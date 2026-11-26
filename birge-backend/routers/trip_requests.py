"""Trip-request routes and server-sent event streams."""
import asyncio
import json
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

import auth
import models
import schemas
from database import SessionLocal, get_db
from dependencies import get_current_user
from rate_limit import enforce_user_limit, enforce_user_limit_sync
from realtime import (
    driver_sse_manager,
    publish_driver_event,
    publish_requester_event,
    sse_manager,
)
from time_utils import get_bishkek_now, get_bishkek_today_str

router = APIRouter(prefix="/trip-requests", tags=["trip-requests"])

# SSE keepalive interval; also bounds how long a revoked stream stays open.
SSE_KEEPALIVE_SECONDS = 20.0


def _session_revoked(user_id: int, ticket_version: Optional[int]) -> bool:
    """Re-check a long-lived SSE stream against the current token version."""
    with SessionLocal() as session:
        return not auth.is_token_version_current(session, user_id, ticket_version)


def _authorize_sse_ticket(
    ticket: Optional[str],
    stream: str,
    target_id: int,
    db: Session,
) -> None:
    """Validate a short-lived SSE ticket and its session version."""
    if not ticket:
        raise HTTPException(status_code=401, detail="SSE ticket required")

    user_id = auth.verify_sse_ticket(ticket, stream, target_id)
    if not user_id or user_id != target_id:
        raise HTTPException(status_code=403, detail="Invalid or expired SSE ticket")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    ticket_version = auth.get_token_version(ticket, "sse")
    if ticket_version is None or ticket_version != (user.token_version or 0):
        raise HTTPException(status_code=401, detail="Session has been revoked")


@router.post("/sse-ticket")
def issue_sse_ticket(
    stream: Literal["driver", "requester"],
    current_user: models.User = Depends(get_current_user),
):
    """Issue a 60-second ticket for the current user's SSE stream."""
    ticket = auth.create_sse_ticket(
        current_user.id,
        stream,
        current_user.id,
        current_user.token_version or 0,
    )
    return {"ticket": ticket, "expires_in": auth.SSE_TICKET_EXPIRE_SECONDS}


@router.get("/driver-events/{driver_id}")
async def driver_trip_request_events(
    driver_id: int,
    ticket: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """SSE-стрим для водителя.
    Открывается пока водитель в поиске или в активной поездке;
    при каждом новом запросе от пассажира водитель получает event мгновенно.
    Авторизация: короткоживущий ?ticket= вместо access-токена в URL.
    """
    _authorize_sse_ticket(ticket, "driver", driver_id, db)
    ticket_version = auth.get_token_version(ticket, "sse")

    q = driver_sse_manager.subscribe(driver_id)

    async def event_generator():
        try:
            while True:
                try:
                    data = await asyncio.wait_for(
                        q.get(), timeout=SSE_KEEPALIVE_SECONDS
                    )
                except asyncio.TimeoutError:
                    if _session_revoked(driver_id, ticket_version):
                        return
                    yield ": keepalive\n\n"
                    continue
                if _session_revoked(driver_id, ticket_version):
                    return
                yield f"event: new_request\ndata: {data}\n\n"
        finally:
            driver_sse_manager.unsubscribe(driver_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/events/{requester_id}")
async def trip_request_events(
    requester_id: int,
    ticket: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """SSE-стрим для пассажира. Открывается на время поиска;
    когда водитель принимает запрос — пассажир получает event мгновенно.
    Авторизация: короткоживущий ?ticket= вместо access-токена в URL.
    """
    _authorize_sse_ticket(ticket, "requester", requester_id, db)
    ticket_version = auth.get_token_version(ticket, "sse")

    q = sse_manager.subscribe(requester_id)

    async def event_generator():
        try:
            # Keepalive — каждые 20 сек чтобы соединение не обрывалось
            while True:
                try:
                    data = await asyncio.wait_for(
                        q.get(), timeout=SSE_KEEPALIVE_SECONDS
                    )
                except asyncio.TimeoutError:
                    if _session_revoked(requester_id, ticket_version):
                        return
                    yield ": keepalive\n\n"
                    continue
                if _session_revoked(requester_id, ticket_version):
                    return
                yield f"event: request_update\ndata: {data}\n\n"
        finally:
            sse_manager.unsubscribe(requester_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/")
async def send_trip_request(
    req_in: schemas.TripRequestCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Пассажир отправляет запрос водителю на поездку.
    requester_id берётся из JWT (защита от spoofing).
    После сохранения в БД немедленно уведомляет водителя через SSE.
    """
    await enforce_user_limit(current_user.id, "trip_request.create", 20, 600)
    trip_id = req_in.trip_id                     # ID поездки водителя
    requester_trip_id = req_in.requester_trip_id  # ID поездки пассажира
    requester_id = current_user.id               # ID пассажира — только из токена!

    driver_trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()
    if not driver_trip:
        raise HTTPException(status_code=404, detail="Поездка не найдена")
    if driver_trip.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя отправить запрос на собственную поездку")
    if driver_trip.role != "driver":
        raise HTTPException(status_code=400, detail="Можно отправить запрос только на поездку водителя")
    if driver_trip.status not in ("active", "scheduled"):
        raise HTTPException(status_code=400, detail="Эта поездка больше не принимает запросы")

    today = get_bishkek_today_str()
    if driver_trip.date and driver_trip.date < today:
        raise HTTPException(status_code=400, detail="Нельзя отправить запрос на прошедшую поездку")

    # requester_trip_id приходит от клиента — проверяем владельца, чтобы нельзя
    # было подставить чужую поездку и повлиять на её статус.
    if requester_trip_id:
        requester_trip = db.query(models.Trip).filter(
            models.Trip.id == requester_trip_id,
            models.Trip.user_id == current_user.id,
        ).first()
        if not requester_trip or requester_trip.role != "passenger":
            raise HTTPException(status_code=403, detail="Некорректная поездка пассажира")
        if requester_trip.status not in ("active", "scheduled"):
            raise HTTPException(status_code=400, detail="Ваша поездка уже не активна")

    if (driver_trip.seats_taken or 0) >= (driver_trip.seats or 3):
        raise HTTPException(status_code=400, detail="В автомобиле не осталось свободных мест")

    driver_id = driver_trip.user_id              # Берём строго из БД, а не из клиентского пейлоада

    # Проверяем, не отправлял ли уже активную заявку
    existing = db.query(models.TripRequest).filter(
        models.TripRequest.trip_id == trip_id,
        models.TripRequest.requester_id == requester_id,
        models.TripRequest.status.in_(["pending", "accepted"]),
    ).first()
    if existing:
        return {"id": existing.id, "status": existing.status, "message": "Already sent"}

    req = models.TripRequest(
        trip_id=trip_id,
        requester_trip_id=requester_trip_id,
        requester_id=requester_id,
        driver_id=driver_id,
        status="pending",
        created_at=get_bishkek_now().strftime("%Y-%m-%d %H:%M:%S"),
    )
    db.add(req)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request won the partial unique index race.
        db.rollback()
        existing = db.query(models.TripRequest).filter(
            models.TripRequest.trip_id == trip_id,
            models.TripRequest.requester_id == requester_id,
            models.TripRequest.status.in_(["pending", "accepted"]),
        ).first()
        if existing:
            return {"id": existing.id, "status": existing.status, "message": "Already sent"}
        raise
    db.refresh(req)

    # Собираем данные пассажира для SSE-пуша водителю
    driver_trip = db.query(models.Trip).filter(models.Trip.id == trip_id).first()

    sse_payload = {
        "id": req.id,
        "trip_id": trip_id,
        "requester_trip_id": requester_trip_id,
        "requester_id": requester_id,
        "driver_id": driver_id,
        "status": "pending",
        "requester_name": current_user.name,
        "requester_photo": current_user.photo,
        "requester_rating": current_user.trust_rating,
        "origin": driver_trip.origin if driver_trip else "",
        "destination": driver_trip.destination if driver_trip else "",
        "time": driver_trip.time if driver_trip else "",
        "date": driver_trip.date if driver_trip else "",
    }

    # Мгновенно уведомляем водителя через SSE (если он подписан)
    if driver_id:
        await publish_driver_event(driver_id, json.dumps(sse_payload))

    return {"id": req.id, "status": "pending"}


@router.get("/incoming/")
def get_incoming_requests(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Водитель получает входящие запросы (pending).
    Возвращает только запросы адресованные ТЕКУЩЕМУ пользователю.
    """
    # Один запрос с eager-load пользователей (без N+1)
    requests = (
        db.query(models.TripRequest)
        .options(
            joinedload(models.TripRequest.requester),
            joinedload(models.TripRequest.driver),
        )
        .filter(
            models.TripRequest.driver_id == current_user.id,
            models.TripRequest.status == "pending",
        )
        .all()
    )

    # Bulk-загрузка поездок водителя одним IN-запросом (вместо N запросов в цикле)
    trip_ids = list({r.trip_id for r in requests if r.trip_id})
    trips_map: dict[int, models.Trip] = {}
    if trip_ids:
        trips_map = {
            t.id: t
            for t in db.query(models.Trip).filter(models.Trip.id.in_(trip_ids)).all()
        }

    result = []
    for r in requests:
        requester = r.requester
        driver = r.driver
        driver_trip = trips_map.get(r.trip_id)
        # Заявка на отменённую/завершённую или уже заполненную поездку
        # не должна показываться.
        if not driver_trip or driver_trip.status not in ("active", "scheduled"):
            continue
        if (driver_trip.seats_taken or 0) >= (driver_trip.seats or 3):
            continue
        result.append({
            "id": r.id,
            "trip_id": r.trip_id,
            "requester_trip_id": r.requester_trip_id,
            "requester_id": r.requester_id,
            "requester_name": requester.name if requester else "Пассажир",
            "requester_photo": requester.photo if requester else "",
            "requester_rating": requester.trust_rating if requester else 5.0,
            "origin": driver_trip.origin if driver_trip else "",
            "destination": driver_trip.destination if driver_trip else "",
            "time": driver_trip.time if driver_trip else "",
            "date": driver_trip.date if driver_trip else "",
            "status": r.status,
            "created_at": r.created_at,
            "driver_car_model": driver.car_model if driver else None,
            "driver_car_plate": driver.car_plate if driver else None,
            "driver_car_color": driver.car_color if driver else None,
        })
    return result


@router.patch("/{request_id}")
async def respond_to_request(
    request_id: int,
    status_update: schemas.TripRequestStatusUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Водитель принимает (accepted) или отклоняет (declined) запрос.
    При accepted — мгновенно уведомляет пассажира через SSE.
    Только водитель (driver_id == current_user.id) может менять статус своего запроса.
    """
    await enforce_user_limit(current_user.id, "trip_request.respond", 60, 60)
    req = db.query(models.TripRequest).filter(models.TripRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if req.driver_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Request has already been processed")

    new_status = status_update.status
    req.status = new_status

    driver = current_user  # уже загружен через Depends
    today = get_bishkek_today_str()
    declined_events: list[tuple[int, str]] = []

    # Если принят — увеличиваем счётчик мест явно с блокировкой строки от овербукинга
    if new_status == "accepted":
        trip = (
            db.query(models.Trip)
            .filter(models.Trip.id == req.trip_id)
            .with_for_update()
            .first()
        )
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.role != "driver":
            raise HTTPException(status_code=400, detail="Принять запрос можно только на поездку водителя")
        if trip.status not in ("active", "scheduled"):
            raise HTTPException(status_code=400, detail="Эта поездка больше не принимает пассажиров")
        if trip.date and trip.date < today:
            raise HTTPException(status_code=400, detail="Нельзя принять запрос на прошедшую поездку")
        if (trip.seats_taken or 0) >= (trip.seats or 3):
            raise HTTPException(status_code=400, detail="Все места в автомобиле уже заняты")

        trip.seats_taken = (trip.seats_taken or 0) + 1
        is_full = trip.seats_taken >= (trip.seats or 3)
        # "matched" закрывает набор только для поездки на сегодня.
        # Будущая поездка остаётся "scheduled", иначе она исчезает из
        # запланированных и из напоминаний за час.
        if is_full and (not trip.date or trip.date <= today):
            trip.status = "matched"

        # Если мест больше нет — автоматически отклоняем остальные заявки,
        # чтобы они не висели у водителя и не блокировали пассажиров.
        if is_full:
            other_pending = db.query(models.TripRequest).filter(
                models.TripRequest.trip_id == trip.id,
                models.TripRequest.id != req.id,
                models.TripRequest.status == "pending",
            ).all()
            for other in other_pending:
                other.status = "declined"
                declined_events.append((
                    other.requester_id,
                    json.dumps({
                        "id": other.id,
                        "status": "declined",
                        "trip_id": other.trip_id,
                        "requester_id": other.requester_id,
                        "driver_id": current_user.id,
                        "driver_name": current_user.name,
                    }),
                ))

        # Синхронизируем собственную поисковую поездку пассажира: после
        # принятия она больше не должна попадаться другим водителям.
        if req.requester_trip_id:
            p_trip = db.query(models.Trip).filter(
                models.Trip.id == req.requester_trip_id,
                models.Trip.user_id == req.requester_id,
            ).first()
            if p_trip and p_trip.status in ("active", "scheduled", "matched"):
                p_trip.status = "scheduled" if (p_trip.date and p_trip.date > today) else "matched"

    db.add(models.AuditLog(
        actor_id=current_user.id,
        action="trip_request.status_changed",
        entity_type="trip_request",
        entity_id=req.id,
        details=json.dumps({"from": "pending", "to": new_status, "trip_id": req.trip_id}),
    ))
    db.commit()

    response_payload = {
        "id": req.id,
        "status": new_status,
        "trip_id": req.trip_id,
        "requester_trip_id": req.requester_trip_id,
        "requester_id": req.requester_id,
        "driver_id": req.driver_id,
        "driver_name": driver.name,
        "driver_photo": driver.photo,
        "driver_car_model": driver.car_model,
        "driver_car_plate": driver.car_plate,
        "driver_car_color": driver.car_color,
    }

    # Мгновенно уведомляем пассажиров через SSE (не ждём polling)
    for user_id, payload in declined_events:
        if user_id:
            await publish_requester_event(user_id, payload)
    if new_status in ("accepted", "declined") and req.requester_id:
        await publish_requester_event(req.requester_id, json.dumps(response_payload))

    return response_payload


@router.get("/statuses")
def check_request_statuses(
    trip_ids: Optional[str] = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Batch status lookup for the current passenger's trip requests."""
    enforce_user_limit_sync(current_user.id, "trip_request.statuses", 120, 60)

    query = (
        db.query(models.TripRequest)
        .options(joinedload(models.TripRequest.driver))
        .filter(models.TripRequest.requester_id == current_user.id)
    )
    if trip_ids is not None:
        raw_parts = [part.strip() for part in trip_ids.split(",") if part.strip()]
        if not raw_parts:
            return {"items": []}
        try:
            parsed_ids = [int(part) for part in raw_parts]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid trip_ids") from exc
        if any(tid <= 0 for tid in parsed_ids) or len(parsed_ids) > 50:
            raise HTTPException(status_code=400, detail="trip_ids must contain 1..50 positive IDs")
        query = query.filter(models.TripRequest.trip_id.in_(parsed_ids))

    rows = query.order_by(models.TripRequest.id.desc()).limit(100).all()
    seen_trips: set[int] = set()
    items = []
    for req in rows:
        if req.trip_id in seen_trips:
            continue
        seen_trips.add(req.trip_id)
        driver = req.driver
        items.append({
            "id": req.id,
            "status": req.status,
            "trip_id": req.trip_id,
            "requester_trip_id": req.requester_trip_id,
            "driver_id": req.driver_id,
            "driver_name": driver.name if driver else None,
            "driver_photo": driver.photo if driver else None,
            "driver_car_model": driver.car_model if driver else None,
            "driver_car_plate": driver.car_plate if driver else None,
            "driver_car_color": driver.car_color if driver else None,
        })
    return {"items": items}


@router.get("/status/{trip_id}")
def check_request_status(
    trip_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Пассажир проверяет статус своего запроса на поездку водителя (polling).
    requester_id берётся из JWT — пользователь не может запросить чужой статус.
    """
    req = db.query(models.TripRequest).filter(
        models.TripRequest.trip_id == trip_id,
        models.TripRequest.requester_id == current_user.id,
    ).order_by(models.TripRequest.id.desc()).first()

    if not req:
        return {"status": "not_sent"}

    driver = db.query(models.User).filter(models.User.id == req.driver_id).first()
    return {
        "id": req.id,
        "status": req.status,
        "trip_id": req.trip_id,
        "requester_trip_id": req.requester_trip_id,
        "driver_id": req.driver_id,
        "driver_name": driver.name if driver else None,
        "driver_photo": driver.photo if driver else None,
        "driver_car_model": driver.car_model if driver else None,
        "driver_car_plate": driver.car_plate if driver else None,
        "driver_car_color": driver.car_color if driver else None,
    }
