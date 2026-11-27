"""Unit and HTTP tests for free geocoding, TTL cache, corridor matching, and ETA."""
from __future__ import annotations

import os

os.environ["DATABASE_URL"] = "sqlite:///./_test_birge.db"
os.environ["RENDER_EXTERNAL_URL"] = ""
os.environ["ENVIRONMENT"] = "test"
os.environ["ADMIN_PHONES"] = "+996555000001"

from fastapi.testclient import TestClient

import auth
import database
import geo
import main
import models
from rate_limit import get_rate_limiter


def _setup_users():
    database.Base.metadata.drop_all(bind=database.engine)
    database.Base.metadata.create_all(bind=database.engine)
    geo.reset_geo_cache()
    get_rate_limiter().reset_memory()

    db = database.SessionLocal()
    try:
        driver = models.User(name="Driver Geo", phone="+996555110001", car_plate="01KG999ABC")
        passenger = models.User(name="Passenger Geo", phone="+996555110002")
        db.add_all([driver, passenger])
        db.commit()
        db.refresh(driver)
        db.refresh(passenger)
        driver_token = auth.create_access_token(
            {"sub": str(driver.id), "ver": driver.token_version or 0}
        )
        passenger_token = auth.create_access_token(
            {"sub": str(passenger.id), "ver": passenger.token_version or 0}
        )
        return driver.id, driver_token, passenger.id, passenger_token
    finally:
        db.close()


def test_corridor_matching_directional_and_off_corridor():
    matched, m_type, detour = geo.evaluate_trip_match(
        searcher_role="passenger",
        searcher_origin="Орто-Сайский рынок",
        searcher_dest="ВЕФА Центр",
        candidate_origin="мкр. Асанбай",
        candidate_dest="ЦУМ (Центр)",
    )
    assert matched is True
    assert m_type == "corridor"
    assert detour is not None and detour <= 2.0

    # Opposite direction must not match along corridor.
    rev_matched, _, _ = geo.evaluate_trip_match(
        searcher_role="passenger",
        searcher_origin="ВЕФА Центр",
        searcher_dest="Орто-Сайский рынок",
        candidate_origin="мкр. Асанбай",
        candidate_dest="ЦУМ (Центр)",
    )
    assert rev_matched is False

    # Off-corridor route must not match.
    off_matched, _, _ = geo.evaluate_trip_match(
        searcher_role="passenger",
        searcher_origin="Аэропорт Манас",
        searcher_dest="Рынок Дордой",
        candidate_origin="мкр. Асанбай",
        candidate_dest="ЦУМ (Центр)",
    )
    assert off_matched is False


def test_trip_coordinates_and_corridor_matches_http():
    _, driver_token, _, passenger_token = _setup_users()
    client = TestClient(main.app)

    today = main.get_bishkek_today_str()
    r1 = client.post(
        "/trips/",
        headers={"Authorization": f"Bearer {driver_token}"},
        json={
            "role": "driver",
            "origin": "мкр. Асанбай",
            "destination": "ЦУМ (Центр)",
            "time": "09:00",
            "date": today,
            "seats": 3,
            "price_per_seat": 100,
        },
    )
    assert r1.status_code == 200, r1.text
    created = r1.json()
    assert created["origin_lat"] is not None
    assert created["dest_lat"] is not None

    # Passenger travelling along driver corridor (Orto-Sai -> Vefa) finds driver.
    r_matches = client.get(
        "/trips/matches",
        headers={"Authorization": f"Bearer {passenger_token}"},
        params={
            "role": "passenger",
            "origin": "Орто-Сайский рынок",
            "destination": "ВЕФА Центр",
            "time": "09:10",
            "date": today,
        },
    )
    assert r_matches.status_code == 200, r_matches.text
    rows = r_matches.json()
    assert len(rows) == 1
    assert rows[0]["id"] == created["id"]
    assert rows[0]["match_type"] == "corridor"
    assert rows[0]["distance_km"] is not None and rows[0]["distance_km"] > 0
    assert rows[0]["eta_minutes"] is not None and rows[0]["eta_minutes"] >= 3
    assert rows[0]["user"]["car_plate"] is None


def test_geocode_reverse_and_route_preview_endpoints(monkeypatch):
    _, _, _, passenger_token = _setup_users()
    client = TestClient(main.app)

    # Local hub geocode needs zero external network calls.
    r_local = client.get(
        "/trips/geocode",
        headers={"Authorization": f"Bearer {passenger_token}"},
        params={"q": "Асанб"},
    )
    assert r_local.status_code == 200
    assert any("Асанбай" in item["label"] for item in r_local.json())

    # Photon mock + TTL cache reuse check.
    calls = {"photon": 0}

    async def fake_photon(query: str, limit: int = 5):
        calls["photon"] += 1
        return [{"label": "ул. Киевская, 120", "lat": 42.8752, "lng": 74.6011, "source": "photon"}]

    monkeypatch.setattr(geo, "_fetch_photon", fake_photon)
    r_fwd1 = client.get(
        "/trips/geocode",
        headers={"Authorization": f"Bearer {passenger_token}"},
        params={"q": "Киевская 120", "limit": 3},
    )
    r_fwd2 = client.get(
        "/trips/geocode",
        headers={"Authorization": f"Bearer {passenger_token}"},
        params={"q": "Киевская 120", "limit": 3},
    )
    assert r_fwd1.status_code == 200
    assert r_fwd1.json()[0]["label"] == "ул. Киевская, 120"
    assert r_fwd2.json()[0]["label"] == "ул. Киевская, 120"
    assert calls["photon"] == 1

    # Reverse geocode offline nearest-hub fallback.
    r_rev = client.get(
        "/trips/reverse-geocode",
        headers={"Authorization": f"Bearer {passenger_token}"},
        params={"lat": 42.8760, "lng": 74.6140},
    )
    assert r_rev.status_code == 200
    assert "ЦУМ" in r_rev.json()["label"]

    # Route preview fallback + mocked OSRM response.
    r_route_fb = client.get(
        "/trips/route-preview",
        headers={"Authorization": f"Bearer {passenger_token}"},
        params={"origin": "мкр. Асанбай", "destination": "ЦУМ (Центр)"},
    )
    assert r_route_fb.status_code == 200
    rb = r_route_fb.json()
    assert rb["source"] == "haversine_fallback"
    assert len(rb["geometry"]) == 2
    assert rb["eta_minutes"] >= 3

    async def fake_osrm(from_coords, to_coords):
        return {
            "distance_km": 7.4,
            "eta_minutes": 18,
            "geometry": [
                [from_coords[0], from_coords[1]],
                [42.85, 74.61],
                [to_coords[0], to_coords[1]],
            ],
            "source": "osrm",
        }

    geo.reset_geo_cache()
    monkeypatch.setattr(geo, "_fetch_osrm_route", fake_osrm)
    r_route_osrm = client.get(
        "/trips/route-preview",
        headers={"Authorization": f"Bearer {passenger_token}"},
        params={"origin": "мкр. Асанбай", "destination": "ЦУМ (Центр)"},
    )
    assert r_route_osrm.status_code == 200
    ro = r_route_osrm.json()
    assert ro["source"] == "osrm"
    assert ro["distance_km"] == 7.4
    assert ro["eta_minutes"] == 18
    assert len(ro["geometry"]) == 3
