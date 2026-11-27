"""Geolocation constants, offline Bishkek hubs, and distance helpers."""
import math
from typing import Optional

BISHKEK_LOCATIONS: dict[str, tuple[float, float]] = {
    "ала-арча": (42.8380, 74.5520),
    "ала арча": (42.8380, 74.5520),
    "аламедин": (42.8700, 74.5200),
    "джал": (42.8200, 74.5700),
    "кара-жыгач": (42.8650, 74.5050),
    "кара жыгач": (42.8650, 74.5050),
    "асанбай": (42.8450, 74.6300),
    "тунгуч": (42.8920, 74.5980),
    "восток-5": (42.8750, 74.6100),
    "восток 5": (42.8750, 74.6100),
    "мкр 7": (42.8550, 74.5650),
    "мкр. 7": (42.8550, 74.5650),
    "ак-орго": (42.8600, 74.5300),
    "ак орго": (42.8600, 74.5300),
    "кожомкул": (42.8500, 74.5100),
    "деревня": (42.8850, 74.6200),
    "кеминчи": (42.8950, 74.5600),
    "бай тюбе": (42.8300, 74.5900),
    "байтюбе": (42.8300, 74.5900),
    "новпостройка": (42.8650, 74.5800),
    "интернациональный аэропорт": (42.8474, 74.4776),
    "цум": (42.8760, 74.6050),
    "центр": (42.8746, 74.5698),
    "площадь": (42.8762, 74.6036),
    "ала-тоо": (42.8762, 74.6036),
    "ала тоо": (42.8762, 74.6036),
    "ошский базар": (42.8820, 74.5780),
    "ошский": (42.8820, 74.5780),
    "дордой": (42.9100, 74.6300),
    "кузнечная": (42.8780, 74.5850),
    "карпинка": (42.8670, 74.6010),
    "рушания": (42.8900, 74.5700),
    "цум-азия": (42.8760, 74.6050),
    "горький парк": (42.8820, 74.5980),
    "фучик": (42.8800, 74.5900),
    "ботанический сад": (42.8850, 74.5820),
    "октябрьская": (42.8730, 74.5950),
    "истанкул": (42.8680, 74.5720),
    "меркентиль": (42.8940, 74.5940),
    "манас": (42.8474, 74.4776),
    "аэропорт": (42.8474, 74.4776),
    "западный автовокзал": (42.8700, 74.5500),
    "западный": (42.8700, 74.5500),
    "восточный автовокзал": (42.8780, 74.6400),
}


def geocode_bishkek(location_str: str) -> Optional[tuple[float, float]]:
    """Resolve a known Bishkek district/landmark string to (lat, lng)."""
    if not location_str:
        return None
    lower = location_str.lower().strip()
    for key, coords in BISHKEK_LOCATIONS.items():
        if key in lower:
            return coords
    return None


def haversine_km(coord1: tuple[float, float], coord2: tuple[float, float]) -> float:
    """Great-circle distance between two (lat, lng) points in kilometers."""
    lat1, lon1 = math.radians(coord1[0]), math.radians(coord1[1])
    lat2, lon2 = math.radians(coord2[0]), math.radians(coord2[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def locations_match(loc_a: str, loc_b: str, radius_km: float = 2.0) -> bool:
    """True when two location strings resolve within radius_km or overlap textually."""
    coords_a = geocode_bishkek(loc_a)
    coords_b = geocode_bishkek(loc_b)
    if coords_a and coords_b:
        return haversine_km(coords_a, coords_b) <= radius_km
    a_norm = " ".join(loc_a.lower().split())
    b_norm = " ".join(loc_b.lower().split())
    return a_norm in b_norm or b_norm in a_norm
