from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import auth
import database
import main
import models


@pytest.fixture()
def client():
    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)
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


def _user(db, phone: str = "+996555000010", name: str = "Пользователь", verified: bool = True):
    user = models.User(
        name=name,
        phone=phone,
        mbank_phone=phone,
        elkart_number="123456",
        is_verified=verified,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _headers(user):
    return {"Authorization": f"Bearer {auth.create_access_token({'sub': str(user.id)})}"}


def _future_date(days: int = 1) -> str:
    return (
        datetime.strptime(main.get_bishkek_today_str(), "%Y-%m-%d") + timedelta(days=days)
    ).strftime("%Y-%m-%d")


def _trip(
    db,
    user,
    *,
    role: str = "driver",
    date: str = None,
    status: str = "active",
    seats: int = 3,
    seats_taken: int = 0,
):
    trip = models.Trip(
        user_id=user.id,
        role=role,
        origin="Ала-Арча",
        destination="ЦУМ",
        time="08:15",
        date=date,
        status=status,
        seats=seats,
        seats_taken=seats_taken,
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip


def _accepted_request(db, trip, passenger, requester_trip_id=None):
    request = models.TripRequest(
        trip_id=trip.id,
        requester_id=passenger.id,
        requester_trip_id=requester_trip_id,
        driver_id=trip.user_id,
        status="accepted",
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


def test_users_me_patch_and_public_profile(client, db):
    user = _user(db, name="Старое имя")
    headers = _headers(user)

    updated = client.patch(
        "/users/me",
        headers=headers,
        json={"name": "Новое имя", "car_model": "Toyota", "car_plate": "A123BC"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Новое имя"
    assert updated.json()["car_model"] == "Toyota"

    public = client.get(f"/users/{user.id}", headers=headers)
    assert public.status_code == 200
    body = public.json()
    assert body["id"] == user.id
    assert body["name"] == "Новое имя"
    assert "phone" not in body
    assert "mbank_phone" not in body
    assert "elkart_number" not in body

    assert client.get("/users/999999", headers=headers).status_code == 404
    assert client.get("/users/me").status_code == 401


def test_public_profile_is_limited_to_self_and_accepted_trip(client, db):
    driver = _user(db, phone="+996555000017", name="Водитель")
    driver.car_plate = "A123BC"
    passenger = _user(db, phone="+996555000018", name="Пассажир")
    co_passenger = _user(db, phone="+996555000019", name="Попутчик")
    stranger = _user(db, phone="+996555000020", name="Посторонний")
    db.commit()

    trip = _trip(db, driver, seats=3, seats_taken=2)
    _accepted_request(db, trip, passenger)
    _accepted_request(db, trip, co_passenger)
    db.add(
        models.TripRequest(
            trip_id=trip.id,
            requester_id=stranger.id,
            driver_id=driver.id,
            status="pending",
        )
    )
    db.commit()

    own = client.get(f"/users/{driver.id}", headers=_headers(driver))
    assert own.status_code == 200
    assert own.json()["car_plate"] == "A123BC"

    shared_driver = client.get(f"/users/{driver.id}", headers=_headers(passenger))
    assert shared_driver.status_code == 200
    assert shared_driver.json()["car_plate"] == "A123BC"

    shared_passenger = client.get(f"/users/{passenger.id}", headers=_headers(driver))
    assert shared_passenger.status_code == 200

    shared_co_passenger = client.get(
        f"/users/{co_passenger.id}", headers=_headers(passenger)
    )
    assert shared_co_passenger.status_code == 200

    for target in (driver, passenger, co_passenger):
        blocked = client.get(f"/users/{target.id}", headers=_headers(stranger))
        assert blocked.status_code == 404
        assert blocked.json() == {"detail": "User not found"}
        assert "A123BC" not in blocked.text


def test_public_profile_is_rate_limited(client, db, monkeypatch):
    user = _user(db, phone="+996555000021")
    calls = []

    def deny(*args, **kwargs):
        calls.append(args)
        raise HTTPException(status_code=429, detail="Too many requests")

    monkeypatch.setattr("routers.users.enforce_user_limit_sync", deny)
    response = client.get(f"/users/{user.id}", headers=_headers(user))
    assert response.status_code == 429
    assert calls == [(user.id, "user.profile.read", 60, 60)]


def test_users_trips_and_active_trip(client, db):
    driver = _user(db, phone="+996555000011", name="Водитель")
    passenger = _user(db, phone="+996555000012", name="Пассажир")
    trip = _trip(
        db,
        driver,
        date=main.get_bishkek_today_str(),
        status="matched",
        seats=2,
        seats_taken=1,
    )
    _accepted_request(db, trip, passenger)

    driver_history = client.get("/users/me/trips", headers=_headers(driver))
    assert driver_history.status_code == 200
    assert any(item["id"] == trip.id for item in driver_history.json())

    passenger_history = client.get("/users/me/trips", headers=_headers(passenger))
    assert passenger_history.status_code == 200
    assert any(item["id"] == trip.id for item in passenger_history.json())

    passenger_active = client.get("/users/me/active-trip", headers=_headers(passenger))
    assert passenger_active.status_code == 200
    assert passenger_active.json()["found"] is True
    assert passenger_active.json()["trip_id"] == trip.id
    assert passenger_active.json()["role"] == "passenger"

    driver_active = client.get("/users/me/active-trip", headers=_headers(driver))
    assert driver_active.status_code == 200
    assert driver_active.json()["found"] is True
    assert driver_active.json()["trip_id"] == trip.id
    assert driver_active.json()["role"] == "driver"


def test_users_verify_telegram_flow(client, db):
    user = _user(db, phone="+996555000013", verified=False)
    headers = _headers(user)

    first = client.post("/users/me/verify", headers=headers)
    assert first.status_code == 200
    assert first.json()["status"] == "need_telegram"
    assert first.json()["bot_url"] == f"https://t.me/{auth.TELEGRAM_BOT_USERNAME}"
    assert "996555000013" not in first.json()["bot_url"]

    digits = "".join(ch for ch in user.phone if ch.isdigit())
    db.add(
        models.TelegramBinding(
            phone=user.phone,
            phone_normalized=digits,
            chat_id=123456789,
        )
    )
    db.commit()

    second = client.post("/users/me/verify", headers=headers)
    assert second.status_code == 200
    assert second.json()["status"] == "verified"

    db.refresh(user)
    assert user.is_verified is True


def test_users_scheduled_trips_for_driver_and_passenger(client, db):
    driver = _user(db, phone="+996555000014", name="Водитель")
    passenger = _user(db, phone="+996555000015", name="Пассажир")
    future = _future_date()

    driver_trip = _trip(
        db,
        driver,
        date=future,
        status="scheduled",
        seats=3,
        seats_taken=1,
    )
    passenger_trip = _trip(
        db,
        passenger,
        role="passenger",
        date=future,
        status="scheduled",
    )
    _accepted_request(
        db,
        driver_trip,
        passenger,
        requester_trip_id=passenger_trip.id,
    )

    driver_data = client.get("/users/me/scheduled-trips", headers=_headers(driver))
    assert driver_data.status_code == 200
    driver_entry = next(item for item in driver_data.json() if item["trip_id"] == driver_trip.id)
    assert driver_entry["role"] == "driver"
    assert driver_entry["passengers"][0]["id"] == passenger.id

    passenger_data = client.get("/users/me/scheduled-trips", headers=_headers(passenger))
    assert passenger_data.status_code == 200
    passenger_entry = next(
        item for item in passenger_data.json() if item["trip_id"] == driver_trip.id
    )
    assert passenger_entry["role"] == "passenger"
    assert passenger_entry["driver"]["id"] == driver.id


def test_users_photo_validates_file_before_external_upload(client, db, monkeypatch):
    monkeypatch.setenv("IMGBB_API_KEY", "test-key")
    user = _user(db, phone="+996555000016")
    headers = _headers(user)

    empty = client.post(
        "/users/me/photo",
        headers=headers,
        files={"file": ("avatar.png", b"", "image/png")},
    )
    assert empty.status_code == 400

    invalid = client.post(
        "/users/me/photo",
        headers=headers,
        files={"file": ("avatar.png", b"not-an-image", "image/png")},
    )
    assert invalid.status_code == 400


def test_users_me_export_and_audit_log(client, db):
    driver = _user(db, phone="+996555000031", name="Экспорт Водитель")
    passenger = _user(db, phone="+996555000032", name="Экспорт Пассажир")
    digits = "".join(ch for ch in driver.phone if ch.isdigit())
    db.add(models.TelegramBinding(phone=driver.phone, phone_normalized=digits, chat_id=987654321))
    trip = _trip(db, driver, date=_future_date(), status="scheduled", seats=3, seats_taken=1)
    _accepted_request(db, trip, passenger)
    db.add(models.Review(user_id=driver.id, author_id=passenger.id, author_name=passenger.name, trip_id=trip.id, text="Отлично", rating=5))
    db.add(models.ChatMessage(trip_id=trip.id, sender_id=driver.id, text="Выезжаю", timestamp="08:00"))
    db.commit()

    resp = client.get("/users/me/export", headers=_headers(driver))
    assert resp.status_code == 200
    body = resp.json()
    assert body["telegram_linked"] is True
    assert body["profile"]["phone"] == "+996555000031"
    assert body["profile"]["elkart_number"] == "123456"
    assert len(body["trips"]) == 1
    assert len(body["trip_requests"]) == 1
    assert len(body["reviews_received"]) == 1
    assert len(body["chat_messages"]) == 1
    assert body["chat_messages"][0]["text"] == "Выезжаю"

    audit = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.actor_id == driver.id, models.AuditLog.action == "user.data_exported")
        .first()
    )
    assert audit is not None


def test_users_me_delete_blocks_in_progress_trip(client, db):
    driver = _user(db, phone="+996555000033", name="Активный Водитель")
    passenger = _user(db, phone="+996555000034", name="Активный Пассажир")
    trip = _trip(db, driver, status="in_progress", seats=3, seats_taken=1)
    _accepted_request(db, trip, passenger)

    driver_res = client.delete("/users/me", headers=_headers(driver))
    assert driver_res.status_code == 409

    passenger_res = client.delete("/users/me", headers=_headers(passenger))
    assert passenger_res.status_code == 409


def test_users_me_delete_scrubs_pii_releases_seats_and_revokes_sessions(client, db):
    driver = _user(db, phone="+996555000035", name="Водитель")
    victim = _user(db, phone="+996555000036", name="Удаляемый")
    victim.car_model = "Honda Fit"
    victim.car_plate = "01KG999XYZ"
    future = _future_date()
    digits = "".join(ch for ch in victim.phone if ch.isdigit())
    db.add(models.TelegramBinding(phone=victim.phone, phone_normalized=digits, chat_id=555666777))
    db.add(models.RefreshSession(
        user_id=victim.id,
        jti_hash="a" * 64,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        family_id="fam1",
    ))

    # Driver trip that was full because victim accepted a seat.
    driver_trip = _trip(db, driver, date=future, status="matched", seats=1, seats_taken=1)
    victim_passenger_trip = _trip(db, victim, role="passenger", date=future, status="matched")
    _accepted_request(db, driver_trip, victim, requester_trip_id=victim_passenger_trip.id)

    # Also victim's own future driver trip.
    victim_driver_trip = _trip(db, victim, role="driver", date=future, status="scheduled")
    db.commit()

    victim_headers = _headers(victim)
    res = client.delete("/users/me", headers=victim_headers)
    assert res.status_code == 200
    payload = res.json()
    assert payload["deleted"] is True
    assert payload["cancelled_trips"] == 2
    assert payload["released_bookings"] == 1

    # Old JWT must immediately stop working.
    assert client.get("/users/me", headers=victim_headers).status_code == 401

    db.expire_all()
    refreshed_victim = db.query(models.User).filter(models.User.id == victim.id).first()
    assert refreshed_victim.phone.startswith(f"deleted_{victim.id}_")
    assert "+996555000036" != refreshed_victim.phone
    assert refreshed_victim.car_model is None
    assert refreshed_victim.mbank_phone is None
    assert refreshed_victim.elkart_number is None
    assert refreshed_victim.is_verified is False

    refreshed_driver_trip = db.query(models.Trip).filter(models.Trip.id == driver_trip.id).first()
    assert refreshed_driver_trip.seats_taken == 0
    assert refreshed_driver_trip.status == "scheduled"

    refreshed_own = db.query(models.Trip).filter(models.Trip.id == victim_driver_trip.id).first()
    assert refreshed_own.status == "cancelled"

    assert db.query(models.TelegramBinding).filter(models.TelegramBinding.phone_normalized == digits).first() is None
    assert db.query(models.RefreshSession).filter(models.RefreshSession.user_id == victim.id).first() is None

    audit = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.actor_id == victim.id, models.AuditLog.action == "user.account_deleted")
        .first()
    )
    assert audit is not None
    assert "+996555000036" not in (audit.details or "")
