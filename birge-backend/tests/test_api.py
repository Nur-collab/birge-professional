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
    refresh = auth.create_refresh_token({"sub": str(user.id)})

    response = client.get("/users/me", headers={"Authorization": f"Bearer {access}"})
    assert response.status_code == 200
    assert response.json()["mbank_phone"] == user.mbank_phone

    refresh_response = client.post("/auth/refresh", json={"refresh_token": refresh})
    assert refresh_response.status_code == 200
    assert refresh_response.json()["access_token"]

    failed = client.post("/auth/refresh", json={"refresh_token": access})
    assert failed.status_code == 401


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
