from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, String, Float, DateTime, BigInteger, Text, text
from sqlalchemy.orm import relationship
from sqlalchemy.types import TypeDecorator
from database import Base
from datetime import datetime, timezone
from pii_crypto import decrypt_if_needed, encrypt_if_needed


def _utc_now_naive() -> datetime:
    """Return current UTC time as a naive datetime matching existing DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EncryptedString(TypeDecorator):
    """Transparently encrypt payment PII while keeping the existing VARCHAR schema."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt_if_needed(value)

    def process_result_value(self, value, dialect):
        return decrypt_if_needed(value)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    phone = Column(String, unique=True, index=True)
    photo = Column(String, default="https://i.pravatar.cc/150")
    trust_rating = Column(Float, default=5.0)
    is_verified = Column(Boolean, default=False)
    trips_today = Column(Integer, default=0)
    registered_since = Column(String, default="2024")
    last_trip_date = Column(String) # For daily reset: 'YYYY-MM-DD'
    # Incrementing this value revokes every access/refresh token of the user.
    token_version = Column(Integer, nullable=False, default=0, server_default=text("0"))

    car_model = Column(String)
    car_color = Column(String)
    car_plate = Column(String)
    mbank_phone = Column(EncryptedString)
    elkart_number = Column(EncryptedString)
    is_blocked = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    late_cancellations = Column(Integer, nullable=False, default=0, server_default=text("0"))

    trips = relationship("Trip", back_populates="user")
    reviews = relationship("Review", foreign_keys="[Review.user_id]", back_populates="user")

class Trip(Base):
    __tablename__ = "trips"
    __table_args__ = (
        Index("ix_trips_status_date_role", "status", "date", "role"),
        Index("ix_trips_route_lookup", "role", "origin", "destination", "date"),
        Index("ix_trips_user_status", "user_id", "status"),
        CheckConstraint(
            "seats IS NULL OR (seats >= 1 AND seats <= 8)",
            name="ck_trips_seats_range",
        ),
        CheckConstraint(
            "seats_taken IS NULL OR seats_taken >= 0",
            name="ck_trips_seats_taken_range",
        ),
        CheckConstraint(
            "seats_taken IS NULL OR seats IS NULL OR seats_taken <= seats",
            name="ck_trips_seats_taken_le_seats",
        ),
        CheckConstraint(
            "price_per_seat IS NULL OR (price_per_seat >= 0 AND price_per_seat <= 100000)",
            name="ck_trips_price_range",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    role = Column(String) # 'driver' or 'passenger'
    origin = Column(String)
    destination = Column(String)
    origin_lat = Column(Float, nullable=True)
    origin_lng = Column(Float, nullable=True)
    dest_lat = Column(Float, nullable=True)
    dest_lng = Column(Float, nullable=True)
    time = Column(String)
    status = Column(String, default="active") # active, matched, completed
    date = Column(String)                      # 'YYYY-MM-DD' дата поездки (опц.)
    seats = Column(Integer, default=3)         # макс мест (для водителя)
    seats_taken = Column(Integer, default=0)   # занято мест
    price_per_seat = Column(Integer, default=0) # стоимость одного места в сомах (0 = бесплатно)
    recurrence_days = Column(String(40), nullable=True)  # e.g. '0,1,2,3,4' (Mon..Sun)
    reminder_sent = Column(Boolean, default=False) # True = напоминание уже отправлено (не повторяем при рестарте)
    created_at = Column(DateTime, default=_utc_now_naive)  # UTC, для очистки legacy-поисков

    user = relationship("User", back_populates="trips")

class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        Index("ix_reviews_user_author", "user_id", "author_id"),
        CheckConstraint(
            "rating IS NULL OR (rating >= 1 AND rating <= 5)",
            name="ck_reviews_rating_range",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    author_name = Column(String)
    trip_id = Column(Integer, ForeignKey("trips.id", ondelete="CASCADE"), nullable=True)
    text = Column(String)
    rating = Column(Integer)

    user = relationship("User", foreign_keys=[user_id], back_populates="reviews")
    author = relationship("User", foreign_keys=[author_id])
    trip = relationship("Trip", foreign_keys=[trip_id])

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_trip_id_id", "trip_id", "id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey("trips.id", ondelete="CASCADE"))
    sender_id = Column(Integer, ForeignKey("users.id"))
    text = Column(String)
    timestamp = Column(String)

    trip = relationship("Trip", backref="messages")
    sender = relationship("User")

# Запросы на поездку (пассажир → водитель)
class TripRequest(Base):
    __tablename__ = "trip_requests"
    __table_args__ = (
        Index("ix_trip_requests_trip_status", "trip_id", "status"),
        Index("ix_trip_requests_requester_status", "requester_id", "status"),
        Index("ix_trip_requests_driver_status", "driver_id", "status"),
        Index(
            "uq_trip_requests_active",
            "trip_id",
            "requester_id",
            unique=True,
            sqlite_where=text("status IN ('pending', 'accepted')"),
            postgresql_where=text("status IN ('pending', 'accepted')"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    trip_id = Column(Integer, ForeignKey("trips.id", ondelete="CASCADE"))            # поездка водителя
    requester_trip_id = Column(Integer, ForeignKey("trips.id", ondelete="CASCADE"))  # поездка пассажира
    requester_id = Column(Integer, ForeignKey("users.id"))       # кто запрашивает
    driver_id = Column(Integer, ForeignKey("users.id"))          # кому адресован запрос
    status = Column(String, default="pending")                   # pending, accepted, declined
    created_at = Column(String)

    requester = relationship("User", foreign_keys=[requester_id])
    driver = relationship("User", foreign_keys=[driver_id])


# SMS-коды: хранятся в БД (не теряются при рестарте)
class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
        Index("ix_audit_logs_actor_created", "actor_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=False)
    entity_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utc_now_naive, nullable=False)


class SmsCode(Base):
    __tablename__ = "sms_codes"

    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String, index=True)
    code = Column(String)                              # HMAC-SHA256, never plaintext
    expires_at = Column(DateTime(timezone=True))       # Когда код истекает (5 минут)
    last_sent_at = Column(DateTime(timezone=True))     # Когда последний раз отправляли (rate limit)
    is_used = Column(Boolean, default=False)
    attempts = Column(Integer, default=0)             # Счётчик неверных попыток (защита от brute-force)


class RefreshSession(Base):
    """One issued refresh token; rotation revokes the previous JTI.

    Tokens descended from one login share ``family_id`` so that replaying an
    already-rotated token can revoke the whole family at once.
    """

    __tablename__ = "refresh_sessions"
    __table_args__ = (
        Index("ix_refresh_sessions_user_revoked", "user_id", "revoked_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    jti_hash = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    used_at = Column(DateTime(timezone=True), nullable=True)
    family_id = Column(String(32), index=True)


class LoginCode(Base):
    """Short-lived one-time code exchanged for a token pair (magic links)."""

    __tablename__ = "login_codes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code_hash = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    used_at = Column(DateTime(timezone=True), nullable=True)


# Telegram: привязка номера телефона к chat_id
class TelegramBinding(Base):
    __tablename__ = "telegram_bindings"

    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String, unique=True, index=True)          # "+996 555 123 456" (читаемый формат)
    phone_normalized = Column(String, index=True)             # "996555123456" (только цифры, для быстрого поиска)
    chat_id = Column(BigInteger, index=True)                  # Telegram chat_id (BigInteger для 64-бит ID в PostgreSQL)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class TelegramAuthChallenge(Base):
    """Browser-bound one-time Telegram contact verification challenge."""

    __tablename__ = "telegram_auth_challenges"
    __table_args__ = (
        Index("ix_tg_auth_challenges_chat_status", "chat_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    challenge_hash = Column(String(64), unique=True, nullable=False, index=True)
    verifier_hash = Column(String(64), nullable=False)
    chat_id = Column(BigInteger, nullable=True, index=True)
    phone_e164 = Column(String(24), nullable=True)
    phone_formatted = Column(String(32), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    verified_at = Column(DateTime(timezone=True), nullable=True)
    consumed_at = Column(DateTime(timezone=True), nullable=True)


class AbuseReport(Base):
    """User-submitted safety/conduct report reviewed by allowlisted admins."""

    __tablename__ = "abuse_reports"
    __table_args__ = (
        Index("ix_abuse_reports_status_created", "status", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    target_user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    trip_id = Column(
        Integer,
        ForeignKey("trips.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    reason = Column(String(40), nullable=False)
    details = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="open", server_default=text("'open'"))
    admin_note = Column(Text, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=_utc_now_naive, nullable=False)
    resolved_at = Column(DateTime, nullable=True)

    reporter = relationship("User", foreign_keys=[reporter_id])
    target_user = relationship("User", foreign_keys=[target_user_id])


class FunnelEvent(Base):
    """Anonymized conversion funnel event (search -> request -> accept -> trip -> review)."""

    __tablename__ = "funnel_events"
    __table_args__ = (
        Index("ix_funnel_events_day_stage", "day", "stage"),
    )

    id = Column(Integer, primary_key=True, index=True)
    stage = Column(String(40), nullable=False, index=True)
    role = Column(String(20), nullable=True)
    actor_hash = Column(String(32), nullable=True, index=True)
    day = Column(String(10), nullable=False, index=True)
    meta = Column(String(80), nullable=True)
    created_at = Column(DateTime, default=_utc_now_naive, nullable=False)
