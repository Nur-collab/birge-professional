"""Realtime fan-out for WebSocket chat and SSE.

Every worker keeps its own local WebSocket connections and SSE queues. When
REDIS_URL is configured, events are published to one Redis channel and every
worker dispatches them to its local clients. Without Redis the module keeps
the original in-process behavior for local development and tests.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import threading
from typing import Any, Dict, List, Optional

import redis
from fastapi import WebSocket
from sqlalchemy.orm import Session

import models

logger = logging.getLogger("birge")

CHANNEL = "birge:realtime"


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, trip_id: str):
        await websocket.accept()
        if trip_id not in self.active_connections:
            self.active_connections[trip_id] = []
        self.active_connections[trip_id].append(websocket)

    def disconnect(self, websocket: WebSocket, trip_id: str):
        if trip_id in self.active_connections:
            self.active_connections[trip_id].remove(websocket)
            if not self.active_connections[trip_id]:
                self.active_connections.pop(trip_id)

    async def broadcast(self, message: str, trip_id: str):
        if trip_id in self.active_connections:
            dead_connections = []
            for connection in list(self.active_connections[trip_id]):
                try:
                    await connection.send_text(message)
                except Exception as exc:
                    logger.warning(f"[WS] Error broadcasting to client on trip {trip_id}: {exc}")
                    dead_connections.append(connection)
            for dead in dead_connections:
                self.disconnect(dead, trip_id)


manager = ConnectionManager()


class SSEManager:
    """Хранит список asyncio.Queue для каждого user_id.

    Поддерживает несколько одновременных подключений одного пользователя
    (например, две открытые вкладки браузера) — все получают события.
    """

    def __init__(self):
        self._queues: dict[int, list[asyncio.Queue]] = {}

    def subscribe(self, user_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=50)
        if user_id not in self._queues:
            self._queues[user_id] = []
        self._queues[user_id].append(q)
        return q

    def unsubscribe(self, user_id: int, q: asyncio.Queue) -> None:
        queues = self._queues.get(user_id)
        if queues and q in queues:
            queues.remove(q)
        if not queues:
            self._queues.pop(user_id, None)

    async def push(self, user_id: int, data: str) -> None:
        """Отправляет событие во все активные очереди пользователя (non-blocking)."""
        for q in list(self._queues.get(user_id, [])):
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                with contextlib.suppress(asyncio.QueueEmpty):
                    q.get_nowait()
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(data)


sse_manager = SSEManager()        # passenger: receives accept/decline events
driver_sse_manager = SSEManager()  # driver: receives new trip-request events

_redis_url: str = ""
_publish_client: Optional[redis.Redis] = None
_listener_thread: Optional[threading.Thread] = None
_stop_event: Optional[threading.Event] = None
_ready: Optional[asyncio.Event] = None
_loop: Optional[asyncio.AbstractEventLoop] = None


async def _dispatch_local(event: dict[str, Any]) -> None:
    kind = event.get("kind")
    data = event.get("data")
    if not isinstance(data, str):
        return
    try:
        if kind == "sse_driver":
            await driver_sse_manager.push(int(event["user_id"]), data)
        elif kind == "sse_requester":
            await sse_manager.push(int(event["user_id"]), data)
        elif kind == "ws_chat":
            await manager.broadcast(data, str(event["trip_id"]))
        else:
            logger.warning("[Realtime] Unknown event kind: %r", kind)
    except (KeyError, TypeError, ValueError):
        logger.warning("[Realtime] Invalid event payload: %r", event)


def _listen_loop(
    redis_url: str,
    loop: asyncio.AbstractEventLoop,
    ready: asyncio.Event,
    stop: threading.Event,
) -> None:
    delay = 1.0
    while not stop.is_set() and not loop.is_closed():
        client = None
        pubsub = None
        try:
            client = redis.Redis.from_url(
                redis_url,
                decode_responses=True,
                protocol=2,
                socket_connect_timeout=3,
                socket_timeout=3,
            )
            pubsub = client.pubsub()
            pubsub.subscribe(CHANNEL)
            loop.call_soon_threadsafe(ready.set)
            delay = 1.0

            while not stop.is_set():
                message = pubsub.get_message(ignore_subscribe_messages=True, timeout=0.5)
                if not message or message.get("type") != "message":
                    continue
                try:
                    event = json.loads(message["data"])
                except (TypeError, ValueError):
                    logger.warning("[Realtime] Invalid Pub/Sub payload")
                    continue
                try:
                    asyncio.run_coroutine_threadsafe(_dispatch_local(event), loop)
                except RuntimeError:
                    return
        except Exception:
            if stop.is_set() or loop.is_closed():
                break
            logger.exception(
                "[Realtime] Redis Pub/Sub listener failed; reconnecting in %.1fs",
                delay,
            )
            stop.wait(delay)
            delay = min(delay * 2, 30.0)
        finally:
            if pubsub is not None:
                with contextlib.suppress(Exception):
                    pubsub.close()
            if client is not None:
                with contextlib.suppress(Exception):
                    client.close()


async def start_realtime(redis_url: Optional[str] = None) -> None:
    """Start the Redis listener. Empty URL keeps in-process delivery."""
    global _redis_url, _publish_client, _listener_thread, _stop_event, _ready, _loop

    target = (redis_url if redis_url is not None else os.environ.get("REDIS_URL", "")).strip()
    if not target:
        logger.info("[Realtime] REDIS_URL is empty; using in-process delivery")
        return

    if _listener_thread is not None and _listener_thread.is_alive():
        if _redis_url == target:
            return
        await stop_realtime()

    loop = asyncio.get_running_loop()
    ready = asyncio.Event()
    stop = threading.Event()
    client = redis.Redis.from_url(
        target,
        decode_responses=True,
        protocol=2,
        socket_connect_timeout=3,
        socket_timeout=3,
    )
    try:
        await asyncio.to_thread(client.ping)
    except Exception:
        client.close()
        logger.exception("[Realtime] Cannot connect to Redis at %s", target)
        raise

    thread = threading.Thread(
        target=_listen_loop,
        args=(target, loop, ready, stop),
        name="birge-realtime",
        daemon=True,
    )
    _redis_url = target
    _publish_client = client
    _listener_thread = thread
    _stop_event = stop
    _ready = ready
    _loop = loop
    thread.start()
    try:
        await asyncio.wait_for(ready.wait(), timeout=5)
    except asyncio.TimeoutError as exc:
        await stop_realtime()
        raise RuntimeError("Realtime Redis listener did not become ready") from exc
    logger.info("[Realtime] Redis Pub/Sub listener started: %s", target)


async def wait_ready(timeout: float = 5) -> None:
    """Wait until the current Redis subscription is active."""
    if _ready is None:
        return
    await asyncio.wait_for(_ready.wait(), timeout)


async def stop_realtime() -> None:
    global _redis_url, _publish_client, _listener_thread, _stop_event, _ready, _loop

    stop = _stop_event
    thread = _listener_thread
    client = _publish_client
    _redis_url = ""
    _publish_client = None
    _listener_thread = None
    _stop_event = None
    _ready = None
    _loop = None

    if stop is not None:
        stop.set()
    if thread is not None:
        await asyncio.to_thread(thread.join, 3)
    if client is not None:
        await asyncio.to_thread(client.close)


async def _publish(event: dict[str, Any]) -> bool:
    client = _publish_client
    if client is None:
        return False
    payload = json.dumps(event, ensure_ascii=False)
    try:
        await asyncio.to_thread(client.publish, CHANNEL, payload)
        return True
    except Exception:
        logger.exception("[Realtime] Redis publish failed; using local fallback")
        return False


async def publish_driver_event(user_id: int, data: str) -> None:
    if await _publish({"kind": "sse_driver", "user_id": user_id, "data": data}):
        return
    await driver_sse_manager.push(user_id, data)


async def publish_requester_event(user_id: int, data: str) -> None:
    if await _publish({"kind": "sse_requester", "user_id": user_id, "data": data}):
        return
    await sse_manager.push(user_id, data)


async def publish_chat_message(trip_id: str | int, data: str) -> None:
    if await _publish({"kind": "ws_chat", "trip_id": str(trip_id), "data": data}):
        return
    await manager.broadcast(data, str(trip_id))


def is_trip_participant(db: Session, trip_id: int, user_id: int) -> bool:
    """Проверяет, имеет ли пользователь право доступа к чату поездки."""
    trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not trip:
        return False
    if trip.user_id == user_id:
        return True

    accepted_as_passenger = db.query(models.TripRequest).filter(
        models.TripRequest.trip_id == trip_id,
        models.TripRequest.requester_id == user_id,
        models.TripRequest.status.in_(["accepted", "completed"]),
    ).first()
    if accepted_as_passenger:
        return True

    accepted_as_driver = db.query(models.TripRequest).filter(
        models.TripRequest.requester_trip_id == trip_id,
        models.TripRequest.driver_id == user_id,
        models.TripRequest.status.in_(["accepted", "completed"]),
    ).first()
    return bool(accepted_as_driver)
