"""Authentication endpoints: phone code delivery, verification and refresh."""
from datetime import datetime, timezone
import hmac
import ipaddress
import logging
import secrets
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status
from pydantic import Field
from sqlalchemy.orm import Session

import auth as auth_service
import models
import schemas
from config import (
    ALLOWED_ORIGINS,
    AUTH_COOKIE_PATH,
    AUTH_PROXY_SECRET,
    IS_PRODUCTION,
    NATIVE_WEBVIEW_ORIGINS,
)
from database import get_db
from dependencies import get_current_user
from rate_limit import get_rate_limiter
from sentry_config import capture_auth_proxy_fallback

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class VerifyCodePayload(schemas.VerifyCodeRequest):
    name: Optional[str] = Field(default=None, max_length=80)


_SEND_CODE_WINDOW_SECONDS = 600
_SEND_CODE_MAX_PER_WINDOW = 10

_VERIFY_CODE_WINDOW_SECONDS = 60
_VERIFY_CODE_MAX_PER_WINDOW = 15

_REFRESH_WINDOW_SECONDS = 60
_REFRESH_MAX_PER_WINDOW = 30

_LOGIN_CODE_WINDOW_SECONDS = 60
_LOGIN_CODE_MAX_PER_WINDOW = 10
_EXCHANGE_CODE_WINDOW_SECONDS = 60
_EXCHANGE_CODE_MAX_PER_WINDOW = 20
_TG_CHALLENGE_CREATE_WINDOW_SECONDS = 60
_TG_CHALLENGE_CREATE_MAX_PER_WINDOW = 20
_TG_CHALLENGE_STATUS_WINDOW_SECONDS = 60
_TG_CHALLENGE_STATUS_MAX_PER_WINDOW = 120
_TG_CHALLENGE_COMPLETE_WINDOW_SECONDS = 60
_TG_CHALLENGE_COMPLETE_MAX_PER_WINDOW = 20

# Deliberately neutral: the response must not reveal whether the phone has a
# Telegram binding or which delivery channel was used.
_SEND_CODE_ACCEPTED_MESSAGE = "Запрос на отправку кода принят"

REFRESH_COOKIE_NAME = "birge_refresh"
CSRF_COOKIE_NAME = "birge_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"
_COOKIE_MAX_AGE = auth_service.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


_AUTH_PROXY_HEADER = "x-auth-proxy-secret"
# Carrier-grade NAT is common for mobile operators; it is not globally
# routable but it is a real visitor address that must keep its own bucket.
_CGNAT_NETWORKS = (ipaddress.ip_network("100.64.0.0/10"),)


def _usable_ip(value: str) -> Optional[str]:
    """Return a canonical visitor address, or None for spoofable values."""
    try:
        address = ipaddress.ip_address((value or "").strip())
    except ValueError:
        return None
    if any(address in network for network in _CGNAT_NETWORKS):
        return str(address)
    return str(address) if address.is_global else None


def _from_auth_proxy(request: Request) -> bool:
    """True only for requests signed by the Vercel rewrite.

    Vercel overwrites x-auth-proxy-secret on the way to the origin, so a direct
    caller cannot forge it. Without the secret, X-Forwarded-For is ignored.
    """
    if not AUTH_PROXY_SECRET:
        return False
    provided = request.headers.get(_AUTH_PROXY_HEADER, "")
    return bool(provided) and hmac.compare_digest(provided, AUTH_PROXY_SECRET)


_proxy_fallback_warned = False


def _warn_proxy_fallback_once() -> None:
    """Report a proxied request with a bad signature once per process.

    The Vercel middleware header is present but the rewrite did not inject a
    matching secret: ORIGIN_SECRET is unset in Vercel (or differs from
    AUTH_PROXY_SECRET), so every visitor lands in one shared rate-limit bucket
    instead. Direct calls to the origin never reach this branch.
    """
    global _proxy_fallback_warned
    if _proxy_fallback_warned or not IS_PRODUCTION:
        return
    _proxy_fallback_warned = True
    logger.warning(
        "Auth request from the Vercel middleware has no valid "
        "x-auth-proxy-secret; falling back to CF-Connecting-IP, so all "
        "visitors share one rate-limit bucket. Check that ORIGIN_SECRET is "
        "set in Vercel and equals AUTH_PROXY_SECRET."
    )
    capture_auth_proxy_fallback()


def _client_ip(request: Request) -> str:
    """Return the visitor address verified by the Vercel proxy.

    Vercel's routing middleware resolves the edge-sanitized address and writes
    it to x-auth-client-ip before the external rewrite. X-Forwarded-For is
    never trusted: on rewrites to external origins Vercel forwards a
    caller-supplied value, so reading it would reopen the per-IP bypass.

    Cloudflare in front of Render overwrites CF-Connecting-IP with the address
    that connected to it. For /api/auth that is the shared Vercel egress, so
    it is only a safe fallback (no bypass, but all visitors share a bucket)
    when the middleware header is absent or unusable.
    """
    if _from_auth_proxy(request):
        visitor = _usable_ip(request.headers.get("x-auth-client-ip", ""))
        if visitor:
            return visitor
    elif request.headers.get("x-auth-client-ip", "").strip():
        # The Vercel middleware ran but the rewrite did not sign the request.
        _warn_proxy_fallback_once()
    cloudflare_ip = _usable_ip(request.headers.get("cf-connecting-ip", ""))
    if cloudflare_ip:
        return cloudflare_ip
    return request.client.host if request.client else "unknown"


def _token_payload(user: models.User) -> dict:
    """Claims for a session that can be revoked via User.token_version."""
    return {"sub": str(user.id), "ver": int(user.token_version or 0)}


def _cookie_options() -> dict:
    """Cookie attributes for the first-party auth proxy.

    Production uses the Vercel /api/auth proxy so the refresh cookie is
    first-party. Lax is therefore both sufficient and safer than None, which
    would be a third-party cookie in a direct Vercel -> Render setup.
    """
    return {
        "max_age": _COOKIE_MAX_AGE,
        "path": AUTH_COOKIE_PATH,
        "secure": IS_PRODUCTION,
        "httponly": True,
        "samesite": "lax",
    }


def _set_session_cookies(response: Response, refresh_token: str, csrf_token: str) -> None:
    options = _cookie_options()
    response.set_cookie(REFRESH_COOKIE_NAME, refresh_token, **options)
    response.set_cookie(CSRF_COOKIE_NAME, csrf_token, **options)


def _clear_session_cookies(response: Response) -> None:
    options = _cookie_options()
    options.pop("max_age", None)
    response.delete_cookie(REFRESH_COOKIE_NAME, **options)
    response.delete_cookie(CSRF_COOKIE_NAME, **options)


def _origin_allowed(request: Request, origin: str) -> bool:
    if origin in ALLOWED_ORIGINS:
        return True
    # Every Vercel preview deployment gets its own host. Vercel overwrites
    # x-forwarded-host with the host the browser requested, so a same-origin
    # request from a preview matches itself without trusting every
    # *.vercel.app subdomain. The CSRF token is still required.
    forwarded_host = request.headers.get("x-forwarded-host", "").split(",", 1)[0].strip()
    if not forwarded_host:
        return False
    proto = request.headers.get("x-forwarded-proto", "https").split(",", 1)[0].strip()
    if proto not in ("http", "https"):
        proto = "https"
    return origin == f"{proto}://{forwarded_host}"


def _require_csrf(request: Request) -> None:
    """Validate the cookie-bound CSRF token before rotating a refresh session."""
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME, "")
    header_token = request.headers.get(CSRF_HEADER_NAME, "")
    if (
        not cookie_token
        or not header_token
        or not hmac.compare_digest(cookie_token, header_token)
    ):
        raise HTTPException(status_code=403, detail="CSRF validation failed")

    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin and not _origin_allowed(request, origin):
        raise HTTPException(status_code=403, detail="Origin is not allowed")


def _request_origin(request: Request) -> str:
    return (request.headers.get("origin") or "").strip().rstrip("/")


def _is_native_webview_origin(request: Request) -> bool:
    """True only when a packaged Capacitor/Ionic WebView sends its own Origin."""
    return _request_origin(request) in NATIVE_WEBVIEW_ORIGINS


def _session_payload(
    user: models.User,
    db: Session,
    response: Response,
    *,
    include_refresh_token: bool = False,
) -> dict:
    """Issue access token and HttpOnly refresh/CSRF cookie pair."""
    token_data = _token_payload(user)
    refresh_token = auth_service.issue_refresh_token(user, db)
    csrf_token = secrets.token_urlsafe(32)
    _set_session_cookies(response, refresh_token, csrf_token)
    payload = {
        "access_token": auth_service.create_access_token(token_data),
        "csrf_token": csrf_token,
        "token_type": "bearer",
        "expires_in": auth_service.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user_id": user.id,
        "user": schemas.User.model_validate(user).model_dump(),
    }
    if include_refresh_token:
        payload["refresh_token"] = refresh_token
    return payload


def _check_refresh_rate(user_id: int) -> None:
    """Limit rotations per account, not by a spoofable request header."""
    allowed = get_rate_limiter().hit_sync(
        f"auth:refresh:user:{user_id}",
        _REFRESH_MAX_PER_WINDOW,
        _REFRESH_WINDOW_SECONDS,
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Слишком много обновлений сессии. Попробуйте позже.",
        )


async def _check_ip_rate(
    ip: str,
    bucket: str,
    max_hits: int,
    window_seconds: int,
    detail: str,
) -> None:
    allowed = await get_rate_limiter().hit(
        f"{bucket}:{ip}",
        max_hits,
        window_seconds,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail=detail)


async def _check_exchange_code_rate(ip: str) -> None:
    await _check_ip_rate(
        ip,
        "auth:exchange-code",
        _EXCHANGE_CODE_MAX_PER_WINDOW,
        _EXCHANGE_CODE_WINDOW_SECONDS,
        "Слишком много попыток входа. Попробуйте позже.",
    )


async def _check_send_code_rate(ip: str) -> None:
    await _check_ip_rate(
        ip,
        "auth:send-code",
        _SEND_CODE_MAX_PER_WINDOW,
        _SEND_CODE_WINDOW_SECONDS,
        "Слишком много запросов кода. Попробуйте позже.",
    )


async def _check_verify_code_rate(ip: str) -> None:
    await _check_ip_rate(
        ip,
        "auth:verify-code",
        _VERIFY_CODE_MAX_PER_WINDOW,
        _VERIFY_CODE_WINDOW_SECONDS,
        "Слишком много попыток ввода кода. Подождите минуту.",
    )


@router.post("/send-code")
async def send_code(req: schemas.SendCodeRequest, request: Request, db: Session = Depends(get_db)):
    """Отправка кода через Telegram Bot с нейтральным ответом для любого номера."""
    await _check_send_code_rate(_client_ip(request))

    raw_phone = req.phone.strip()
    if not raw_phone:
        raise HTTPException(status_code=400, detail="Phone number required")

    # Нормализуем кыргызский номер
    is_valid, p_e164, p_digits, p_formatted, op_or_err = auth_service.normalize_kg_phone(raw_phone)
    if not is_valid:
        raise HTTPException(status_code=400, detail=op_or_err)

    # Генерируем 6-значный код криптографически стойким генератором
    code = str(secrets.randbelow(900000) + 100000)

    # Сохраняем в БД по нормализованному формату (с проверкой rate limit)
    ok, error_msg = auth_service.save_sms_code(p_e164, code, db)
    if not ok:
        raise HTTPException(status_code=429, detail=error_msg)

    # Пробуем отправить через Telegram Bot (ищем по normalized digits)
    chat_id = auth_service.get_telegram_chat_id(p_digits, db)
    delivered = False
    if chat_id:
        delivered = await auth_service.send_telegram_code(chat_id, code)

    if not delivered:
        if IS_PRODUCTION:
            # Не оставляем валидный код в БД, если его невозможно доставить.
            # Клиент всё равно получает нейтральный ответ, чтобы не раскрывать
            # наличие привязки Telegram.
            db.query(models.SmsCode).filter(models.SmsCode.phone == p_e164).delete(synchronize_session=False)
            db.commit()
            logger.warning("Code delivery unavailable; generated code discarded")
        else:
            # Локальная разработка без Telegram: код печатается только в консоль.
            print(f"\n{'='*40}")
            print(f"📱 КОД ДЛЯ {p_formatted} ({p_e164})")
            print(f"👉 ВАШ КОД БИРГЕ: {code} 👈")
            print(f"{'='*40}\n")

    return {"message": _SEND_CODE_ACCEPTED_MESSAGE}


@router.post("/verify-code")
async def verify_code(
    req: VerifyCodePayload,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Проверяет SMS-код и выдает JWT токен."""
    await _check_verify_code_rate(_client_ip(request))
    raw_phone = req.phone.strip()
    code = req.code.strip()
    name = (req.name or "").strip()

    is_valid, p_e164, p_digits, p_formatted, op_or_err = auth_service.normalize_kg_phone(raw_phone)
    if not is_valid:
        raise HTTPException(status_code=400, detail=op_or_err)

    if not auth_service.verify_sms_code(p_e164, code, db):
        raise HTTPException(status_code=400, detail="Invalid, expired, or locked code")

    # Ищем существующего пользователя по любому представлению номера
    user = auth_service.find_user_by_phone(db, p_e164, p_formatted, p_digits)
    if not user:
        # Автоматическая верификация если контакт уже был подтверждён в Telegram боте
        has_tg = db.query(models.TelegramBinding).filter(
            (models.TelegramBinding.phone_normalized == p_digits)
            | (models.TelegramBinding.phone == p_e164)
            | (models.TelegramBinding.phone == p_formatted)
        ).first()
        user = models.User(
            name=name or "Новый пользователь",
            phone=p_e164,
            is_verified=bool(has_tg),
            photo=f"https://i.pravatar.cc/150?u={p_digits}",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Создаём JWT токены (sub строго строковый). Профиль отдаём сразу,
    # чтобы клиент не делал второй запрос и не зависел от гонки сети.
    payload = _session_payload(
        user,
        db,
        response,
        include_refresh_token=_is_native_webview_origin(request),
    )
    db.commit()
    return payload


@router.post("/telegram-challenge", response_model=schemas.TelegramChallengeResponse)
async def create_telegram_challenge(
    request: Request,
    db: Session = Depends(get_db),
):
    """Create a browser-bound challenge for one-tap Telegram contact auth."""
    await _check_ip_rate(
        _client_ip(request),
        "auth:tg-challenge-create",
        _TG_CHALLENGE_CREATE_MAX_PER_WINDOW,
        _TG_CHALLENGE_CREATE_WINDOW_SECONDS,
        "Слишком много запросов на вход через Telegram. Попробуйте позже.",
    )
    challenge_id, verifier, expires_in = auth_service.issue_telegram_challenge(db)
    db.commit()
    return {
        "challenge_id": challenge_id,
        "verifier": verifier,
        "bot_username": auth_service.TELEGRAM_BOT_USERNAME,
        "telegram_url": auth_service.build_telegram_bot_url(f"auth_{challenge_id}"),
        "expires_in": expires_in,
    }


@router.post("/telegram-challenge/status", response_model=schemas.TelegramChallengeStatusResponse)
async def get_telegram_challenge_status(
    req: schemas.TelegramChallengeStatusRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Poll whether the creating browser tab's Telegram challenge was verified."""
    await _check_ip_rate(
        _client_ip(request),
        "auth:tg-challenge-status",
        _TG_CHALLENGE_STATUS_MAX_PER_WINDOW,
        _TG_CHALLENGE_STATUS_WINDOW_SECONDS,
        "Слишком частая проверка статуса. Подождите несколько секунд.",
    )
    row, status_override = auth_service.lookup_telegram_challenge(
        req.challenge_id,
        req.verifier,
        db,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if status_override == "expired":
        return {
            "status": "expired",
            "phone": None,
            "is_new_user": False,
            "expires_in": 0,
        }

    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    remaining = max(0, int((expires_at - datetime.now(timezone.utc)).total_seconds()))

    if row.status == "verified" and row.phone_e164:
        existing_user = auth_service.find_user_by_phone(
            db,
            row.phone_e164,
            row.phone_formatted or "",
        )
        return {
            "status": "verified",
            "phone": row.phone_formatted or row.phone_e164,
            "is_new_user": existing_user is None,
            "expires_in": remaining,
        }

    return {
        "status": row.status if row.status in ("pending", "bot_started") else "pending",
        "phone": None,
        "is_new_user": False,
        "expires_in": remaining,
    }


@router.post("/telegram-challenge/complete")
async def complete_telegram_challenge(
    req: schemas.TelegramChallengeCompleteRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Exchange a verified browser-bound Telegram challenge for session tokens."""
    await _check_ip_rate(
        _client_ip(request),
        "auth:tg-challenge-complete",
        _TG_CHALLENGE_COMPLETE_MAX_PER_WINDOW,
        _TG_CHALLENGE_COMPLETE_WINDOW_SECONDS,
        "Слишком много попыток входа. Попробуйте позже.",
    )
    row, status_override = auth_service.lookup_telegram_challenge(
        req.challenge_id,
        req.verifier,
        db,
        for_update=True,
    )
    if not row or status_override == "expired" or row.status != "verified" or not row.phone_e164:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, unverified, or expired Telegram challenge",
            headers={"WWW-Authenticate": "Bearer"},
        )

    is_valid, p_e164, p_digits, p_formatted, _ = auth_service.normalize_kg_phone(row.phone_e164)
    if not is_valid:
        raise HTTPException(status_code=400, detail="Unsupported phone number")

    row.status = "consumed"
    row.consumed_at = datetime.now(timezone.utc)

    name = (req.name or "").strip()
    user = auth_service.find_user_by_phone(db, p_e164, p_formatted, p_digits)
    if not user:
        user = models.User(
            name=name or "Новый пользователь",
            phone=p_e164,
            is_verified=True,
            photo=f"https://i.pravatar.cc/150?u={p_digits}",
        )
        db.add(user)
        db.flush()
    elif not user.is_verified:
        user.is_verified = True

    payload = _session_payload(
        user,
        db,
        response,
        include_refresh_token=_is_native_webview_origin(request),
    )
    db.commit()
    return payload


@router.post("/login-code")
def create_login_code(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Выдаёт одноразовый код для ссылки входа в приложение."""
    allowed = get_rate_limiter().hit_sync(
        f"auth:login-code:{current_user.id}",
        _LOGIN_CODE_MAX_PER_WINDOW,
        _LOGIN_CODE_WINDOW_SECONDS,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Слишком много запросов кода входа.")

    code = auth_service.issue_login_code(current_user, db)
    db.commit()
    return {"code": code, "expires_in": auth_service.LOGIN_CODE_TTL_SECONDS}


@router.post("/exchange-code")
async def exchange_login_code(
    req: schemas.ExchangeCodeRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Обменивает одноразовый код из ссылки на пару токенов."""
    await _check_exchange_code_rate(_client_ip(request))

    user = auth_service.consume_login_code(req.code, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired login code",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = _session_payload(
        user,
        db,
        response,
        include_refresh_token=_is_native_webview_origin(request),
    )
    db.commit()
    return payload


@router.post("/refresh")
def refresh_access_token(
    request: Request,
    response: Response,
    req: Optional[schemas.RefreshTokenRequest] = Body(default=None),
    db: Session = Depends(get_db),
):
    """Rotate the refresh session and return a new access token."""
    native_origin = _is_native_webview_origin(request)
    cookie_refresh = request.cookies.get(REFRESH_COOKIE_NAME, "")
    if cookie_refresh:
        refresh_token = cookie_refresh
        _require_csrf(request)
        csrf_token = request.cookies.get(CSRF_COOKIE_NAME, "")
    elif native_origin and req and req.refresh_token:
        refresh_token = req.refresh_token
        csrf_token = (
            request.headers.get(CSRF_HEADER_NAME, "").strip()
            or secrets.token_urlsafe(32)
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh session is missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = auth_service.verify_refresh_token(refresh_token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    _check_refresh_rate(user_id)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or (user.phone or "").startswith("deleted_"):
        raise HTTPException(status_code=401, detail="User not found")

    token_version = auth_service.get_token_version(refresh_token, "refresh")
    if token_version is None or token_version != (user.token_version or 0):
        raise HTTPException(status_code=401, detail="Session has been revoked")

    new_refresh_token = auth_service.rotate_refresh_token(refresh_token, user, db)
    if not new_refresh_token:
        # A replayed token revokes its whole family; persist that before 401.
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has already been used or revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    db.commit()

    # Keep the existing CSRF token for this session; rotating it would race
    # concurrent tabs that share the same cookie-bound value.
    _set_session_cookies(response, new_refresh_token, csrf_token)

    token_data = _token_payload(user)
    result = {
        "access_token": auth_service.create_access_token(token_data),
        "csrf_token": csrf_token,
        "token_type": "bearer",
        "expires_in": auth_service.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }
    if native_origin:
        result["refresh_token"] = new_refresh_token
    return result


@router.post("/logout")
def logout(
    response: Response,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke every token issued to the user, including other devices."""
    current_user.token_version = int(current_user.token_version or 0) + 1
    # The version bump invalidates every session; remove the now-dead rows too.
    db.query(models.RefreshSession).filter(
        models.RefreshSession.user_id == current_user.id
    ).delete(synchronize_session=False)
    db.commit()
    _clear_session_cookies(response)
    return {"ok": True}
