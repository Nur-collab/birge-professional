"""User data export and account deletion routes (GDPR / store compliance)."""
from datetime import datetime, timezone
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

import auth as auth_service
import models
import schemas
from database import get_db
from dependencies import get_current_user
from rate_limit import enforce_user_limit, enforce_user_limit_sync
from realtime import publish_driver_event, publish_requester_event
from time_utils import get_bishkek_today_str

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me/export", response_model=schemas.UserDataExport)
def export_current_user_data(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export personal profile, trips, requests, reviews, and messages as JSON."""
    enforce_user_limit_sync(current_user.id, "user.export", 5, 3600)

    user = (
        db.query(models.User)
        .options(selectinload(models.User.reviews))
        .filter(models.User.id == current_user.id)
        .first()
    ) or current_user

    telegram_linked = bool(auth_service.get_telegram_chat_id(user.phone, db))

    trip_requests = (
        db.query(models.TripRequest)
        .filter(
            or_(
                models.TripRequest.requester_id == user.id,
                models.TripRequest.driver_id == user.id,
            )
        )
        .order_by(models.TripRequest.id.desc())
        .all()
    )

    own_trips = (
        db.query(models.Trip)
        .filter(models.Trip.user_id == user.id)
        .all()
    )
    own_trip_ids = {t.id for t in own_trips}
    related_trip_ids = {
        r.trip_id
        for r in trip_requests
        if r.trip_id and r.trip_id not in own_trip_ids
    }
    related_trips = []
    if related_trip_ids:
        related_trips = (
            db.query(models.Trip)
            .filter(models.Trip.id.in_(related_trip_ids))
            .all()
        )
    all_trips = sorted(own_trips + related_trips, key=lambda t: t.id, reverse=True)

    reviews_received = (
        db.query(models.Review)
        .filter(models.Review.user_id == user.id)
        .order_by(models.Review.id.desc())
        .all()
    )
    reviews_written = (
        db.query(models.Review)
        .filter(models.Review.author_id == user.id)
        .order_by(models.Review.id.desc())
        .all()
    )
    chat_messages = (
        db.query(models.ChatMessage)
        .filter(models.ChatMessage.sender_id == user.id)
        .order_by(models.ChatMessage.id.asc())
        .all()
    )

    db.add(models.AuditLog(
        actor_id=user.id,
        action="user.data_exported",
        entity_type="user",
        entity_id=user.id,
    ))
    db.commit()

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile": user,
        "telegram_linked": telegram_linked,
        "trips": all_trips,
        "trip_requests": trip_requests,
        "reviews_received": reviews_received,
        "reviews_written": reviews_written,
        "chat_messages": chat_messages,
    }


@router.delete("/me", response_model=schemas.AccountDeleteResponse)
async def delete_current_user_account(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Cancel open trips/bookings, scrub PII, revoke sessions, and delete account."""
    await enforce_user_limit(current_user.id, "user.delete", 3, 3600)

    has_in_progress_own = (
        db.query(models.Trip.id)
        .filter(
            models.Trip.user_id == current_user.id,
            models.Trip.status == "in_progress",
        )
        .first()
        is not None
    )
    has_in_progress_passenger = (
        db.query(models.TripRequest.id)
        .join(models.Trip, models.Trip.id == models.TripRequest.trip_id)
        .filter(
            models.TripRequest.requester_id == current_user.id,
            models.TripRequest.status == "accepted",
            models.Trip.status == "in_progress",
        )
        .first()
        is not None
    )
    if has_in_progress_own or has_in_progress_passenger:
        raise HTTPException(
            status_code=409,
            detail="Finish or cancel your active trip before deleting your account",
        )

    today = get_bishkek_today_str()
    notifications: list[tuple[int, str]] = []
    driver_notifications: list[tuple[int, str]] = []
    cancelled_trips = 0
    released_bookings = 0

    open_own_trips = (
        db.query(models.Trip)
        .filter(
            models.Trip.user_id == current_user.id,
            models.Trip.status.in_(("active", "matched", "scheduled")),
        )
        .all()
    )
    open_own_trip_ids = [t.id for t in open_own_trips]
    for trip in open_own_trips:
        trip.status = "cancelled"
        trip.seats_taken = 0
        cancelled_trips += 1

    if open_own_trip_ids:
        incoming_open = (
            db.query(models.TripRequest)
            .filter(
                models.TripRequest.trip_id.in_(open_own_trip_ids),
                models.TripRequest.status.in_(("pending", "accepted")),
            )
            .all()
        )
        for req in incoming_open:
            was_accepted = req.status == "accepted"
            req.status = "cancelled"
            if was_accepted and req.requester_trip_id:
                p_trip = (
                    db.query(models.Trip)
                    .filter(
                        models.Trip.id == req.requester_trip_id,
                        models.Trip.user_id == req.requester_id,
                    )
                    .first()
                )
                if p_trip and p_trip.status in ("active", "matched", "scheduled"):
                    p_trip.status = "scheduled" if (p_trip.date and p_trip.date > today) else "active"
            if was_accepted and req.requester_id:
                notifications.append((
                    req.requester_id,
                    json.dumps({
                        "event": "trip_cancelled",
                        "trip_id": req.trip_id,
                        "driver_name": current_user.name,
                    }),
                ))

    outgoing_open = (
        db.query(models.TripRequest)
        .filter(
            models.TripRequest.requester_id == current_user.id,
            models.TripRequest.status.in_(("pending", "accepted")),
        )
        .all()
    )
    for req in outgoing_open:
        was_accepted = req.status == "accepted"
        req.status = "cancelled"
        if was_accepted and req.trip_id:
            driver_trip = (
                db.query(models.Trip)
                .filter(models.Trip.id == req.trip_id)
                .first()
            )
            if driver_trip:
                if driver_trip.seats_taken and driver_trip.seats_taken > 0:
                    driver_trip.seats_taken -= 1
                if (
                    driver_trip.status == "matched"
                    and (driver_trip.seats_taken or 0) < (driver_trip.seats or 3)
                ):
                    driver_trip.status = (
                        "scheduled"
                        if (driver_trip.date and driver_trip.date > today)
                        else "active"
                    )
                if driver_trip.user_id:
                    driver_notifications.append((
                        driver_trip.user_id,
                        json.dumps({
                            "event": "passenger_cancelled",
                            "trip_id": driver_trip.id,
                            "passenger_name": current_user.name,
                        }),
                    ))
                released_bookings += 1

    old_phone = current_user.phone or ""
    normalized_digits = "".join(ch for ch in old_phone if ch.isdigit())

    if old_phone:
        binding_filters = [models.TelegramBinding.phone == old_phone]
        if normalized_digits:
            binding_filters.append(models.TelegramBinding.phone_normalized == normalized_digits)
        db.query(models.TelegramBinding).filter(or_(*binding_filters)).delete(synchronize_session=False)
        db.query(models.SmsCode).filter(models.SmsCode.phone == old_phone).delete(synchronize_session=False)
        db.query(models.TelegramAuthChallenge).filter(
            or_(
                models.TelegramAuthChallenge.phone_e164 == old_phone,
                models.TelegramAuthChallenge.phone_formatted == old_phone,
            )
        ).delete(synchronize_session=False)

    db.query(models.RefreshSession).filter(
        models.RefreshSession.user_id == current_user.id
    ).delete(synchronize_session=False)
    db.query(models.LoginCode).filter(
        models.LoginCode.user_id == current_user.id
    ).delete(synchronize_session=False)

    current_user.token_version = int(current_user.token_version or 0) + 1
    current_user.name = "Удалённый пользователь"
    current_user.phone = f"deleted_{current_user.id}_{secrets.token_hex(6)}"
    current_user.photo = None
    current_user.car_model = None
    current_user.car_color = None
    current_user.car_plate = None
    current_user.mbank_phone = None
    current_user.elkart_number = None
    current_user.is_verified = False

    db.add(models.AuditLog(
        actor_id=current_user.id,
        action="user.account_deleted",
        entity_type="user",
        entity_id=current_user.id,
        details=json.dumps({
            "cancelled_trips": cancelled_trips,
            "released_bookings": released_bookings,
        }),
    ))
    db.commit()

    for requester_id, payload in notifications:
        await publish_requester_event(requester_id, payload)
    for driver_id, payload in driver_notifications:
        await publish_driver_event(driver_id, payload)

    return {
        "ok": True,
        "deleted": True,
        "cancelled_trips": cancelled_trips,
        "released_bookings": released_bookings,
    }
