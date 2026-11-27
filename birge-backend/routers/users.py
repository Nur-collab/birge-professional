"""User profile routes."""
import base64
import logging
import os
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session, selectinload

import auth as auth_service
import models
import schemas
from database import get_db
from dependencies import get_current_user
from rate_limit import enforce_user_limit, enforce_user_limit_sync
from time_utils import get_bishkek_today_str

logger = logging.getLogger("birge")
router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=schemas.User)
def read_current_user(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Возвращает профиль текущего пользователя по JWT токену.
    Eager-load отзывов: без этого Profile.jsx покажет 0 отзывов.
    """
    user = (
        db.query(models.User)
        .options(selectinload(models.User.reviews))
        .filter(models.User.id == current_user.id)
        .first()
    )
    return user or current_user

def _is_accepted_passenger(db: Session, driver_id: int, passenger_id: int) -> bool:
    """True, если passenger принят в поездку driver."""
    return (
        db.query(models.TripRequest.id)
        .join(models.Trip, models.Trip.id == models.TripRequest.trip_id)
        .filter(
            models.Trip.user_id == driver_id,
            models.TripRequest.requester_id == passenger_id,
            models.TripRequest.status.in_(("accepted", "completed")),
        )
        .first()
        is not None
    )


def _shares_accepted_trip(db: Session, viewer_id: int, target_id: int) -> bool:
    """True, если пользователи вместе приняли одну поездку."""
    if _is_accepted_passenger(db, viewer_id, target_id) or _is_accepted_passenger(
        db, target_id, viewer_id
    ):
        return True

    # Два принятых пассажира одной поездки тоже видят профили друг друга.
    statuses = ("accepted", "completed")
    viewer_trip_ids = [
        trip_id
        for (trip_id,) in db.query(models.TripRequest.trip_id)
        .filter(
            models.TripRequest.requester_id == viewer_id,
            models.TripRequest.trip_id.isnot(None),
            models.TripRequest.status.in_(statuses),
        )
        .all()
    ]
    if not viewer_trip_ids:
        return False
    return (
        db.query(models.TripRequest.id)
        .filter(
            models.TripRequest.requester_id == target_id,
            models.TripRequest.trip_id.in_(viewer_trip_ids),
            models.TripRequest.status.in_(statuses),
        )
        .first()
        is not None
    )


@router.get("/{user_id}", response_model=schemas.UserPublic)
def read_user_public(
    user_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Профиль доступен только себе и участникам принятой совместной поездки."""
    enforce_user_limit_sync(current_user.id, "user.profile.read", 60, 60)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or (
        user_id != current_user.id
        and not _shares_accepted_trip(db, current_user.id, user_id)
    ):
        # 404 не подтверждает существование профиля посторонним.
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/me", response_model=schemas.User)
def update_current_user(
    user_update: schemas.UserUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Обновляет профиль и данные машины текущего пользователя."""
    enforce_user_limit_sync(current_user.id, "user.update", 20, 3600)
    update_data = user_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(current_user, key, value)
    db.commit()
    db.refresh(current_user)
    return current_user


MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024


def _detect_image_type(content: bytes) -> Optional[str]:
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


@router.post("/me/photo")
async def upload_profile_photo(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Загружает фото профиля через сервер, не раскрывая ImgBB-ключ в браузере."""
    await enforce_user_limit(current_user.id, "user.photo", 5, 3600)
    api_key = os.environ.get("IMGBB_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Photo upload is not configured")

    content = await file.read(MAX_PROFILE_PHOTO_BYTES + 1)
    await file.close()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_PROFILE_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (max 5 MB)")
    if not _detect_image_type(content):
        raise HTTPException(status_code=400, detail="Only JPEG, PNG and WebP images are allowed")

    encoded = base64.b64encode(content).decode("ascii")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                "https://api.imgbb.com/1/upload",
                params={"key": api_key},
                data={"image": encoded},
            )
    except httpx.HTTPError as exc:
        logger.warning("[PhotoUpload] ImgBB request failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Photo storage is unavailable") from exc

    if response.status_code != 200:
        logger.warning("[PhotoUpload] ImgBB returned HTTP %s", response.status_code)
        raise HTTPException(status_code=502, detail="Photo upload failed")

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Invalid photo storage response") from exc

    data = payload.get("data") if isinstance(payload, dict) else None
    photo_url = (data or {}).get("url") or (data or {}).get("display_url")
    if not isinstance(photo_url, str) or not photo_url.startswith(("https://", "http://")):
        raise HTTPException(status_code=502, detail="Photo storage returned no URL")

    current_user.photo = photo_url
    db.commit()
    db.refresh(current_user)
    return {"photo": photo_url}


@router.get("/me/trips", response_model=List[schemas.Trip])
def read_current_user_trips(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Возвращает историю поездок пользователя (и как водителя, и как пассажира)."""
    created_trips = (
        db.query(models.Trip)
        .filter(models.Trip.user_id == current_user.id)
        .all()
    )
    created_ids = {t.id for t in created_trips}

    # Поездки других водителей, где пользователь был принят или завершил поездку как пассажир
    passenger_requests = (
        db.query(models.TripRequest)
        .filter(
            models.TripRequest.requester_id == current_user.id,
            models.TripRequest.status.in_(["accepted", "completed"]),
        )
        .all()
    )
    joined_trip_ids = [r.trip_id for r in passenger_requests if r.trip_id and r.trip_id not in created_ids]

    joined_trips = []
    if joined_trip_ids:
        joined_trips = (
            db.query(models.Trip)
            .filter(models.Trip.id.in_(joined_trip_ids))
            .all()
        )

    all_trips = created_trips + joined_trips
    all_trips.sort(key=lambda t: t.id, reverse=True)
    return all_trips


@router.get("/me/active-trip")
def get_my_active_trip(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = get_bishkek_today_str()
    from sqlalchemy import or_ as _or

    # 1. Сначала проверяем: является ли пользователь принятым пассажиром в активной поездке водителя
    accepted_request = (
        db.query(models.TripRequest)
        .filter(
            models.TripRequest.requester_id == current_user.id,
            models.TripRequest.status == "accepted",
        )
        .order_by(models.TripRequest.id.desc())
        .first()
    )

    if accepted_request:
        driver_trip = (
            db.query(models.Trip)
            .filter(
                models.Trip.id == accepted_request.trip_id,
                models.Trip.status.in_(["active", "matched", "in_progress"]),
            )
            .first()
        )
        if driver_trip:
            return {
                "found": True,
                "trip_id": driver_trip.id,
                "role": "passenger",
                "my_role": "passenger",
                "is_driver": False,
                "origin": driver_trip.origin,
                "destination": driver_trip.destination,
                "time": driver_trip.time,
                "date": driver_trip.date,
                "seats": driver_trip.seats or 3,
                "driver_id": driver_trip.user_id,
            }

    # 2. Поездка, созданная самим пользователем (как водитель или пассажир в поиске)
    # in_progress активна независимо от смены суток; active/matched — на сегодня или без даты
    trip = (
        db.query(models.Trip)
        .filter(
            models.Trip.user_id == current_user.id,
            _or(
                models.Trip.status == "in_progress",
                (
                    models.Trip.status.in_(["active", "matched"])
                    & _or(models.Trip.date == today, models.Trip.date.is_(None))
                ),
            ),
        )
        .order_by(models.Trip.id.desc())
        .first()
    )

    if trip:
        return {
            "found": True,
            "trip_id": trip.id,
            "role": trip.role,
            "my_role": trip.role,
            "is_driver": trip.role == "driver",
            "origin": trip.origin,
            "destination": trip.destination,
            "time": trip.time,
            "date": trip.date,
            "seats": trip.seats or 3,
        }

    return {"found": False}

@router.post("/me/verify")
async def verify_user(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Верификация аккаунта через Telegram.
    Если TelegramBinding есть — ставим is_verified=True сразу.
    Если нет — возвращаем ссылку на бота.
    """
    await enforce_user_limit(current_user.id, "user.verify", 5, 3600)
    if current_user.is_verified:
        return {"status": "already_verified"}

    chat_id = auth_service.get_telegram_chat_id(current_user.phone, db)
    if chat_id:
        current_user.is_verified = True
        db.commit()
        db.refresh(current_user)
        msg = (
            f"✅ *Аккаунт верифицирован!*\n\n"
            f"Привет, {current_user.name}! Твой аккаунт Birge теперь имеет значок ✅ на профиле.\n"
            f"Другие пользователи будут точно знать, что ты настоящий — это повышает доверие 🙏"
        )
        await auth_service.send_telegram_message(chat_id, msg)
        return {"status": "verified", "message": "Аккаунт успешно верифицирован"}
    else:
        # Telegram не привязан — возвращаем ссылку на реального бота без PII в URL
        bot_url = auth_service.build_telegram_bot_url()
        return {
            "status": "need_telegram",
            "bot_url": bot_url,
            "message": (
                f"Откройте @{auth_service.TELEGRAM_BOT_USERNAME}, "
                "нажмите Start → «Поделиться номером» и запустите проверку снова"
            ),
        }


@router.get("/me/scheduled-trips")
def read_scheduled_trips(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Возвращает запланированные поездки пользователя (и как водителя, и как пассажира)."""
    today_str = get_bishkek_today_str()
    user_id = current_user.id

    result = []

    # 1. Поездки где пользователь — ВОДИТЕЛЬ.
    # "matched" для будущей поездки означает «все места заняты», но поездка
    # остаётся запланированной и не должна исчезать из списка.
    driver_trips = db.query(models.Trip).filter(
        models.Trip.user_id == user_id,
        models.Trip.role == "driver",
        models.Trip.status.in_(["scheduled", "matched"]),
        models.Trip.date > today_str
    ).order_by(models.Trip.date, models.Trip.time).all()

    # Bulk-загрузка пассажиров для всех поездок водителя (без N+1)
    driver_trip_ids = [t.id for t in driver_trips]
    accepted_by_trip: dict[int, list[models.TripRequest]] = {}
    passengers_map: dict[int, models.User] = {}
    if driver_trip_ids:
        accepted_reqs = db.query(models.TripRequest).filter(
            models.TripRequest.trip_id.in_(driver_trip_ids),
            models.TripRequest.status == "accepted",
        ).all()
        passenger_ids = {r.requester_id for r in accepted_reqs if r.requester_id}
        if passenger_ids:
            passengers_map = {
                u.id: u for u in db.query(models.User).filter(models.User.id.in_(passenger_ids)).all()
            }
        for r in accepted_reqs:
            accepted_by_trip.setdefault(r.trip_id, []).append(r)

    for trip in driver_trips:
        passengers = []
        for r in accepted_by_trip.get(trip.id, []):
            passenger_user = passengers_map.get(r.requester_id)
            if passenger_user:
                passengers.append({
                    "id": passenger_user.id,
                    "name": passenger_user.name,
                    "photo": passenger_user.photo,
                    "trust_rating": passenger_user.trust_rating,
                    "is_verified": passenger_user.is_verified,
                    "request_id": r.id,
                })
        result.append({
            "trip_id": trip.id,
            "role": "driver",
            "origin": trip.origin,
            "destination": trip.destination,
            "date": trip.date,
            "time": trip.time,
            "seats": trip.seats or 3,
            "seats_taken": trip.seats_taken or 0,
            "passengers": passengers,
            "driver": None,
        })

    # 2. Поездки где пользователь — ПАССАЖИР (принятые TripRequest для будущих поездок)
    from sqlalchemy.orm import joinedload as _jl2

    accepted_requests = (
        db.query(models.TripRequest)
        .options(_jl2(models.TripRequest.driver))  # eager-load водителя без N+1
        .filter(
            models.TripRequest.requester_id == user_id,
            models.TripRequest.status == "accepted",
        )
        .all()
    )

    # Bulk-загрузка поездок водителей одним IN-запросом
    passenger_trip_ids = list({r.trip_id for r in accepted_requests if r.trip_id})
    passenger_trips_map: dict[int, models.Trip] = {}
    if passenger_trip_ids:
        passenger_trips_map = {
            t.id: t
            for t in db.query(models.Trip)
            .filter(models.Trip.id.in_(passenger_trip_ids))
            .all()
        }

    for req in accepted_requests:
        driver_trip = passenger_trips_map.get(req.trip_id)
        if not driver_trip:
            continue
        # Только будущие поездки, которые ещё не отменены и не завершены
        if driver_trip.status not in ("scheduled", "matched"):
            continue
        trip_date = driver_trip.date or ""
        if not trip_date or trip_date <= today_str:
            continue
        driver_user = req.driver  # уже загружен через joinedload
        result.append({
            "trip_id": req.trip_id,
            "requester_trip_id": req.requester_trip_id,
            "role": "passenger",
            "origin": driver_trip.origin,
            "destination": driver_trip.destination,
            "date": driver_trip.date,
            "time": driver_trip.time,
            "seats": driver_trip.seats or 3,
            "seats_taken": driver_trip.seats_taken or 0,
            "passengers": [],
            "driver": {
                "id": driver_user.id if driver_user else None,
                "name": driver_user.name if driver_user else "Водитель",
                "photo": driver_user.photo if driver_user else "",
                "trust_rating": driver_user.trust_rating if driver_user else 5.0,
                "is_verified": driver_user.is_verified if driver_user else False,
                "car_model": driver_user.car_model if driver_user else None,
                "car_color": driver_user.car_color if driver_user else None,
                "car_plate": driver_user.car_plate if driver_user else None,
            } if driver_user else None,
        })

    # Сортируем итоговый список по дате
    result.sort(key=lambda x: (x.get("date", ""), x.get("time", "")))
    return result
