"""Background maintenance tasks: trip reminders and stale trip cleanup."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
from typing import Optional

from sqlalchemy.orm import Session

import auth
import database
import models
from database import SessionLocal
from time_utils import BISHKEK_TZ, get_bishkek_now, parse_time_minutes

logger = logging.getLogger("birge")


def _get_trip_datetime(trip: models.Trip) -> Optional[datetime]:
    """Return trip datetime in Bishkek timezone (UTC+6)."""
    if not trip.date:
        return None
    try:
        parts = [int(p) for p in str(trip.date).strip().split("-") if p.isdigit()]
        if len(parts) != 3:
            return None
        year, month, day = parts
        tm = parse_time_minutes(trip.time)
        hour, minute = (tm // 60, tm % 60) if tm is not None else (23, 59)
        return datetime(year, month, day, hour, minute, tzinfo=BISHKEK_TZ)
    except Exception:
        return None


def cleanup_stale_trips(db: Session) -> dict[str, int]:
    """Archive completed trips, cancel stale unmatched trips, and prune legacy rows."""
    now_bishkek = get_bishkek_now()
    now_utc = datetime.now(timezone.utc)
    stats = {
        "completed_driver_trips": 0,
        "cancelled_driver_trips": 0,
        "cancelled_passenger_trips": 0,
        "declined_stale_requests": 0,
        "pruned_legacy_trips": 0,
    }

    try:
        candidate_trips = (
            db.query(models.Trip)
            .filter(models.Trip.status.in_(["active", "scheduled", "matched", "in_progress"]))
            .all()
        )

        stale_driver_completed: list[models.Trip] = []
        stale_driver_cancelled: list[models.Trip] = []
        stale_passenger_cancelled: list[models.Trip] = []

        for trip in candidate_trips:
            buffer_hours = 12 if trip.status == "in_progress" else 4
            trip_dt = _get_trip_datetime(trip)

            is_stale = False
            if trip_dt:
                if now_bishkek - trip_dt >= timedelta(hours=buffer_hours):
                    is_stale = True
            elif trip.created_at:
                created_utc = (
                    trip.created_at
                    if trip.created_at.tzinfo
                    else trip.created_at.replace(tzinfo=timezone.utc)
                )
                if now_utc - created_utc >= timedelta(hours=buffer_hours):
                    is_stale = True
            elif trip.date and trip.date < now_bishkek.date().isoformat():
                is_stale = True

            if not is_stale:
                continue

            if trip.role == "driver":
                has_passengers = bool(trip.seats_taken and trip.seats_taken > 0)
                if not has_passengers:
                    has_passengers = (
                        db.query(models.TripRequest)
                        .filter(
                            models.TripRequest.trip_id == trip.id,
                            models.TripRequest.status.in_(["accepted", "completed"]),
                        )
                        .first()
                        is not None
                    )
                if has_passengers:
                    stale_driver_completed.append(trip)
                else:
                    stale_driver_cancelled.append(trip)
            else:
                stale_passenger_cancelled.append(trip)

        for d_trip in stale_driver_completed:
            d_trip.status = "completed"
            stats["completed_driver_trips"] += 1

            accepted_reqs = (
                db.query(models.TripRequest)
                .filter(
                    models.TripRequest.trip_id == d_trip.id,
                    models.TripRequest.status == "accepted",
                )
                .all()
            )
            for req in accepted_reqs:
                req.status = "completed"
                if req.requester_trip_id:
                    p_trip = (
                        db.query(models.Trip)
                        .filter(models.Trip.id == req.requester_trip_id)
                        .first()
                    )
                    if p_trip and p_trip.status not in ("completed", "cancelled"):
                        p_trip.status = "completed"

            pending_reqs = (
                db.query(models.TripRequest)
                .filter(
                    models.TripRequest.trip_id == d_trip.id,
                    models.TripRequest.status == "pending",
                )
                .all()
            )
            for p_req in pending_reqs:
                p_req.status = "declined"
                stats["declined_stale_requests"] += 1

        for d_trip in stale_driver_cancelled:
            d_trip.status = "cancelled"
            stats["cancelled_driver_trips"] += 1

            pending_reqs = (
                db.query(models.TripRequest)
                .filter(
                    models.TripRequest.trip_id == d_trip.id,
                    models.TripRequest.status == "pending",
                )
                .all()
            )
            for p_req in pending_reqs:
                p_req.status = "declined"
                stats["declined_stale_requests"] += 1

        for p_trip in stale_passenger_cancelled:
            was_accepted = (
                db.query(models.TripRequest)
                .filter(
                    models.TripRequest.requester_trip_id == p_trip.id,
                    models.TripRequest.status.in_(["accepted", "completed"]),
                )
                .first()
            )
            if was_accepted:
                continue

            p_trip.status = "cancelled"
            stats["cancelled_passenger_trips"] += 1

            out_pending = (
                db.query(models.TripRequest)
                .filter(
                    models.TripRequest.requester_trip_id == p_trip.id,
                    models.TripRequest.status == "pending",
                )
                .all()
            )
            for req in out_pending:
                req.status = "declined"
                stats["declined_stale_requests"] += 1

        cutoff_date = (now_bishkek - timedelta(days=14)).date().isoformat()
        cutoff_utc = now_utc - timedelta(days=14)

        legacy_trips = (
            db.query(models.Trip)
            .filter(
                models.Trip.status == "cancelled",
                (
                    (models.Trip.date.is_not(None) & (models.Trip.date < cutoff_date))
                    | (models.Trip.created_at.is_not(None) & (models.Trip.created_at < cutoff_utc))
                ),
            )
            .limit(100)
            .all()
        )

        if legacy_trips:
            legacy_ids = [t.id for t in legacy_trips]
            chat_trip_ids = {
                m.trip_id
                for m in db.query(models.ChatMessage.trip_id)
                .filter(models.ChatMessage.trip_id.in_(legacy_ids))
                .all()
            }
            review_trip_ids = {
                r.trip_id
                for r in db.query(models.Review.trip_id)
                .filter(models.Review.trip_id.in_(legacy_ids))
                .all()
            }
            safe_to_delete = [
                tid for tid in legacy_ids if tid not in chat_trip_ids and tid not in review_trip_ids
            ]
            if safe_to_delete:
                db.query(models.TripRequest).filter(
                    models.TripRequest.trip_id.in_(safe_to_delete)
                    | models.TripRequest.requester_trip_id.in_(safe_to_delete)
                ).delete(synchronize_session=False)
                deleted_count = (
                    db.query(models.Trip)
                    .filter(models.Trip.id.in_(safe_to_delete))
                    .delete(synchronize_session=False)
                )
                stats["pruned_legacy_trips"] = deleted_count

        db.commit()
    except Exception:
        db.rollback()
        logger.exception("[cleanup_stale_trips] Transaction failed")
        raise

    return stats


async def reminder_loop() -> None:
    """Send 1-hour-before Telegram reminders for scheduled/matched trips."""
    while True:
        await asyncio.sleep(60)
        try:
            now = get_bishkek_now()
            window_from = now + timedelta(minutes=50)
            window_to = now + timedelta(minutes=70)
            candidate_dates = list({window_from.date().isoformat(), window_to.date().isoformat()})

            with SessionLocal() as db:
                trips = (
                    db.query(models.Trip)
                    .filter(
                        models.Trip.status.in_(["scheduled", "matched"]),
                        models.Trip.date.in_(candidate_dates),
                        models.Trip.reminder_sent == False,  # noqa: E712
                    )
                    .all()
                )

                for trip in trips:
                    if not trip.date or not trip.time:
                        continue
                    try:
                        t_year, t_month, t_day = map(int, trip.date.split("-"))
                        tm = parse_time_minutes(trip.time)
                        if tm is None:
                            continue
                        t_hour, t_min = divmod(tm, 60)
                        trip_dt = datetime(t_year, t_month, t_day, t_hour, t_min, tzinfo=BISHKEK_TZ)
                    except (ValueError, AttributeError):
                        continue

                    if not (window_from <= trip_dt <= window_to):
                        continue

                    driver_user = (
                        db.query(models.User).filter(models.User.id == trip.user_id).first()
                    )
                    if driver_user:
                        driver_chat_id = auth.get_telegram_chat_id(driver_user.phone, db)
                        if driver_chat_id:
                            msg = (
                                f"🚗 *Напоминание о поездке!*\n\n"
                                f"До отправления остался примерно *час*.\n"
                                f"↘️ {trip.origin}\n"
                                f"↗️ {trip.destination}\n"
                                f"🕕 {trip.time} — {trip.date}\n\n"
                                f"Роль: *Водитель* 🚘"
                            )
                            await auth.send_telegram_message(driver_chat_id, msg)
                            logger.info("[Reminder] Driver notified trip_id=%s", trip.id)

                    accepted = (
                        db.query(models.TripRequest)
                        .filter(
                            models.TripRequest.trip_id == trip.id,
                            models.TripRequest.status == "accepted",
                        )
                        .all()
                    )
                    for req in accepted:
                        passenger = (
                            db.query(models.User)
                            .filter(models.User.id == req.requester_id)
                            .first()
                        )
                        if not passenger:
                            continue
                        passenger_chat_id = auth.get_telegram_chat_id(passenger.phone, db)
                        if not passenger_chat_id:
                            continue

                        car_info = ""
                        if driver_user and driver_user.car_model:
                            car_info = f"🚙 {driver_user.car_model}"
                            if driver_user.car_color:
                                car_info += f" · {driver_user.car_color}"
                            if driver_user.car_plate:
                                car_info += f" `{driver_user.car_plate}`"
                            car_info = f"\n{car_info}"

                        msg = (
                            f"🚗 *Напоминание о поездке!*\n\n"
                            f"До отправления остался примерно *час*.\n"
                            f"↘️ {trip.origin}\n"
                            f"↗️ {trip.destination}\n"
                            f"🕕 {trip.time} — {trip.date}\n"
                            f"👤 Водитель: *{driver_user.name if driver_user else 'Неизвестно'}*"
                            f"{car_info}\n\n"
                            f"Роль: *Пассажир* 🤺"
                        )
                        await auth.send_telegram_message(passenger_chat_id, msg)
                        logger.info(
                            "[Reminder] Passenger notified user_id=%s trip_id=%s",
                            passenger.id,
                            trip.id,
                        )

                    trip.reminder_sent = True
                    db.commit()
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("[Reminder] Loop error: %s", type(exc).__name__)


async def stale_cleanup_loop() -> None:
    """Periodic stale-trip cleanup loop (every 15 minutes)."""
    while True:
        try:
            await asyncio.sleep(900)
            with database.SessionLocal() as db:
                stats = cleanup_stale_trips(db)
                if sum(stats.values()) > 0:
                    logger.info("[AutoCleanup] Periodic cleanup completed: %s", stats)
        except asyncio.CancelledError:
            break
        except Exception as exc:
            logger.warning("[AutoCleanup] Loop error: %s", type(exc).__name__)
