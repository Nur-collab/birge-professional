"""Shared rate limiting with Redis and an in-process fallback.

The Redis implementation is used when REDIS_URL is configured, so all
workers share the same counters. Without Redis the limiter falls back to
process-local memory for local development and tests.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import deque
from typing import Deque, Optional

import redis
from fastapi import HTTPException

from config import REDIS_URL

logger = logging.getLogger("birge")

_NAMESPACE = "birge:rate"


class RateLimiter:
    def __init__(self, redis_url: Optional[str] = None) -> None:
        self._redis_url = (REDIS_URL if redis_url is None else redis_url).strip()
        self._client: Optional[redis.Redis] = None
        self._client_lock = threading.Lock()
        self._memory: dict[str, Deque[float]] = {}
        self._memory_lock = threading.Lock()

    def _get_client(self) -> Optional[redis.Redis]:
        if not self._redis_url:
            return None
        if self._client is None:
            with self._client_lock:
                if self._client is None:
                    self._client = redis.Redis.from_url(
                        self._redis_url,
                        decode_responses=True,
                        protocol=2,
                        socket_connect_timeout=2,
                        socket_timeout=2,
                    )
        return self._client

    @staticmethod
    def _redis_hit(client: redis.Redis, key: str, limit: int, window_seconds: int) -> bool:
        full_key = f"{_NAMESPACE}:{key}"
        count = client.incr(full_key)
        client.expire(full_key, window_seconds)
        return int(count) <= limit

    def _memory_hit(self, key: str, limit: int, window_seconds: int) -> bool:
        now = time.monotonic()
        with self._memory_lock:
            # Keep the fallback bounded when Redis is unavailable and many
            # distinct client IPs hit the auth endpoints.
            if len(self._memory) > 2048:
                for old_key in list(self._memory):
                    bucket = self._memory[old_key]
                    if not bucket or now - bucket[-1] >= window_seconds:
                        self._memory.pop(old_key, None)
                while len(self._memory) > 2048:
                    self._memory.pop(next(iter(self._memory)))

            bucket = self._memory.setdefault(key, deque())
            while bucket and now - bucket[0] >= window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True

    def hit_sync(self, key: str, limit: int, window_seconds: int) -> bool:
        """Blocking variant for sync FastAPI routes running in a threadpool."""
        if limit <= 0 or window_seconds <= 0:
            raise ValueError("limit and window_seconds must be positive")

        client = self._get_client()
        if client is not None:
            try:
                return self._redis_hit(client, key, limit, window_seconds)
            except Exception:
                logger.exception(
                    "[RateLimit] Redis unavailable; using process-local fallback"
                )
        return self._memory_hit(key, limit, window_seconds)

    async def hit(self, key: str, limit: int, window_seconds: int) -> bool:
        """Record one request. Returns False when the limit is exhausted."""
        return await asyncio.to_thread(self.hit_sync, key, limit, window_seconds)

    def reset_memory(self) -> None:
        """Clear the local fallback; used by tests and local tooling."""
        with self._memory_lock:
            self._memory.clear()

    async def close(self) -> None:
        client = self._client
        self._client = None
        if client is not None:
            await asyncio.to_thread(client.close)


_limiter: Optional[RateLimiter] = None
_limiter_lock = threading.Lock()


def get_rate_limiter() -> RateLimiter:
    global _limiter
    if _limiter is None:
        with _limiter_lock:
            if _limiter is None:
                _limiter = RateLimiter()
    return _limiter


async def close_rate_limiter() -> None:
    global _limiter
    limiter = _limiter
    _limiter = None
    if limiter is not None:
        await limiter.close()


def _limit_key(user_id: int, action: str) -> str:
    return f"user:{user_id}:{action}"


def _raise_limit_error() -> None:
    raise HTTPException(
        status_code=429,
        detail="Слишком много запросов. Попробуйте позже.",
    )


async def enforce_user_limit(
    user_id: int,
    action: str,
    limit: int,
    window_seconds: int,
) -> None:
    """Enforce a shared per-user limit on an async write endpoint."""
    if not await get_rate_limiter().hit(_limit_key(user_id, action), limit, window_seconds):
        _raise_limit_error()


def enforce_user_limit_sync(
    user_id: int,
    action: str,
    limit: int,
    window_seconds: int,
) -> None:
    """Enforce a shared per-user limit on a sync write endpoint."""
    if not get_rate_limiter().hit_sync(_limit_key(user_id, action), limit, window_seconds):
        _raise_limit_error()
