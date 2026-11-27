"""Tests for abuse reporting/moderation, conversion funnel analytics, recurring trips, and cancellation policy."""
from __future__ import annotations

import os
from datetime import timedelta

os.environ["DATABASE_URL"] = "sqlite:///./_test_birge.db"
os.environ["RENDER_EXTERNAL_URL"] = ""
os.environ["ENVIRONMENT"] = "test"
os.environ["ADMIN_PHONES"] = "+996555000001"

from fastapi.testclient import TestClient

import auth
import database
import main
import models
from rate_limit import get_rate_limiter
from time_utils import get_bishkek_now, get_bishkek_today_str


def _reset_and_seed_users():
    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)
    get_rate_limiter().reset_memory()

    db = database.SessionLocal()
    try:
        admin_driver = models.User(name="Admin Driver", phone="+996555000001", car_plate="01KG001ADM")
        passenger = models.User(name="Passenger One", phone="+996555000002")
        outsider = models.User(name="Outsider", phone="+996555000003")
        db.add_all([admin_driver, passenger, outsider])
        db.commit()
        for u in (admin_driver, passenger, outsider):
            db.refresh(u)

        tokens = {
            u.id: auth.create_access_token({"sub": str(u.id), "ver": u.token_version or 0})
            for u in (admin_driver, passenger, outsider)
        }
        return admin_driver.id, passenger.id, outsider.id, tokens
    finally:
        db.close()


def test_moderation_funnel_and_recurring_trip_lifecycle():
    driver_id, pax_id, outsider_id, tokens = _reset_and_seed_users()
    client = TestClient(main.app)
    today = get_bishkek_today_str()

    # /users/me exposes is_admin flag accurately.
    me_admin = client.get("/users/me", headers={"Authorization": f"Bearer {tokens[driver_id]}"})
    me_pax = client.get("/users/me", headers={"Authorization": f"Bearer {tokens[pax_id]}"})
    assert me_admin.status_code == 200 and me_admin.json()["is_admin"] is True
    assert me_pax.status_code == 200 and me_pax.json()["is_admin"] is False

    # 1. Create recurring driver trip & passenger trip.
    r_drv = client.post(
        "/trips/",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={
            "role": "driver",
            "origin": "мкр. Асанбай",
            "destination": "ЦУМ (Центр)",
            "time": "23:55",
            "date": today,
            "seats": 3,
            "price_per_seat": 120,
            "recurrence_days": "6,0,1,2,3,4,5,0",
        },
    )
    assert r_drv.status_code == 200, r_drv.text
    drv_trip = r_drv.json()
    assert drv_trip["recurrence_days"] == "0,1,2,3,4,5,6"

    r_pax_trip = client.post(
        "/trips/",
        headers={"Authorization": f"Bearer {tokens[pax_id]}"},
        json={
            "role": "passenger",
            "origin": "мкр. Асанбай",
            "destination": "ЦУМ (Центр)",
            "time": "23:55",
            "date": today,
        },
    )
    assert r_pax_trip.status_code == 200
    pax_trip_id = r_pax_trip.json()["id"]

    # 2. Funnel: search -> request_sent -> request_accepted -> trip_started -> trip_completed -> review_submitted
    r_match = client.get(
        "/trips/matches",
        headers={"Authorization": f"Bearer {tokens[pax_id]}"},
        params={"role": "passenger", "origin": "мкр. Асанбай", "destination": "ЦУМ (Центр)", "time": "23:55", "date": today},
    )
    assert r_match.status_code == 200 and len(r_match.json()) == 1

    r_req = client.post(
        "/trip-requests/",
        headers={"Authorization": f"Bearer {tokens[pax_id]}"},
        json={"trip_id": drv_trip["id"], "requester_trip_id": pax_trip_id, "driver_id": driver_id},
    )
    assert r_req.status_code == 200
    req_id = r_req.json()["id"]

    r_acc = client.patch(
        f"/trip-requests/{req_id}",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"status": "accepted"},
    )
    assert r_acc.status_code == 200

    r_start = client.patch(
        f"/trips/{drv_trip['id']}/status",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"status": "in_progress"},
    )
    assert r_start.status_code == 200

    r_done = client.patch(
        f"/trips/{drv_trip['id']}/status",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"status": "completed"},
    )
    assert r_done.status_code == 200
    done_data = r_done.json()
    assert done_data["next_scheduled_trip"]["date"] > today

    # Verify next occurrence exists as scheduled recurring trip.
    db = database.SessionLocal()
    try:
        next_trip = db.query(models.Trip).filter(models.Trip.id == done_data["next_scheduled_trip"]["id"]).first()
        assert next_trip is not None
        assert next_trip.status == "scheduled"
        assert next_trip.recurrence_days == "0,1,2,3,4,5,6"
        assert next_trip.price_per_seat == 120
    finally:
        db.close()

    r_rev = client.post(
        "/reviews/",
        headers={"Authorization": f"Bearer {tokens[pax_id]}"},
        json={"user_id": driver_id, "trip_id": drv_trip["id"], "rating": 5, "text": "Great"},
    )
    assert r_rev.status_code == 200

    # Non-admin denied funnel & reports list.
    assert client.get("/admin/funnel", headers={"Authorization": f"Bearer {tokens[pax_id]}"}).status_code == 403
    assert client.get("/admin/reports", headers={"Authorization": f"Bearer {tokens[pax_id]}"}).status_code == 403

    r_funnel = client.get("/admin/funnel", headers={"Authorization": f"Bearer {tokens[driver_id]}"})
    assert r_funnel.status_code == 200, r_funnel.text
    stages = {s["stage"]: s["events_count"] for s in r_funnel.json()["stages"]}
    for stage in ("search", "request_sent", "request_accepted", "trip_started", "trip_completed", "review_submitted"):
        assert stages[stage] >= 1

    # 3. Abuse reporting: outsider blocked (403), self blocked (400), participant succeeds, duplicate open blocked (409).
    assert client.post(
        "/reports/",
        headers={"Authorization": f"Bearer {tokens[pax_id]}"},
        json={"target_user_id": pax_id, "reason": "spam", "details": "self"},
    ).status_code == 400

    assert client.post(
        "/reports/",
        headers={"Authorization": f"Bearer {tokens[outsider_id]}"},
        json={"target_user_id": driver_id, "trip_id": drv_trip["id"], "reason": "rude_behavior"},
    ).status_code == 403

    r_rep = client.post(
        "/reports/",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"target_user_id": pax_id, "trip_id": drv_trip["id"], "reason": "no_show", "details": "Late 20 min"},
    )
    assert r_rep.status_code == 200, r_rep.text
    rep_id = r_rep.json()["id"]

    assert client.post(
        "/reports/",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"target_user_id": pax_id, "trip_id": drv_trip["id"], "reason": "no_show"},
    ).status_code == 409

    # Admin resolves & blocks target user -> token immediately invalid (403).
    r_list = client.get("/admin/reports", headers={"Authorization": f"Bearer {tokens[driver_id]}"})
    assert r_list.status_code == 200 and len(r_list.json()) == 1

    r_mod = client.patch(
        f"/admin/reports/{rep_id}",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"status": "resolved", "admin_note": "Confirmed no-show", "block_target": True},
    )
    assert r_mod.status_code == 200
    assert r_mod.json()["status"] == "resolved"
    assert r_mod.json()["target_is_blocked"] is True

    r_blocked_me = client.get("/users/me", headers={"Authorization": f"Bearer {tokens[pax_id]}"})
    assert r_blocked_me.status_code == 403


def test_late_cancellation_policy_increments_counter_within_30_min():
    driver_id, pax_id, _, tokens = _reset_and_seed_users()
    client = TestClient(main.app)

    now_kg = get_bishkek_now()
    soon_dt = now_kg + timedelta(minutes=15)
    later_dt = now_kg + timedelta(minutes=90)

    # Create trip 15 min from now (late cancel zone) and passenger accepts.
    r_drv = client.post(
        "/trips/",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={
            "role": "driver",
            "origin": "мкр. Асанбай",
            "destination": "ЦУМ (Центр)",
            "time": soon_dt.strftime("%H:%M"),
            "date": soon_dt.date().isoformat(),
            "seats": 3,
        },
    )
    assert r_drv.status_code == 200
    soon_trip_id = r_drv.json()["id"]

    r_req = client.post(
        "/trip-requests/",
        headers={"Authorization": f"Bearer {tokens[pax_id]}"},
        json={"trip_id": soon_trip_id, "driver_id": driver_id},
    )
    assert client.patch(
        f"/trip-requests/{r_req.json()['id']}",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"status": "accepted"},
    ).status_code == 200

    # Passenger cancels 15 min before departure -> late_cancellation=True, count=1.
    r_pax_cancel = client.patch(
        f"/trips/{soon_trip_id}/status",
        headers={"Authorization": f"Bearer {tokens[pax_id]}"},
        json={"status": "passenger_cancelled"},
    )
    assert r_pax_cancel.status_code == 200
    assert r_pax_cancel.json()["late_cancellation"] is True
    assert r_pax_cancel.json()["late_cancellations"] == 1

    # Trip 90 min in advance -> NOT a late cancellation.
    r_drv2 = client.post(
        "/trips/",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={
            "role": "driver",
            "origin": "мкр. Асанбай",
            "destination": "ЦУМ (Центр)",
            "time": later_dt.strftime("%H:%M"),
            "date": later_dt.date().isoformat(),
            "seats": 3,
        },
    )
    later_trip_id = r_drv2.json()["id"]
    r_req2 = client.post(
        "/trip-requests/",
        headers={"Authorization": f"Bearer {tokens[pax_id]}"},
        json={"trip_id": later_trip_id, "driver_id": driver_id},
    )
    client.patch(
        f"/trip-requests/{r_req2.json()['id']}",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"status": "accepted"},
    )
    r_drv_cancel = client.patch(
        f"/trips/{later_trip_id}/status",
        headers={"Authorization": f"Bearer {tokens[driver_id]}"},
        json={"status": "cancelled"},
    )
    assert r_drv_cancel.status_code == 200
    assert r_drv_cancel.json()["late_cancellation"] is False
    assert r_drv_cancel.json()["late_cancellations"] == 0
