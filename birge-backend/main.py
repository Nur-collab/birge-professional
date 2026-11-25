from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import time
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional
from uuid import uuid4
import database, models, schemas, auth
import redis
from config import ALLOWED_ORIGIN_REGEX, ALLOWED_ORIGINS, IS_PRODUCTION, REDIS_URL
from dependencies import get_current_admin, get_current_user
from time_utils import BISHKEK_TZ, get_bishkek_now, get_bishkek_today_str, parse_time_minutes
from realtime import is_trip_participant, start_realtime, stop_realtime
from rate_limit import close_rate_limiter, enforce_user_limit_sync, get_rate_limiter
from logging_config import bind_request_id, configure_logging, reset_request_id
from sentry_config import init_sentry
from routers.auth import router as auth_router
from routers.chat import router as chat_router
from routers.trip_requests import router as trip_requests_router
from routers.trips import router as trips_router
from routers.users import router as users_router
import asyncio
import os
import logging
import secrets
import sys

# Windows-консоль по умолчанию использует cp1251 и падает на эмодзи в print().
# Явный UTF-8 делает запуск одинаковым на Windows и Linux.
for _stream in (sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            # Поток может быть уже закрыт или перенаправлен нестандартным хостом.
            pass

configure_logging()
logger = logging.getLogger("birge")
init_sentry()

# Схема БД управляется Alembic. Перед запуском приложения выполните:
# alembic upgrade head

# Время Бишкека и общие auth-зависимости вынесены в time_utils.py и dependencies.py.

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle: startup → yield → shutdown."""
    await start_realtime()
    try:
        await startup_tasks()
        yield
    finally:
        await stop_realtime()
        await close_rate_limiter()

app = FastAPI(
    title="Birge API - MVP Backend",
    lifespan=lifespan,
    # Public API docs are useful in development but unnecessary attack surface
    # in production. The schema is exported at build time for frontend types.
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)


@app.middleware("http")
async def request_id_middleware(request, call_next):
    """Attach a stable request id to every response and log record."""
    incoming = request.headers.get("X-Request-ID", "").strip()
    request_id = incoming[:128] if incoming else uuid4().hex
    request.state.request_id = request_id
    token = bind_request_id(request_id)
    started = time.perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request.complete",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response
    except Exception:
        logger.exception(
            "request.failed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status_code": 500,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        raise
    finally:
        reset_request_id(token)


@app.middleware("http")
async def security_headers_middleware(request, call_next):
    """Add baseline browser protections to every API response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = (
        "geolocation=(self), camera=(), microphone=(), payment=()"
    )
    response.headers["Content-Security-Policy"] = (
        "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
    )
    # Tokens and personal data must never be reused from an HTTP cache. Every
    # authenticated request is personalized by definition; auth and profile
    # routes also need this for their unauthenticated steps.
    is_authenticated = "authorization" in request.headers
    if (
        is_authenticated
        or request.url.path == "/users"
        or request.url.path.startswith(("/auth/", "/users/", "/internal/"))
    ):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    if IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


app.include_router(auth_router)
app.include_router(trips_router)
app.include_router(users_router)
app.include_router(trip_requests_router)
app.include_router(chat_router)

@app.get("/health")
def health_check():
    """Публичный liveness-эндпоинт для мониторинга (UptimeRobot, etc.)."""
    return {"status": "ok"}


@app.get("/ready")
def readiness_check():
    """Readiness: database is reachable and optional Redis is configured."""
    try:
        with database.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        logger.exception("[Readiness] Database check failed")
        raise HTTPException(status_code=503, detail="Database is not ready") from exc

    if REDIS_URL:
        client = None
        try:
            client = redis.Redis.from_url(
                REDIS_URL,
                protocol=2,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            client.ping()
        except Exception as exc:
            logger.warning("[Readiness] Redis check failed: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail="Redis is not ready") from exc
        finally:
            if client is not None:
                client.close()

    return {"status": "ready"}

# CORS origins and the auth-cookie path are shared with routers/auth.py.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

# Dependency импортируется напрямую из database.py
from database import get_db, SessionLocal


# --- USERS ---
# User profile routes live in routers/users.py.

# --- TRIPS ---
# Trip routes live in routers/trips.py.


@app.post("/reviews/", response_model=schemas.Review)
def create_review(
    review: schemas.ReviewCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Сохраняет отзыв о пользователе после поездки.

    Правила:
    - Нельзя оставить отзыв самому себе.
    - Один пользователь может оставить только один отзыв конкретному человеку.
      (защита от накрутки рейтинга)
    """
    enforce_user_limit_sync(current_user.id, "review.create", 10, 3600)
    if review.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot review yourself")

    user = db.query(models.User).filter(models.User.id == review.user_id).with_for_update().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Проверка совместной поездки: отзыв доступен только после завершённой поездки.
    joint_query = db.query(models.TripRequest).filter(
        (
            (models.TripRequest.requester_id == current_user.id)
            & (models.TripRequest.driver_id == review.user_id)
        )
        | (
            (models.TripRequest.requester_id == review.user_id)
            & (models.TripRequest.driver_id == current_user.id)
        )
    )

    if review.trip_id:
        trip = db.query(models.Trip).filter(models.Trip.id == review.trip_id).first()
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if not is_trip_participant(db, review.trip_id, current_user.id) or not is_trip_participant(db, review.trip_id, review.user_id):
            raise HTTPException(
                status_code=403,
                detail="Отзыв можно оставить только после совместной поездки",
            )

        joint = joint_query.filter(
            models.TripRequest.trip_id == review.trip_id,
            models.TripRequest.status == "completed",
        ).first()
        # Совместимость со старыми записями: поездка завершена, но заявка
        # осталась в статусе accepted.
        if not joint and trip.status != "completed":
            raise HTTPException(
                status_code=403,
                detail="Отзыв можно оставить только после завершённой поездки",
            )
    else:
        joint = joint_query.filter(models.TripRequest.status == "completed").first()
        if not joint:
            raise HTTPException(
                status_code=403,
                detail="Отзыв можно оставить только после завершённой поездки",
            )

    # Защита от дублирующих отзывов. author_name используется только для
    # legacy-записей, где author_id ещё не был заполнен.
    query = db.query(models.Review).filter(
        models.Review.user_id == review.user_id,
        (models.Review.author_id == current_user.id)
        | (
            models.Review.author_id.is_(None)
            & (models.Review.author_name == current_user.name)
        ),
    )
    if review.trip_id:
        query = query.filter(models.Review.trip_id == review.trip_id)
    existing = query.first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail="You have already reviewed this user",
        )

    new_review = models.Review(
        user_id=review.user_id,
        author_id=current_user.id,
        author_name=current_user.name,
        trip_id=review.trip_id,
        text=review.text,
        rating=review.rating,
    )
    db.add(new_review)

    # Пересчитываем средний рейтинг (включая новый)
    all_reviews = db.query(models.Review).filter(models.Review.user_id == review.user_id).all()
    total_rating = sum((r.rating or 0) for r in all_reviews) + review.rating
    count = len(all_reviews) + 1
    user.trust_rating = int(total_rating * 10 / count) / 10.0

    db.commit()
    db.refresh(new_review)
    return new_review




TELEGRAM_WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")

INTERNAL_SYNC_SECRET = os.environ.get("INTERNAL_SYNC_SECRET", "")
INTERNAL_SYNC_ENABLED = os.environ.get("INTERNAL_SYNC_ENABLED", "").lower() == "true"

_BOT_LOGIN_CODE_WINDOW_SECONDS = 60
_BOT_LOGIN_CODE_MAX_PER_WINDOW = 10


# --- TELEGRAM BOT WEBHOOK ---
@app.post("/bot/webhook")
async def telegram_webhook(
    payload: dict,
    x_telegram_bot_api_secret_token: Optional[str] = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
    db: Session = Depends(get_db),
):
    """
    Telegram шлёт сюда все входящие сообщения.
    Защищён проверкой X-Telegram-Bot-Api-Secret-Token.
    Обрабатывает:
      - Передачу контакта через кнопку «Поделиться номером» (с проверкой ownership)
      - Команды /status, /check, /test, /help
    """
    import secrets
    if not TELEGRAM_WEBHOOK_SECRET:
        # Fail-closed: без секрета webhook нельзя открывать в production.
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

        chat_id: int = message.get("chat", {}).get("id")
        text: str = (message.get("text") or "").strip()
        contact: dict = message.get("contact", {})
        sender: dict = message.get("from", {})
        first_name: str = sender.get("first_name", "Пользователь")
        username: str = sender.get("username", "")

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
            """Resolve a Telegram binding to a Birge account."""
            from models import User

            phone_tail = (
                binding.phone_normalized
                or "".join(filter(str.isdigit, binding.phone or ""))
            )[-9:]
            query = db.query(User).filter(User.phone == binding.phone)
            if phone_tail:
                query = db.query(User).filter(
                    (User.phone == binding.phone)
                    | (User.phone.like(f"%{phone_tail}%"))
                )
            return query.first()

        async def _send_login_link(user) -> None:
            """Issue a one-time code and send its frontend login link."""
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
                {
                    "inline_keyboard": [[
                        {"text": "🔐 Войти в Birge", "url": login_url}
                    ]]
                },
            )

        async def _process_phone_binding(raw_phone: str) -> None:
            is_valid, p_e164, p_digits, p_formatted, op_or_err = auth.normalize_kg_phone(raw_phone)
            if not is_valid:
                await _reply(
                    f"❌ *Ошибка в номере телефона:*\n{op_or_err}\n\n"
                    f"💡 Пример: `0555 123 456` или `+996 555 123 456`."
                )
                return

            from models import TelegramBinding, User
            # 1. Проверяем наличие пользователя в БД Birge
            user = (
                db.query(User)
                .filter(
                    (User.phone == p_formatted)
                    | (User.phone == p_e164)
                    | (User.phone == p_digits)
                    | (User.phone.like(f"%{p_digits[-9:]}%"))
                )
                .first()
            )

            # 2. Сохраняем/обновляем привязку Telegram (поиск по телефону ИЛИ по chat_id)
            binding = db.query(TelegramBinding).filter(
                (TelegramBinding.phone_normalized == p_digits)
                | (TelegramBinding.phone == p_formatted)
                | (TelegramBinding.phone == p_e164)
                | (TelegramBinding.chat_id == chat_id)
            ).first()

            if binding:
                binding.chat_id = chat_id
                binding.phone = p_formatted
                binding.phone_normalized = p_digits
            else:
                binding = TelegramBinding(
                    phone=p_formatted,
                    phone_normalized=p_digits,
                    chat_id=chat_id,
                )
                db.add(binding)

            if user:
                user.is_verified = True

            try:
                db.commit()
            except Exception as e:
                logger.error(f"[Telegram] Ошибка сохранения привязки: {e}")
                db.rollback()
                try:
                    db.query(TelegramBinding).filter(
                        (TelegramBinding.chat_id == chat_id)
                        | (TelegramBinding.phone == p_formatted)
                        | (TelegramBinding.phone_normalized == p_digits)
                    ).delete(synchronize_session=False)
                    new_b = TelegramBinding(
                        phone=p_formatted,
                        phone_normalized=p_digits,
                        chat_id=chat_id,
                    )
                    db.add(new_b)
                    if user:
                        user.is_verified = True
                    db.commit()
                except Exception as e2:
                    logger.error(f"[Telegram] Критическая ошибка повторной привязки: {e2}")
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

        # 1. Если отправлен контакт через кнопку «Поделиться номером»
        if contact:
            contact_user_id = contact.get("user_id")
            sender_id = sender.get("id")
            if contact_user_id != sender_id:
                await _reply("❌ Вы можете отправить только свой собственный контакт через кнопку «Поделиться номером».")
                return {"ok": True}

            contact_phone = contact.get("phone_number", "").strip()
            if contact_phone:
                await _process_phone_binding(contact_phone)
                return {"ok": True}

        # 2. Команда /start
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

        # 3. Команда /login или кнопка «Войти в приложение»
        if text in ("/login", "🔐 Войти в приложение", "войти", "вход"):
            from models import TelegramBinding

            binding = db.query(TelegramBinding).filter(
                TelegramBinding.chat_id == chat_id
            ).first()
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

        # 4. Команда /status или "Проверить статус"
        if text in ("/status", "🔍 Проверить статус", "проверить статус", "статус"):
            from models import TelegramBinding, User
            binding = db.query(TelegramBinding).filter(TelegramBinding.chat_id == chat_id).first()
            if binding:
                phone_tail = (binding.phone_normalized or "".join(filter(str.isdigit, binding.phone or "")))[-9:]
                query = db.query(User).filter(User.phone == binding.phone)
                if phone_tail:
                    query = db.query(User).filter((User.phone == binding.phone) | (User.phone.like(f"%{phone_tail}%")))
                user = query.first()
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

        # 4. Команда /check <phone>
        if text.startswith("/check") or text.lower().startswith("проверить "):
            args = text.replace("/check", "").replace("проверить", "").strip()
            if not args:
                await _reply("💡 Укажите номер для проверки. Пример:\n`/check 0555123456`")
                return {"ok": True}
            is_val, pe164, pdig, pfmt, op_err = auth.normalize_kg_phone(args)
            if not is_val:
                await _reply(f"❌ Номер невалиден: {op_err}")
                return {"ok": True}

            from models import TelegramBinding, User
            sender_binding = db.query(TelegramBinding).filter(TelegramBinding.chat_id == chat_id).first()
            if not sender_binding or sender_binding.phone_normalized != pdig:
                await _reply(
                    "❌ Проверять можно только свой номер.\n\n"
                    "Привяжите Telegram через кнопку *«📱 Поделиться номером»*."
                )
                return {"ok": True}

            user = db.query(User).filter(User.phone.like(f"%{pdig[-9:]}%")).first()
            binding = db.query(TelegramBinding).filter(TelegramBinding.phone_normalized == pdig).first()

            await _reply(
                f"🔍 *Результат проверки номера {pfmt} ({op_err}):*\n\n"
                f"• Регистрация в Birge: {'✅ Да (Пользователь: ' + user.name + ')' if user else '❌ Нет'}\n"
                f"• Telegram-бот подключен: {'✅ Да' if binding else '❌ Нет (сообщения не доставляются)'}\n"
                f"• Статус верификации: {'✅ Верифицирован' if user and user.is_verified else '⚠️ Не верифицирован'}"
            )
            return {"ok": True}

        # 5. Команда /test или "Тест связи"
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

        # 6. Команда /help или "Помощь"
        if text in ("/help", "❓ Помощь", "помощь"):
            await _reply(
                "ℹ️ *Справка по боту Birge:*\n\n"
                "• Нажмите *«📱 Поделиться номером»* для безопасной привязки аккаунта\n"
                "• `/login` — получить одноразовую ссылку для входа в приложение\n"
                "• `/status` — проверить ваш статус привязки и верификации\n"
                "• `/check <номер>` — проверить наличие номера в системе Birge\n"
                "• `/test` — проверить доставку сообщений\n\n"
                "🌐 Веб-версия приложения: [birge-5c900.web.app](https://birge-5c900.web.app)\n"
                "🆘 Служба поддержки: @birge_support"
            )
            return {"ok": True}

        # 7. Любое другое сообщение — для безопасности привязка возможна только через Telegram-контакт
        await _reply(
            "🔒 Для защиты вашего аккаунта привязка номера телефона выполняется *только* через подтверждённый Telegram-контакт.\n\n"
            "👇 Нажмите кнопку *«📱 Поделиться номером»* внизу для безопасной привязки."
        )
        return {"ok": True}

    except Exception:
        # Do not put exception text into logs: SDK/transport errors can contain
        # request URLs, and Telegram URLs include the bot token.
        logger.exception("[Telegram Webhook] Ошибка обработки обновления")
        try:
            db.rollback()
        except Exception:
            pass
        return {"ok": True}


@app.get("/internal/get-binding")
def internal_get_binding(
    phone: str,
    x_internal_sync_secret: Optional[str] = Header(None, alias="X-Internal-Sync-Secret"),
    db: Session = Depends(get_db),
):
    """Внутренний эндпоинт для синхронизации привязок Telegram.

    По умолчанию выключен и в production не должен включаться без отдельного
    секрета. Секрет webhook для этого не переиспользуется.
    """
    import secrets
    if not INTERNAL_SYNC_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")
    if not INTERNAL_SYNC_SECRET:
        raise HTTPException(status_code=503, detail="Internal sync is not configured")
    if not x_internal_sync_secret or not secrets.compare_digest(x_internal_sync_secret, INTERNAL_SYNC_SECRET):
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


# Глобальный in-memory set удалён — состояние теперь хранится в БД (Trip.reminder_sent).
# Это означает что напоминания не дублируются при рестарте сервера.


async def _reminder_loop():
    """Background loop: каждую минуту проверяет запланированные поездки.
    Если до начала поездки осталось 50-70 минут — отправляем Telegram-напоминание
    водителю И всем принятым пассажирам.
    Учитывает часовой пояс Бишкека (UTC+6) и корректный переход через полночь.
    """
    from models import TelegramBinding

    while True:
        await asyncio.sleep(60)  # проверяем раз в минуту
        try:
            now = get_bishkek_now()

            # Окно проверки: от 50 до 70 минут до начала поездки
            window_from = now + timedelta(minutes=50)
            window_to = now + timedelta(minutes=70)

            # Кандидатные даты (учитывает переход через полночь)
            candidate_dates = list({window_from.date().isoformat(), window_to.date().isoformat()})

            with SessionLocal() as db:
                trips = db.query(models.Trip).filter(
                    models.Trip.status.in_(["scheduled", "matched"]),
                    models.Trip.date.in_(candidate_dates),
                    models.Trip.reminder_sent == False,  # noqa: E712
                ).all()

                for trip in trips:
                    if not trip.date or not trip.time:
                        continue

                    # Парсим дату и время поездки в часовом поясе Бишкека
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

                    # --- Напоминаем ВОДИТЕЛЮ ---
                    driver_user = db.query(models.User).filter(
                        models.User.id == trip.user_id
                    ).first()
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
                            print(f"[Reminder] Водитель trip#{trip.id} → chat {driver_chat_id}")

                    # --- Напоминаем всех ПРИНЯТЫХ ПАССАЖИРОВ ---
                    accepted = db.query(models.TripRequest).filter(
                        models.TripRequest.trip_id == trip.id,
                        models.TripRequest.status == "accepted",
                    ).all()

                    for req in accepted:
                        passenger = db.query(models.User).filter(models.User.id == req.requester_id).first()
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
                        print(f"[Reminder] Пассажир uid={passenger.id} trip#{trip.id} → chat {passenger_chat_id}")

                    # Отмечаем в БД — персистентно переживёт любой рестарт
                    trip.reminder_sent = True
                    db.commit()

        except Exception as e:
            # Не даём задаче упасть — продолжаем циклить
            print(f"[Reminder] Ошибка в цикле: {e}")


def _get_trip_datetime(trip: models.Trip) -> Optional[datetime]:
    """Возвращает datetime поездки в часовом поясе Бишкека (BISHKEK_TZ)."""
    if not trip.date:
        return None
    try:
        parts = [int(p) for p in str(trip.date).strip().split("-") if p.isdigit()]
        if len(parts) != 3:
            return None
        y, m, d = parts
        tm = parse_time_minutes(trip.time)
        h, mn = (tm // 60, tm % 60) if tm is not None else (23, 59)
        return datetime(y, m, d, h, mn, tzinfo=BISHKEK_TZ)
    except Exception:
        return None


def cleanup_stale_trips(db: Session) -> dict[str, int]:
    """Периодическая автоочистка и архивация старых поездок:
    1. Поездки водителей с пассажирами (время вышло > 4ч назад):
       - Переводятся в 'completed' (сохраняет историю поездок и отзывы).
       - Принятые пассажирские запросы переходят в 'completed'.
       - Привязанные поездки пассажиров переходят в 'completed'.
       - Висящие 'pending' запросы закрываются как 'declined'.
    2. Поездки водителей без пассажиров (время вышло > 5ч назад):
       - Переводятся в 'cancelled'.
       - Висящие 'pending' запросы закрываются как 'declined'.
    3. Неактуальные поиски пассажиров (время вышло > 4ч назад):
       - Переводятся в 'cancelled'.
       - Исходящие 'pending' запросы отклоняются.
    4. Физическая очистка древних cancelled записей (> 14 дней без сообщений и отзывов).
    """
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
        candidate_trips = db.query(models.Trip).filter(
            models.Trip.status.in_(["active", "scheduled", "matched", "in_progress"])
        ).all()

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
                created_utc = trip.created_at if trip.created_at.tzinfo else trip.created_at.replace(tzinfo=timezone.utc)
                if now_utc - created_utc >= timedelta(hours=buffer_hours):
                    is_stale = True
            elif trip.date and trip.date < now_bishkek.date().isoformat():
                is_stale = True

            if not is_stale:
                continue

            if trip.role == "driver":
                has_passengers = bool(trip.seats_taken and trip.seats_taken > 0)
                if not has_passengers:
                    has_passengers = db.query(models.TripRequest).filter(
                        models.TripRequest.trip_id == trip.id,
                        models.TripRequest.status.in_(["accepted", "completed"]),
                    ).first() is not None

                if has_passengers:
                    stale_driver_completed.append(trip)
                else:
                    stale_driver_cancelled.append(trip)
            else:
                stale_passenger_cancelled.append(trip)

        # 1. Завершаем поездки водителей с пассажирами
        for d_trip in stale_driver_completed:
            d_trip.status = "completed"
            stats["completed_driver_trips"] += 1

            accepted_reqs = db.query(models.TripRequest).filter(
                models.TripRequest.trip_id == d_trip.id,
                models.TripRequest.status == "accepted",
            ).all()
            for req in accepted_reqs:
                req.status = "completed"
                if req.requester_trip_id:
                    p_trip = db.query(models.Trip).filter(models.Trip.id == req.requester_trip_id).first()
                    if p_trip and p_trip.status not in ("completed", "cancelled"):
                        p_trip.status = "completed"

            pending_reqs = db.query(models.TripRequest).filter(
                models.TripRequest.trip_id == d_trip.id,
                models.TripRequest.status == "pending",
            ).all()
            for p_req in pending_reqs:
                p_req.status = "declined"
                stats["declined_stale_requests"] += 1

        # 2. Отменяем несостоявшиеся поездки водителей
        for d_trip in stale_driver_cancelled:
            d_trip.status = "cancelled"
            stats["cancelled_driver_trips"] += 1

            pending_reqs = db.query(models.TripRequest).filter(
                models.TripRequest.trip_id == d_trip.id,
                models.TripRequest.status == "pending",
            ).all()
            for p_req in pending_reqs:
                p_req.status = "declined"
                stats["declined_stale_requests"] += 1

        # 3. Отменяем устаревшие поиски пассажиров
        for p_trip in stale_passenger_cancelled:
            was_accepted = db.query(models.TripRequest).filter(
                models.TripRequest.requester_trip_id == p_trip.id,
                models.TripRequest.status.in_(["accepted", "completed"]),
            ).first()
            if was_accepted:
                continue

            p_trip.status = "cancelled"
            stats["cancelled_passenger_trips"] += 1

            out_pending = db.query(models.TripRequest).filter(
                models.TripRequest.requester_trip_id == p_trip.id,
                models.TripRequest.status == "pending",
            ).all()
            for req in out_pending:
                req.status = "declined"
                stats["declined_stale_requests"] += 1

        # 4. Физическая очистка древних cancelled записей (> 14 дней без сообщений и отзывов)
        cutoff_date = (now_bishkek - timedelta(days=14)).date().isoformat()
        cutoff_utc = now_utc - timedelta(days=14)

        legacy_trips = db.query(models.Trip).filter(
            models.Trip.status == "cancelled",
            (
                (models.Trip.date.is_not(None) & (models.Trip.date < cutoff_date))
                | (models.Trip.created_at.is_not(None) & (models.Trip.created_at < cutoff_utc))
            ),
        ).limit(100).all()

        if legacy_trips:
            legacy_ids = [t.id for t in legacy_trips]
            chat_trip_ids = {
                m.trip_id for m in db.query(models.ChatMessage.trip_id).filter(
                    models.ChatMessage.trip_id.in_(legacy_ids)
                ).all()
            }
            review_trip_ids = {
                r.trip_id for r in db.query(models.Review.trip_id).filter(
                    models.Review.trip_id.in_(legacy_ids)
                ).all()
            }
            safe_to_delete = [
                tid for tid in legacy_ids
                if tid not in chat_trip_ids and tid not in review_trip_ids
            ]
            if safe_to_delete:
                db.query(models.TripRequest).filter(
                    models.TripRequest.trip_id.in_(safe_to_delete)
                    | models.TripRequest.requester_trip_id.in_(safe_to_delete)
                ).delete(synchronize_session=False)
                deleted_count = db.query(models.Trip).filter(
                    models.Trip.id.in_(safe_to_delete)
                ).delete(synchronize_session=False)
                stats["pruned_legacy_trips"] = deleted_count

        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"[cleanup_stale_trips] Ошибка транзакции: {e}", exc_info=True)
        raise

    return stats


async def _stale_cleanup_loop():
    """Фоновая периодическая автоочистка старых поездок (каждые 15 минут)."""
    while True:
        try:
            await asyncio.sleep(900)  # 15 минут
            with database.SessionLocal() as db:
                stats = cleanup_stale_trips(db)
                total_actions = sum(stats.values())
                if total_actions > 0:
                    logger.info(f"[AutoCleanup] Периодическая очистка выполнена: {stats}")
                    print(f"[AutoCleanup] ✅ Выполнена автоочистка поездок: {stats}")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"[AutoCleanup] Ошибка в цикле автоочистки: {e}")
            print(f"[AutoCleanup] ⚠️ Ошибка: {e}")


@app.post("/admin/cleanup-trips")
def run_admin_cleanup(
    current_user: models.User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Принудительный запуск очистки старых поездок администратором."""
    stats = cleanup_stale_trips(db)
    return {"ok": True, "stats": stats}


async def startup_tasks():
    """1. Автоочистка и архивация просроченных поездок.
    2. Запуск периодического цикла автоочистки каждые 15 минут.
    3. Запуск фоновой задачи напоминаний за 1 час до поездки.
    4. Регистрация Telegram webhook с secret_token.
    """
    # --- Автоочистка просроченных поездок при старте ---
    try:
        with database.SessionLocal() as db:
            startup_stats = cleanup_stale_trips(db)
            print(f"[Startup] ✅ Автоочистка поездок выполнена: {startup_stats}")
    except Exception as e:
        logger.error(f"[Startup] Ошибка при автоочистке: {e}")

    # --- Запуск периодического цикла автоочистки ---
    asyncio.create_task(_stale_cleanup_loop())
    print("[AutoCleanup] ✅ Фоновая задача автоочистки поездок запущена (проверка каждые 15 минут)")

    # --- Запуск фоновой задачи напоминаний ---
    asyncio.create_task(_reminder_loop())
    print("[Reminder] ✅ Фоновая задача напоминаний запущена (проверка каждые 60 сек)")

    # --- Telegram webhook ---
    import os
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    # Не подставляем production-домен: локальный запуск с реальным токеном
    # не должен перехватывать webhook у задеплоенного backend.
    render_url = os.environ.get("RENDER_EXTERNAL_URL", "").strip()
    if not token or not render_url:
        print("[Telegram] TELEGRAM_BOT_TOKEN или RENDER_EXTERNAL_URL не заданы — webhook не зарегистрирован")
        return
    webhook_url = f"{render_url}/bot/webhook"
    webhook_payload = {"url": webhook_url}
    if TELEGRAM_WEBHOOK_SECRET:
        webhook_payload["secret_token"] = TELEGRAM_WEBHOOK_SECRET

    async with __import__('httpx').AsyncClient() as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{token}/setWebhook",
            json=webhook_payload
        )
        result = resp.json()
        if result.get("ok"):
            print(f"[Telegram] ✅ Webhook установлен: {webhook_url}")
        else:
            print(f"[Telegram] ❌ Ошибка webhook: {result}")


# debug/telegram-bindings endpoint removed — данные пользователей не должны быть публичными.
