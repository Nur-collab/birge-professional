"""Shared runtime configuration flags.

Environment values are loaded here first so every module sees the same
production flag regardless of import order.
"""
import os

from dotenv import load_dotenv

load_dotenv()

IS_PRODUCTION = bool(os.environ.get("RENDER")) or os.environ.get("ENVIRONMENT", "").lower() == "production"

# Shared rate limits and SSE/WebSocket Pub/Sub. Empty means in-process mode.
REDIS_URL = os.environ.get("REDIS_URL", "").strip()

# Exact browser origins allowed by CORS and cookie CSRF checks.
# Production should set ALLOWED_ORIGINS explicitly; legacy defaults are kept
# for local development and old deployments.
_DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4173",
    "https://birge-professional.vercel.app",
    "https://birge-nine.vercel.app",
    "https://birge.vercel.app",
    "https://birge-5c900.web.app",
    "https://birge-5c900.firebaseapp.com",
]
_env_allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
ALLOWED_ORIGINS = list(dict.fromkeys(_env_allowed_origins or _DEFAULT_ALLOWED_ORIGINS))
ALLOWED_ORIGIN_REGEX = os.environ.get("CORS_ORIGIN_REGEX", "").strip() or None

# The frontend always calls the same-origin /api/auth proxy: Vite forwards it
# to the API in development, vercel.json forwards it in production. The refresh
# cookie is therefore first-party everywhere and can use SameSite=Lax.
AUTH_COOKIE_PATH = os.environ.get("AUTH_COOKIE_PATH", "/api/auth").strip() or "/api/auth"

# Shared secret that the Vercel rewrite injects into /api/auth requests. Only a
# request carrying it may trust the middleware's x-auth-client-ip header;
# without it the backend falls back to Cloudflare's CF-Connecting-IP, which is
# not spoofable but is shared by every visitor behind the Vercel edge.
AUTH_PROXY_SECRET = os.environ.get("AUTH_PROXY_SECRET", "").strip()
if not AUTH_COOKIE_PATH.startswith("/"):
    AUTH_COOKIE_PATH = f"/{AUTH_COOKIE_PATH}"


def require_auth_proxy_secret() -> None:
    """Refuse to start production without the Vercel proxy secret.

    An unset secret silently places every visitor in one shared Cloudflare
    rate-limit bucket, so per-IP limits stop protecting individual users. That
    is a deployment mistake: a failed deploy with a clear log is safer than a
    quiet degradation nobody notices.
    """
    if IS_PRODUCTION and not AUTH_PROXY_SECRET:
        raise RuntimeError(
            "AUTH_PROXY_SECRET is required when IS_PRODUCTION is true. Set it "
            "on Render to the same value as ORIGIN_SECRET in the Vercel "
            "project; otherwise every /api/auth request falls back to one "
            "shared Cloudflare IP bucket."
        )
