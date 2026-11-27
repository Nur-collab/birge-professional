"""Trip, chat and payment routes."""
import html
import json
import logging
import os
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_ as _or
from sqlalchemy.orm import Session, joinedload

import auth as auth_service
import models
import schemas
from database import get_db
from dependencies import get_current_user
from geo import locations_match
from rate_limit import enforce_user_limit, enforce_user_limit_sync, get_rate_limiter
from realtime import (
    is_trip_participant,
    publish_chat_message,
    publish_driver_event,
    publish_requester_event,
)
from time_utils import get_bishkek_now, get_bishkek_today_str, parse_time_minutes

logger = logging.getLogger("birge")
router = APIRouter(prefix="/trips", tags=["trips"])


@router.post("/", response_model=schemas.Trip)
def create_trip(trip: schemas.TripCreate, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    enforce_user_limit_sync(current_user.id, "trip.create", 20, 3600)
    user = current_user
    if not user:
         raise HTTPException(status_code=404, detail="User not found")

    today_str = get_bishkek_today_str()

    # Сбрасываем лимит, если начался новый день
    if user.last_trip_date != today_str:
        user.trips_today = 0
        user.last_trip_date = today_str

    # Проверка лимита водителя
    if trip.role == "driver":
        if user.trips_today >= 3:
            raise HTTPException(status_code=400, detail="Daily driver trip limit (3) exceeded")

    trip_data = trip.model_dump()
    trip_data["user_id"] = user.id

    # Если дата поездки в будущем — ставим статус 'scheduled', иначе 'active'
    trip_date = trip_data.get("date")
    if trip_date and trip_date > today_str:
        trip_data["status"] = "scheduled"
    else:
        trip_data["status"] = "active"

    valid_trip_fields = {c.name for c in models.Trip.__table__.columns}
    filtered_data = {k: v for k, v in trip_data.items() if k in valid_trip_fields}

    new_trip = models.Trip(**filtered_data)
    if trip.role == "driver":
        user.trips_today += 1
    db.add(new_trip)
    db.commit()
    db.refresh(new_trip)
    return new_trip

@router.get("/matches", response_model=List[schemas.Trip])
def find_matches(role: str, origin: str, destination: str, time: str, date: Optional[str] = None, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Улучшенный алгоритм поиска попутчиков:
    1. Haversine-расстояние по геокоординатам (радиус 2км)
    2. Fallback: текстовый поиск с нормализацией
    3. Время: разница не более 30 минут
    """
    enforce_user_limit_sync(current_user.id, "trip.matches", 60, 60)
    target_role = "passenger" if role == "driver" else "driver"

    # Показываем как 'active', так и 'scheduled' поездки
    trip_query = db.query(models.Trip).options(joinedload(models.Trip.user)).filter(
        models.Trip.role == target_role,
        _or(models.Trip.status == "active", models.Trip.status == "scheduled"),
        models.Trip.user_id != current_user.id,
        # Не показываем машины, в которых уже нет свободных мест
        _or(
            models.Trip.seats.is_(None),
            models.Trip.seats_taken.is_(None),
            models.Trip.seats_taken < models.Trip.seats,
        ),
    )

    # Фильтр по дате: если дата передана — показываем только её (+ legacy записи без даты)
    if date:
        trip_query = trip_query.filter(
            _or(models.Trip.date == date, models.Trip.date.is_(None))
        )

    potential_trips = trip_query.order_by(models.Trip.id.desc()).limit(200).all()

    matches = []
    for trip in potential_trips:
        from_match = locations_match(origin, trip.origin)
        to_match = locations_match(destination, trip.destination)

        if not (from_match and to_match):
            continue
        
        # Сравниваем время (разница не более 30 минут)
        my_total = parse_time_minutes(time)
        t_total = parse_time_minutes(trip.time)
        if my_total is not None and t_total is not None:
            diff = abs(my_total - t_total)
            circular_diff = min(diff, 1440 - diff)
            if circular_diff <= 30:
                matches.append(trip)

    # Поиск доступен посторонним: номер машины раскрываем только после
    # принятия поездки, когда профиль уже доступен через /users/{id}.
    result = []
    for trip in matches:
        item = schemas.Trip.model_validate(trip)
        if item.user is not None:
            item.user.car_plate = None
        result.append(item)
    return result

@router.post("/{trip_id}/ws-ticket")
def create_trip_ws_ticket(
    trip_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Выдаёт короткоживущий ticket для WebSocket-чата поездки."""
    if not is_trip_participant(db, trip_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied to this trip chat")
    return {
        "ticket": auth_service.create_ws_ticket(
            current_user.id, trip_id, current_user.token_version or 0
        ),
        "expires_in": auth_service.WS_TICKET_EXPIRE_SECONDS,
    }

@router.get("/{trip_id}", response_model=schemas.Trip)
def get_trip_detail(trip_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return a trip to its driver or an accepted participant.

    Non-participants receive 404 rather than 403 to avoid leaking trip IDs.
    The response uses the existing ``Trip`` schema, so no public fields change.
    """
    trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not trip or not is_trip_participant(db, trip_id, current_user.id):
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.get("/{trip_id}/messages", response_model=List[schemas.ChatMessage])
def get_trip_messages(trip_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Возвращает историю сообщений поездки с обязательной проверкой прав доступа."""
    if not is_trip_participant(db, trip_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied to this trip chat")
    messages = db.query(models.ChatMessage).filter(models.ChatMessage.trip_id == trip_id).all()
    return messages


@router.patch("/{trip_id}/status")
async def update_trip_status(
    trip_id: int,
    status_update: schemas.TripStatusUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Обновляет статус поездки.

    Поддерживаемые переходы:
      active | matched | in_progress | completed — управляет водитель.
      passenger_cancelled — пассажир выходит из поездки; водитель получает SSE.
    """
    import json as _json

    await enforce_user_limit(current_user.id, "trip.status", 60, 60)
    trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    old_status = trip.status
    new_status = status_update.status
    today = get_bishkek_today_str()

    def _update_passenger_trip(requester_trip_id: Optional[int], passenger_id: int, completed: bool) -> None:
        """Синхронизирует собственную поездку пассажира с решением водителя."""
        if not requester_trip_id:
            return
        p_trip = db.query(models.Trip).filter(
            models.Trip.id == requester_trip_id,
            models.Trip.user_id == passenger_id,
        ).first()
        if not p_trip:
            return
        if completed:
            p_trip.status = "completed"
        elif p_trip.status in ("active", "matched", "scheduled"):
            p_trip.status = "scheduled" if (p_trip.date and p_trip.date > today) else "active"

    # --- Пассажир отменяет участие ---
    if (new_status in ("passenger_cancelled", "cancelled")) and trip.user_id != current_user.id:
        req = db.query(models.TripRequest).filter(
            models.TripRequest.trip_id == trip_id,
            models.TripRequest.requester_id == current_user.id,
            models.TripRequest.status == "accepted",
        ).first()
        if not req:
            raise HTTPException(status_code=403, detail="Вы не участник этой поездки")

        req.status = "cancelled"
        if trip.seats_taken and trip.seats_taken > 0:
            trip.seats_taken -= 1
        # Если поездка была "matched", но теперь есть свободные места — возвращаем в active / scheduled
        if trip.status == "matched" and (trip.seats_taken or 0) < (trip.seats or 3):
            trip.status = "scheduled" if (trip.date and trip.date > today) else "active"

        _update_passenger_trip(req.requester_trip_id, current_user.id, completed=False)
        db.add(models.AuditLog(
            actor_id=current_user.id,
            action="trip.passenger_cancelled",
            entity_type="trip",
            entity_id=trip_id,
            details=_json.dumps({"from": old_status, "request_id": req.id}),
        ))
        db.commit()

        await publish_driver_event(trip.user_id, _json.dumps({
            "event": "passenger_cancelled",
            "trip_id": trip_id,
            "passenger_name": current_user.name,
        }))
        return {"id": trip_id, "status": "passenger_cancelled"}

    # Пассажир завершает поездку со своей стороны (после отправки отзыва)
    if new_status == "completed" and trip.user_id != current_user.id:
        req = db.query(models.TripRequest).filter(
            models.TripRequest.trip_id == trip_id,
            models.TripRequest.requester_id == current_user.id,
            models.TripRequest.status == "accepted",
        ).first()
        if not req:
            raise HTTPException(status_code=403, detail="Вы не участник этой поездки")

        req.status = "completed"
        _update_passenger_trip(req.requester_trip_id, current_user.id, completed=True)
        db.add(models.AuditLog(
            actor_id=current_user.id,
            action="trip.passenger_completed",
            entity_type="trip",
            entity_id=trip_id,
            details=_json.dumps({"from": old_status, "request_id": req.id}),
        ))
        db.commit()
        return {"id": trip_id, "status": "passenger_completed"}

    # --- Водитель управляет статусом ---
    if trip.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the driver can change trip status")
    if new_status == "passenger_cancelled":
        raise HTTPException(status_code=400, detail="passenger_cancelled is only for passengers")

    trip.status = new_status
    notifications: list[tuple[int, str]] = []

    if new_status == "completed":
        accepted = db.query(models.TripRequest).filter(
            models.TripRequest.trip_id == trip_id,
            models.TripRequest.status == "accepted",
        ).all()
        event_data = _json.dumps({"event": "trip_completed", "trip_id": trip_id})
        for r in accepted:
            r.status = "completed"
            _update_passenger_trip(r.requester_trip_id, r.requester_id, completed=True)
            if r.requester_id:
                notifications.append((r.requester_id, event_data))

    elif new_status == "cancelled":
        accepted = db.query(models.TripRequest).filter(
            models.TripRequest.trip_id == trip_id,
            models.TripRequest.status == "accepted",
        ).all()
        event_data = _json.dumps({
            "event": "trip_cancelled",
            "trip_id": trip_id,
            "driver_name": current_user.name,
        })
        for r in accepted:
            r.status = "cancelled"
            _update_passenger_trip(r.requester_trip_id, r.requester_id, completed=False)
            if r.requester_id:
                notifications.append((r.requester_id, event_data))
        trip.seats_taken = 0

    db.add(models.AuditLog(
        actor_id=current_user.id,
        action="trip.status_changed",
        entity_type="trip",
        entity_id=trip_id,
        details=_json.dumps({"from": old_status, "to": new_status, "role": "driver"}),
    ))

    # Сначала фиксируем изменения в БД, затем уведомляем: обрыв SSE не должен
    # откатывать уже принятое пользователем решение.
    db.commit()

    for user_id, payload in notifications:
        await publish_requester_event(user_id, payload)

    return {"id": trip_id, "status": new_status}


@router.delete("/{trip_id}")
async def cancel_trip(
    trip_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Отмена/удаление своей поездки с синхронизацией связанных заявок."""
    import json as _json

    await enforce_user_limit(current_user.id, "trip.cancel", 10, 60)
    trip = db.query(models.Trip).filter(
        models.Trip.id == trip_id,
        models.Trip.user_id == current_user.id,
    ).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found or access denied")

    today = get_bishkek_today_str()
    driver_notifications: list[tuple[int, str]] = []
    passenger_notifications: list[tuple[int, str]] = []

    # 1. Пользователь удаляет свою поисковую поездку как пассажир.
    #    Нужно освободить места в поездках водителей, которые уже приняли его.
    own_requests = db.query(models.TripRequest).filter(
        models.TripRequest.requester_trip_id == trip_id,
        models.TripRequest.requester_id == current_user.id,
        models.TripRequest.status == "accepted",
    ).all()
    for r in own_requests:
        driver_trip = db.query(models.Trip).filter(models.Trip.id == r.trip_id).first()
        if driver_trip:
            if driver_trip.seats_taken and driver_trip.seats_taken > 0:
                driver_trip.seats_taken -= 1
            if driver_trip.status == "matched" and (driver_trip.seats_taken or 0) < (driver_trip.seats or 3):
                driver_trip.status = "scheduled" if (driver_trip.date and driver_trip.date > today) else "active"
            if driver_trip.user_id:
                driver_notifications.append((
                    driver_trip.user_id,
                    _json.dumps({
                        "event": "passenger_cancelled",
                        "trip_id": driver_trip.id,
                        "passenger_name": current_user.name,
                    }),
                ))

    # 2. Пользователь удаляет свою поездку как водитель — уведомляем пассажиров.
    accepted = db.query(models.TripRequest).filter(
        models.TripRequest.trip_id == trip_id,
        models.TripRequest.status == "accepted",
    ).all()
    for r in accepted:
        if r.requester_trip_id:
            p_trip = db.query(models.Trip).filter(
                models.Trip.id == r.requester_trip_id,
                models.Trip.user_id == r.requester_id,
            ).first()
            if p_trip and p_trip.status in ("active", "matched", "scheduled"):
                p_trip.status = "scheduled" if (p_trip.date and p_trip.date > today) else "active"
        if r.requester_id:
            passenger_notifications.append((
                r.requester_id,
                _json.dumps({
                    "event": "trip_cancelled",
                    "trip_id": trip_id,
                    "driver_name": current_user.name,
                }),
            ))

    db.add(models.AuditLog(
        actor_id=current_user.id,
        action="trip.deleted",
        entity_type="trip",
        entity_id=trip_id,
        details=_json.dumps({"from": trip.status, "role": trip.role}),
    ))

    # Безопасная очистка зависимых сущностей перед удалением
    db.query(models.ChatMessage).filter(models.ChatMessage.trip_id == trip_id).delete(synchronize_session=False)
    db.query(models.TripRequest).filter(
        (models.TripRequest.trip_id == trip_id) | (models.TripRequest.requester_trip_id == trip_id)
    ).delete(synchronize_session=False)
    db.delete(trip)
    db.commit()

    for user_id, payload in driver_notifications:
        await publish_driver_event(user_id, payload)
    for user_id, payload in passenger_notifications:
        await publish_requester_event(user_id, payload)

    return {"id": trip_id, "deleted": True}


@router.post("/{trip_id}/panic")
async def send_panic_alert(
    trip_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Пассажир нажал тревожную кнопку — отправляем уведомление в Telegram поддержки.
    TELEGRAM_ADMIN_CHAT_ID должен быть задан в env (chat_id группы или личного чата поддержки).
    """
    await enforce_user_limit(current_user.id, "trip.panic", 5, 60)
    trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not trip or not is_trip_participant(db, trip_id, current_user.id):
        raise HTTPException(status_code=403, detail="Только участник поездки может отправить сигнал тревоги")

    # Shared per-trip 30s cooldown via Redis (or bounded in-memory fallback).
    if not await get_rate_limiter().hit(f"trip:panic:cooldown:{trip_id}", 1, 30):
        raise HTTPException(status_code=429, detail="Сигнал тревоги уже отправлен. Пожалуйста, подождите.")

    admin_chat_id = os.environ.get("TELEGRAM_ADMIN_CHAT_ID")
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN")

    if not bot_token:
        return {"sent": False, "reason": "bot_token_missing"}

    # Если нет admin chat — fallback: отправляем самому пользователю
    if not admin_chat_id:
        admin_chat_id = auth_service.get_telegram_chat_id(current_user.phone, db)

    if not admin_chat_id:
        return {"sent": False, "reason": "no_chat_id"}

    safe_name = html.escape(current_user.name or "Пользователь")
    safe_phone = html.escape(current_user.phone or "")
    safe_origin = html.escape(trip.origin or "")
    safe_dest = html.escape(trip.destination or "")
    safe_time = html.escape(trip.time or "")

    msg_parts = [
        "🚨 <b>ТРЕВОГА — ПАССАЖИР В ОПАСНОСТИ!</b>",
        "",
        f"👤 <b>{safe_name}</b>",
        f"📱 <code>{safe_phone}</code>",
        f"🚗 Поездка #<b>{trip_id}</b>",
        f"📍 {safe_origin} → {safe_dest}",
        f"🕐 {safe_time}",
        "",
        "⚠️ Срочно свяжитесь с пассажиром!",
    ]
    message = "\n".join(msg_parts)

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": admin_chat_id,
                    "text": message,
                    "parse_mode": "HTML",
                },
            )
        return {"sent": resp.status_code == 200}
    except Exception as e:
        # Never return transport text to the client: it can include the Telegram
        # URL and therefore the bot token.
        logger.warning("[Panic] Telegram delivery failed: %s", type(e).__name__)
        return {"sent": False, "reason": "delivery_failed"}

@router.get("/{trip_id}/passengers")
def get_trip_passengers(trip_id: int, current_user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Список принятых пассажиров для поездки водителя"""
    trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if not is_trip_participant(db, trip_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied to passenger list")

    accepted = db.query(models.TripRequest).filter(
        models.TripRequest.trip_id == trip_id,
        models.TripRequest.status == "accepted"
    ).all()

    requester_ids = {r.requester_id for r in accepted if r.requester_id}
    users_map: dict[int, models.User] = {}
    if requester_ids:
        users_map = {
            u.id: u for u in db.query(models.User).filter(models.User.id.in_(requester_ids)).all()
        }

    passengers = []
    for r in accepted:
        user = users_map.get(r.requester_id)
        if user:
            passengers.append({
                "id": user.id,
                "name": user.name,
                "photo": user.photo,
                "trust_rating": user.trust_rating,
                "is_verified": user.is_verified,
                "request_id": r.id,
            })

    return {
        "trip_id": trip_id,
        "seats": trip.seats or 3,
        "seats_taken": trip.seats_taken or 0,
        "passengers": passengers,
    }


@router.get("/{trip_id}/payment")
def get_trip_payment(
    trip_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Платёжные реквизиты водителя — только участникам конкретной поездки."""
    trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if not is_trip_participant(db, trip_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied to payment details")

    owner = db.query(models.User).filter(models.User.id == trip.user_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="Driver not found")

    db.add(models.AuditLog(
        actor_id=current_user.id,
        action="payment.view",
        entity_type="trip",
        entity_id=trip_id,
        details=json.dumps({"driver_id": owner.id}),
    ))
    db.commit()

    return {
        "driver_id": owner.id,
        "driver_name": owner.name,
        "mbank_phone": owner.mbank_phone,
        "elkart_number": owner.elkart_number,
        "phone": owner.phone,
    }


@router.post("/{trip_id}/messages", response_model=schemas.ChatMessage)
async def send_trip_message(
    trip_id: int,
    message: schemas.ChatMessageInput,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Отправка сообщения через REST с теми же правами, что и WebSocket."""
    import json as _json

    await enforce_user_limit(current_user.id, "trip.message", 30, 60)
    if not is_trip_participant(db, trip_id, current_user.id):
        raise HTTPException(status_code=403, detail="Access denied to this trip chat")

    text = message.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    timestamp = get_bishkek_now().strftime("%I:%M %p")
    new_msg = models.ChatMessage(
        trip_id=trip_id,
        sender_id=current_user.id,
        text=text,
        timestamp=timestamp,
    )
    db.add(new_msg)
    db.commit()
    db.refresh(new_msg)

    await publish_chat_message(trip_id, _json.dumps({
        "id": new_msg.id,
        "text": text,
        "sender_id": current_user.id,
        "sender_name": current_user.name,
        "timestamp": timestamp,
        "trip_id": trip_id,
    }))

    return new_msg
