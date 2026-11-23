import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from starlette.websockets import WebSocketDisconnect

import auth
import database
import main
import models


@pytest.fixture()
def client():
    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)
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

    refresh_response = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert refresh_response.status_code == 200
    assert refresh_response.json()["access_token"]

    failed = client.post("/auth/refresh", json={"refresh_token": access})
    assert failed.status_code == 401


def test_verify_code_issues_a_rotatable_refresh_token(client, db):
    phone = "+996555000008"
    assert auth.save_sms_code(phone, "123456", db)[0] is True

    response = client.post(
        "/auth/verify-code",
        json={"phone": phone, "code": "123456", "name": "Новый"},
    )
    assert response.status_code == 200
    issued = response.json()["refresh_token"]

    rotated = client.post("/auth/refresh", json={"refresh_token": issued})
    assert rotated.status_code == 200
    assert rotated.json()["refresh_token"] != issued


def test_refresh_token_replay_revokes_every_session_and_access_token(client, db):
    user = _user(db, "+996555000005", "Ротация")
    access = auth.create_access_token(
        {"sub": str(user.id), "ver": user.token_version or 0}
    )
    refresh = auth.issue_refresh_token(user, db)
    db.commit()
    headers = {"Authorization": f"Bearer {access}"}
    assert client.get("/users/me", headers=headers).status_code == 200

    first = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert first.status_code == 200
    rotated = first.json()["refresh_token"]
    assert rotated != refresh

    _age_consumed_sessions(db, user)
    replay = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert replay.status_code == 401

    # The stolen successor must not survive the replay either.
    second = client.post("/auth/refresh", json={"refresh_token": rotated})
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

    rotated = client.post("/auth/refresh", json={"refresh_token": first_login})
    assert rotated.status_code == 200
    successor = rotated.json()["refresh_token"]

    _age_consumed_sessions(db, user)
    assert client.post(
        "/auth/refresh", json={"refresh_token": first_login}
    ).status_code == 401
    assert client.post(
        "/auth/refresh", json={"refresh_token": successor}
    ).status_code == 401
    # Minimal user-wide revocation: other device families die too.
    assert client.post(
        "/auth/refresh", json={"refresh_token": second_login}
    ).status_code == 401

    db.expire_all()
    db.refresh(user)
    assert user.token_version == 1


def test_immediate_refresh_reuse_is_a_benign_retry(client, db):
    user = _user(db, "+996555000013", "Повтор")
    refresh = auth.issue_refresh_token(user, db)
    db.commit()

    first = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert first.status_code == 200
    successor = first.json()["refresh_token"]

    retry = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert retry.status_code == 200
    branch = retry.json()["refresh_token"]
    assert branch not in (refresh, successor)

    # Only one extra branch is minted; further duplicates are ignored.
    assert client.post(
        "/auth/refresh", json={"refresh_token": refresh}
    ).status_code == 401

    db.refresh(user)
    assert user.token_version == 0
    # Both branches stay usable: the parallel request was not punished.
    assert client.post(
        "/auth/refresh", json={"refresh_token": successor}
    ).status_code == 200
    assert client.post(
        "/auth/refresh", json={"refresh_token": branch}
    ).status_code == 200


def test_refresh_rate_limit_returns_429(client, db, monkeypatch):
    monkeypatch.setattr("routers.auth._REFRESH_MAX_PER_WINDOW", 2)
    user = _user(db, "+996555000070", "Refresh limit")
    token = auth.issue_refresh_token(user, db)
    db.commit()
    headers = {"X-Forwarded-For": "203.0.113.70"}

    first = client.post("/auth/refresh", json={"refresh_token": token}, headers=headers)
    assert first.status_code == 200
    second = client.post(
        "/auth/refresh",
        json={"refresh_token": first.json()["refresh_token"]},
        headers=headers,
    )
    assert second.status_code == 200

    blocked = client.post(
        "/auth/refresh",
        json={"refresh_token": second.json()["refresh_token"]},
        headers=headers,
    )
    assert blocked.status_code == 429
    assert blocked.headers["Cache-Control"] == "no-store"


def test_login_exchange_code_is_single_use(client, db):
    user = _user(db, "+996555000071", "Обмен")
    code = auth.issue_login_code(user, db)
    db.commit()

    exchanged = client.post("/auth/exchange-code", json={"code": code})
    assert exchanged.status_code == 200
    tokens = exchanged.json()
    assert tokens["refresh_token"]
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

    assert client.get("/users/me", headers=headers).status_code == 200

    logout = client.post("/auth/logout", headers=headers)
    assert logout.status_code == 200
    db.refresh(user)
    assert user.token_version == 1
    assert db.query(models.RefreshSession).filter_by(user_id=user.id).count() == 0

    assert client.get("/users/me", headers=headers).status_code == 401
    assert client.post(
        "/auth/refresh", json={"refresh_token": refresh}
    ).status_code == 401

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

    auth_failure = client.post("/auth/refresh", json={"refresh_token": "x" * 20})
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
