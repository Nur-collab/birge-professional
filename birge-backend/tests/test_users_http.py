from datetime import datetime, timedelta

import pytest
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
    assert "t.me/" in first.json()["bot_url"]

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
