"""An unsigned proxied production auth request must be reported once."""
from unittest.mock import patch

import pytest
from starlette.requests import Request

from routers import auth as auth_router

VISITOR_IP = "92.62.69.231"
MIDDLEWARE_IP = "92.62.69.232"


def _request(headers=None):
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/auth/send-code",
            "headers": raw_headers,
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
            "query_string": b"",
        }
    )


@pytest.fixture
def production_proxy(monkeypatch):
    monkeypatch.setattr(auth_router, "IS_PRODUCTION", True)
    monkeypatch.setattr(auth_router, "AUTH_PROXY_SECRET", "proxy-secret")
    monkeypatch.setattr(auth_router, "_proxy_fallback_warned", False)


def test_unsigned_proxied_request_warns_once(production_proxy):
    # The middleware ran (x-auth-client-ip is present) but the rewrite did not
    # inject a valid secret, so ORIGIN_SECRET is missing in Vercel.
    request = _request(
        {
            "cf-connecting-ip": VISITOR_IP,
            "x-auth-client-ip": MIDDLEWARE_IP,
        }
    )

    with patch.object(auth_router.logger, "warning") as warning, patch.object(
        auth_router, "capture_auth_proxy_fallback"
    ) as alert:
        assert auth_router._client_ip(request) == VISITOR_IP
        assert auth_router._client_ip(request) == VISITOR_IP

    assert warning.call_count == 1
    assert "ORIGIN_SECRET" in warning.call_args.args[0]
    alert.assert_called_once_with()


def test_direct_origin_request_does_not_warn(production_proxy):
    # No middleware header: a direct caller uses its own CF-Connecting-IP.
    request = _request({"cf-connecting-ip": VISITOR_IP})

    with patch.object(auth_router.logger, "warning") as warning, patch.object(
        auth_router, "capture_auth_proxy_fallback"
    ) as alert:
        assert auth_router._client_ip(request) == VISITOR_IP

    warning.assert_not_called()
    alert.assert_not_called()


def test_signed_production_request_does_not_warn(production_proxy):
    request = _request(
        {
            "x-auth-proxy-secret": "proxy-secret",
            "x-auth-client-ip": MIDDLEWARE_IP,
            "cf-connecting-ip": VISITOR_IP,
        }
    )

    with patch.object(auth_router.logger, "warning") as warning, patch.object(
        auth_router, "capture_auth_proxy_fallback"
    ) as alert:
        assert auth_router._client_ip(request) == MIDDLEWARE_IP

    warning.assert_not_called()
    alert.assert_not_called()


def test_development_without_signature_does_not_warn(monkeypatch):
    monkeypatch.setattr(auth_router, "IS_PRODUCTION", False)
    monkeypatch.setattr(auth_router, "_proxy_fallback_warned", False)
    request = _request(
        {
            "cf-connecting-ip": VISITOR_IP,
            "x-auth-client-ip": MIDDLEWARE_IP,
        }
    )

    with patch.object(auth_router.logger, "warning") as warning, patch.object(
        auth_router, "capture_auth_proxy_fallback"
    ) as alert:
        assert auth_router._client_ip(request) == VISITOR_IP

    warning.assert_not_called()
    alert.assert_not_called()
