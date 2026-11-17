"""Authenticated encryption for payment PII stored in the database.

Payment details (MBank phone and ElKart number) are encrypted with Fernet
(AES-128-CBC + HMAC-SHA256). The encryption key is derived from
``PII_ENCRYPTION_KEY``; production must set it. Local development and tests
fall back to ``SECRET_KEY`` so an unconfigured local database remains usable.

Existing plaintext rows are still readable and are encrypted by migration
``5c8f1a2b9d4e``. New writes always produce the versioned ``enc:v1:`` format.
Key rotation is intentionally not implicit: re-encrypt with a new key using a
dedicated migration after updating the secret.
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

from config import IS_PRODUCTION

CIPHERTEXT_PREFIX = "enc:v1:"
_DEVELOPMENT_FALLBACK_KEY = "birge-development-pii-key"

if IS_PRODUCTION and not os.environ.get("PII_ENCRYPTION_KEY", "").strip():
    raise RuntimeError("PII_ENCRYPTION_KEY must be set in production")


def _raw_secret() -> str:
    secret = os.environ.get("PII_ENCRYPTION_KEY", "").strip()
    if secret:
        return secret
    if IS_PRODUCTION:
        raise RuntimeError("PII_ENCRYPTION_KEY must be set in production")
    return os.environ.get("SECRET_KEY", "").strip() or _DEVELOPMENT_FALLBACK_KEY


def _fernet() -> Fernet:
    digest = hashlib.sha256(_raw_secret().encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def is_encrypted(value: object) -> bool:
    return isinstance(value, str) and value.startswith(CIPHERTEXT_PREFIX)


def encrypt_if_needed(value: object) -> object:
    """Encrypt a plaintext value once; ``None`` and empty values stay as-is."""
    if value is None or value == "":
        return value
    if not isinstance(value, str):
        raise TypeError("PII values must be strings")
    if is_encrypted(value):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{CIPHERTEXT_PREFIX}{token}"


def decrypt_if_needed(value: object) -> object:
    """Decrypt a versioned ciphertext; legacy plaintext is returned unchanged."""
    if not is_encrypted(value):
        return value
    assert isinstance(value, str)
    token = value[len(CIPHERTEXT_PREFIX):].encode("ascii")
    try:
        return _fernet().decrypt(token).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Payment PII cannot be decrypted with the configured key") from exc
