"""Shared FastAPI authentication dependencies."""
import os
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

import auth
import models
from database import get_db


def _extract_token(authorization: Optional[str]) -> str:
    """Извлекает JWT токен из заголовка Authorization: Bearer <token>."""
    return (authorization or "").partition(" ")[2]


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> models.User:
    """Возвращает текущего пользователя по Bearer-токену из заголовка."""
    raw_token: Optional[str] = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = _extract_token(authorization)

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = auth.verify_token(raw_token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or (user.phone or "").startswith("deleted_"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if getattr(user, "is_blocked", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is suspended",
        )

    token_version = auth.get_token_version(raw_token)
    if token_version is None or token_version != (user.token_version or 0):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def _normalize_phone_for_admin(value: Optional[str]) -> str:
    digits = "".join(ch for ch in (value or "") if ch.isdigit())
    return digits[-9:] if len(digits) >= 9 else digits


_ADMIN_PHONES = {
    _normalize_phone_for_admin(phone)
    for phone in os.environ.get("ADMIN_PHONES", "").split(",")
    if phone.strip()
}


def is_admin_user(user: Optional[models.User]) -> bool:
    """Return True when the user's phone matches the configured ADMIN_PHONES allowlist."""
    if not user or not _ADMIN_PHONES:
        return False
    return _normalize_phone_for_admin(user.phone) in _ADMIN_PHONES


def get_current_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    """Административный доступ по явному allowlist номеров."""
    if not _ADMIN_PHONES:
        raise HTTPException(status_code=403, detail="Admin access is not configured")
    if not is_admin_user(current_user):
        raise HTTPException(status_code=403, detail="Admin access denied")
    return current_user
