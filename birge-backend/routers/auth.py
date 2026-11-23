"""Authentication endpoints: phone code delivery, verification and refresh."""
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import Field
from sqlalchemy.orm import Session

import auth as auth_service
import models
import schemas
from config import IS_PRODUCTION
from database import get_db
from dependencies import get_current_user
from rate_limit import get_rate_limiter

router = APIRouter(prefix="/auth", tags=["auth"])


class VerifyCodePayload(schemas.VerifyCodeRequest):
    name: Optional[str] = Field(default=None, max_length=80)


_SEND_CODE_WINDOW_SECONDS = 600
_SEND_CODE_MAX_PER_WINDOW = 10

_VERIFY_CODE_WINDOW_SECONDS = 60
_VERIFY_CODE_MAX_PER_WINDOW = 15


def _client_ip(request: Request) -> str:
    """IP клиента с учётом прокси Render; нужен только для анти-спам лимита."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _token_payload(user: models.User) -> dict:
    """Claims for a session that can be revoked via User.token_version."""
    return {"sub": str(user.id), "ver": int(user.token_version or 0)}


async def _check_send_code_rate(ip: str) -> None:
    allowed = await get_rate_limiter().hit(
        f"auth:send-code:{ip}",
        _SEND_CODE_MAX_PER_WINDOW,
        _SEND_CODE_WINDOW_SECONDS,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Слишком много запросов кода. Попробуйте позже.")


async def _check_verify_code_rate(ip: str) -> None:
    allowed = await get_rate_limiter().hit(
        f"auth:verify-code:{ip}",
        _VERIFY_CODE_MAX_PER_WINDOW,
        _VERIFY_CODE_WINDOW_SECONDS,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Слишком много попыток ввода кода. Подождите минуту.")


@router.post("/send-code")
async def send_code(req: schemas.SendCodeRequest, request: Request, db: Session = Depends(get_db)):
    """Отправка кода через Telegram Bot. В production без доставки возвращает 503."""
    await _check_send_code_rate(_client_ip(request))

    raw_phone = req.phone.strip()
    if not raw_phone:
        raise HTTPException(status_code=400, detail="Phone number required")

    # Нормализуем кыргызский номер
    is_valid, p_e164, p_digits, p_formatted, op_or_err = auth_service.normalize_kg_phone(raw_phone)
    if not is_valid:
        raise HTTPException(status_code=400, detail=op_or_err)

    # Генерируем 6-значный код криптографически стойким генератором
    code = str(secrets.randbelow(900000) + 100000)

    # Сохраняем в БД по нормализованному формату (с проверкой rate limit)
    ok, error_msg = auth_service.save_sms_code(p_e164, code, db)
    if not ok:
        raise HTTPException(status_code=429, detail=error_msg)

    # Пробуем отправить через Telegram Bot (ищем по normalized digits)
    chat_id = auth_service.get_telegram_chat_id(p_digits, db)
    tg_sent = False
    if chat_id:
        tg_sent = await auth_service.send_telegram_code(chat_id, code)

    if not tg_sent:
        if IS_PRODUCTION:
            # Не оставляем валидный код в БД, если его невозможно доставить.
            db.query(models.SmsCode).filter(models.SmsCode.phone == p_e164).delete(synchronize_session=False)
            db.commit()
            raise HTTPException(
                status_code=503,
                detail="Не удалось доставить код. Привяжите Telegram через @BirgeAuthBot и повторите.",
            )
        # Локальная разработка без Telegram: код печатается только в консоль.
        print(f"\n{'='*40}")
        print(f"📱 КОД ДЛЯ {p_formatted} ({p_e164})")
        print(f"👉 ВАШ КОД БИРГЕ: {code} 👈")
        print(f"{'='*40}\n")

    channel = "telegram" if tg_sent else "console"
    return {"message": f"Code sent via {channel}", "tg_linked": bool(chat_id)}


@router.post("/verify-code")
async def verify_code(req: VerifyCodePayload, request: Request, db: Session = Depends(get_db)):
    """Проверяет SMS-код и выдает JWT токен."""
    await _check_verify_code_rate(_client_ip(request))
    raw_phone = req.phone.strip()
    code = req.code.strip()
    name = (req.name or "").strip()

    is_valid, p_e164, p_digits, p_formatted, op_or_err = auth_service.normalize_kg_phone(raw_phone)
    if not is_valid:
        raise HTTPException(status_code=400, detail=op_or_err)

    if not auth_service.verify_sms_code(p_e164, code, db):
        raise HTTPException(status_code=400, detail="Invalid, expired, or locked code")

    # Ищем существующего пользователя по любому представлению номера
    user = (
        db.query(models.User)
        .filter(
            (models.User.phone == p_e164)
            | (models.User.phone == p_formatted)
            | (models.User.phone == p_digits)
            | (models.User.phone.like(f"%{p_digits[-9:]}%"))
        )
        .first()
    )
    if not user:
        # Автоматическая верификация если контакт уже был подтверждён в Telegram боте
        has_tg = db.query(models.TelegramBinding).filter(
            (models.TelegramBinding.phone_normalized == p_digits)
            | (models.TelegramBinding.phone == p_e164)
            | (models.TelegramBinding.phone == p_formatted)
        ).first()
        user = models.User(
            name=name or "Новый пользователь",
            phone=p_e164,
            is_verified=bool(has_tg),
            photo=f"https://i.pravatar.cc/150?u={p_digits}",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Создаём JWT токены (sub строго строковый). Профиль отдаём сразу,
    # чтобы клиент не делал второй запрос и не зависел от гонки сети.
    token_data = _token_payload(user)
    access_token = auth_service.create_access_token(token_data)
    refresh_token = auth_service.issue_refresh_token(user, db)
    db.commit()
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": auth_service.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user_id": user.id,
        "user": schemas.User.model_validate(user).model_dump(),
    }


@router.post("/refresh")
def refresh_access_token(req: schemas.RefreshTokenRequest, db: Session = Depends(get_db)):
    """Обменивает refresh-токен на новую пару токенов."""
    user_id = auth_service.verify_refresh_token(req.refresh_token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    token_version = auth_service.get_token_version(req.refresh_token, "refresh")
    if token_version is None or token_version != (user.token_version or 0):
        raise HTTPException(status_code=401, detail="Session has been revoked")

    new_refresh_token = auth_service.rotate_refresh_token(req.refresh_token, user, db)
    if not new_refresh_token:
        # A replayed token revokes its whole family; persist that before 401.
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has already been used or revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    db.commit()

    token_data = _token_payload(user)
    return {
        "access_token": auth_service.create_access_token(token_data),
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "expires_in": auth_service.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@router.post("/logout")
def logout(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke every token issued to the user, including other devices."""
    current_user.token_version = int(current_user.token_version or 0) + 1
    # The version bump invalidates every session; remove the now-dead rows too.
    db.query(models.RefreshSession).filter(
        models.RefreshSession.user_id == current_user.id
    ).delete(synchronize_session=False)
    db.commit()
    return {"ok": True}
