"""Telegram bot webhook and internal binding sync endpoints."""
from datetime import datetime, timezone
import logging
import os
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

import auth
import models
from config import IS_PRODUCTION
from database import get_db
from rate_limit import get_rate_limiter

logger = logging.getLogger("birge")

router = APIRouter(tags=["bot"])

TELEGRAM_WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
INTERNAL_SYNC_SECRET = os.environ.get("INTERNAL_SYNC_SECRET", "")
INTERNAL_SYNC_ENABLED = os.environ.get("INTERNAL_SYNC_ENABLED", "").lower() == "true"

_BOT_LOGIN_CODE_WINDOW_SECONDS = 60
_BOT_LOGIN_CODE_MAX_PER_WINDOW = 10


@router.post("/bot/webhook")
async def telegram_webhook(
    payload: dict,
    x_telegram_bot_api_secret_token: Optional[str] = Header(
        None, alias="X-Telegram-Bot-Api-Secret-Token"
    ),
    db: Session = Depends(get_db),
):
    """Telegram Bot webhook handler protected by X-Telegram-Bot-Api-Secret-Token."""
    if not TELEGRAM_WEBHOOK_SECRET:
        if IS_PRODUCTION:
            raise HTTPException(status_code=503, detail="Webhook secret is not configured")
    elif not x_telegram_bot_api_secret_token or not secrets.compare_digest(
        x_telegram_bot_api_secret_token, TELEGRAM_WEBHOOK_SECRET
    ):
        raise HTTPException(status_code=403, detail="Forbidden: Invalid webhook secret")

    try:
        message = payload.get("message", {})
        if not message:
            return {"ok": True}

        chat_id: Optional[int] = message.get("chat", {}).get("id")
        text: str = (message.get("text") or "").strip()
        contact: dict = message.get("contact", {})
        sender: dict = message.get("from", {})
        first_name: str = sender.get("first_name", "Пользователь")

        if not chat_id:
            return {"ok": True}

        main_keyboard = {
            "keyboard": [
                [{"text": "📱 Поделиться номером", "request_contact": True}],
                [{"text": "🔐 Войти в приложение"}],
                [{"text": "🔍 Проверить статус"}, {"text": "🔔 Тест связи"}],
                [{"text": "❓ Помощь"}],
            ],
            "resize_keyboard": True,
            "is_persistent": True,
        }

        async def _reply(reply_text: str, custom_kb: dict | None = main_keyboard) -> None:
            await auth.send_telegram_message(chat_id, reply_text, reply_markup=custom_kb)

        def _bound_user(binding):
            phone_tail = (
                binding.phone_normalized
                or "".join(filter(str.isdigit, binding.phone or ""))
            )[-9:]
            query = db.query(models.User).filter(models.User.phone == binding.phone)
            if phone_tail:
                query = db.query(models.User).filter(
                    (models.User.phone == binding.phone) | (models.User.phone.like(f"%{phone_tail}%"))
                )
            return query.first()

        async def _send_login_link(user) -> None:
            allowed = get_rate_limiter().hit_sync(
                f"bot:login-code:{user.id}",
                _BOT_LOGIN_CODE_MAX_PER_WINDOW,
                _BOT_LOGIN_CODE_WINDOW_SECONDS,
            )
            if not allowed:
                await _reply("⏳ Слишком много ссылок для входа. Попробуйте через минуту.")
                return

            code = auth.issue_login_code(user, db)
            db.commit()
            login_url = auth.build_login_url(code)
            await _reply(
                "🔐 *Вход в приложение Birge*\n\n"
                f"Ссылка действует {auth.LOGIN_CODE_TTL_SECONDS} секунд и срабатывает один раз.\n"
                "Нажмите кнопку ниже, чтобы войти.",
                {"inline_keyboard": [[{"text": "🔐 Войти в Birge", "url": login_url}]]},
            )

        async def _process_phone_binding(raw_phone: str) -> None:
            is_valid, p_e164, p_digits, p_formatted, op_or_err = auth.normalize_kg_phone(raw_phone)
            if not is_valid:
                await _reply(
                    f"❌ *Ошибка в номере телефона:*\n{op_or_err}\n\n"
                    f"💡 Пример: `0555 123 456` или `+996 555 123 456`."
                )
                return

            user = (
                db.query(models.User)
                .filter(
                    (models.User.phone == p_formatted)
                    | (models.User.phone == p_e164)
                    | (models.User.phone == p_digits)
                    | (models.User.phone.like(f"%{p_digits[-9:]}%"))
                )
                .first()
            )

            binding = (
                db.query(models.TelegramBinding)
                .filter(
                    (models.TelegramBinding.phone_normalized == p_digits)
                    | (models.TelegramBinding.phone == p_formatted)
                    | (models.TelegramBinding.phone == p_e164)
                    | (models.TelegramBinding.chat_id == chat_id)
                )
                .first()
            )

            if binding:
                binding.chat_id = chat_id
                binding.phone = p_formatted
                binding.phone_normalized = p_digits
            else:
                db.add(
                    models.TelegramBinding(
                        phone=p_formatted,
                        phone_normalized=p_digits,
                        chat_id=chat_id,
                    )
                )

            if user:
                user.is_verified = True

            try:
                db.commit()
            except Exception as exc:
                logger.warning("[Telegram] Binding save conflict (%s); retrying", type(exc).__name__)
                db.rollback()
                try:
                    db.query(models.TelegramBinding).filter(
                        (models.TelegramBinding.chat_id == chat_id)
                        | (models.TelegramBinding.phone == p_formatted)
                        | (models.TelegramBinding.phone_normalized == p_digits)
                    ).delete(synchronize_session=False)
                    db.add(
                        models.TelegramBinding(
                            phone=p_formatted,
                            phone_normalized=p_digits,
                            chat_id=chat_id,
                        )
                    )
                    if user:
                        user.is_verified = True
                    db.commit()
                except Exception:
                    logger.exception("[Telegram] Binding retry failed")
                    db.rollback()

            if user:
                await _reply(
                    f"✅ *Номер подтверждён и найден в системе Birge!*\n\n"
                    f"👤 *Профиль:* {user.name}\n"
                    f"📱 *Телефон:* `{p_formatted}` ({op_or_err})\n"
                    f"⭐️ *Рейтинг доверия:* {user.trust_rating or 5.0} ★\n"
                    f"🛡 *Верификация:* Аккаунт успешно верифицирован (бейдж ✅ активен)\n\n"
                    f"🎉 *Теперь все сообщения гарантированно приходят сюда:*\n"
                    f"• Коды для быстрого входа\n"
                    f"• Запросы от попутчиков\n"
                    f"• Напоминания за 1 час до выезда\n"
                    f"• Экстренные уведомления (SOS)"
                )
                await _send_login_link(user)
            else:
                await _reply(
                    f"⚠️ *Номер {p_formatted} ({op_or_err}) распознан, но пока НЕ зарегистрирован в Birge.*\n\n"
                    f"Мы успешно привязали ваш Telegram-аккаунт к этому номеру.\n\n"
                    f"👉 Зарегистрируйтесь на сайте или в приложении Birge с этим номером, "
                    f"и ваш профиль автоматически станет верифицированным ✅, "
                    f"а все уведомления начнут мгновенно приходить сюда!"
                )

        if contact:
            if contact.get("user_id") != sender.get("id"):
                await _reply(
                    "❌ Вы можете отправить только свой собственный контакт через кнопку «Поделиться номером»."
                )
                return {"ok": True}

            contact_phone = contact.get("phone_number", "").strip()
            if contact_phone:
                await _process_phone_binding(contact_phone)
                return {"ok": True}

        if text.startswith("/start"):
            await _reply(
                f"👋 Привет, *{first_name}*!\n\n"
                f"Я официальный бот сервиса совместных поездок *Birge* (Бишкек и Кыргызстан) 🚗\n\n"
                f"Я отправляю вам:\n"
                f"• 🔐 Коды входа в приложение\n"
                f"• 🚗 Мгновенные запросы от попутчиков\n"
                f"• ⏰ Напоминания за час до поездки\n\n"
                f"Чтобы безопасно привязать номер, нажмите кнопку ниже:\n"
                f"*«📱 Поделиться номером»*."
            )
            return {"ok": True}

        if text in ("/login", "🔐 Войти в приложение", "войти", "вход"):
            binding = (
                db.query(models.TelegramBinding)
                .filter(models.TelegramBinding.chat_id == chat_id)
                .first()
            )
            if not binding:
                await _reply(
                    "❌ Сначала привяжите номер телефона через кнопку "
                    "*«📱 Поделиться номером»*."
                )
                return {"ok": True}

            user = _bound_user(binding)
            if not user:
                await _reply(
                    f"⚠️ Telegram привязан к номеру `{binding.phone}`, но профиль "
                    "в Birge ещё не создан. Зарегистрируйтесь в приложении и повторите."
                )
                return {"ok": True}

            await _send_login_link(user)
            return {"ok": True}

        if text in ("/status", "🔍 Проверить статус", "проверить статус", "статус"):
            binding = (
                db.query(models.TelegramBinding)
                .filter(models.TelegramBinding.chat_id == chat_id)
                .first()
            )
            if binding:
                user = _bound_user(binding)
                if user:
                    await _reply(
                        f"📊 *Статус подключения Birge:*\n\n"
                        f"✅ Telegram привязан и активен!\n"
                        f"📱 Номер: `{binding.phone}`\n"
                        f"👤 Профиль в Birge: *{user.name}*\n"
                        f"⭐️ Рейтинг: *{user.trust_rating or 5.0} ★*\n"
                        f"🛡 Верификация: *Подтверждена ✅*\n"
                        f"🔔 Доставка уведомлений: *Работает штатно*"
                    )
                else:
                    await _reply(
                        f"📊 *Статус подключения:*\n\n"
                        f"⚠️ Telegram привязан к номеру `{binding.phone}`, но профиль в базе Birge ещё не создан.\n"
                        f"Создайте аккаунт в приложении, чтобы связать его."
                    )
            else:
                await _reply(
                    "❌ Ваш Telegram ещё не привязан к номеру телефона.\n\n"
                    "Нажмите кнопку *«📱 Поделиться номером»* ниже или напишите ваш номер телефона сообщением."
                )
            return {"ok": True}

        if text.startswith("/check") or text.lower().startswith("проверить "):
            args = text.replace("/check", "").replace("проверить", "").strip()
            if not args:
                await _reply("💡 Укажите номер для проверки. Пример:\n`/check 0555123456`")
                return {"ok": True}
            is_val, _, pdig, pfmt, op_err = auth.normalize_kg_phone(args)
            if not is_val:
                await _reply(f"❌ Номер невалиден: {op_err}")
                return {"ok": True}

            sender_binding = (
                db.query(models.TelegramBinding)
                .filter(models.TelegramBinding.chat_id == chat_id)
                .first()
            )
            if not sender_binding or sender_binding.phone_normalized != pdig:
                await _reply(
                    "❌ Проверять можно только свой номер.\n\n"
                    "Привяжите Telegram через кнопку *«📱 Поделиться номером»*."
                )
                return {"ok": True}

            user = db.query(models.User).filter(models.User.phone.like(f"%{pdig[-9:]}%")).first()
            binding = (
                db.query(models.TelegramBinding)
                .filter(models.TelegramBinding.phone_normalized == pdig)
                .first()
            )

            await _reply(
                f"🔍 *Результат проверки номера {pfmt} ({op_err}):*\n\n"
                f"• Регистрация в Birge: {'✅ Да (Пользователь: ' + user.name + ')' if user else '❌ Нет'}\n"
                f"• Telegram-бот подключен: {'✅ Да' if binding else '❌ Нет (сообщения не доставляются)'}\n"
                f"• Статус верификации: {'✅ Верифицирован' if user and user.is_verified else '⚠️ Не верифицирован'}"
            )
            return {"ok": True}

        if text in ("/test", "🔔 Тест связи", "тест", "проверка"):
            now_time = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
            await _reply(
                f"🔔 *Тест доставки сообщений пройден!*\n\n"
                f"✅ Связь с ботом Birge активна.\n"
                f"🆔 Ваш Chat ID: `{chat_id}`\n"
                f"⏱ Время проверки: `{now_time}`\n\n"
                f"Уведомления о поездках и коды подтверждения будут доставляться без задержек."
            )
            return {"ok": True}

        if text in ("/help", "❓ Помощь", "помощь"):
            await _reply(
                "ℹ️ *Справка по боту Birge:*\n\n"
                "• Нажмите *«📱 Поделиться номером»* для безопасной привязки аккаунта\n"
                "• `/login` — получить одноразовую ссылку для входа в приложение\n"
                "• `/status` — проверить ваш статус привязки и верификации\n"
                "• `/check <номер>` — проверить наличие номера в системе Birge\n"
                "• `/test` — проверить доставку сообщений\n\n"
                f"🌐 Веб-версия приложения: [Birge]({auth.APP_PUBLIC_URL})\n"
                "🆘 Служба поддержки: @birge_support"
            )
            return {"ok": True}

        await _reply(
            "🔒 Для защиты вашего аккаунта привязка номера телефона выполняется *только* через подтверждённый Telegram-контакт.\n\n"
            "👇 Нажмите кнопку *«📱 Поделиться номером»* внизу для безопасной привязки."
        )
        return {"ok": True}

    except Exception:
        logger.exception("[Telegram Webhook] Update processing failed")
        try:
            db.rollback()
        except Exception:
            pass
        return {"ok": True}


@router.get("/internal/get-binding")
def internal_get_binding(
    phone: str,
    x_internal_sync_secret: Optional[str] = Header(None, alias="X-Internal-Sync-Secret"),
    db: Session = Depends(get_db),
):
    """Internal endpoint for syncing Telegram bindings in development."""
    if not INTERNAL_SYNC_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")
    if not INTERNAL_SYNC_SECRET:
        raise HTTPException(status_code=503, detail="Internal sync is not configured")
    if not x_internal_sync_secret or not secrets.compare_digest(
        x_internal_sync_secret, INTERNAL_SYNC_SECRET
    ):
        raise HTTPException(status_code=403, detail="Forbidden: Invalid secret")

    phone_digits = "".join(filter(str.isdigit, phone or ""))
    if not phone_digits:
        return {"found": False}

    binding = (
        db.query(models.TelegramBinding)
        .filter(
            (models.TelegramBinding.phone_normalized == phone_digits)
            | (models.TelegramBinding.phone == phone)
            | (models.TelegramBinding.phone_normalized.endswith(phone_digits[-9:]))
        )
        .first()
    )
    if not binding:
        return {"found": False}

    return {
        "found": True,
        "phone": binding.phone,
        "phone_normalized": binding.phone_normalized,
        "chat_id": binding.chat_id,
    }
