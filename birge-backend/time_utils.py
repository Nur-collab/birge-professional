"""Bishkek time helpers shared by the API routers."""
from datetime import datetime, timedelta, timezone
from typing import Optional

# UTC+6, no daylight saving time.
BISHKEK_TZ = timezone(timedelta(hours=6))


def get_bishkek_now() -> datetime:
    return datetime.now(BISHKEK_TZ)


def get_bishkek_today_str() -> str:
    return datetime.now(BISHKEK_TZ).date().isoformat()


def parse_time_minutes(time_str: str) -> Optional[int]:
    """Безопасный парсинг времени в минуты от полуночи (HH:MM, HH:MM:SS, AM/PM)."""
    if not time_str:
        return None
    try:
        clean = str(time_str).strip().upper()
        is_pm = "PM" in clean or "ПП" in clean
        is_am = "AM" in clean or "ДП" in clean
        digits_parts = [p for p in clean.replace(":", " ").split() if p.isdigit()]
        if len(digits_parts) >= 2:
            h = int(digits_parts[0])
            m = int(digits_parts[1])
            if is_pm and h < 12:
                h += 12
            elif is_am and h == 12:
                h = 0
            if 0 <= h < 24 and 0 <= m < 60:
                return h * 60 + m
    except (TypeError, ValueError):
        return None
    return None
