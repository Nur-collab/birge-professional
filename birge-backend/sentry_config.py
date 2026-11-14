"""Optional Sentry initialization.

Sentry is enabled only when SENTRY_DSN is configured. The default is a no-op so
local development and tests do not send data to a third party.
"""
from __future__ import annotations

import logging
import os

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

from config import IS_PRODUCTION

logger = logging.getLogger("birge")


def _sample_rate() -> float:
    raw = os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "").strip()
    if not raw:
        return 0.05
    try:
        value = float(raw)
    except ValueError:
        logger.warning("[Sentry] Invalid SENTRY_TRACES_SAMPLE_RATE; using 0.05")
        return 0.05
    return min(max(value, 0.0), 1.0)


def init_sentry() -> bool:
    """Initialize Sentry when configured; return whether it was enabled."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False

    environment = (
        os.environ.get("SENTRY_ENVIRONMENT", "").strip()
        or os.environ.get("ENVIRONMENT", "").strip()
        or ("production" if IS_PRODUCTION else "development")
    )
    release = (
        os.environ.get("SENTRY_RELEASE", "").strip()
        or os.environ.get("RENDER_GIT_COMMIT", "").strip()
        or os.environ.get("GIT_COMMIT", "").strip()
    )
    sample_rate = _sample_rate()

    options = {
        "dsn": dsn,
        "environment": environment,
        "traces_sample_rate": sample_rate,
        "send_default_pii": False,
        "max_request_body_size": "never",
        "integrations": [FastApiIntegration()],
    }
    if release:
        options["release"] = release

    try:
        sentry_sdk.init(**options)
    except Exception:
        logger.exception("[Sentry] Initialization failed")
        return False

    logger.info(
        "sentry.initialized",
        extra={"environment": environment, "traces_sample_rate": sample_rate},
    )
    return True
