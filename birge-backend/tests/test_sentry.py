import sentry_sdk

from sentry_config import init_sentry


def test_sentry_is_disabled_without_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert init_sentry() is False


def test_sentry_initializes_with_safe_defaults(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.com/1")
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "test")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.25")
    monkeypatch.setenv("SENTRY_RELEASE", "test-release")
    captured = {}
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: captured.update(kwargs))

    assert init_sentry() is True
    assert captured["dsn"] == "https://public@example.com/1"
    assert captured["environment"] == "test"
    assert captured["release"] == "test-release"
    assert captured["traces_sample_rate"] == 0.25
    assert captured["send_default_pii"] is False
    assert captured["max_request_body_size"] == "never"
    assert captured["integrations"]
