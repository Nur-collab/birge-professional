from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import List, Optional, Literal
from datetime import datetime

# --- Input Schemas ---
class SendCodeRequest(BaseModel):
    phone: str = Field(..., min_length=4, max_length=32)

class VerifyCodeRequest(BaseModel):
    phone: str = Field(..., min_length=4, max_length=32)
    code: str = Field(..., min_length=4, max_length=8)

class ExchangeCodeRequest(BaseModel):
    code: str = Field(..., min_length=20, max_length=128)


class RefreshTokenRequest(BaseModel):
    refresh_token: Optional[str] = Field(default=None, min_length=16, max_length=2048)


class TelegramChallengeResponse(BaseModel):
    challenge_id: str
    verifier: str
    bot_username: str
    telegram_url: str
    expires_in: int


class TelegramChallengeStatusRequest(BaseModel):
    challenge_id: str = Field(..., min_length=16, max_length=128)
    verifier: str = Field(..., min_length=20, max_length=128)


class TelegramChallengeStatusResponse(BaseModel):
    status: Literal["pending", "bot_started", "verified", "expired"]
    phone: Optional[str] = None
    is_new_user: bool = False
    expires_in: int = 0


class TelegramChallengeCompleteRequest(BaseModel):
    challenge_id: str = Field(..., min_length=16, max_length=128)
    verifier: str = Field(..., min_length=20, max_length=128)
    name: Optional[str] = Field(default=None, max_length=80)


class TripStatusUpdate(BaseModel):
    status: Literal["active", "matched", "in_progress", "completed", "cancelled", "passenger_cancelled"]

class TripRequestCreate(BaseModel):
    trip_id: int = Field(..., gt=0)
    requester_trip_id: Optional[int] = Field(None, gt=0)
    driver_id: Optional[int] = Field(None, gt=0)

class TripRequestStatusUpdate(BaseModel):
    status: Literal["accepted", "declined"]

# --- User Schemas ---
class ReviewBase(BaseModel):
    text: str = Field(default="", max_length=1000)
    rating: int = Field(..., ge=1, le=5)

class ReviewCreate(ReviewBase):
    """Клиент передаёт target user_id, rating и text. Опционально trip_id."""
    user_id: int = Field(..., gt=0)
    trip_id: Optional[int] = Field(None, gt=0)

class Review(BaseModel):
    """Ответ API; без input-валидаторов для совместимости со старыми отзывами."""
    id: int
    user_id: int
    author_id: Optional[int] = None
    author_name: Optional[str] = ""
    trip_id: Optional[int] = None
    text: Optional[str] = ""
    rating: Optional[int] = 5

    model_config = ConfigDict(from_attributes=True)

class UserBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    phone: str = Field(..., min_length=4, max_length=32)
    photo: Optional[str] = Field("https://i.pravatar.cc/150", max_length=1000)
    car_model: Optional[str] = Field(None, max_length=80)
    car_color: Optional[str] = Field(None, max_length=40)
    car_plate: Optional[str] = Field(None, max_length=20)
    mbank_phone: Optional[str] = Field(None, max_length=32)
    elkart_number: Optional[str] = Field(None, max_length=32)

class UserPublic(BaseModel):
    """Публичный профиль без телефона и платёжных реквизитов."""
    id: int
    name: Optional[str] = ""
    photo: Optional[str] = "https://i.pravatar.cc/150"
    trust_rating: float = 5.0
    is_verified: bool = False
    car_model: Optional[str] = None
    car_color: Optional[str] = None
    car_plate: Optional[str] = None
    registered_since: Optional[str] = "2024"
    late_cancellations: int = 0

    model_config = ConfigDict(from_attributes=True)

class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    photo: Optional[str] = Field(None, max_length=1000)
    car_model: Optional[str] = Field(None, max_length=80)
    car_color: Optional[str] = Field(None, max_length=40)
    car_plate: Optional[str] = Field(None, max_length=20)
    mbank_phone: Optional[str] = Field(None, max_length=32)
    elkart_number: Optional[str] = Field(None, max_length=32)

class UserCreate(UserBase):
    pass

class User(BaseModel):
    """Профиль владельца; допускает NULL в legacy-записях."""
    id: int
    name: Optional[str] = ""
    phone: Optional[str] = ""
    photo: Optional[str] = "https://i.pravatar.cc/150"
    trust_rating: float = 5.0
    is_verified: bool = False
    trips_today: int = 0
    registered_since: Optional[str] = "2024"
    car_model: Optional[str] = None
    car_color: Optional[str] = None
    car_plate: Optional[str] = None
    mbank_phone: Optional[str] = None
    elkart_number: Optional[str] = None
    is_blocked: bool = False
    late_cancellations: int = 0
    is_admin: bool = False
    reviews: List[Review] = []

    model_config = ConfigDict(from_attributes=True)

# --- Trip Schemas ---
class TripBase(BaseModel):
    role: Literal["driver", "passenger"]
    origin: str = Field(..., min_length=2, max_length=120)
    destination: str = Field(..., min_length=2, max_length=120)
    time: str = Field(..., pattern=r"^\d{1,2}:\d{2}$")
    date: Optional[str] = None          # 'YYYY-MM-DD', None = без привязки к дате
    seats: int = Field(3, ge=1, le=8)   # макс мест (для водителя)
    price_per_seat: int = Field(0, ge=0, le=100000)  # стоимость места в сомах (0 = бесплатно)
    recurrence_days: Optional[str] = Field(None, max_length=40)

    @field_validator("recurrence_days")
    @classmethod
    def _normalize_recurrence_days(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        parts = [p.strip() for p in str(value).split(",") if p.strip()]
        if not parts:
            return None
        days: list[int] = []
        for p in parts:
            if not p.isdigit():
                raise ValueError("recurrence_days must contain comma-separated weekdays 0..6")
            d = int(p)
            if d < 0 or d > 6:
                raise ValueError("recurrence_days values must be between 0 (Mon) and 6 (Sun)")
            if d not in days:
                days.append(d)
        return ",".join(str(d) for d in sorted(days))

    @field_validator("date")
    @classmethod
    def _validate_date(cls, value: Optional[str]) -> Optional[str]:
        if value in (None, ""):
            return None
        try:
            parsed = datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError as exc:
            raise ValueError("date must be in YYYY-MM-DD format") from exc
        return parsed.isoformat()

    @field_validator("time")
    @classmethod
    def _normalize_time(cls, value: str) -> str:
        hours, minutes = (int(part) for part in value.split(":"))
        if not (0 <= hours < 24 and 0 <= minutes < 60):
            raise ValueError("time must be a valid 24-hour time")
        return f"{hours:02d}:{minutes:02d}"

class TripCreate(TripBase):
    origin_lat: Optional[float] = Field(None, ge=-90, le=90)
    origin_lng: Optional[float] = Field(None, ge=-180, le=180)
    dest_lat: Optional[float] = Field(None, ge=-90, le=90)
    dest_lng: Optional[float] = Field(None, ge=-180, le=180)

class Trip(BaseModel):
    """Ответ API. Без input-валидаторов: в БД могут быть legacy-форматы времени."""
    id: int
    user_id: int
    role: str
    origin: str
    destination: str
    origin_lat: Optional[float] = None
    origin_lng: Optional[float] = None
    dest_lat: Optional[float] = None
    dest_lng: Optional[float] = None
    time: str
    date: Optional[str] = None
    seats: int = 3
    seats_taken: int = 0
    price_per_seat: int = 0
    recurrence_days: Optional[str] = None
    status: str
    match_type: Optional[str] = None
    detour_km: Optional[float] = None
    distance_km: Optional[float] = None
    eta_minutes: Optional[int] = None
    user: Optional[UserPublic] = None   # Защита от утечки телефонов и платёжных данных в поиске!

    model_config = ConfigDict(from_attributes=True)


class GeocodeResult(BaseModel):
    label: str
    lat: float
    lng: float
    source: str


class RoutePreviewResponse(BaseModel):
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float
    distance_km: float
    eta_minutes: int
    geometry: List[List[float]]
    source: str

# --- Chat Schemas ---
class ChatMessageInput(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)

class ChatMessageBase(BaseModel):
    trip_id: int = Field(..., gt=0)
    text: str = Field(..., min_length=1, max_length=1000)
    timestamp: str = Field(..., max_length=40)

class ChatMessageCreate(ChatMessageBase):
    pass

class ChatMessage(ChatMessageBase):
    id: int
    sender_id: int
    sender: Optional[UserPublic] = None

    model_config = ConfigDict(from_attributes=True)


class ExportedTripRequest(BaseModel):
    id: int
    trip_id: Optional[int] = None
    requester_trip_id: Optional[int] = None
    requester_id: Optional[int] = None
    driver_id: Optional[int] = None
    status: Optional[str] = None
    created_at: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ExportedChatMessage(BaseModel):
    id: int
    trip_id: Optional[int] = None
    text: str
    timestamp: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UserDataExport(BaseModel):
    exported_at: str
    profile: User
    telegram_linked: bool
    trips: List[Trip] = []
    trip_requests: List[ExportedTripRequest] = []
    reviews_received: List[Review] = []
    reviews_written: List[Review] = []
    chat_messages: List[ExportedChatMessage] = []


class AccountDeleteResponse(BaseModel):
    ok: bool = True
    deleted: bool = True
    cancelled_trips: int = 0
    released_bookings: int = 0


ReportReason = Literal[
    "no_show",
    "unsafe_driving",
    "rude_behavior",
    "payment_issue",
    "spam",
    "other",
]
ReportStatus = Literal["open", "reviewed", "resolved", "dismissed"]


class AbuseReportCreate(BaseModel):
    target_user_id: int = Field(..., gt=0)
    trip_id: Optional[int] = Field(None, gt=0)
    reason: ReportReason
    details: str = Field(default="", max_length=1000)


class AbuseReportOut(BaseModel):
    id: int
    reporter_id: Optional[int] = None
    reporter_name: Optional[str] = None
    target_user_id: int
    target_name: Optional[str] = None
    trip_id: Optional[int] = None
    reason: str
    details: Optional[str] = None
    status: str
    admin_note: Optional[str] = None
    target_is_blocked: bool = False
    created_at: Optional[str] = None
    resolved_at: Optional[str] = None


class AbuseReportModerationUpdate(BaseModel):
    status: ReportStatus
    admin_note: Optional[str] = Field(None, max_length=500)
    block_target: Optional[bool] = None


class FunnelStageSummary(BaseModel):
    stage: str
    events_count: int
    unique_actors: int
    conversion_from_prev_pct: float
    conversion_from_search_pct: float


class FunnelDaySummary(BaseModel):
    day: str
    counts: dict[str, int]


class FunnelSummaryResponse(BaseModel):
    days: int
    since_day: str
    stages: List[FunnelStageSummary]
    by_day: List[FunnelDaySummary]
