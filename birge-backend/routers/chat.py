"""WebSocket trip chat."""
import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import auth
import models
from database import SessionLocal
from realtime import is_trip_participant, manager, publish_chat_message
from time_utils import get_bishkek_now

logger = logging.getLogger("birge")

router = APIRouter(tags=["chat"])


@router.websocket("/ws/chat/{trip_id}/{user_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    trip_id: str,
    user_id: int,
    ticket: Optional[str] = None,   # одноразовый ticket, не долгоживущий JWT
):
    """WebSocket чат поездки с короткоживущим ticket.

    Клиент подключается как:
        wss://host/ws/chat/{trip_id}/{user_id}?ticket=<ticket>
    Ticket проверяется до подключения; несовпадение user_id → закрытие 1008.
    """
    # --- Авторизация ticket ---
    if not ticket:
        await websocket.close(code=1008, reason="Ticket required")
        return

    try:
        trip_int_id = int(trip_id)
    except ValueError:
        await websocket.close(code=1008, reason="Invalid trip_id")
        return

    verified_user_id = auth.verify_ws_ticket(ticket, trip_int_id)
    if not verified_user_id or verified_user_id != user_id:
        await websocket.close(code=1008, reason="Invalid or forbidden ticket")
        return

    # Проверяем права доступа к чату поездки и актуальность сессии
    # (точечная сессия, не блокирующая пул).
    with SessionLocal() as db:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        ticket_version = auth.get_token_version(ticket, "ws")
        if (
            not user
            or ticket_version is None
            or ticket_version != (user.token_version or 0)
        ):
            await websocket.close(code=1008, reason="Session has been revoked")
            return
        if not is_trip_participant(db, trip_int_id, user_id):
            await websocket.close(code=1008, reason="Access denied to this trip chat")
            return

    await manager.connect(websocket, trip_id)
    try:
        while True:
            data = await websocket.receive_text()

            # Парсим JSON: ожидаем {"text": "привет"}
            try:
                msg_data = json.loads(data)
                text = (msg_data.get("text") or "").strip() if isinstance(msg_data, dict) else ""
            except (json.JSONDecodeError, AttributeError):
                text = str(data).strip()

            if not text:
                continue
            if len(text) > 1000:
                await websocket.send_text(json.dumps({"error": "message_too_long"}))
                continue

            timestamp = get_bishkek_now().strftime("%I:%M %p")

            # Сохраняем в БД точечно через SessionLocal (соединение освобождается сразу)
            with SessionLocal() as db:
                sender = db.query(models.User).filter(models.User.id == user_id).first()
                sender_name = sender.name if sender else "Пользователь"
                new_msg = models.ChatMessage(
                    trip_id=trip_int_id,
                    sender_id=user_id,
                    text=text,
                    timestamp=timestamp,
                )
                db.add(new_msg)
                db.commit()
                db.refresh(new_msg)
                msg_id = new_msg.id

            # Рассылаем всем участникам комнаты
            response_data = {
                "id": msg_id,
                "text": text,
                "sender_id": user_id,
                "sender_name": sender_name,
                "timestamp": timestamp,
                "trip_id": trip_int_id,
            }
            await publish_chat_message(trip_id, json.dumps(response_data))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"[WS] WebSocket error on trip {trip_id}, user {user_id}: {e}")
    finally:
        manager.disconnect(websocket, trip_id)
