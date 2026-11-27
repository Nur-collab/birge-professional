"""Privacy-safe conversion funnel event logging and aggregation."""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

import auth
import models
from time_utils import get_bishkek_now, get_bishkek_today_str

logger = logging.getLogger("birge")

FUNNEL_STAGES: tuple[str, ...] = (
    "search",
    "request_sent",
    "request_accepted",
    "trip_started",
    "trip_completed",
    "review_submitted",
)


def _anonymize_actor(user_id: Optional[int], day: str) -> Optional[str]:
    if not user_id:
        return None
    msg = f"{user_id}:{day}".encode("utf-8")
    digest = hmac.new(auth.SECRET_KEY.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return digest[:24]


def record_funnel_event(
    db: Session,
    stage: str,
    user_id: Optional[int],
    role: Optional[str] = None,
    meta: Optional[str] = None,
    *,
    commit: bool = False,
) -> None:
    """Record a non-PII funnel milestone event without risking the caller's UX."""
    if stage not in FUNNEL_STAGES:
        return
    try:
        day = get_bishkek_today_str()
        event = models.FunnelEvent(
            stage=stage,
            role=role[:20] if role else None,
            actor_hash=_anonymize_actor(user_id, day),
            day=day,
            meta=meta[:80] if meta else None,
        )
        db.add(event)
        if commit:
            db.commit()
    except Exception as exc:
        logger.warning("[Funnel] Failed to persist funnel stage %s: %s", stage, type(exc).__name__)
        if commit:
            db.rollback()


def build_funnel_summary(db: Session, days: int = 7) -> dict:
    """Aggregate conversion funnel counts and step conversion percentages."""
    clamped_days = max(1, min(90, int(days)))
    today = get_bishkek_now().date()
    since_day = (today - timedelta(days=clamped_days - 1)).isoformat()

    rows = (
        db.query(
            models.FunnelEvent.stage,
            func.count(models.FunnelEvent.id),
            func.count(func.distinct(models.FunnelEvent.actor_hash)),
        )
        .filter(models.FunnelEvent.day >= since_day)
        .group_by(models.FunnelEvent.stage)
        .all()
    )
    by_stage = {stage: (int(total or 0), int(uniq or 0)) for stage, total, uniq in rows}

    stages = []
    search_total = by_stage.get("search", (0, 0))[0]
    prev_total: Optional[int] = None
    for stage in FUNNEL_STAGES:
        total, unique_actors = by_stage.get(stage, (0, 0))
        from_prev = (
            round((total / prev_total) * 100.0, 1)
            if prev_total and prev_total > 0
            else (100.0 if prev_total is None and total > 0 else 0.0)
        )
        from_search = round((total / search_total) * 100.0, 1) if search_total > 0 else 0.0
        stages.append(
            {
                "stage": stage,
                "events_count": total,
                "unique_actors": unique_actors,
                "conversion_from_prev_pct": from_prev,
                "conversion_from_search_pct": from_search,
            }
        )
        prev_total = total

    daily_rows = (
        db.query(models.FunnelEvent.day, models.FunnelEvent.stage, func.count(models.FunnelEvent.id))
        .filter(models.FunnelEvent.day >= since_day)
        .group_by(models.FunnelEvent.day, models.FunnelEvent.stage)
        .order_by(models.FunnelEvent.day.desc())
        .all()
    )
    days_map: dict[str, dict[str, int]] = {}
    for day_str, stage, cnt in daily_rows:
        bucket = days_map.setdefault(day_str, {})
        bucket[stage] = int(cnt or 0)

    return {
        "days": clamped_days,
        "since_day": since_day,
        "stages": stages,
        "by_day": [{"day": d, "counts": counts} for d, counts in days_map.items()],
    }
