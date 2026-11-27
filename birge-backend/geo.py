"""Geolocation constants, offline Bishkek/Chuy hubs, TTL geocache, corridor matching, and routing."""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import threading
import time
from typing import Any, Optional

import httpx

from rate_limit import get_rate_limiter

logger = logging.getLogger("birge")

BISHKEK_CENTER: tuple[float, float] = (42.8746, 74.5698)
DEFAULT_CORRIDOR_KM = 2.0
URBAN_ROAD_FACTOR = 1.35
URBAN_SPEED_KMH = 26.0
GEO_HTTP_TIMEOUT = 2.5
GEO_CACHE_TTL_SECONDS = 86400
ROUTE_CACHE_TTL_SECONDS = 3600
_GEO_USER_AGENT = "BirgeCarpool/1.0 (+https://birge.app)"

# Curated Bishkek & Chuy Valley hubs with display labels and aliases.
# Longer/more-specific aliases should be matched before shorter ones.
BISHKEK_HUB_CATALOG: list[tuple[str, tuple[float, float], tuple[str, ...]]] = [
    ("ЦУМ (Центр)", (42.8760, 74.6140), ("цум", "цум-азия", "чуй", "проспект чуй")),
    ("Площадь Ала-Тоо", (42.8762, 74.6036), ("площадь ала-тоо", "ала-тоо", "ала тоо", "площадь")),
    ("ТРК Asia Mall", (42.8554, 74.5858), ("asia mall", "азия молл", "трк asia mall")),
    ("Южная Магистраль", (42.8285, 74.5970), ("южная магистраль", "магистраль", "токомбаева")),
    ("Политех / БГУ", (42.8495, 74.5872), ("политех", "бгу", "кгуста", "кгту")),
    ("мкр. Асанбай", (42.8240, 74.6305), ("асанбай",)),
    ("мкр. Джал", (42.8425, 74.5620), ("джал", "нижний джал", "верхний джал")),
    ("мкр. Тунгуч", (42.8575, 74.6870), ("тунгуч",)),
    ("мкр. Восток-5", (42.8752, 74.6378), ("восток-5", "восток 5")),
    ("мкр. 7", (42.8315, 74.6160), ("мкр 7", "мкр. 7", "7 микрорайон", "7 мкр")),
    ("мкр. 12", (42.8170, 74.6230), ("мкр 12", "мкр. 12", "12 микрорайон", "12 мкр")),
    ("Орто-Сайский рынок", (42.8390, 74.6145), ("орто-сай", "орто сай")),
    ("Кок-Жар", (42.8470, 74.6460), ("кок-жар", "кок жар")),
    ("ЖК «Ала-Арча»", (42.8380, 74.5520), ("ала-арча", "ала арча", "жилмассив ала-арча")),
    ("ж/м Ак-Өргө", (42.8570, 74.5170), ("ак-өргө", "ак өргө", "ак-орго", "ак орго")),
    ("ж/м Ак-Босого", (42.9055, 74.5655), ("ак-босого", "ак босого")),
    ("Рынок Дордой", (42.9330, 74.6225), ("дордой", "рынок дордой")),
    ("Ошский базар", (42.8758, 74.5705), ("ошский базар", "ошский", "ош базар")),
    ("Аламединский базар", (42.8835, 74.6335), ("аламединский базар", "аламедин")),
    ("Кудайберген", (42.8935, 74.5445), ("кудайберген",)),
    ("ВЕФА Центр", (42.8575, 74.6095), ("вефа", "vefa")),
    ("Бишкек Парк", (42.8750, 74.5905), ("бишкек парк", "bishkek park")),
    ("Филармония", (42.8788, 74.5875), ("филармония",)),
    ("Ж/Д Вокзал (Бишкек-2)", (42.8645, 74.6048), ("ж/д вокзал", "жд вокзал", "вокзал")),
    ("Западный автовокзал", (42.8855, 74.5485), ("западный автовокзал", "западный")),
    ("Восточный автовокзал", (42.8860, 74.6395), ("восточный автовокзал",)),
    ("мкр. Көк-Жар", (42.8470, 74.6460), ("көк-жар",)),
    ("Парк Победы", (42.8260, 74.6060), ("парк победы", "южные ворота")),
    ("Аэропорт Манас", (43.0613, 74.4776), ("аэропорт манас", "манас", "аэропорт")),
    ("г. Кант", (42.8910, 74.8505), ("кант", "г. кант")),
    ("г. Токмок", (42.8419, 75.3015), ("токмок", "г. токмок")),
    ("с. Сокулук", (42.8569, 74.2940), ("сокулук", "с. сокулук")),
    ("г. Кара-Балта", (42.8140, 73.8481), ("кара-балта", "кара балта", "г. кара-балта")),
    ("Центр (Бишкек)", BISHKEK_CENTER, ("центр", "бишкек")),
]

# Ordered by alias length descending so specific names match before generic prefixes.
BISHKEK_LOCATIONS: dict[str, tuple[float, float]] = dict(
    sorted(
        (
            (alias, coords)
            for _, coords, aliases in BISHKEK_HUB_CATALOG
            for alias in aliases
        ),
        key=lambda item: len(item[0]),
        reverse=True,
    )
)

_MEM_CACHE_MAX = 512
_mem_cache: dict[str, tuple[float, Any]] = {}
_mem_cache_lock = threading.Lock()


def _cache_get(key: str) -> Optional[Any]:
    client = get_rate_limiter()._get_client()
    if client is not None:
        try:
            raw = client.get(key)
            if raw:
                return json.loads(raw)
        except Exception:
            logger.debug("[GeoCache] Redis get failed for %s", key)

    now = time.monotonic()
    with _mem_cache_lock:
        entry = _mem_cache.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at < now:
            _mem_cache.pop(key, None)
            return None
        return value


def _cache_set(key: str, value: Any, ttl_seconds: int) -> None:
    client = get_rate_limiter()._get_client()
    if client is not None:
        try:
            client.setex(key, ttl_seconds, json.dumps(value, ensure_ascii=False))
            return
        except Exception:
            logger.debug("[GeoCache] Redis set failed for %s", key)

    now = time.monotonic()
    with _mem_cache_lock:
        if len(_mem_cache) >= _MEM_CACHE_MAX:
            expired = [k for k, (exp, _) in _mem_cache.items() if exp < now]
            for k in expired:
                _mem_cache.pop(k, None)
            while len(_mem_cache) >= _MEM_CACHE_MAX:
                _mem_cache.pop(next(iter(_mem_cache)))
        _mem_cache[key] = (now + ttl_seconds, value)


def reset_geo_cache() -> None:
    """Clear in-memory geo cache (used by tests)."""
    with _mem_cache_lock:
        _mem_cache.clear()


def _norm_text(value: str) -> str:
    return " ".join((value or "").lower().strip().split())


def geocode_bishkek(location_str: str) -> Optional[tuple[float, float]]:
    """Resolve a known Bishkek/Chuy hub or landmark string to (lat, lng)."""
    lower = _norm_text(location_str)
    if not lower:
        return None
    for key, coords in BISHKEK_LOCATIONS.items():
        if key in lower:
            return coords
    return None


def suggest_local_hubs(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Return matching offline Bishkek/Chuy hubs for instant autocomplete."""
    q = _norm_text(query)
    if not q:
        return []
    matches: list[dict[str, Any]] = []
    for label, (lat, lng), aliases in BISHKEK_HUB_CATALOG:
        label_norm = _norm_text(label)
        if q in label_norm or any(q in alias or alias in q for alias in aliases):
            matches.append({"label": label, "lat": lat, "lng": lng, "source": "hub_cache"})
            if len(matches) >= limit:
                break
    return matches


def haversine_km(coord1: tuple[float, float], coord2: tuple[float, float]) -> float:
    """Great-circle distance between two (lat, lng) points in kilometers."""
    lat1, lon1 = math.radians(coord1[0]), math.radians(coord1[1])
    lat2, lon2 = math.radians(coord2[0]), math.radians(coord2[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0 * 2.0 * math.asin(min(1.0, math.sqrt(max(0.0, a))))


def _to_local_km(
    coord: tuple[float, float],
    ref: tuple[float, float] = BISHKEK_CENTER,
) -> tuple[float, float]:
    """Project (lat, lng) onto local tangent-plane kilometers around ref."""
    cos_lat = math.cos(math.radians(ref[0]))
    x = (coord[1] - ref[1]) * 111.32 * cos_lat
    y = (coord[0] - ref[0]) * 111.32
    return (x, y)


def point_to_segment_projection(
    point: tuple[float, float],
    seg_start: tuple[float, float],
    seg_end: tuple[float, float],
) -> tuple[float, float]:
    """Return (distance_km, clamped_t in [0, 1]) from point to segment [seg_start, seg_end]."""
    ref = ((seg_start[0] + seg_end[0]) / 2.0, (seg_start[1] + seg_end[1]) / 2.0)
    ax, ay = _to_local_km(seg_start, ref)
    bx, by = _to_local_km(seg_end, ref)
    px, py = _to_local_km(point, ref)

    abx = bx - ax
    aby = by - ay
    len_sq = abx * abx + aby * aby
    if len_sq < 1e-6:
        return haversine_km(point, seg_start), 0.0

    raw_t = ((px - ax) * abx + (py - ay) * aby) / len_sq
    t = max(0.0, min(1.0, raw_t))
    proj_x = ax + t * abx
    proj_y = ay + t * aby
    dist_km = math.hypot(px - proj_x, py - proj_y)
    return dist_km, t


def resolve_coords(
    label: Optional[str],
    lat: Optional[float] = None,
    lng: Optional[float] = None,
) -> Optional[tuple[float, float]]:
    """Use explicit coordinates when valid, otherwise fall back to curated hubs."""
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
        return (float(lat), float(lng))
    if label:
        return geocode_bishkek(label)
    return None


def locations_match(loc_a: str, loc_b: str, radius_km: float = DEFAULT_CORRIDOR_KM) -> bool:
    """True when two location strings resolve within radius_km or overlap textually."""
    coords_a = geocode_bishkek(loc_a)
    coords_b = geocode_bishkek(loc_b)
    if coords_a and coords_b:
        return haversine_km(coords_a, coords_b) <= radius_km
    a_norm = _norm_text(loc_a)
    b_norm = _norm_text(loc_b)
    return bool(a_norm and b_norm and (a_norm in b_norm or b_norm in a_norm))


def evaluate_trip_match(
    searcher_role: str,
    searcher_origin: str,
    searcher_dest: str,
    candidate_origin: str,
    candidate_dest: str,
    searcher_origin_coords: Optional[tuple[float, float]] = None,
    searcher_dest_coords: Optional[tuple[float, float]] = None,
    candidate_origin_coords: Optional[tuple[float, float]] = None,
    candidate_dest_coords: Optional[tuple[float, float]] = None,
    radius_km: float = DEFAULT_CORRIDOR_KM,
    corridor_km: float = DEFAULT_CORRIDOR_KM,
) -> tuple[bool, Optional[str], Optional[float]]:
    """Determine if two trips match by endpoints, driver corridor, or normalized text.

    Returns ``(matched, match_type, detour_km)`` where ``match_type`` is one of
    ``'exact'``, ``'corridor'``, ``'text'``, or ``None``.
    """
    s_o = searcher_origin_coords or geocode_bishkek(searcher_origin)
    s_d = searcher_dest_coords or geocode_bishkek(searcher_dest)
    c_o = candidate_origin_coords or geocode_bishkek(candidate_origin)
    c_d = candidate_dest_coords or geocode_bishkek(candidate_dest)

    if s_o and s_d and c_o and c_d:
        origin_dist = haversine_km(s_o, c_o)
        dest_dist = haversine_km(s_d, c_d)
        if origin_dist <= radius_km and dest_dist <= radius_km:
            avg_detour = round((origin_dist + dest_dist) / 2.0, 1)
            return True, "exact", avg_detour

        # Corridor check is directional: passenger (P -> D) must lie along driver (A -> B).
        if searcher_role == "driver":
            drv_o, drv_d = s_o, s_d
            pax_o, pax_d = c_o, c_d
        else:
            drv_o, drv_d = c_o, c_d
            pax_o, pax_d = s_o, s_d

        drv_len = haversine_km(drv_o, drv_d)
        if drv_len >= 0.5:
            dist_p, t_p = point_to_segment_projection(pax_o, drv_o, drv_d)
            dist_d, t_d = point_to_segment_projection(pax_d, drv_o, drv_d)
            # Passenger pickup must precede dropoff along driver vector.
            forward_progress = (t_d - t_p) >= 0.08 or haversine_km(pax_o, pax_d) < 0.5 and t_p <= t_d
            if forward_progress and dist_p <= corridor_km and dist_d <= corridor_km:
                return True, "corridor", round(max(dist_p, dist_d), 1)
        return False, None, None

    # Fallback when either side has custom addresses without coordinates.
    s_on = _norm_text(searcher_origin)
    s_dn = _norm_text(searcher_dest)
    c_on = _norm_text(candidate_origin)
    c_dn = _norm_text(candidate_dest)
    from_ok = (
        haversine_km(s_o, c_o) <= radius_km
        if (s_o and c_o)
        else bool(s_on and c_on and (s_on in c_on or c_on in s_on))
    )
    to_ok = (
        haversine_km(s_d, c_d) <= radius_km
        if (s_d and c_d)
        else bool(s_dn and c_dn and (s_dn in c_dn or c_dn in s_dn))
    )
    if from_ok and to_ok:
        return True, "text", None
    return False, None, None


def estimate_route_metrics(
    origin_coords: Optional[tuple[float, float]],
    dest_coords: Optional[tuple[float, float]],
) -> tuple[Optional[float], Optional[int]]:
    """Fast deterministic distance (km) and ETA (minutes) estimate without network I/O."""
    if not origin_coords or not dest_coords:
        return None, None
    straight_km = haversine_km(origin_coords, dest_coords)
    road_km = round(max(0.4, straight_km * URBAN_ROAD_FACTOR), 1)
    eta_minutes = max(3, int(round((road_km / URBAN_SPEED_KMH) * 60.0)))
    return road_km, eta_minutes


def _nearest_hub_label(lat: float, lng: float, max_km: float = 15.0) -> Optional[str]:
    best_label: Optional[str] = None
    best_dist = max_km
    for label, coords, _ in BISHKEK_HUB_CATALOG:
        dist = haversine_km((lat, lng), coords)
        if dist <= best_dist:
            best_dist = dist
            best_label = label
    return best_label


def _in_pytest_without_override() -> bool:
    return bool(os.environ.get("PYTEST_CURRENT_TEST")) and os.environ.get("BIRGE_ALLOW_LIVE_GEO_IN_TESTS") != "1"


async def _fetch_photon(query: str, limit: int) -> list[dict[str, Any]]:
    if _in_pytest_without_override():
        return []
    params = {
        "q": f"{query}, Бишкек",
        "lat": BISHKEK_CENTER[0],
        "lon": BISHKEK_CENTER[1],
        "limit": limit,
        "lang": "ru",
    }
    async with httpx.AsyncClient(
        timeout=GEO_HTTP_TIMEOUT,
        headers={"User-Agent": _GEO_USER_AGENT},
    ) as client:
        resp = await client.get("https://photon.komoot.io/api/", params=params)
        resp.raise_for_status()
        data = resp.json()

    results: list[dict[str, Any]] = []
    for feat in data.get("features") or []:
        coords = (feat.get("geometry") or {}).get("coordinates") or []
        props = feat.get("properties") or {}
        if len(coords) < 2:
            continue
        lng_val, lat_val = float(coords[0]), float(coords[1])
        # Keep suggestions inside Kyrgyzstan/Chuy viewport.
        if not (39.0 <= lat_val <= 43.5 and 69.0 <= lng_val <= 80.5):
            continue
        parts = [
            p
            for p in (
                props.get("name"),
                props.get("street"),
                props.get("housenumber"),
                props.get("district") or props.get("city"),
            )
            if p
        ]
        label = ", ".join(dict.fromkeys(str(p) for p in parts)) or str(query)
        results.append(
            {"label": label[:120], "lat": round(lat_val, 6), "lng": round(lng_val, 6), "source": "photon"}
        )
    return results


async def _fetch_nominatim_search(query: str, limit: int) -> list[dict[str, Any]]:
    if _in_pytest_without_override():
        return []
    params = {
        "q": f"{query}, Бишкек, Кыргызстан",
        "format": "jsonv2",
        "limit": limit,
        "accept-language": "ru",
        "countrycodes": "kg",
    }
    async with httpx.AsyncClient(
        timeout=GEO_HTTP_TIMEOUT,
        headers={"User-Agent": _GEO_USER_AGENT},
    ) as client:
        resp = await client.get("https://nominatim.openstreetmap.org/search", params=params)
        resp.raise_for_status()
        rows = resp.json()

    results: list[dict[str, Any]] = []
    for row in rows or []:
        try:
            lat_val = float(row["lat"])
            lng_val = float(row["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        raw_name = str(row.get("display_name") or query)
        short_label = ", ".join(part.strip() for part in raw_name.split(",")[:2] if part.strip())
        results.append(
            {
                "label": (short_label or raw_name)[:120],
                "lat": round(lat_val, 6),
                "lng": round(lng_val, 6),
                "source": "nominatim",
            }
        )
    return results


async def _fetch_nominatim_reverse(lat: float, lng: float) -> Optional[str]:
    if _in_pytest_without_override():
        return None
    params = {
        "lat": lat,
        "lon": lng,
        "format": "jsonv2",
        "accept-language": "ru",
    }
    async with httpx.AsyncClient(
        timeout=GEO_HTTP_TIMEOUT,
        headers={"User-Agent": _GEO_USER_AGENT},
    ) as client:
        resp = await client.get("https://nominatim.openstreetmap.org/reverse", params=params)
        resp.raise_for_status()
        data = resp.json()
    addr = data.get("address") or {}
    road = addr.get("road") or addr.get("suburb") or addr.get("neighbourhood") or addr.get("city_district")
    house = addr.get("house_number")
    if road and house:
        return f"{road}, {house}"[:120]
    if road:
        return str(road)[:120]
    display_name = str(data.get("display_name") or "").split(",")[0].strip()
    return display_name[:120] if display_name else None


async def _fetch_osrm_route(
    from_coords: tuple[float, float],
    to_coords: tuple[float, float],
) -> Optional[dict[str, Any]]:
    if _in_pytest_without_override():
        return None
    url = (
        f"https://router.project-osrm.org/route/v1/driving/"
        f"{from_coords[1]:.6f},{from_coords[0]:.6f};{to_coords[1]:.6f},{to_coords[0]:.6f}"
    )
    params = {"overview": "full", "geometries": "geojson"}
    async with httpx.AsyncClient(
        timeout=GEO_HTTP_TIMEOUT,
        headers={"User-Agent": _GEO_USER_AGENT},
    ) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        payload = resp.json()
    routes = payload.get("routes") or []
    if not routes:
        return None
    best = routes[0]
    raw_coords = ((best.get("geometry") or {}).get("coordinates") or [])
    if len(raw_coords) < 2:
        return None
    # Convert GeoJSON [lng, lat] pairs to Leaflet [lat, lng] pairs (capped for payload safety).
    geometry = [[round(float(pt[1]), 6), round(float(pt[0]), 6)] for pt in raw_coords[:400]]
    distance_km = round(max(0.2, float(best.get("distance", 0.0)) / 1000.0), 1)
    eta_minutes = max(2, int(round(float(best.get("duration", 0.0)) / 60.0)))
    return {
        "distance_km": distance_km,
        "eta_minutes": eta_minutes,
        "geometry": geometry,
        "source": "osrm",
    }


async def forward_geocode(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Resolve an address string via local hub cache, Redis/memory TTL cache, Photon, and Nominatim."""
    norm = _norm_text(query)
    if len(norm) < 2:
        return []

    local = suggest_local_hubs(norm, limit=limit)
    if len(local) >= limit:
        return local[:limit]

    cache_key = f"birge:geo:fwd:{norm}:{limit}"
    cached = await asyncio.to_thread(_cache_get, cache_key)
    if isinstance(cached, list) and cached:
        return cached[:limit]

    remote: list[dict[str, Any]] = []
    try:
        remote = await _fetch_photon(norm, limit=limit)
    except Exception as exc:
        logger.debug("[Geo] Photon forward geocode failed: %s", type(exc).__name__)
    if not remote:
        try:
            remote = await _fetch_nominatim_search(norm, limit=limit)
        except Exception as exc:
            logger.debug("[Geo] Nominatim forward geocode failed: %s", type(exc).__name__)

    combined = list(local)
    seen = {item["label"].lower() for item in combined}
    for item in remote:
        key = str(item.get("label", "")).lower()
        if key and key not in seen:
            seen.add(key)
            combined.append(item)
        if len(combined) >= limit:
            break

    if combined:
        await asyncio.to_thread(_cache_set, cache_key, combined, GEO_CACHE_TTL_SECONDS)
    return combined[:limit]


async def reverse_geocode(lat: float, lng: float) -> dict[str, Any]:
    """Resolve coordinates into a human-readable street or nearest hub label."""
    lat_r = round(float(lat), 4)
    lng_r = round(float(lng), 4)
    cache_key = f"birge:geo:rev:{lat_r}:{lng_r}"
    cached = await asyncio.to_thread(_cache_get, cache_key)
    if isinstance(cached, dict) and cached.get("label"):
        return cached

    label: Optional[str] = None
    source = "hub_fallback"
    try:
        label = await _fetch_nominatim_reverse(lat, lng)
        if label:
            source = "nominatim"
    except Exception as exc:
        logger.debug("[Geo] Nominatim reverse geocode failed: %s", type(exc).__name__)

    if not label:
        label = _nearest_hub_label(lat, lng)
    if not label:
        label = f"Бишкек ({lat:.3f}, {lng:.3f})"

    result = {"label": label, "lat": float(lat), "lng": float(lng), "source": source}
    await asyncio.to_thread(_cache_set, cache_key, result, GEO_CACHE_TTL_SECONDS)
    return result


async def get_route_preview(
    from_coords: tuple[float, float],
    to_coords: tuple[float, float],
) -> dict[str, Any]:
    """Compute driving route geometry, distance_km, and eta_minutes via OSRM + fallback."""
    key = (
        f"birge:geo:route:{from_coords[0]:.4f},{from_coords[1]:.4f}:"
        f"{to_coords[0]:.4f},{to_coords[1]:.4f}"
    )
    cached = await asyncio.to_thread(_cache_get, key)
    if isinstance(cached, dict) and cached.get("geometry"):
        return cached

    route_data: Optional[dict[str, Any]] = None
    try:
        route_data = await _fetch_osrm_route(from_coords, to_coords)
    except Exception as exc:
        logger.debug("[Geo] OSRM route failed: %s", type(exc).__name__)

    if route_data is None:
        dist_km, eta_min = estimate_route_metrics(from_coords, to_coords)
        route_data = {
            "distance_km": dist_km or 0.4,
            "eta_minutes": eta_min or 3,
            "geometry": [
                [round(from_coords[0], 6), round(from_coords[1], 6)],
                [round(to_coords[0], 6), round(to_coords[1], 6)],
            ],
            "source": "haversine_fallback",
        }

    payload = {
        "origin_lat": round(from_coords[0], 6),
        "origin_lng": round(from_coords[1], 6),
        "dest_lat": round(to_coords[0], 6),
        "dest_lng": round(to_coords[1], 6),
        **route_data,
    }
    await asyncio.to_thread(_cache_set, key, payload, ROUTE_CACHE_TTL_SECONDS)
    return payload
