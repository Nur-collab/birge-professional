from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

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


def test_refresh_tokens_are_single_use(client, db):
    user = _user(db, "+996555000005", "Ротация")
    refresh = auth.issue_refresh_token(user, db)
    db.commit()

    first = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert first.status_code == 200
    rotated = first.json()["refresh_token"]
    assert rotated != refresh

    replay = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert replay.status_code == 401

    second = client.post("/auth/refresh", json={"refresh_token": rotated})
    assert second.status_code == 200


def test_refresh_cleanup_removes_consumed_and_expired_sessions_only(client, db):
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
    )
    expired = models.RefreshSession(
        user_id=user.id,
        jti_hash="b" * 64,
        expires_at=now - timedelta(seconds=1),
    )
    db.add_all([revoked, expired])
    db.commit()

    assert auth.purge_refresh_sessions(db, user_id=user.id) == 2
    db.commit()
    remaining = db.query(models.RefreshSession).filter_by(user_id=user.id).all()
    assert len(remaining) == 1
    assert remaining[0].revoked_at is None


def test_refresh_rotation_purges_consumed_session(client, db):
    user = _user(db, "+996555000010", "Rotation cleanup")
    original = auth.issue_refresh_token(user, db)
    db.commit()

    rotated = auth.rotate_refresh_token(original, user, db)
    assert rotated
    db.commit()

    remaining = db.query(models.RefreshSession).filter_by(user_id=user.id).all()
    assert len(remaining) == 1
    assert auth.rotate_refresh_token(original, user, db) is None


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
    assert any(item["id"] == trip_id for item in matches.json())

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
