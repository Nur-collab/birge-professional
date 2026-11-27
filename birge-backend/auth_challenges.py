"""Browser-bound Telegram auth challenges and one-time magic-link login codes."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
import secrets
from typing import Optional

LOGIN_CODE_TTL_SECONDS = int(os.environ.get("LOGIN_CODE_TTL_SECONDS", "120"))
TELEGRAM_CHALLENGE_TTL_SECONDS = int(os.environ.get("TELEGRAM_CHALLENGE_TTL_SECONDS", "300"))


def _ensure_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def hash_login_code(code: str) -> str:
    """One-time login codes are high-entropy; a SHA-256 digest is enough."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def hash_challenge_token(token: str) -> str:
    """Hash a challenge identifier or verifier with SHA-256 before persistence."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def purge_telegram_challenges(db, now: Optional[datetime] = None) -> int:
    """Remove expired or already-consumed browser auth challenges."""
    from models import TelegramAuthChallenge

    now = now or datetime.now(timezone.utc)
    return (
        db.query(TelegramAuthChallenge)
        .filter(
            (TelegramAuthChallenge.expires_at < now)
            | (TelegramAuthChallenge.consumed_at.isnot(None))
        )
        .delete(synchronize_session="fetch")
    )


def issue_telegram_challenge(db) -> tuple[str, str, int]:
    """Create a short-lived browser-bound Telegram verification challenge."""
    from models import TelegramAuthChallenge

    now = datetime.now(timezone.utc)
    purge_telegram_challenges(db, now=now)
    challenge_id = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(32)
    db.add(
        TelegramAuthChallenge(
            challenge_hash=hash_challenge_token(challenge_id),
            verifier_hash=hash_challenge_token(verifier),
            status="pending",
            expires_at=now + timedelta(seconds=TELEGRAM_CHALLENGE_TTL_SECONDS),
        )
    )
    return challenge_id, verifier, TELEGRAM_CHALLENGE_TTL_SECONDS


def lookup_telegram_challenge(
    challenge_id: str,
    verifier: str,
    db,
    *,
    for_update: bool = False,
) -> tuple[Optional[object], Optional[str]]:
    """Validate challenge_id + verifier and return (row, status_override)."""
    from models import TelegramAuthChallenge

    query = db.query(TelegramAuthChallenge).filter(
        TelegramAuthChallenge.challenge_hash == hash_challenge_token(challenge_id)
    )
    if for_update:
        query = query.with_for_update()
    row = query.first()
    if not row:
        return None, None
    expected_verifier_hash = hash_challenge_token(verifier)
    if not hmac.compare_digest(row.verifier_hash, expected_verifier_hash):
        return None, None

    now = datetime.now(timezone.utc)
    expires_at = _ensure_utc(row.expires_at)
    if row.consumed_at is not None or expires_at is None or expires_at < now:
        return row, "expired"
    return row, None


def attach_chat_to_challenge(challenge_id: str, chat_id: int, db):
    """Bind a Telegram chat_id to an active challenge when /start auth_<id> arrives."""
    from models import TelegramAuthChallenge

    now = datetime.now(timezone.utc)
    row = (
        db.query(TelegramAuthChallenge)
        .filter(TelegramAuthChallenge.challenge_hash == hash_challenge_token(challenge_id))
        .first()
    )
    if not row or row.consumed_at is not None:
        return None
    expires_at = _ensure_utc(row.expires_at)
    if expires_at is None or expires_at < now:
        return None
    if row.status not in ("pending", "bot_started"):
        return None
    if row.chat_id is not None and int(row.chat_id) != int(chat_id):
        return None
    row.chat_id = chat_id
    if row.status == "pending":
        row.status = "bot_started"
    return row


def verify_challenge_for_chat(
    chat_id: int,
    phone_e164: str,
    phone_formatted: str,
    db,
    *,
    challenge_id: Optional[str] = None,
):
    """Mark an active challenge verified with the contact's confirmed phone."""
    from models import TelegramAuthChallenge

    now = datetime.now(timezone.utc)
    if challenge_id:
        row = (
            db.query(TelegramAuthChallenge)
            .filter(TelegramAuthChallenge.challenge_hash == hash_challenge_token(challenge_id))
            .first()
        )
        if not row or row.consumed_at is not None:
            return None
        expires_at = _ensure_utc(row.expires_at)
        if expires_at is None or expires_at < now:
            return None
        if row.chat_id is not None and int(row.chat_id) != int(chat_id):
            return None
    else:
        row = (
            db.query(TelegramAuthChallenge)
            .filter(
                TelegramAuthChallenge.chat_id == chat_id,
                TelegramAuthChallenge.status.in_(("pending", "bot_started")),
                TelegramAuthChallenge.consumed_at.is_(None),
            )
            .order_by(TelegramAuthChallenge.created_at.desc(), TelegramAuthChallenge.id.desc())
            .first()
        )
        if not row:
            return None
        expires_at = _ensure_utc(row.expires_at)
        if expires_at is None or expires_at < now:
            return None

    row.chat_id = chat_id
    row.phone_e164 = phone_e164
    row.phone_formatted = phone_formatted
    row.status = "verified"
    row.verified_at = now
    return row


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
    expires_at = _ensure_utc(row.expires_at)
    if expires_at is None or expires_at < now:
        return None
    user = db.query(User).filter(User.id == row.user_id).first()
    if not user:
        return None
    row.used_at = now
    return user
