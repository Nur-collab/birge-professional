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
# request carrying it may trust X-Forwarded-For for the visitor IP; direct
# requests keep using Cloudflare's overwritten CF-Connecting-IP. Empty disables
# forwarded-IP trust (safe, but the auth proxy then shares one edge bucket).
AUTH_PROXY_SECRET = os.environ.get("AUTH_PROXY_SECRET", "").strip()
if not AUTH_COOKIE_PATH.startswith("/"):
    AUTH_COOKIE_PATH = f"/{AUTH_COOKIE_PATH}"
