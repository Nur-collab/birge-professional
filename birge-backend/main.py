from contextlib import asynccontextmanager
import asyncio
import logging
import os
import sys
import time
from uuid import uuid4

import httpx
import redis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

import database
from config import (
    ALLOWED_ORIGIN_REGEX,
    ALLOWED_ORIGINS,
    IS_PRODUCTION,
    REDIS_URL,
    require_auth_proxy_secret,
)
from dependencies import get_current_admin
from logging_config import bind_request_id, configure_logging, reset_request_id
from rate_limit import close_rate_limiter
from realtime import start_realtime, stop_realtime
from routers.admin import router as admin_router
from routers.auth import router as auth_router
from routers.bot import TELEGRAM_WEBHOOK_SECRET, router as bot_router, telegram_webhook
from routers.chat import router as chat_router
from routers.reviews import create_review, router as reviews_router
from routers.trip_requests import router as trip_requests_router
from routers.trips import router as trips_router
from routers.users import router as users_router
from sentry_config import init_sentry
from time_utils import get_bishkek_today_str
from trip_maintenance import cleanup_stale_trips, reminder_loop, stale_cleanup_loop

# Ensure UTF-8 console output on Windows and Linux alike.
for _stream in (sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass

configure_logging()
logger = logging.getLogger("birge")
init_sentry()

# Fail at import time (before uvicorn serves) instead of silently collapsing
# every visitor into one shared auth rate-limit bucket.
try:
    require_auth_proxy_secret()
except RuntimeError as exc:
    logger.critical("[Config] %s", exc)
    raise

__all__ = [
    "ALLOWED_ORIGINS",
    "app",
    "cleanup_stale_trips",
    "create_review",
    "get_bishkek_today_str",
    "get_current_admin",
    "telegram_webhook",
]


async def _register_telegram_webhook() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "").strip()
    if not token or not render_url:
        logger.info("[Telegram] Bot token or RENDER_EXTERNAL_URL missing; webhook skipped")
        return

    webhook_url = f"{render_url}/bot/webhook"
    webhook_payload = {"url": webhook_url}
    if TELEGRAM_WEBHOOK_SECRET:
        webhook_payload["secret_token"] = TELEGRAM_WEBHOOK_SECRET

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{token}/setWebhook",
                json=webhook_payload,
            )
        result = resp.json()
        if result.get("ok"):
            logger.info("[Telegram] Webhook registered: %s", webhook_url)
        else:
            logger.warning("[Telegram] Webhook registration failed: %s", result.get("description"))
    except Exception as exc:
        logger.warning("[Telegram] Webhook registration error: %s", type(exc).__name__)


async def startup_tasks() -> list[asyncio.Task]:
    """Run startup cleanup, start background loops, and register webhook."""
    try:
        with database.SessionLocal() as db:
            startup_stats = cleanup_stale_trips(db)
            logger.info("[Startup] Stale trip cleanup completed: %s", startup_stats)
    except Exception:
        logger.exception("[Startup] Stale trip cleanup failed")

    tasks = [
        asyncio.create_task(stale_cleanup_loop(), name="birge-stale-cleanup"),
        asyncio.create_task(reminder_loop(), name="birge-trip-reminders"),
    ]
    await _register_telegram_webhook()
    return tasks


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle: startup -> yield -> shutdown."""
    await start_realtime()
    bg_tasks: list[asyncio.Task] = []
    try:
        bg_tasks = await startup_tasks()
        yield
    finally:
        for task in bg_tasks:
            task.cancel()
        if bg_tasks:
            await asyncio.gather(*bg_tasks, return_exceptions=True)
        await stop_realtime()
        await close_rate_limiter()


app = FastAPI(
    title="Birge API - MVP Backend",
    lifespan=lifespan,
    # Public API docs are useful in development but unnecessary attack surface
    # in production. The schema is exported at build time for frontend types.
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)


@app.middleware("http")
async def request_id_middleware(request, call_next):
    """Attach a stable request id to every response and log record."""
    incoming = request.headers.get("X-Request-ID", "").strip()
    request_id = incoming[:128] if incoming else uuid4().hex
    request.state.request_id = request_id
    token = bind_request_id(request_id)
    started = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request.complete",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response
    except Exception:
        logger.exception(
            "request.failed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": 500,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        raise
    finally:
        reset_request_id(token)


@app.middleware("http")
async def security_headers_middleware(request, call_next):
    """Add baseline browser protections to every API response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "geolocation=(self), camera=(), microphone=(), payment=()"
    )
    response.headers["Content-Security-Policy"] = (
        "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
    )
    is_authenticated = "authorization" in request.headers
    if (
        is_authenticated
        or request.url.path == "/users"
        or request.url.path.startswith(("/auth/", "/users/", "/internal/"))
    ):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    if IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


app.include_router(auth_router)
app.include_router(trips_router)
app.include_router(users_router)
app.include_router(trip_requests_router)
app.include_router(chat_router)
app.include_router(reviews_router)
app.include_router(bot_router)
app.include_router(admin_router)


@app.get("/health")
def health_check():
    """Public liveness probe for uptime monitoring."""
    return {"status": "ok"}


@app.get("/ready")
def readiness_check():
    """Readiness: database is reachable and optional Redis is configured."""
    try:
        with database.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        logger.exception("[Readiness] Database check failed")
        raise HTTPException(status_code=503, detail="Database is not ready") from exc

    if REDIS_URL:
        client = None
        try:
            client = redis.Redis.from_url(
                REDIS_URL,
                protocol=2,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            client.ping()
        except Exception as exc:
            logger.warning("[Readiness] Redis check failed: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail="Redis is not ready") from exc
        finally:
            if client is not None:
                client.close()

    return {"status": "ready"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)
