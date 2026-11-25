import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from starlette.requests import Request
from starlette.websockets import WebSocketDisconnect

import auth
import database
import main
import models
from rate_limit import get_rate_limiter
from routers.auth import _client_ip


@pytest.fixture()
def client():
    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)
    # Rate counters are process-local in tests; isolate them per test case.
    get_rate_limiter().reset_memory()
    # Do not enter the lifespan: these tests exercise routes, not startup jobs.
    test_client = TestClient(main.app)
    try:
        yield test_client
    finally:
        test_client.close()


@pytest.fixture()
def db():
    session = database.SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _user(db, phone: str, name: str):
    user = models.User(name=name, phone=phone, mbank_phone=phone, is_verified=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _headers(user):
    return {"Authorization": f"Bearer {auth.create_access_token({'sub': str(user.id)})}"}


def _driver_trip(db, user):
    trip = models.Trip(
        user_id=user.id,
        role="driver",
        origin="Ала-Арча",
        destination="ЦУМ",
        time="08:15",
        date=main.get_bishkek_today_str(),
        status="matched",
        seats=1,
        seats_taken=1,
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip


def _age_consumed_sessions(db, user):
    """Move consumed tokens past the reuse grace window."""
    db.query(models.RefreshSession).filter(
        models.RefreshSession.user_id == user.id,
        models.RefreshSession.used_at.isnot(None),
    ).update(
        {
            models.RefreshSession.used_at: datetime.now(timezone.utc)
            - timedelta(minutes=1)
        },
        synchronize_session=False,
    )
    db.commit()


_TEST_CSRF = "test-csrf-token"


def _set_auth_cookies(client, refresh_token, csrf_token=_TEST_CSRF):
    # The public cookie path is /api/auth; tests post to the internal /auth
    # router, so pin the simulated cookies to that route and drop stale ones.
    client.cookies.clear()
    client.cookies.clear()
    client.cookies.set(
        "birge_refresh", refresh_token, domain="testserver.local", path="/auth"
    )
    client.cookies.set(
        "birge_csrf", csrf_token, domain="testserver.local", path="/auth"
    )


def _refresh(client, refresh_token, csrf_token=_TEST_CSRF, headers=None):
    _set_auth_cookies(client, refresh_token, csrf_token)
    request_headers = {"X-CSRF-Token": csrf_token}
    request_headers.update(headers or {})
    return client.post("/auth/refresh", headers=request_headers)


def _refresh_cookie(client):
    return client.cookies.get("birge_refresh", path="/api/auth")


def _set_cookie_headers(response):
    return "; ".join(response.headers.get_list("set-cookie")).lower()


def _accepted_request(db, trip, passenger, requester_trip_id=None):
    req = models.TripRequest(
        trip_id=trip.id,
        requester_id=passenger.id,
        requester_trip_id=requester_trip_id,
        driver_id=trip.user_id,
        status="accepted",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


def test_openapi_includes_user_routes(client):
    paths = client.get("/openapi.json").json()["paths"]
    expected = {
        "/users/me",
        "/users/{user_id}",
        "/users/me/photo",
        "/users/me/trips",
        "/users/me/active-trip",
        "/users/me/verify",
        "/users/me/scheduled-trips",
    }
    assert expected <= set(paths)
    assert {"get", "patch"} <= set(paths["/users/me"])


def test_openapi_includes_trip_routes(client):
    paths = client.get("/openapi.json").json()["paths"]
    expected = {
        "/trips/": {"post"},
        "/trips/matches": {"get"},
        "/trips/{trip_id}/ws-ticket": {"post"},
        "/trips/{trip_id}/messages": {"get", "post"},
        "/trips/{trip_id}/status": {"patch"},
        "/trips/{trip_id}": {"get", "delete"},
        "/trips/{trip_id}/panic": {"post"},
        "/trips/{trip_id}/passengers": {"get"},
        "/trips/{trip_id}/payment": {"get"},
        "/trip-requests/": {"post"},
        "/trip-requests/incoming/": {"get"},
        "/trip-requests/{request_id}": {"patch"},
        "/trip-requests/status/{trip_id}": {"get"},
        "/trip-requests/driver-events/{driver_id}": {"get"},
        "/trip-requests/events/{requester_id}": {"get"},
    }
    for path, methods in expected.items():
        assert methods <= set(paths.get(path, {})), path


def test_websocket_chat_route_is_registered(client):
    paths = {getattr(route, "path", "") for route in main.app.routes}
    assert "/ws/chat/{trip_id}/{user_id}" in paths


def test_trip_request_http_flow(client, db):
    driver = _user(db, "+996555000031", "Водитель")
    passenger = _user(db, "+996555000032", "Пассажир")
    today = main.get_bishkek_today_str()

    driver_trip = models.Trip(
        user_id=driver.id,
        role="driver",
        origin="Ала-Арча",
        destination="ЦУМ",
        time="09:00",
        date=today,
        status="active",
        seats=2,
        seats_taken=0,
    )
    passenger_trip = models.Trip(
        user_id=passenger.id,
        role="passenger",
        origin="Ала-Арча",
        destination="ЦУМ",
        time="09:00",
        date=today,
        status="active",
    )
    db.add_all([driver_trip, passenger_trip])
    db.commit()
    db.refresh(driver_trip)
    db.refresh(passenger_trip)

    sent = client.post(
        "/trip-requests/",
        headers=_headers(passenger),
        json={"trip_id": driver_trip.id, "requester_trip_id": passenger_trip.id},
    )
    assert sent.status_code == 200
    assert sent.json()["status"] == "pending"
    request_id = sent.json()["id"]

    duplicate = client.post(
        "/trip-requests/",
        headers=_headers(passenger),
        json={"trip_id": driver_trip.id, "requester_trip_id": passenger_trip.id},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == request_id
    assert duplicate.json()["status"] == "pending"

    incoming = client.get("/trip-requests/incoming/", headers=_headers(driver))
    assert incoming.status_code == 200
    assert [item["id"] for item in incoming.json()] == [request_id]

    accepted = client.patch(
        f"/trip-requests/{request_id}",
        headers=_headers(driver),
        json={"status": "accepted"},
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"
    request_audit = db.query(models.AuditLog).filter_by(
        action="trip_request.status_changed", entity_id=request_id, actor_id=driver.id
    ).all()
    assert len(request_audit) == 1

    status = client.get(f"/trip-requests/status/{driver_trip.id}", headers=_headers(passenger))
    assert status.status_code == 200
    assert status.json()["status"] == "accepted"
    assert status.json()["driver_id"] == driver.id


def test_current_user_and_refresh_token_flow(client, db):
    user = _user(db, "+996555000001", "Водитель")
    access = auth.create_access_token({"sub": str(user.id)})
    refresh = auth.issue_refresh_token(user, db)
    db.commit()

    response = client.get("/users/me", headers={"Authorization": f"Bearer {access}"})
    assert response.status_code == 200
    assert response.json()["mbank_phone"] == user.mbank_phone

    refresh_response = _refresh(client, refresh)
    assert refresh_response.status_code == 200
    assert refresh_response.json()["access_token"]
    assert "refresh_token" not in refresh_response.json()

    failed = _refresh(client, access)
    assert failed.status_code == 401


def test_verify_code_issues_a_rotatable_refresh_token(client, db):
    phone = "+996555000008"
    assert auth.save_sms_code(phone, "123456", db)[0] is True

    response = client.post(
        "/auth/verify-code",
        json={"phone": phone, "code": "123456", "name": "Новый"},
    )
    assert response.status_code == 200
    assert "refresh_token" not in response.json()
    issued = _refresh_cookie(client)
    assert issued
    csrf = response.json()["csrf_token"]

    # The real cookie path is /api/auth; the test client posts to the internal
    # /auth router, so pin the jar path to the internal route.
    _set_auth_cookies(client, issued, csrf)
    rotated = client.post("/auth/refresh", headers={"X-CSRF-Token": csrf})
    assert rotated.status_code == 200
    assert "refresh_token" not in rotated.json()
    assert _refresh_cookie(client) != issued

    cookie_headers = _set_cookie_headers(response)
    assert "birge_refresh" in cookie_headers
    assert "httponly" in cookie_headers
    assert "path=/api/auth" in cookie_headers
    assert "samesite=lax" in cookie_headers


def test_refresh_requires_matching_csrf_and_checks_origin(client, db):
    user = _user(db, "+996555000090", "CSRF")
    refresh = auth.issue_refresh_token(user, db)
    db.commit()

    _set_auth_cookies(client, refresh)
    assert client.post("/auth/refresh").status_code == 403
    assert client.post(
        "/auth/refresh", headers={"X-CSRF-Token": "wrong"}
    ).status_code == 403

    client.cookies.delete("birge_csrf", domain="testserver.local", path="/auth")
    assert client.post(
        "/auth/refresh", headers={"X-CSRF-Token": _TEST_CSRF}
    ).status_code == 403

    _set_auth_cookies(client, refresh)
    assert client.post(
        "/auth/refresh",
        headers={"X-CSRF-Token": _TEST_CSRF, "Origin": "https://evil.example"},
    ).status_code == 403

    _set_auth_cookies(client, refresh)
    allowed = client.post(
        "/auth/refresh",
        headers={"X-CSRF-Token": _TEST_CSRF, "Origin": main.ALLOWED_ORIGINS[0]},
    )
    assert allowed.status_code == 200


def test_csrf_accepts_the_forwarded_preview_origin(client, db):
    user = _user(db, "+996555000099", "Preview")
    refresh = auth.issue_refresh_token(user, db)
    db.commit()
    _set_auth_cookies(client, refresh)

    response = client.post(
        "/auth/refresh",
        headers={
            "X-CSRF-Token": _TEST_CSRF,
            "Origin": "https://birge-professional-abc123.vercel.app",
            "X-Forwarded-Host": "birge-professional-abc123.vercel.app",
            "X-Forwarded-Proto": "https",
        },
    )
    assert response.status_code == 200


def test_production_auth_cookies_are_secure(client, db, monkeypatch):
    monkeypatch.setattr("routers.auth.IS_PRODUCTION", True)
    phone = "+996555000091"
    assert auth.save_sms_code(phone, "123456", db)[0] is True

    response = client.post(
        "/auth/verify-code",
        json={"phone": phone, "code": "123456"},
    )
    assert response.status_code == 200
    cookie_headers = _set_cookie_headers(response)
    assert "secure" in cookie_headers
    assert "httponly" in cookie_headers
    assert "samesite=lax" in cookie_headers


def test_refresh_token_replay_revokes_every_session_and_access_token(client, db):
    user = _user(db, "+996555000005", "Ротация")
    access = auth.create_access_token(
        {"sub": str(user.id), "ver": user.token_version or 0}
    )
    refresh = auth.issue_refresh_token(user, db)
    db.commit()
    headers = {"Authorization": f"Bearer {access}"}
    assert client.get("/users/me", headers=headers).status_code == 200

    first = _refresh(client, refresh)
    assert first.status_code == 200
    rotated = _refresh_cookie(client)
    assert rotated != refresh

    _age_consumed_sessions(db, user)
    replay = _refresh(client, refresh)
    assert replay.status_code == 401

    # The stolen successor must not survive the replay either.
    second = _refresh(client, rotated)
    assert second.status_code == 401

    # Detected theft bumps the user-wide version: the stolen access token
    # dies immediately and every refresh session is dropped.
    db.expire_all()
    db.refresh(user)
    assert user.token_version == 1
    assert db.query(models.RefreshSession).filter_by(user_id=user.id).count() == 0
    assert client.get("/users/me", headers=headers).status_code == 401

    fresh_access = auth.create_access_token({"sub": str(user.id), "ver": 1})
    assert client.get(
        "/users/me", headers={"Authorization": f"Bearer {fresh_access}"}
    ).status_code == 200


def test_refresh_replay_signs_every_device_out(client, db):
    user = _user(db, "+996555000011", "Семейство")
    first_login = auth.issue_refresh_token(user, db)
    second_login = auth.issue_refresh_token(user, db)
    db.commit()

    rotated = _refresh(client, first_login)
    assert rotated.status_code == 200
    successor = _refresh_cookie(client)

    _age_consumed_sessions(db, user)
    assert _refresh(client, first_login).status_code == 401
    assert _refresh(client, successor).status_code == 401
    # Minimal user-wide revocation: other device families die too.
    assert _refresh(client, second_login).status_code == 401

    db.expire_all()
    db.refresh(user)
    assert user.token_version == 1


def test_immediate_refresh_reuse_is_a_benign_retry(client, db):
    user = _user(db, "+996555000013", "Повтор")
    refresh = auth.issue_refresh_token(user, db)
    db.commit()

    first = _refresh(client, refresh)
    assert first.status_code == 200
    successor = _refresh_cookie(client)

    retry = _refresh(client, refresh)
    assert retry.status_code == 200
    branch = _refresh_cookie(client)
    assert branch not in (refresh, successor)

    # Only one extra branch is minted; further duplicates are ignored.
    assert _refresh(client, refresh).status_code == 401

    db.refresh(user)
    assert user.token_version == 0
    # Both branches stay usable: the parallel request was not punished.
    assert _refresh(client, successor).status_code == 200
    assert _refresh(client, branch).status_code == 200


def test_refresh_rate_limit_returns_429(client, db, monkeypatch):
    monkeypatch.setattr("routers.auth._REFRESH_MAX_PER_WINDOW", 2)
    user = _user(db, "+996555000070", "Refresh limit")
    token = auth.issue_refresh_token(user, db)
    db.commit()
    # Changing a client-supplied header must not reset the account limit.
    forged_headers = [
        {"X-Forwarded-For": "203.0.113.70"},
        {"X-Forwarded-For": "198.51.100.9"},
        {"X-Forwarded-For": "192.0.2.44"},
    ]

    first = _refresh(client, token, headers=forged_headers[0])
    assert first.status_code == 200
    second = _refresh(client, _refresh_cookie(client), headers=forged_headers[1])
    assert second.status_code == 200

    blocked = _refresh(client, _refresh_cookie(client), headers=forged_headers[2])
    assert blocked.status_code == 429
    assert blocked.headers["Cache-Control"] == "no-store"


def _request(headers, client=("10.0.0.5", 1234)):
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "client": client,
            "headers": headers,
        }
    )


def test_client_ip_trusts_edge_header_only_behind_the_signed_proxy(monkeypatch):
    monkeypatch.setattr("routers.auth.AUTH_PROXY_SECRET", "proxy-secret")

    proxied = _request([
        (b"x-auth-proxy-secret", b"proxy-secret"),
        (b"cf-connecting-ip", b"1.1.1.1"),
        (b"x-auth-client-ip", b"8.8.8.8"),
    ])
    assert _client_ip(proxied) == "8.8.8.8"

    # X-Forwarded-For is caller-controlled even behind the signed proxy.
    forwarded_spoof = _request([
        (b"x-auth-proxy-secret", b"proxy-secret"),
        (b"cf-connecting-ip", b"1.1.1.1"),
        (b"x-forwarded-for", b"8.8.8.8"),
    ])
    assert _client_ip(forwarded_spoof) == "1.1.1.1"

    # A direct caller cannot make the backend trust its own edge header.
    spoofed = _request([
        (b"cf-connecting-ip", b"1.1.1.1"),
        (b"x-auth-client-ip", b"6.6.6.6"),
    ])
    assert _client_ip(spoofed) == "1.1.1.1"

    wrong_secret = _request([
        (b"x-auth-proxy-secret", b"not-the-secret"),
        (b"cf-connecting-ip", b"1.1.1.1"),
        (b"x-auth-client-ip", b"8.8.8.8"),
    ])
    assert _client_ip(wrong_secret) == "1.1.1.1"

    # Private ranges stay spoofable, even with the proxy secret.
    private_hop = _request([
        (b"x-auth-proxy-secret", b"proxy-secret"),
        (b"cf-connecting-ip", b"1.1.1.1"),
        (b"x-auth-client-ip", b"10.0.0.9"),
    ])
    assert _client_ip(private_hop) == "1.1.1.1"

    socket_only = _request([])
    assert _client_ip(socket_only) == "10.0.0.5"


def test_cgnat_mobile_addresses_keep_their_own_bucket(monkeypatch):
    monkeypatch.setattr("routers.auth.AUTH_PROXY_SECRET", "proxy-secret")
    proxied = _request([
        (b"x-auth-proxy-secret", b"proxy-secret"),
        (b"cf-connecting-ip", b"1.1.1.1"),
        (b"x-auth-client-ip", b"100.64.12.34"),
    ])
    assert _client_ip(proxied) == "100.64.12.34"


def test_exchange_code_limit_is_per_forwarded_visitor(client, monkeypatch):
    monkeypatch.setattr("routers.auth._EXCHANGE_CODE_MAX_PER_WINDOW", 2)
    monkeypatch.setattr("routers.auth.AUTH_PROXY_SECRET", "proxy-secret")
    headers = {
        "x-auth-proxy-secret": "proxy-secret",
        "x-auth-client-ip": "8.8.8.8",
    }
    statuses = [
        client.post(
            "/auth/exchange-code",
            json={"code": char * 32},
            headers=headers,
        ).status_code
        for char in ("a", "b", "c")
    ]
    assert statuses == [401, 401, 429]

    # A different visitor behind the same shared Vercel edge is not blocked.
    other = client.post(
        "/auth/exchange-code",
        json={"code": "d" * 32},
        headers={
            "x-auth-proxy-secret": "proxy-secret",
            "x-auth-client-ip": "9.9.9.9",
        },
    )
    assert other.status_code == 401


def test_auth_code_limits_are_per_forwarded_visitor(client, monkeypatch):
    monkeypatch.setattr("routers.auth._SEND_CODE_MAX_PER_WINDOW", 2)
    monkeypatch.setattr("routers.auth.AUTH_PROXY_SECRET", "proxy-secret")
    visitor = "8.8.4.4"
    headers = {
        "x-auth-proxy-secret": "proxy-secret",
        "x-auth-client-ip": visitor,
    }
    for phone in (84, 85):
        assert client.post(
            "/auth/send-code",
            json={"phone": f"+9965550000{phone}"},
            headers=headers,
        ).status_code == 200
    assert client.post(
        "/auth/send-code",
        json={"phone": "+996555000086"},
        headers=headers,
    ).status_code == 429
    assert client.post(
        "/auth/send-code",
        json={"phone": "+996555000087"},
        headers={
            "x-auth-proxy-secret": "proxy-secret",
            "x-auth-client-ip": "9.9.9.9",
        },
    ).status_code == 200

    monkeypatch.setattr("routers.auth._VERIFY_CODE_MAX_PER_WINDOW", 2)
    verify_headers = {
        "x-auth-proxy-secret": "proxy-secret",
        "x-auth-client-ip": "8.8.4.4",
    }
    statuses = [
        client.post(
            "/auth/verify-code",
            json={"phone": f"+9965550000{phone}", "code": "123456"},
            headers=verify_headers,
        ).status_code
        for phone in (81, 82, 83)
    ]
    assert statuses == [400, 400, 429]


def test_spoofed_forwarded_for_cannot_reset_a_limit(client, monkeypatch):
    monkeypatch.setattr("routers.auth._SEND_CODE_MAX_PER_WINDOW", 2)
    monkeypatch.setattr("routers.auth.AUTH_PROXY_SECRET", "proxy-secret")

    for spoof, phone in zip(("6.6.6.1", "6.6.6.2", "6.6.6.3"), (91, 92, 93), strict=True):
        response = client.post(
            "/auth/send-code",
            json={"phone": f"+9965550000{phone}"},
            headers={
                "cf-connecting-ip": "1.1.1.1",
                "X-Forwarded-For": f"{spoof}, 1.1.1.1",
            },
        )
        expected = 200 if phone < 93 else 429
        assert response.status_code == expected


def test_send_code_response_does_not_reveal_telegram_binding(client, monkeypatch):
    def chat_id_for(phone, db):
        return 900000087 if phone.endswith("87") else None

    async def delivered(chat_id, code):
        assert chat_id == 900000087
        return True

    monkeypatch.setattr(auth, "get_telegram_chat_id", chat_id_for)
    monkeypatch.setattr(auth, "send_telegram_code", delivered)

    linked = client.post(
        "/auth/send-code",
        json={"phone": "+996555000087"},
    )
    unlinked = client.post(
        "/auth/send-code",
        json={"phone": "+996555000088"},
    )

    assert linked.status_code == 200
    assert unlinked.status_code == 200
    assert linked.json() == unlinked.json()
    assert linked.json() == {"message": "Запрос на отправку кода принят"}
    assert "tg_linked" not in linked.json()
    assert "telegram" not in linked.text.lower()
    assert "console" not in linked.text.lower()


def test_send_code_hides_delivery_failure_and_discards_code(client, db, monkeypatch):
    monkeypatch.setattr("routers.auth.IS_PRODUCTION", True)
    monkeypatch.setattr(auth, "get_telegram_chat_id", lambda phone, db: None)
    phone = "+996555000089"

    response = client.post("/auth/send-code", json={"phone": phone})

    assert response.status_code == 200
    assert response.json() == {"message": "Запрос на отправку кода принят"}
    assert db.query(models.SmsCode).filter(models.SmsCode.phone == phone).count() == 0


def test_login_exchange_code_is_single_use(client, db):
    user = _user(db, "+996555000071", "Обмен")
    code = auth.issue_login_code(user, db)
    db.commit()

    exchanged = client.post("/auth/exchange-code", json={"code": code})
    assert exchanged.status_code == 200
    tokens = exchanged.json()
    assert "refresh_token" not in tokens
    assert tokens["csrf_token"]
    me = client.get(
        "/users/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert me.status_code == 200

    replay = client.post("/auth/exchange-code", json={"code": code})
    assert replay.status_code == 401


def test_login_code_endpoint_issues_and_rejects_expired(client, db):
    user = _user(db, "+996555000072", "Код входа")

    assert client.post("/auth/login-code").status_code == 401

    issued = client.post("/auth/login-code", headers=_headers(user))
    assert issued.status_code == 200
    assert issued.json()["expires_in"] == auth.LOGIN_CODE_TTL_SECONDS

    db.query(models.LoginCode).update(
        {
            models.LoginCode.expires_at: datetime.now(timezone.utc)
            - timedelta(seconds=1)
        }
    )
    db.commit()

    expired = client.post(
        "/auth/exchange-code", json={"code": issued.json()["code"]}
    )
    assert expired.status_code == 401


def test_telegram_login_command_issues_one_time_link(client, db, monkeypatch):
    _user(db, "+996555000073", "Бот")
    db.add(
        models.TelegramBinding(
            phone="+996 555 000 073",
            phone_normalized="996555000073",
            chat_id=900000073,
        )
    )
    db.commit()

    sent: dict = {}

    async def fake_send(chat_id, text, reply_markup=None):
        sent.update(
            chat_id=chat_id,
            text=text,
            reply_markup=reply_markup,
        )
        return True

    monkeypatch.setattr(auth, "send_telegram_message", fake_send)

    response = client.post(
        "/bot/webhook",
        json={
            "message": {
                "chat": {"id": 900000073},
                "from": {"id": 900000073, "first_name": "Бот"},
                "text": "/login",
            }
        },
    )
    assert response.status_code == 200
    assert sent["chat_id"] == 900000073
    assert "один раз" in sent["text"]

    login_url = sent["reply_markup"]["inline_keyboard"][0][0]["url"]
    parsed = urlparse(login_url)
    assert parsed.scheme == "https"
    assert parsed.path == "/"
    code = parse_qs(parsed.query)["code"][0]

    exchanged = client.post("/auth/exchange-code", json={"code": code})
    assert exchanged.status_code == 200
    assert exchanged.json()["access_token"]

    replay = client.post("/auth/exchange-code", json={"code": code})
    assert replay.status_code == 401


def test_refresh_cleanup_removes_only_expired_sessions(client, db):
    user = _user(db, "+996555000009", "Cleanup")
    active = auth.issue_refresh_token(user, db)
    db.commit()
    assert active

    now = datetime.now(timezone.utc)
    revoked = models.RefreshSession(
        user_id=user.id,
        jti_hash="a" * 64,
        expires_at=now + timedelta(days=1),
        revoked_at=now,
        used_at=now,
    )
    expired = models.RefreshSession(
        user_id=user.id,
        jti_hash="b" * 64,
        expires_at=now - timedelta(seconds=1),
    )
    db.add_all([revoked, expired])
    db.commit()

    # Rotated rows stay until expiry so their replay can still be detected.
    assert auth.purge_refresh_sessions(db, user_id=user.id) == 1
    db.commit()
    remaining = {
        session.jti_hash
        for session in db.query(models.RefreshSession).filter_by(user_id=user.id)
    }
    assert len(remaining) == 2
    assert "a" * 64 in remaining


def test_refresh_rotation_keeps_consumed_session_for_reuse_detection(client, db):
    user = _user(db, "+996555000010", "Rotation cleanup")
    original = auth.issue_refresh_token(user, db)
    db.commit()

    rotated = auth.rotate_refresh_token(original, user, db)
    assert rotated
    db.commit()

    sessions = db.query(models.RefreshSession).filter_by(user_id=user.id).all()
    assert len(sessions) == 2
    assert sum(1 for session in sessions if session.used_at is not None) == 1

    # Replaying the consumed token after the grace window returns None, drops
    # every session and invalidates access tokens through the version.
    _age_consumed_sessions(db, user)
    assert auth.rotate_refresh_token(original, user, db) is None
    db.commit()
    assert db.query(models.RefreshSession).filter_by(user_id=user.id).count() == 0
    db.refresh(user)
    assert user.token_version == 1


def test_consumed_refresh_session_survives_next_issue(client, db):
    user = _user(db, "+996555000012", "Повтор")
    original = auth.issue_refresh_token(user, db)
    db.commit()

    rotated = auth.rotate_refresh_token(original, user, db)
    assert rotated
    # Issuing the replacement purges only expired rows, not the consumed one.
    db.commit()

    consumed = (
        db.query(models.RefreshSession)
        .filter(models.RefreshSession.user_id == user.id)
        .all()
    )
    assert len(consumed) == 2
    # Immediate reuse is a concurrent retry, not theft.
    assert auth.rotate_refresh_token(original, user, db) is not None


def test_payment_pii_is_encrypted_at_rest_but_readable_through_api(client, db):
    user = _user(db, "+996555000006", "PII")
    user.elkart_number = "123456"
    db.commit()

    from sqlalchemy import text

    raw = db.execute(
        text("SELECT mbank_phone, elkart_number FROM users WHERE id = :user_id"),
        {"user_id": user.id},
    ).one()
    assert raw[0].startswith("enc:v1:")
    assert raw[0] != "+996555000006"
    assert raw[1].startswith("enc:v1:")
    assert raw[1] != "123456"

    db.refresh(user)
    response = client.get("/users/me", headers=_headers(user))
    assert response.status_code == 200
    assert response.json()["mbank_phone"] == "+996555000006"
    assert response.json()["elkart_number"] == "123456"


def test_otp_codes_are_hashed_at_rest(client, db):
    user = _user(db, "+996555000007", "OTP")
    phone = "+996555000007"
    assert auth.save_sms_code(phone, "123456", db)[0] is True

    stored = db.query(models.SmsCode).filter(models.SmsCode.phone == phone).one()
    assert stored.code != "123456"
    assert len(stored.code) == 64
    assert stored.code == auth.hash_sms_code(phone, "123456")
    assert auth.verify_sms_code(phone, "123456", db) is True

    # A fresh code must be hashed too, and the old hash must not authenticate it.
    assert auth.save_sms_code(phone, "654321", db)[0] is False
    db.query(models.SmsCode).filter(models.SmsCode.phone == phone).delete()
    db.commit()
    assert auth.save_sms_code(phone, "654321", db)[0] is True
    assert auth.verify_sms_code(phone, "123456", db) is False
    assert auth.verify_sms_code(phone, "654321", db) is True
    assert client.get("/users/me", headers=_headers(user)).status_code == 200


def test_logout_revokes_access_and_refresh_tokens(client, db):
    user = _user(db, "+996555000003", "Сессия")
    access = auth.create_access_token({"sub": str(user.id)})
    refresh = auth.issue_refresh_token(user, db)
    db.commit()
    headers = {"Authorization": f"Bearer {access}"}
    _set_auth_cookies(client, refresh)

    assert client.get("/users/me", headers=headers).status_code == 200

    logout = client.post("/auth/logout", headers=headers)
    assert logout.status_code == 200
    db.refresh(user)
    assert user.token_version == 1
    assert db.query(models.RefreshSession).filter_by(user_id=user.id).count() == 0

    assert client.get("/users/me", headers=headers).status_code == 401
    assert _refresh(client, refresh).status_code == 401

    fresh_access = auth.create_access_token({"sub": str(user.id), "ver": 1})
    assert client.get(
        "/users/me", headers={"Authorization": f"Bearer {fresh_access}"}
    ).status_code == 200


def test_sse_ticket_is_bound_to_stream_and_user(client, db):
    user = _user(db, "+996555000004", "SSE")
    headers = _headers(user)

    response = client.post(
        "/trip-requests/sse-ticket?stream=requester", headers=headers
    )
    assert response.status_code == 200
    ticket = response.json()["ticket"]
    assert response.json()["expires_in"] == 60

    assert auth.verify_sse_ticket(ticket, "requester", user.id) == user.id
    assert auth.verify_sse_ticket(ticket, "driver", user.id) is None
    assert auth.verify_sse_ticket(ticket, "requester", user.id + 1) is None

    access = auth.create_access_token({"sub": str(user.id)})
    legacy_token = client.get(
        f"/trip-requests/events/{user.id}?token={access}"
    )
    assert legacy_token.status_code == 401

    assert client.post("/auth/logout", headers=headers).status_code == 200
    revoked = client.get(
        f"/trip-requests/events/{user.id}?ticket={ticket}"
    )
    assert revoked.status_code == 401


def test_sse_stream_closes_after_session_revocation(client, db, monkeypatch):
    """A real open SSE connection must end once token_version changes."""
    import socket
    import threading
    import time

    import httpx
    import uvicorn

    user = _user(db, "+996555000069", "SSE отзыв")
    ticket = auth.create_sse_ticket(
        user.id, "requester", user.id, user.token_version or 0
    )

    # Keepalive is the wake-up that re-checks the session in the generator.
    monkeypatch.setattr("routers.trip_requests.SSE_KEEPALIVE_SECONDS", 0.05)

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    config = uvicorn.Config(
        main.app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        lifespan="off",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.time() + 10
        while not server.started and time.time() < deadline:
            time.sleep(0.05)
        assert server.started, "uvicorn did not start"

        url = f"http://127.0.0.1:{port}/trip-requests/events/{user.id}?ticket={ticket}"
        with httpx.stream("GET", url, timeout=5.0) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")

            lines = response.iter_lines()
            # Wait for the first keepalive while the session is still valid.
            first = next(lines)
            while first == "":
                first = next(lines)
            assert first == ": keepalive"

            db.query(models.User).filter(models.User.id == user.id).update(
                {models.User.token_version: 1}
            )
            db.commit()

            # After revocation the generator ends instead of keeping the
            # stream alive; consume any already-buffered blank line.
            for _ in range(20):
                try:
                    line = next(lines)
                except StopIteration:
                    break
                assert line in ("", ": keepalive") or line.startswith("event:")
            else:
                pytest.fail("SSE stream stayed open after token_version change")
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def test_token_version_check_rejects_revoked_streams(db):
    user = _user(db, "+996555000014", "Стрим")
    assert auth.is_token_version_current(db, user.id, 0)

    user.token_version = 1
    db.commit()

    assert not auth.is_token_version_current(db, user.id, 0)
    assert auth.is_token_version_current(db, user.id, 1)
    assert not auth.is_token_version_current(db, user.id, None)


def test_admin_endpoint_requires_admin_allowlist(client, db):
    admin = _user(db, "+996555000001", "Админ")
    regular = _user(db, "+996555000002", "Пассажир")

    denied = client.post("/admin/cleanup-trips", headers=_headers(regular))
    assert denied.status_code == 403

    allowed = client.post("/admin/cleanup-trips", headers=_headers(admin))
    assert allowed.status_code == 200


def test_payment_and_ws_ticket_are_participant_only(client, db):
    driver = _user(db, "+996555000001", "Водитель")
    passenger = _user(db, "+996555000002", "Пассажир")
    outsider = _user(db, "+996555000003", "Чужой")
    trip = _driver_trip(db, driver)
    _accepted_request(db, trip, passenger)

    payment = client.get(f"/trips/{trip.id}/payment", headers=_headers(passenger))
    assert payment.status_code == 200
    assert payment.json()["mbank_phone"] == driver.mbank_phone
    audit = db.query(models.AuditLog).filter_by(
        action="payment.view", entity_id=trip.id, actor_id=passenger.id
    ).all()
    assert len(audit) == 1

    denied_payment = client.get(f"/trips/{trip.id}/payment", headers=_headers(outsider))
    assert denied_payment.status_code == 403

    ticket = client.post(f"/trips/{trip.id}/ws-ticket", headers=_headers(passenger))
    assert ticket.status_code == 200
    assert auth.verify_ws_ticket(ticket.json()["ticket"], trip.id) == passenger.id

    denied_ticket = client.post(f"/trips/{trip.id}/ws-ticket", headers=_headers(outsider))
    assert denied_ticket.status_code == 403


def test_photo_upload_requires_server_side_configuration(client, db, monkeypatch):
    monkeypatch.delenv("IMGBB_API_KEY", raising=False)
    user = _user(db, "+996555000001", "Водитель")
    response = client.post(
        "/users/me/photo",
        headers=_headers(user),
        files={"file": ("avatar.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
    )
    assert response.status_code == 503


def test_trip_create_matches_status_and_delete_flow(client, db):
    driver = _user(db, "+996555000021", "Водитель")
    driver.car_plate = "A123BC"
    db.commit()
    passenger = _user(db, "+996555000022", "Пассажир")
    today = main.get_bishkek_today_str()

    created = client.post(
        "/trips/",
        headers=_headers(driver),
        json={
            "role": "driver",
            "origin": "Ала-Арча",
            "destination": "ЦУМ",
            "time": "08:15",
            "date": today,
            "seats": 2,
            "price_per_seat": 100,
        },
    )
    assert created.status_code == 200
    trip_id = created.json()["id"]
    assert created.json()["status"] == "active"

    matches = client.get(
        "/trips/matches",
        headers=_headers(passenger),
        params={
            "role": "passenger",
            "origin": "Ала-Арча",
            "destination": "ЦУМ",
            "time": "08:15",
            "date": today,
        },
    )
    assert matches.status_code == 200
    match = next(item for item in matches.json() if item["id"] == trip_id)
    assert match["user"]["car_plate"] is None

    updated = client.patch(
        f"/trips/{trip_id}/status",
        headers=_headers(driver),
        json={"status": "in_progress"},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "in_progress"
    audit = db.query(models.AuditLog).filter_by(
        action="trip.status_changed", entity_id=trip_id, actor_id=driver.id
    ).all()
    assert len(audit) == 1
    assert audit[0].details is not None

    deleted = client.delete(f"/trips/{trip_id}", headers=_headers(driver))
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True


def test_auth_rate_limit_returns_429(client, monkeypatch):
    class DeniedLimiter:
        async def hit(self, key: str, limit: int, window_seconds: int) -> bool:
            return False

    monkeypatch.setattr("routers.auth.get_rate_limiter", lambda: DeniedLimiter())
    response = client.post(
        "/auth/verify-code",
        json={"phone": "+996555000077", "code": "123456"},
    )
    assert response.status_code == 429


def test_readiness_and_request_id(client):
    health = client.get("/health")
    assert health.status_code == 200
    assert health.headers.get("X-Request-ID")

    explicit = client.get("/health", headers={"X-Request-ID": "client-request-1"})
    assert explicit.headers["X-Request-ID"] == "client-request-1"

    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready"}
    assert "/ready" in client.get("/openapi.json").json()["paths"]


def test_security_headers_and_current_cors_origin(client):
    response = client.get("/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert "geolocation=(self)" in response.headers["Permissions-Policy"]
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]

    # Локальный .env может переопределять production-список, поэтому
    # проверяем preflight для фактически разрешённого origin.
    allowed_origin = main.ALLOWED_ORIGINS[0]
    preflight = client.options(
        "/health",
        headers={
            "Origin": allowed_origin,
            "Access-Control-Request-Method": "GET",
        },
    )
    assert preflight.headers["access-control-allow-origin"] == allowed_origin


def test_auth_and_profile_responses_are_not_cached(client, db):
    user = _user(db, "+996555000066", "Кеш")

    profile = client.get("/users/me", headers=_headers(user))
    assert profile.status_code == 200
    assert profile.headers["Cache-Control"] == "no-store"

    public_profile = client.get(f"/users/{user.id}", headers=_headers(user))
    assert public_profile.status_code == 200
    assert public_profile.headers["Cache-Control"] == "no-store"
    assert public_profile.headers["Pragma"] == "no-cache"

    trip = _driver_trip(db, user)
    trip_detail = client.get(f"/trips/{trip.id}", headers=_headers(user))
    assert trip_detail.status_code == 200
    assert trip_detail.headers["Cache-Control"] == "no-store"

    auth_failure = client.post("/auth/refresh")
    assert auth_failure.status_code == 401
    assert auth_failure.headers["Cache-Control"] == "no-store"

    health = client.get("/health")
    assert "Cache-Control" not in health.headers


def test_websocket_chat_rate_limit(client, db, monkeypatch):
    driver = _user(db, "+996555000067", "Водитель")
    trip = _driver_trip(db, driver)
    ticket = auth.create_ws_ticket(driver.id, trip.id, driver.token_version or 0)

    class DeniedLimiter:
        async def hit(self, key: str, limit: int, window_seconds: int) -> bool:
            return False

    monkeypatch.setattr("routers.chat.get_rate_limiter", lambda: DeniedLimiter())

    with client.websocket_connect(
        f"/ws/chat/{trip.id}/{driver.id}?ticket={ticket}"
    ) as websocket:
        websocket.send_text(json.dumps({"text": "hello"}))
        assert websocket.receive_json() == {"error": "rate_limited"}


def test_websocket_closes_after_session_revocation(client, db):
    driver = _user(db, "+996555000068", "Отзыв")
    trip = _driver_trip(db, driver)
    ticket = auth.create_ws_ticket(driver.id, trip.id, driver.token_version or 0)

    with client.websocket_connect(
        f"/ws/chat/{trip.id}/{driver.id}?ticket={ticket}"
    ) as websocket:
        db.query(models.User).filter(models.User.id == driver.id).update(
            {models.User.token_version: 1}
        )
        db.commit()

        with pytest.raises(WebSocketDisconnect):
            websocket.send_text(json.dumps({"text": "after revocation"}))
            websocket.receive_json()


def test_write_rate_limit_returns_429(client, db, monkeypatch):
    user = _user(db, "+996555000078", "Лимит")

    def deny(*args, **kwargs):
        raise HTTPException(status_code=429, detail="Too many writes")

    monkeypatch.setattr("routers.trips.enforce_user_limit_sync", deny)
    response = client.post(
        "/trips/",
        headers=_headers(user),
        json={
            "role": "passenger",
            "origin": "Ала-Арча",
            "destination": "ЦУМ",
            "time": "08:15",
            "date": main.get_bishkek_today_str(),
            "seats": 1,
            "price_per_seat": 100,
        },
    )
    assert response.status_code == 429


def test_trip_detail_is_participant_only(client, db):
    driver = _user(db, "+996555000070", "Водитель")
    passenger = _user(db, "+996555000071", "Пассажир")
    outsider = _user(db, "+996555000072", "Чужой")
    trip = _driver_trip(db, driver)
    _accepted_request(db, trip, passenger)

    driver_view = client.get(f"/trips/{trip.id}", headers=_headers(driver))
    assert driver_view.status_code == 200
    assert driver_view.json()["id"] == trip.id
    assert driver_view.json()["origin"] == "Ала-Арча"
    assert "phone" not in driver_view.json().get("user", {})

    passenger_view = client.get(f"/trips/{trip.id}", headers=_headers(passenger))
    assert passenger_view.status_code == 200

    denied = client.get(f"/trips/{trip.id}", headers=_headers(outsider))
    assert denied.status_code == 404

    missing = client.get("/trips/999999", headers=_headers(outsider))
    assert missing.status_code == 404


def test_trip_check_constraints_reject_invalid_values(client, db):
    user = _user(db, "+996555000079", "Проверка")
    trip = models.Trip(
        user_id=user.id,
        role="driver",
        origin="Ала-Арча",
        destination="ЦУМ",
        time="08:15",
        seats=0,
    )
    db.add(trip)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_active_trip_request_is_unique(client, db):
    driver = _user(db, "+996555000080", "Водитель")
    passenger = _user(db, "+996555000081", "Пассажир")
    trip = _driver_trip(db, driver)
    first = models.TripRequest(
        trip_id=trip.id,
        requester_id=passenger.id,
        driver_id=driver.id,
        status="pending",
    )
    db.add(first)
    db.commit()
    second = models.TripRequest(
        trip_id=trip.id,
        requester_id=passenger.id,
        driver_id=driver.id,
        status="pending",
    )
    db.add(second)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_panic_cooldown_uses_shared_limiter_and_returns_429(client, db, monkeypatch):
    driver = _user(db, "+996555000082", "Водитель")
    trip = _driver_trip(db, driver)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("TELEGRAM_ADMIN_CHAT_ID", "12345")

    class _FakeResponse:
        status_code = 200

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return _FakeResponse()

    monkeypatch.setattr("routers.trips.httpx.AsyncClient", _FakeClient)

    first = client.post(f"/trips/{trip.id}/panic", headers=_headers(driver))
    assert first.status_code == 200
    assert first.json() == {"sent": True}

    second = client.post(f"/trips/{trip.id}/panic", headers=_headers(driver))
    assert second.status_code == 429


def test_redis_rate_limiter_does_not_extend_ttl_when_blocked():
    from rate_limit import RateLimiter

    class _FakeRedis:
        def __init__(self):
            self.counts = {}
            self.expire_calls = 0

        def incr(self, key):
            self.counts[key] = self.counts.get(key, 0) + 1
            return self.counts[key]

        def expire(self, key, seconds):
            self.expire_calls += 1
            return True

    fake = _FakeRedis()
    assert RateLimiter._redis_hit(fake, "k", 2, 60) is True
    assert RateLimiter._redis_hit(fake, "k", 2, 60) is True
    assert RateLimiter._redis_hit(fake, "k", 2, 60) is False
    assert fake.expire_calls == 2


def test_telegram_challenge_new_user_via_bot_contact(client, db, monkeypatch):
    async def fake_send(chat_id, text, reply_markup=None):
        return True

    monkeypatch.setattr(auth, "send_telegram_message", fake_send)

    created = client.post("/auth/telegram-challenge")
    assert created.status_code == 200
    payload = created.json()
    challenge_id = payload["challenge_id"]
    verifier = payload["verifier"]
    assert payload["telegram_url"] == f"https://t.me/{auth.TELEGRAM_BOT_USERNAME}?start=auth_{challenge_id}"

    # Wrong verifier must not leak challenge state.
    bad_status = client.post(
        "/auth/telegram-challenge/status",
        json={"challenge_id": challenge_id, "verifier": "wrong_" + verifier},
    )
    assert bad_status.status_code == 404

    initial = client.post(
        "/auth/telegram-challenge/status",
        json={"challenge_id": challenge_id, "verifier": verifier},
    )
    assert initial.status_code == 200
    assert initial.json()["status"] == "pending"

    # User taps Start in Telegram with the deep link payload.
    start_resp = client.post(
        "/bot/webhook",
        json={
            "message": {
                "chat": {"id": 900000101},
                "from": {"id": 900000101, "first_name": "Айбек"},
                "text": f"/start auth_{challenge_id}",
            }
        },
    )
    assert start_resp.status_code == 200

    started = client.post(
        "/auth/telegram-challenge/status",
        json={"challenge_id": challenge_id, "verifier": verifier},
    )
    assert started.status_code == 200
    assert started.json()["status"] == "bot_started"

    # Sharing someone else's contact must be rejected and must not verify.
    spoof_contact = client.post(
        "/bot/webhook",
        json={
            "message": {
                "chat": {"id": 900000101},
                "from": {"id": 900000101, "first_name": "Айбек"},
                "contact": {"user_id": 999999, "phone_number": "+996555000101"},
            }
        },
    )
    assert spoof_contact.status_code == 200
    still_waiting = client.post(
        "/auth/telegram-challenge/status",
        json={"challenge_id": challenge_id, "verifier": verifier},
    )
    assert still_waiting.json()["status"] == "bot_started"

    # Sharing own Telegram contact verifies the challenge.
    own_contact = client.post(
        "/bot/webhook",
        json={
            "message": {
                "chat": {"id": 900000101},
                "from": {"id": 900000101, "first_name": "Айбек"},
                "contact": {"user_id": 900000101, "phone_number": "996555000101"},
            }
        },
    )
    assert own_contact.status_code == 200

    verified = client.post(
        "/auth/telegram-challenge/status",
        json={"challenge_id": challenge_id, "verifier": verifier},
    )
    assert verified.status_code == 200
    assert verified.json()["status"] == "verified"
    assert verified.json()["is_new_user"] is True
    assert verified.json()["phone"] == "+996 555 000 101"

    completed = client.post(
        "/auth/telegram-challenge/complete",
        json={"challenge_id": challenge_id, "verifier": verifier, "name": "Айбек"},
    )
    assert completed.status_code == 200
    body = completed.json()
    assert body["access_token"]
    assert body["user"]["name"] == "Айбек"
    assert body["user"]["is_verified"] is True

    # Challenge cannot be replayed after completion.
    replay = client.post(
        "/auth/telegram-challenge/complete",
        json={"challenge_id": challenge_id, "verifier": verifier},
    )
    assert replay.status_code == 401


def test_telegram_challenge_existing_binding_verifies_on_start_and_expires(client, db, monkeypatch):
    _user(db, "+996555000102", "Элдар")
    db.add(
        models.TelegramBinding(
            phone="+996 555 000 102",
            phone_normalized="996555000102",
            chat_id=900000102,
        )
    )
    db.commit()

    sent: list[str] = []

    async def fake_send(chat_id, text, reply_markup=None):
        sent.append(text)
        return True

    monkeypatch.setattr(auth, "send_telegram_message", fake_send)

    created = client.post("/auth/telegram-challenge").json()
    challenge_id = created["challenge_id"]
    verifier = created["verifier"]

    start_resp = client.post(
        "/bot/webhook",
        json={
            "message": {
                "chat": {"id": 900000102},
                "from": {"id": 900000102, "first_name": "Элдар"},
                "text": f"/start auth_{challenge_id}",
            }
        },
    )
    assert start_resp.status_code == 200
    assert any("подтверждён" in msg for msg in sent)

    status_resp = client.post(
        "/auth/telegram-challenge/status",
        json={"challenge_id": challenge_id, "verifier": verifier},
    )
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "verified"
    assert status_resp.json()["is_new_user"] is False

    completed = client.post(
        "/auth/telegram-challenge/complete",
        json={"challenge_id": challenge_id, "verifier": verifier},
    )
    assert completed.status_code == 200
    assert completed.json()["user"]["name"] == "Элдар"

    # Expired challenge reports expired status and cannot be completed.
    expired_created = client.post("/auth/telegram-challenge").json()
    row = (
        db.query(models.TelegramAuthChallenge)
        .filter_by(challenge_hash=auth.hash_challenge_token(expired_created["challenge_id"]))
        .first()
    )
    row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    db.commit()

    exp_status = client.post(
        "/auth/telegram-challenge/status",
        json={
            "challenge_id": expired_created["challenge_id"],
            "verifier": expired_created["verifier"],
        },
    )
    assert exp_status.status_code == 200
    assert exp_status.json()["status"] == "expired"

    exp_complete = client.post(
        "/auth/telegram-challenge/complete",
        json={
            "challenge_id": expired_created["challenge_id"],
            "verifier": expired_created["verifier"],
        },
    )
    assert exp_complete.status_code == 401
