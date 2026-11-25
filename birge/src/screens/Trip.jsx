import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle, MapPin, Navigation, MessageCircle, Star, ShieldCheck,
  Car, Zap, Users, Calendar, XCircle, CreditCard, Smartphone, Copy, Check,
  Map as MapIcon, ChevronDown
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import RealMap from '../components/RealMap';
import Chat from '../components/Chat';
import { api } from '../utils/api';
import { localDateStr } from '../utils/date';
import TripAcceptedCard from '../components/TripAcceptedCard';

export default function Trip({ trip, currentUser, onPanic, onFinish, onCancelled, onNewMessage }) {
  const { t } = useTranslation();
  const [goingNotified, setGoingNotified] = useState(false);
  const [passengers, setPassengers] = useState([]);
  const [seats, setSeats] = useState(trip?.seats || 3);
  const [cancelConfirm, setCancelConfirm] = useState(false); // шаг подтверждения отмены
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedElkart, setCopiedElkart] = useState(false);
  const [driverPayment, setDriverPayment] = useState({
    mbankPhone: trip?.driverMbankPhone || '',
    elkartNumber: trip?.driverElkartNumber || '',
  });
  const [paymentError, setPaymentError] = useState('');
  const [showMap, setShowMap] = useState(false);
  const copiedTimerRef = useRef(null);
  const copiedElkartTimerRef = useRef(null);
  const cancelTimerRef = useRef(null);

  useEffect(() => () => {
    clearTimeout(copiedTimerRef.current);
    clearTimeout(copiedElkartTimerRef.current);
    clearTimeout(cancelTimerRef.current);
  }, []);

  // Определяем: поездка запланирована (дата в будущем)?
  const today = localDateStr();
  const tripDate = trip?.date && trip.date !== 'Сегодня' ? trip.date : today;
  const isScheduled = tripDate > today;

  // Данные: isDriver — определяется строго с проверкой авторства поездки
  const isDriver = trip?.isDriver ?? (trip?.role === 'driver' && (!currentUser?.id || trip?.user_id === currentUser?.id || trip?.userId === currentUser?.id));
  const tripId = trip?.id;

  // Для пассажира: показываем карточку "Поездка принята" при первом входе
  // Ключ хранится в sessionStorage чтобы не показывать повторно при переключении вкладок
  const [showAcceptedCard, setShowAcceptedCard] = useState(() => {
    if (isDriver || !tripId) return false;
    const key = `birge_trip_card_shown_${tripId}`;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
      return true;
    } catch (_) {
      return false;
    }
  });

  // Загружаем список пассажиров для водителя (и обновляем каждые 5 сек)
  useEffect(() => {
    if (!trip?.id || !isDriver) return undefined;
    const load = () => {
      api.getTripPassengers(trip.id).then(data => {
        setPassengers(data.passengers || []);
        setSeats(data.seats || 3);
      }).catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [trip?.id, isDriver]);

  // Реквизиты водителя выдаются только участникам конкретной поездки.
  useEffect(() => {
    if (isDriver || !trip?.id) return;
    api.getTripPayment(trip.id).then(p => {
      if (p) {
        setDriverPayment(prev => ({
          mbankPhone: p.mbank_phone || prev.mbankPhone || p.phone || '',
          elkartNumber: p.elkart_number || prev.elkartNumber || '',
        }));
        setPaymentError('');
      }
    }).catch((e) => setPaymentError(e.message || 'Не удалось загрузить реквизиты'));
  }, [isDriver, trip?.id]);

  const handlePayMbank = () => {
    const targetPhone = driverPayment.mbankPhone;
    if (!targetPhone) {
      setPaymentError('Реквизиты ещё не загружены. Попробуйте через секунду.');
      return;
    }
    setPaymentError('');
    navigator.clipboard?.writeText(targetPhone);
    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 3500);
    // Открываем веб/приложение MBank
    window.open('https://app.mbank.kg/', '_blank', 'noopener,noreferrer');
  };

  const handleCopyElkart = () => {
    const targetCard = driverPayment.elkartNumber;
    if (!targetCard) {
      setPaymentError('Номер карты Элкарт не указан.');
      return;
    }
    setPaymentError('');
    navigator.clipboard?.writeText(targetCard);
    setCopiedElkart(true);
    clearTimeout(copiedElkartTimerRef.current);
    copiedElkartTimerRef.current = setTimeout(() => setCopiedElkart(false), 3000);
  };

  if (!trip) return null;

  const chatRoomId = trip.id;
  const fromLocation = trip.from || trip.origin || '';
  const toLocation = trip.to || trip.destination || '';

  // Для пассажира — партнёр-водитель
  const partner = trip.user || {};
  const partnerName = isDriver
    ? (passengers.length > 0 ? `${passengers.length} пассажира` : 'Ждём пассажиров...')
    : (partner.name || 'Водитель');
  const partnerPhoto = partner.photo || `https://i.pravatar.cc/150?u=${trip.user_id}`;
  const partnerRating = partner.trust_rating || 5.0;
  const partnerVerified = partner.is_verified || false;

  // Данные машины (только для пассажира)
  const carModel = trip.driverCarModel;
  const carPlate = trip.driverCarPlate;
  const carColor = trip.driverCarColor;

  const sendGoingMessage = async () => {
    try {
      await api.sendChatMessage(chatRoomId, 'Выезжаю! Буду ориентировочно через 5 минут. Пожалуйста, выходите.');
      setGoingNotified(true);
    } catch (_) {
      // Не показываем ложный успех, если сообщение не доставлено.
    }
  };

  /** Пассажир отменяет свою поездку */
  const handleCancelTrip = async () => {
    if (!cancelConfirm) {
      // Первый тап — показываем кнопку подтверждения
      setCancelConfirm(true);
      clearTimeout(cancelTimerRef.current);
      // Авто-сброс через 4 сек (не нажал — передумал)
      cancelTimerRef.current = setTimeout(() => setCancelConfirm(false), 4000);
      return;
    }
    // Второй тап — подтверждение получено, отменяем
    setCancelling(true);
    setCancelError('');
    try {
      await api.updateTripStatus(trip.id, isDriver ? 'cancelled' : 'passenger_cancelled');
      // Отмена — это не завершение поездки: не показываем модал отзыва.
      if (onCancelled) onCancelled();
      else onFinish();
    } catch (e) {
      // Не закрываем экран, если сервер не подтвердил отмену.
      setCancelError(e.message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="trip screen-content">

      {/* Карточка "Поездка принята" — только для пассажира, только при первом открытии */}
      {showAcceptedCard && !isDriver && (
        <TripAcceptedCard
          trip={trip}
          onDismiss={() => setShowAcceptedCard(false)}
        />
      )}

      {/* Заголовок поездки */}
      <div className="trip-header glass-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '3px', fontWeight: 800 }}>{t('trip.title')}</h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{trip.date || 'Сегодня'} · {trip.time}</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: isScheduled ? 'var(--info-soft)' : 'var(--accent-soft)',
              color: isScheduled ? 'var(--info-strong)' : 'var(--primary-hover)',
              padding: '2px 10px', borderRadius: 20,
              fontSize: '0.72rem', fontWeight: 600, marginTop: 5
            }}>
              {isScheduled ? (
                <><Calendar size={11} /> Запланировано</>
              ) : (
                <><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} /> В процессе</>
              )}
            </div>
          </div>
          {!isScheduled && (
            <button type="button" className="panic-btn" onClick={onPanic} title="Тревожная кнопка" aria-label="Отправить сигнал тревоги">
              <AlertTriangle size={20} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Для ВОДИТЕЛЯ — счётчик мест + список пассажиров */}
        {isDriver ? (
          <div className="passengers-section">
            <div className="seats-counter">
              <Users size={14} color="var(--primary)" />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                {passengers.length} / {seats} пассажиров
              </span>
              <div className="seats-dots">
                {Array.from({ length: seats }).map((_, i) => (
                  <div key={i} className={`seat-dot ${i < passengers.length ? 'taken' : 'free'}`} />
                ))}
              </div>
            </div>

            {passengers.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', margin: '8px 0' }}>
                Ожидаем пассажиров...
              </p>
            ) : (
              <div className="passengers-list">
                {passengers.map(p => (
                  <div key={p.id} className="passenger-row">
                    <img src={p.photo || `https://i.pravatar.cc/40?u=${p.id}`} alt={p.name}
                      style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--accent-soft)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>{p.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Star size={10} fill="var(--warning)" color="var(--warning)" />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.trust_rating?.toFixed(1)}</span>
                        {p.is_verified && <ShieldCheck size={11} color="var(--primary)" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Кнопка "Выезжаю!" — только если поездка сегодня */}
            {isScheduled ? (
              <div style={{
                textAlign: 'center',
                background: 'var(--bg-subtle)',
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: '0.82rem',
                color: 'var(--text-muted)',
                fontWeight: 600,
              }}>
                Кнопка «Выезжаю» станет активна в день отправления
              </div>
            ) : (
              <button
                type="button"
                className={`going-btn ${goingNotified ? 'going-btn-done' : ''}`}
                disabled={goingNotified || passengers.length === 0}
                onClick={sendGoingMessage}
              >
                {goingNotified ? 'Уведомление отправлено' : <><Zap size={15} /> Уведомить всех — Выезжаю</>}
              </button>
            )}
          </div>
        ) : (
          /* Для ПАССАЖИРА — карточка водителя */
          <div className="partner-card">
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <img src={partnerPhoto} alt={partnerName}
                style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--bg-card)', boxShadow: '0 2px 8px var(--shadow-medium)' }} />
              {partnerVerified && (
                <div style={{ position: 'absolute', bottom: -2, right: -2, background: 'var(--primary)', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg-card)' }}>
                  <ShieldCheck size={9} color='var(--on-primary)' />
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>{partnerName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <Star size={11} fill="var(--warning)" color="var(--warning)" />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{partnerRating.toFixed(1)}</span>
              </div>
              {carModel && (
                <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--accent-soft)', border: '1px solid var(--accent-soft)', borderRadius: 8, padding: '2px 8px' }}>
                    <Car size={11} color="var(--primary)" />
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)' }}>
                      {carModel}{carColor ? ` · ${carColor}` : ''}
                    </span>
                  </div>
                  {carPlate && (
                    <div style={{ background: 'var(--inverse-surface)', color: 'var(--inverse-text)', borderRadius: 6, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.5px' }}>
                      {carPlate}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <MapPin size={11} color="var(--primary)" /> {fromLocation}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Navigation size={11} color="var(--danger)" /> {toLocation}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Баннер запланированной поездки */}
      {isScheduled && (
        <div className="trip-scheduled-banner">
          <div className="trip-scheduled-icon">
            <Calendar size={20} color="var(--on-primary)" />
          </div>
          <div>
            <div className="trip-scheduled-title">Поездка запланирована</div>
            <div className="trip-scheduled-sub">{trip.date} в {trip.time} — ждём дня поездки</div>
          </div>
        </div>
      )}

      {/* Карта (раскрывается по нажатию, чтобы не перехватывать скролл и не занимать экран чата) */}
      <div className="trip-map-box">
        <button
          type="button"
          className="trip-map-toggle"
          onClick={() => setShowMap((prev) => !prev)}
          aria-expanded={showMap}
        >
          <span className="trip-map-toggle-left">
            <MapIcon size={16} aria-hidden="true" />
            <span>{showMap ? 'Скрыть карту маршрута' : 'Показать маршрут на карте'}</span>
          </span>
          <ChevronDown
            size={17}
            className={`trip-map-chevron ${showMap ? 'open' : ''}`}
            aria-hidden="true"
          />
        </button>
        {showMap && (
          <div style={{ borderRadius: 14, overflow: 'hidden', marginTop: 10 }}>
            <RealMap from={fromLocation} to={toLocation} height="200px" />
          </div>
        )}
      </div>

      {/* Чат — групповой для водителя, 1-на-1 для пассажира */}
      <div className="trip-chat">
        <h3 style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
          <MessageCircle size={15} />
          {isDriver && passengers.length > 1 ? `Групповой чат (${passengers.length})` : t('trip.chat')}
        </h3>
        <Chat tripId={chatRoomId} currentUser={currentUser} partnerName={partnerName} onNewMessage={onNewMessage} />
      </div>

      {/* Оплата / компенсация расходов (для пассажира) */}
      {!isDriver && (
        <div className="trip-payment-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="trip-payment-icon">
                <CreditCard size={18} />
              </div>
              <div>
                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  {t('payment.title')}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {(trip.price_per_seat || trip.price || 0) > 0
                    ? `${trip.price_per_seat || trip.price} сом ${t('payment.per_seat')}`
                    : 'Бесплатно / добровольно'}
                </div>
              </div>
            </div>
            {(trip.price_per_seat || trip.price || 0) > 0 && (
              <span style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }}>
                {trip.price_per_seat || trip.price} <span style={{ fontSize: '0.82rem' }}>сом</span>
              </span>
            )}
          </div>

          {paymentError && (
            <p style={{ fontSize: '0.78rem', color: 'var(--warning-strong)', margin: '0 0 4px', fontWeight: 600 }}>
              {paymentError}
            </p>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={handlePayMbank} className="trip-mbank-btn">
              <Smartphone size={16} />
              <span>{copied ? t('payment.copied') : t('payment.mbank_btn')}</span>
            </button>

            {driverPayment.elkartNumber ? (
              <button type="button" onClick={handleCopyElkart} className="trip-elkart-btn">
                {copiedElkart ? <Check size={16} color="var(--primary)" /> : <Copy size={16} />}
                <span>{copiedElkart ? 'Скопировано!' : 'Элкарт'}</span>
              </button>
            ) : null}
          </div>

          {copied && (
            <p style={{ fontSize: '0.78rem', color: 'var(--primary)', textAlign: 'center', margin: 0, fontWeight: 600 }}>
              Номер {driverPayment.mbankPhone} скопирован в буфер. Открываем MBank...
            </p>
          )}
        </div>
      )}

      {/* Действия */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Кнопка Отмены — только для ПАССАЖИРА */}
        {!isDriver && (
          <>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '13px 20px',
                background: cancelConfirm
                  ? 'var(--danger)'
                  : 'var(--danger-soft)',
                color: cancelConfirm ? 'var(--on-primary)' : 'var(--danger)',
                border: `1.5px solid ${cancelConfirm ? 'var(--danger)' : 'var(--danger-border)'}`,
                borderRadius: 14,
                fontSize: '0.92rem',
                fontWeight: 700,
                cursor: cancelling ? 'wait' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: cancelConfirm ? '0 4px 14px var(--danger-border)' : 'none',
              }}
              onClick={handleCancelTrip}
              disabled={cancelling}
            >
              <XCircle size={18} />
              {cancelling
                ? 'Отменяем...'
                : cancelConfirm
                ? 'Нажмите еще раз для подтверждения'
                : 'Отменить поездку'}
            </button>
            {cancelError && (
              <p style={{ color: 'var(--danger)', fontSize: '0.78rem', margin: 0, textAlign: 'center' }}>
                {cancelError}
              </p>
            )}
          </>
        )}

        {/* Завершить — только в день поездки */}
        {!isScheduled && (
          <button type="button" className="primary-btn finish-btn" onClick={onFinish}>
            {isDriver ? 'Завершить поездку' : 'Поездка завершена'}
          </button>
        )}

      </div>

      <style>{`
        .trip { display: flex; flex-direction: column; gap: 0.85rem; }
        .panic-btn {
          background: var(--danger-soft); color: var(--danger); border: 1px solid var(--danger-border);
          width: 44px; height: 44px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: background-color 0.2s ease; flex-shrink: 0;
        }
        .panic-btn:hover { background: var(--danger-border); }

        .trip-scheduled-banner {
          background: var(--info-soft);
          border: 1px solid var(--info-border);
          border-radius: 16px;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .trip-scheduled-icon {
          width: 40px; height: 40px; border-radius: 12px;
          background: var(--info-strong);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .trip-scheduled-title { font-weight: 800; font-size: 0.9rem; color: var(--info-strong); }
        .trip-scheduled-sub { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }

        .trip-map-box {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 16px;
          padding: 10px 12px;
        }
        .trip-map-toggle {
          width: 100%;
          min-height: 38px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          border: none;
          padding: 2px;
          background: transparent;
          color: var(--text-main);
          font: inherit;
          font-size: 0.84rem;
          font-weight: 700;
          cursor: pointer;
        }
        .trip-map-toggle-left {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .trip-map-toggle-left svg { color: var(--primary); }
        .trip-map-chevron { color: var(--text-subtle); transition: transform 0.2s ease; }
        .trip-map-chevron.open { transform: rotate(180deg); }

        .trip-payment-card {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 18px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          box-shadow: var(--card-shadow);
        }
        .trip-payment-icon {
          width: 34px; height: 34px; border-radius: 10px;
          background: var(--accent-soft);
          color: var(--primary);
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .trip-mbank-btn {
          flex: 1;
          min-width: 150px;
          min-height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 14px;
          background: var(--info-strong);
          color: var(--on-primary);
          border: none;
          border-radius: 12px;
          font-size: 0.88rem;
          font-weight: 700;
          cursor: pointer;
          transition: opacity 0.15s ease;
        }
        .trip-mbank-btn:hover { opacity: 0.92; }
        .trip-elkart-btn {
          min-height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 14px;
          background: var(--bg-subtle);
          color: var(--primary);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          font-size: 0.86rem;
          font-weight: 700;
          cursor: pointer;
        }

        /* Passengers section (driver) */
        .passengers-section { margin-top: 12px; }
        .seats-counter {
          display: flex; align-items: center; gap: 8px;
          background: var(--bg-subtle); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 8px 12px;
          margin-bottom: 10px;
        }
        .seats-dots { display: flex; gap: 4px; margin-left: auto; }
        .seat-dot {
          width: 12px; height: 12px; border-radius: 3px;
          transition: background-color 0.2s ease;
        }
        .seat-dot.taken { background: var(--primary); }
        .seat-dot.free { background: var(--border-strong); }

        .passengers-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
        .passenger-row {
          display: flex; align-items: center; gap: 10px;
          background: var(--bg-subtle); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 8px 10px;
        }

        /* Going button */
        .going-btn {
          width: 100%; min-height: 44px; padding: 10px 16px;
          background: var(--primary);
          color: var(--on-primary); border: none; border-radius: 12px;
          font-size: 0.88rem; font-weight: 700;
          cursor: pointer; transition: background-color 0.2s ease;
          display: flex; align-items: center; justify-content: center; gap: 7px;
        }
        .going-btn:hover:not(:disabled) { background: var(--primary-hover); }
        .going-btn:disabled:not(.going-btn-done) { background: var(--border-subtle); color: var(--text-subtle); cursor: default; }
        .going-btn-done { background: var(--accent-soft) !important; color: var(--primary) !important; cursor: default !important; }

        /* Partner card (passenger) */
        .partner-card {
          display: flex; align-items: flex-start; gap: 10px;
          background: var(--bg-subtle); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 10px 12px; margin-top: 10px;
        }

        .trip-chat { display: flex; flex-direction: column; }
        .finish-btn {
          background: var(--danger) !important;
          box-shadow: none !important;
        }
      `}</style>
    </div>
  );
}
