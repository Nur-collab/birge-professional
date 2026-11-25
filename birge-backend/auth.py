import hashlib
import hmac
import logging
import os
import secrets
import httpx
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote
import jwt

logger = logging.getLogger("birge")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Берём секрет из переменной окружения.
# На Render: Settings → Environment → Add SECRET_KEY
_env_secret = os.environ.get("SECRET_KEY", "")
_IS_PRODUCTION = bool(os.environ.get("RENDER")) or os.environ.get("ENVIRONMENT", "").lower() == "production"
if not _env_secret:
    if _IS_PRODUCTION:
        raise RuntimeError("SECRET_KEY must be set in production")
    # Генерируем случайный ключ как временный fallback (сессии не переживут рестарт).
    # Это нормально для разработки, но недопустимо в продакшене.
    _env_secret = secrets.token_hex(32)
    logger.warning(
        "[Auth] SECRET_KEY is not set; using ephemeral development key "
        "(sessions will reset on restart)"
    )

SECRET_KEY: str = _env_secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "30"))
# A short window where reusing the just-rotated token is a benign parallel
# refresh (another tab or an immediate retry), not a stolen-token replay.
REFRESH_REUSE_GRACE_SECONDS = int(os.environ.get("REFRESH_REUSE_GRACE_SECONDS", "10"))
LOGIN_CODE_TTL_SECONDS = int(os.environ.get("LOGIN_CODE_TTL_SECONDS", "120"))
APP_PUBLIC_URL = os.environ.get(
    "APP_PUBLIC_URL", "https://birge-professional.vercel.app"
).rstrip("/")

SMS_CODE_TTL_MINUTES = 5        # Код действителен 5 минут
SMS_RATE_LIMIT_SECONDS = 60     # Повторная отправка — не чаще 1 раза в 60 сек
_OTP_HASH_SECRET = os.environ.get("OTP_HASH_KEY", "").strip() or SECRET_KEY

# Telegram Bot (токен должен задаваться в переменных окружения Render / .env)
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}" if TELEGRAM_BOT_TOKEN else ""



KG_OPERATOR_PREFIXES = {
    "55": "Mega", "99": "Mega",
    "77": "Beeline", "22": "Beeline",
    "70": "О!", "50": "О!",
    "88": "Salam",
}


def normalize_kg_phone(raw_phone: str) -> tuple[bool, str, str, str, str]:
    """
    Нормализует и валидирует кыргызский мобильный номер.
    Возвращает: (is_valid, phone_e164, phone_digits, phone_formatted, operator_name_or_error)
    """
    digits = "".join(filter(str.isdigit, raw_phone or ""))
    if not digits:
        return False, "", "", "", "Номер не указан."

    if len(digits) == 10 and digits.startswith("0"):
        digits = "996" + digits[1:]
    elif len(digits) == 9:
        digits = "996" + digits

    if len(digits) != 12 or not digits.startswith("996"):
        return False, "", "", "", "Номер должен содержать 9 цифр после кода страны (+996)."

    operator_code = digits[3:5]
    operator_name = KG_OPERATOR_PREFIXES.get(operator_code)
    if not operator_name:
        return (
            False, "", "", "",
            f"Неизвестный код оператора '{operator_code}'. Поддерживаются: Mega (55x, 99x), Beeline (77x, 22x), О! (70x, 50x), Salam (88x)."
        )

    phone_e164 = f"+{digits}"
    phone_formatted = f"+996 {digits[3:6]} {digits[6:9]} {digits[9:12]}"
    return True, phone_e164, digits, phone_formatted, operator_name


def _create_token(data: dict, token_type: str, expires_delta: timedelta):
    to_encode = data.copy()
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])  # RFC 7519: sub claim MUST be a string
    to_encode.update({
        "exp": datetime.now(timezone.utc) + expires_delta,
        "typ": token_type,
    })
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(data: dict):
    return _create_token(data, "access", timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(data: dict, jti: Optional[str] = None):
    payload = data.copy()
    if jti:
        payload["jti"] = jti
    return _create_token(payload, "refresh", timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))


def get_refresh_payload(token: str) -> Optional[dict]:
    """Return validated refresh claims, including the rotation JTI."""
    return _decode_payload(token, "refresh")


def get_refresh_jti(token: str) -> Optional[str]:
    payload = get_refresh_payload(token)
    jti = payload.get("jti") if payload else None
    return jti if isinstance(jti, str) and jti else None


def hash_refresh_jti(jti: str) -> str:
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def purge_refresh_sessions(db, user_id: Optional[int] = None, now: Optional[datetime] = None) -> int:
    """Delete expired refresh sessions.

    Consumed rows survive until they expire: they are what lets a replay of
    an old JTI revoke its whole token family.
    """
    from models import RefreshSession

    now = now or datetime.now(timezone.utc)
    query = db.query(RefreshSession).filter(RefreshSession.expires_at < now)
    if user_id is not None:
        query = query.filter(RefreshSession.user_id == user_id)
    return query.delete(synchronize_session="fetch")


def issue_refresh_token(user, db, family_id: Optional[str] = None) -> str:
    """Issue a refresh token and persist its one-time JTI hash."""
    from models import RefreshSession

    # Keep the per-user session table bounded; expired rows are removed.
    purge_refresh_sessions(db, user_id=user.id)

    jti = secrets.token_urlsafe(32)
    token = create_refresh_token(
        {"sub": str(user.id), "ver": int(user.token_version or 0)},
        jti=jti,
    )
    db.add(
        RefreshSession(
            user_id=user.id,
            jti_hash=hash_refresh_jti(jti),
            family_id=family_id or secrets.token_urlsafe(16),
            expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    return token


def rotate_refresh_token(token: str, user, db) -> Optional[str]:
    """Consume a refresh JTI and issue its replacement.

    Returns None when the token is invalid, expired or revoked. Reusing the
    just-rotated token within REFRESH_REUSE_GRACE_SECONDS is a parallel refresh
    or retry and gets its own branch of the family. After that window a replay
    is treated as theft: every refresh session is dropped and the user-wide
    token version is bumped, which revokes already issued access tokens too.
    """
    from models import RefreshSession

    jti = get_refresh_jti(token)
    if not jti:
        return None
    now = datetime.now(timezone.utc)
    session = (
        db.query(RefreshSession)
        .filter(
            RefreshSession.jti_hash == hash_refresh_jti(jti),
            RefreshSession.user_id == user.id,
        )
        .with_for_update()
        .first()
    )
    if not session:
        return None
    if session.used_at is not None:
        used_at = session.used_at
        if used_at.tzinfo is None:
            used_at = used_at.replace(tzinfo=timezone.utc)
        if now - used_at <= timedelta(seconds=REFRESH_REUSE_GRACE_SECONDS):
            # A second tab or an immediate retry can present the same token
            # while the first rotation is still fresh. Give it one extra
            # branch of the same family instead of logging the user out
            # everywhere; further duplicates are ignored.
            family_id = session.family_id or secrets.token_urlsafe(16)
            active_in_family = (
                db.query(RefreshSession)
                .filter(
                    RefreshSession.user_id == user.id,
                    RefreshSession.family_id == family_id,
                    RefreshSession.revoked_at.is_(None),
                )
                .count()
            )
            if active_in_family <= 1:
                session.family_id = family_id
                return issue_refresh_token(user, db, family_id=family_id)
            return None
        # Access tokens only carry the user-wide version, so bumping it is
        # the smallest way to kill the stolen one immediately. The cost is a
        # forced re-login on every device, which is the right response to a
        # confirmed refresh-token replay.
        user.token_version = int(user.token_version or 0) + 1
        db.query(RefreshSession).filter(
            RefreshSession.user_id == user.id
        ).delete(synchronize_session=False)
        return None
    if session.revoked_at is not None:
        return None
    expires_at = session.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is None or expires_at < now:
        session.revoked_at = now
        return None
    if not session.family_id:
        # Legacy row: start a family now so replay detection still covers
        # the token that replaces it.
        session.family_id = secrets.token_urlsafe(16)
    session.used_at = now
    session.revoked_at = now
    return issue_refresh_token(user, db, family_id=session.family_id)


def _decode_payload(token: str, expected_type: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        # Токены, выданные до разделения access/refresh, не имеют claim typ.
        token_type = payload.get("typ", "access")
        if token_type != expected_type:
            return None
        if payload.get("sub") is None:
            return None
        return payload
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return None


def _decode_token(token: str, expected_type: str) -> Optional[int]:
    payload = _decode_payload(token, expected_type)
    if payload is None:
        return None
    try:
        return int(payload["sub"])
    except (TypeError, ValueError):
        return None


def verify_token(token: str) -> Optional[int]:
    """Проверяет access-токен и возвращает user_id."""
    return _decode_token(token, "access")


def verify_refresh_token(token: str) -> Optional[int]:
    """Проверяет refresh-токен и возвращает user_id."""
    return _decode_token(token, "refresh")


def hash_login_code(code: str) -> str:
    """One-time login codes are high-entropy; a SHA-256 digest is enough."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def build_login_url(code: str) -> str:
    """Build the frontend magic link for a one-time code."""
    return f"{APP_PUBLIC_URL}/?code={quote(code, safe='')}"


def issue_login_code(user, db) -> str:
    """Create a short-lived one-time code that can be exchanged for tokens."""
    from models import LoginCode

    now = datetime.now(timezone.utc)
    # Keep only live codes for this user; used and expired rows carry no value.
    db.query(LoginCode).filter(
        LoginCode.user_id == user.id,
        (LoginCode.used_at.isnot(None)) | (LoginCode.expires_at < now),
    ).delete(synchronize_session="fetch")

    code = secrets.token_urlsafe(32)
    db.add(
        LoginCode(
            user_id=user.id,
            code_hash=hash_login_code(code),
            expires_at=now + timedelta(seconds=LOGIN_CODE_TTL_SECONDS),
        )
    )
    return code


def consume_login_code(code: str, db):
    """Atomically consume a login code and return its user, or None."""
    from models import LoginCode, User

    now = datetime.now(timezone.utc)
    row = (
        db.query(LoginCode)
        .filter(LoginCode.code_hash == hash_login_code(code))
        .with_for_update()
        .first()
    )
    if not row or row.used_at is not None:
        return None
    expires_at = row.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is None or expires_at < now:
        return None
    user = db.query(User).filter(User.id == row.user_id).first()
    if not user:
        return None
    row.used_at = now
    return user


def is_token_version_current(db, user_id: int, version: Optional[int]) -> bool:
    """True when a long-lived stream still matches the user's session version."""
    from models import User

    if version is None:
        return False
    current = db.query(User.token_version).filter(User.id == user_id).scalar()
    return current is not None and int(current or 0) == int(version)


def get_token_version(token: str, expected_type: str = "access") -> Optional[int]:
    """Возвращает версию сессии из токена; старые токены считаются версией 0."""
    payload = _decode_payload(token, expected_type)
    if payload is None:
        return None
    try:
        version = int(payload.get("ver", 0))
    except (TypeError, ValueError):
        return None
    return version if version >= 0 else None


WS_TICKET_EXPIRE_SECONDS = 60
SSE_TICKET_EXPIRE_SECONDS = 60


def create_ws_ticket(user_id: int, trip_id: int, token_version: int = 0) -> str:
    """Короткоживущий ticket для WebSocket-подключения."""
    return _create_token(
        {
            "sub": str(user_id),
            "trip_id": int(trip_id),
            "ver": int(token_version),
        },
        "ws",
        timedelta(seconds=WS_TICKET_EXPIRE_SECONDS),
    )


def verify_ws_ticket(token: str, trip_id: int) -> Optional[int]:
    """Проверяет ticket и привязку к конкретной поездке."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("typ") != "ws":
            return None
        if int(payload.get("trip_id", -1)) != int(trip_id):
            return None
        user_id_str = payload.get("sub")
        return int(user_id_str) if user_id_str is not None else None
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return None


def create_sse_ticket(
    user_id: int,
    stream: str,
    target_id: int,
    token_version: int = 0,
) -> str:
    """Короткоживущий ticket для одного SSE-стрима пользователя."""
    return _create_token(
        {
            "sub": str(user_id),
            "stream": stream,
            "target_id": int(target_id),
            "ver": int(token_version),
        },
        "sse",
        timedelta(seconds=SSE_TICKET_EXPIRE_SECONDS),
    )


def verify_sse_ticket(token: str, stream: str, target_id: int) -> Optional[int]:
    """Проверяет SSE-ticket: пользователь, стрим и target_id должны совпасть."""
    payload = _decode_payload(token, "sse")
    if payload is None:
        return None
    if payload.get("stream") != stream:
        return None
    try:
        if int(payload.get("target_id", -1)) != int(target_id):
            return None
        return int(payload["sub"])
    except (TypeError, ValueError):
        return None


# ---------- Telegram: найти chat_id по номеру телефона ----------

def get_telegram_chat_id(phone: str, db) -> Optional[int]:
    """Ищет Telegram chat_id по нормализованному номеру телефона.
    Проверяет точное совпадение по phone_normalized или phone.
    """
    from models import TelegramBinding

    phone_digits = "".join(filter(str.isdigit, phone or ""))
    if not phone_digits:
        return None

    # Поиск по индексированному полю phone_normalized
    binding = (
        db.query(TelegramBinding)
        .filter(
            (TelegramBinding.phone_normalized == phone_digits)
            | (TelegramBinding.phone == phone)
            | (TelegramBinding.phone_normalized.endswith(phone_digits[-9:]))
        )
        .first()
    )
    if binding:
        return binding.chat_id

    # Fallback для старых записей
    old_bindings = (
        db.query(TelegramBinding)
        .filter(TelegramBinding.phone_normalized == None)  # noqa: E711
        .all()
    )
    for b in old_bindings:
        b_digits = "".join(filter(str.isdigit, b.phone))
        b.phone_normalized = b_digits
        if b_digits == phone_digits or b_digits.endswith(phone_digits[-9:]):
            db.commit()
            return b.chat_id

    if old_bindings:
        db.commit()

    # Fallback на Render для локальной разработки (когда webhook Telegram приходит на прод)
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "").rstrip("/")
    internal_secret = os.environ.get("INTERNAL_SYNC_SECRET", "")
    internal_enabled = os.environ.get("INTERNAL_SYNC_ENABLED", "").lower() == "true"
    is_prod = bool(os.environ.get("RENDER")) or os.environ.get("ENVIRONMENT", "").lower() == "production"

    if not is_prod and internal_enabled and render_url and internal_secret:
        try:
            import urllib.request, json
            req = urllib.request.Request(
                f"{render_url}/internal/get-binding?phone={phone_digits}",
                headers={"X-Internal-Sync-Secret": internal_secret},
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    if data.get("found") and data.get("chat_id"):
                        remote_chat_id = int(data["chat_id"])
                        new_b = TelegramBinding(
                            phone=data.get("phone") or phone,
                            phone_normalized=data.get("phone_normalized") or phone_digits,
                            chat_id=remote_chat_id,
                        )
                        db.add(new_b)
                        try:
                            db.commit()
                        except Exception:
                            db.rollback()
                        return remote_chat_id
        except Exception:
            pass

    return None


async def send_telegram_code(chat_id: int, code: str) -> bool:
    """Отправляет код верификации через Telegram Bot."""
    if not TELEGRAM_BOT_TOKEN:
        return False
    message = (
        f"🔐 *Ваш код для входа в Birge:*\n\n"
        f"➡️ `{code}`\n\n"
        f"_Код действителен 5 минут. Не передавайте его никому._"
    )
    return await send_telegram_message(chat_id, message)


async def send_telegram_message(
    chat_id: int | str,
    text: str,
    reply_markup: Optional[dict] = None
) -> bool:
    """Отправляет сообщение через Telegram Bot с поддержкой Markdown и клавиатуры."""
    token = TELEGRAM_BOT_TOKEN
    if not token:
        logger.warning("[Telegram] TELEGRAM_BOT_TOKEN is not configured")
        return False
    api_url = f"https://api.telegram.org/bot{token}"
    try:
        payload: dict = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{api_url}/sendMessage", json=payload)
            return resp.status_code == 200 and resp.json().get("ok", False)
    except Exception as e:
        # Telegram/client errors may include the request URL with the bot token.
        logger.warning("[Telegram] Delivery error: %s", type(e).__name__)
        return False


# ---------- SMS через БД ----------

def hash_sms_code(phone: str, code: str) -> str:
    """HMAC-SHA256 OTP; the plaintext code never reaches the database."""
    message = f"{phone}:{code}".encode("utf-8")
    return hmac.new(_OTP_HASH_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()


def save_sms_code(phone: str, code: str, db):
    """
    Сохраняет или обновляет SMS-код в БД.
    Возвращает (True, None) при успехе или (False, error_message) при rate limit.
    """
    from models import SmsCode

    now = datetime.now(timezone.utc)
    existing = db.query(SmsCode).filter(SmsCode.phone == phone).first()

    if existing:
        # Rate limiting: не чаще одного раза в SMS_RATE_LIMIT_SECONDS
        if existing.last_sent_at:
            last_sent = existing.last_sent_at
            if last_sent.tzinfo is None:
                last_sent = last_sent.replace(tzinfo=timezone.utc)
            seconds_since = (now - last_sent).total_seconds()
            if seconds_since < SMS_RATE_LIMIT_SECONDS:
                wait = int(SMS_RATE_LIMIT_SECONDS - seconds_since)
                return False, f"Подождите {wait} сек. перед повторной отправкой"

        # Обновляем существующую запись
        existing.code = hash_sms_code(phone, code)
        existing.expires_at = now + timedelta(minutes=SMS_CODE_TTL_MINUTES)
        existing.last_sent_at = now
        existing.is_used = False
        existing.attempts = 0  # Сбрасываем счётчик неверных попыток при новом коде
    else:
        # Первый раз — создаём новую запись
        new_entry = SmsCode(
            phone=phone,
            code=hash_sms_code(phone, code),
            expires_at=now + timedelta(minutes=SMS_CODE_TTL_MINUTES),
            last_sent_at=now,
            is_used=False,
            attempts=0,
        )
        db.add(new_entry)

    db.commit()
    return True, None


def verify_sms_code(phone: str, code: str, db) -> bool:
    """
    Проверяет SMS-код из БД с защитой от перебора (Brute-force).
    Лимит: максимум 5 неверных попыток ввода.
    После успешной проверки помечает код как использованный.
    """
    from models import SmsCode

    now = datetime.now(timezone.utc)
    entry = db.query(SmsCode).filter(SmsCode.phone == phone).first()

    if not entry:
        return False
    if entry.is_used:
        return False

    # Проверяем лимит попыток
    current_attempts = getattr(entry, "attempts", 0) or 0
    if current_attempts >= 5:
        entry.is_used = True
        db.commit()
        return False

    # Нормализуем expires_at: если naive — считаем UTC
    exp = entry.expires_at
    if exp is not None and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp is None or exp < now:
        return False  # Код устарел

    expected = hash_sms_code(phone, code)
    if not entry.code or not hmac.compare_digest(entry.code, expected):
        # Неверный код — увеличиваем попытки
        entry.attempts = current_attempts + 1
        if entry.attempts >= 5:
            entry.is_used = True  # Блокируем код после 5 неудачных попыток
        db.commit()
        return False

    # Помечаем как использованный
    entry.is_used = True
    db.commit()
    return True

