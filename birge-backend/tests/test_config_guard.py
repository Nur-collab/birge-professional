"""Production must not start without the Vercel auth proxy secret."""
import config
import pytest


def test_production_without_proxy_secret_fails(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION", True)
    monkeypatch.setattr(config, "AUTH_PROXY_SECRET", "")

    with pytest.raises(RuntimeError, match="AUTH_PROXY_SECRET"):
        config.require_auth_proxy_secret()


def test_production_with_proxy_secret_starts(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION", True)
    monkeypatch.setattr(config, "AUTH_PROXY_SECRET", "secret")

    config.require_auth_proxy_secret()


def test_development_without_proxy_secret_starts(monkeypatch):
    monkeypatch.setattr(config, "IS_PRODUCTION", False)
    monkeypatch.setattr(config, "AUTH_PROXY_SECRET", "")

    config.require_auth_proxy_secret()
