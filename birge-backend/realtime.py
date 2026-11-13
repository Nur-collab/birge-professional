"""In-process realtime state shared by HTTP routes and the WebSocket handler.

This is intentionally single-process; Redis Pub/Sub is required before
running multiple workers.
"""
import asyncio
import contextlib
import logging
from typing import Dict, List

from fastapi import WebSocket
from sqlalchemy.orm import Session

import models

logger = logging.getLogger("birge")


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
