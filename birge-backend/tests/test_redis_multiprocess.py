"""Multiprocess tests for Redis-backed rate limiting and Pub/Sub.

Each test starts a real separate Python process. By default the process talks
to a tiny RESP server from ``tests/redis_stub.py``. CI can set TEST_REDIS_URL
to run the same tests against a real Redis service.
"""
from __future__ import annotations

import asyncio
import json
import os
import queue
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import pytest

from tests.redis_stub import RedisStub

ROOT = Path(__file__).resolve().parents[1]

RATE_CHILD = r"""
import asyncio
import json
import sys
from rate_limit import RateLimiter

async def main():
    limiter = RateLimiter(sys.argv[1])
    try:
        result = [await limiter.hit(sys.argv[2], 2, 60) for _ in range(2)]
    finally:
        await limiter.close()
    print("RESULT:" + json.dumps(result), flush=True)

asyncio.run(main())
"""

SSE_CHILD = r"""
import asyncio
import sys
import realtime

async def main():
    await realtime.start_realtime(sys.argv[1])
    await realtime.wait_ready(10)
    user_id = int(sys.argv[2])
    events = realtime.driver_sse_manager.subscribe(user_id)
    print("READY", flush=True)
    try:
        data = await asyncio.wait_for(events.get(), 15)
        print("RESULT:" + data, flush=True)
    finally:
        realtime.driver_sse_manager.unsubscribe(user_id, events)
        await realtime.stop_realtime()

asyncio.run(main())
"""

WS_CHILD = r"""
import asyncio
import sys
import realtime

class FakeWebSocket:
    def __init__(self):
        self.messages = []
        self.received = asyncio.Event()

    async def send_text(self, message):
        self.messages.append(message)
        self.received.set()

async def main():
    await realtime.start_realtime(sys.argv[1])
    await realtime.wait_ready(10)
    trip_id = sys.argv[2]
    websocket = FakeWebSocket()
    realtime.manager.active_connections[trip_id] = [websocket]
    print("READY", flush=True)
    try:
        await asyncio.wait_for(websocket.received.wait(), 15)
        print("RESULT:" + websocket.messages[0], flush=True)
    finally:
        realtime.manager.active_connections.pop(trip_id, None)
        await realtime.stop_realtime()

asyncio.run(main())
"""


@pytest.fixture()
def redis_url():
    external = os.environ.get("TEST_REDIS_URL", "").strip()
    if external:
        yield external
        return
    with RedisStub() as stub:
        yield stub.url


def _start_child(code: str, redis_url: str, *args: str) -> subprocess.Popen:
    env = os.environ.copy()
    pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) + (os.pathsep + pythonpath if pythonpath else "")
    return subprocess.Popen(
        [sys.executable, "-u", "-c", code, redis_url, *args],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _read_line(process: subprocess.Popen, timeout: float = 20) -> str:
    lines: queue.Queue[str] = queue.Queue()

    def read() -> None:
        lines.put(process.stdout.readline())

    threading.Thread(target=read, daemon=True).start()
    try:
        line = lines.get(timeout=timeout).strip()
    except queue.Empty as exc:
        process.kill()
        raise AssertionError("child process did not respond in time") from exc
    if not line:
        stderr = process.stderr.read()
        raise AssertionError(f"child process exited without output: {stderr}")
    return line


def _finish(process: subprocess.Popen) -> None:
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    if process.returncode != 0:
        raise AssertionError(process.stderr.read())


def test_rate_limit_is_shared_between_processes(redis_url):
    from rate_limit import RateLimiter

    key = f"test:{uuid.uuid4().hex}"

    async def parent_hit() -> bool:
        limiter = RateLimiter(redis_url)
        try:
            return await limiter.hit(key, 2, 60)
        finally:
            await limiter.close()

    assert asyncio.run(parent_hit()) is True

    child = _start_child(RATE_CHILD, redis_url, key)
    try:
        line = _read_line(child)
        assert line.startswith("RESULT:"), line
        assert json.loads(line.removeprefix("RESULT:")) == [True, False]
        _finish(child)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)


def test_sse_event_is_delivered_across_processes(redis_url):
    import realtime

    user_id = 7_000_000 + uuid.uuid4().int % 100_000
    payload = '{"id":1,"status":"pending"}'
    child = _start_child(SSE_CHILD, redis_url, str(user_id))
    try:
        assert _read_line(child) == "READY"

        async def publish() -> None:
            await realtime.start_realtime(redis_url)
            await realtime.wait_ready(10)
            try:
                await realtime.publish_driver_event(user_id, payload)
                await asyncio.sleep(0.2)
            finally:
                await realtime.stop_realtime()

        asyncio.run(publish())
        line = _read_line(child)
        assert line == "RESULT:" + payload, line
        _finish(child)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)


def test_websocket_message_is_delivered_across_processes(redis_url):
    import realtime

    trip_id = str(8_000_000 + uuid.uuid4().int % 100_000)
    payload = '{"text":"hello from another worker"}'
    child = _start_child(WS_CHILD, redis_url, trip_id)
    try:
        assert _read_line(child) == "READY"

        async def publish() -> None:
            await realtime.start_realtime(redis_url)
            await realtime.wait_ready(10)
            try:
                await realtime.publish_chat_message(trip_id, payload)
                await asyncio.sleep(0.2)
            finally:
                await realtime.stop_realtime()

        asyncio.run(publish())
        line = _read_line(child)
        assert line == "RESULT:" + payload, line
        _finish(child)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
