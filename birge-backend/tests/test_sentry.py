import sentry_sdk

from sentry_config import capture_auth_proxy_fallback, init_sentry


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


class _Scope:
    def __init__(self):
        self.level = None
        self.tags = {}
        self.fingerprint = None

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def set_level(self, level):
        self.level = level

    def set_tag(self, key, value):
        self.tags[key] = value

    def set_fingerprint(self, fingerprint):
        self.fingerprint = fingerprint


def test_auth_proxy_alert_is_an_error_with_a_stable_fingerprint(monkeypatch):
    scope = _Scope()
    messages = []
    monkeypatch.setattr(sentry_sdk, "new_scope", lambda: scope)
    monkeypatch.setattr(
        sentry_sdk, "capture_message", lambda message: messages.append(message)
    )

    capture_auth_proxy_fallback()

    assert scope.level == "error"
    assert scope.tags["auth.proxy"] == "unsigned"
    assert scope.fingerprint == ["auth-proxy-missing-origin-secret"]
    assert len(messages) == 1
    assert "ORIGIN_SECRET" in messages[0]
