import React, { useEffect, useRef, useState } from 'react';
import { Star, Check, X, Clock, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './TripRequestModal.css';

const AUTO_DECLINE_SECONDS = 30;

export default function TripRequestModal({ request, onAccept, onDecline }) {
    const { t } = useTranslation();
    const [timeLeft, setTimeLeft] = useState(AUTO_DECLINE_SECONDS);
    const dialogRef = useRef(null);

    useEffect(() => {
        const previous = document.activeElement;
        dialogRef.current?.querySelector('[data-autofocus]')?.focus();
        const onKeyDown = (event) => {
            if (event.key === 'Escape' && request) {
                event.preventDefault();
                onDecline(request.id);
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = [...dialogRef.current.querySelectorAll('button:not([disabled]), [href], input, select, textarea')]
                .filter((element) => element.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previous?.focus?.();
        };
    }, [request?.id]);

    // Таймер: если водитель не ответил за 30 сек — автоотклонение
    useEffect(() => {
        if (!request) return undefined;
        setTimeLeft(AUTO_DECLINE_SECONDS);
        const timer = setInterval(() => {
            setTimeLeft((prev) => (prev <= 1 ? 0 : prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [request?.id]);

    useEffect(() => {
        if (request && timeLeft === 0) {
            onDecline(request.id);
        }
    }, [request, timeLeft, onDecline]);

    if (!request) return null;

    const progress = (timeLeft / AUTO_DECLINE_SECONDS) * 100;
    const urgency = timeLeft <= 10;

    return (
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="trip-request-title"
            aria-describedby="trip-request-desc"
            style={{
                position: 'fixed', inset: 0,
                background: 'var(--surface-overlay)',
                zIndex: 1000,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '1rem',
                backdropFilter: 'blur(6px)',
            }}
        >
            <div style={{
                background: 'var(--bg-card)', borderRadius: '24px', padding: '1.5rem',
                width: '100%', maxWidth: '360px',
                boxShadow: '0 24px 70px var(--shadow-strong)',
                animation: 'req-slide-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                position: 'relative', overflow: 'hidden',
            }}>

                {/* Прогресс-бар вверху (тает по мере истечения времени) */}
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
                    background: 'var(--border-subtle)', borderRadius: '24px 24px 0 0',
                }}>
                    <div style={{
                        height: '100%', borderRadius: '24px 0 0 0',
                        background: urgency ? 'var(--danger)' : 'var(--primary)',
                        width: `${progress}%`,
                        transition: 'width 1s linear, background-color 0.5s ease',
                    }} />
                </div>

                {/* Иконка-пульс */}
                <div style={{ textAlign: 'center', marginBottom: '1.2rem', paddingTop: '0.5rem' }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: '50%',
                        background: urgency ? 'var(--danger)' : 'var(--primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 0.75rem',
                        animation: urgency ? 'req-urgent-pulse 1s ease-in-out infinite' : 'req-ring-pulse 2s ease-in-out infinite',
                    }}>
                        <User size={26} color='var(--on-primary)' />
                    </div>
                    <h3 id="trip-request-title" style={{ color: 'var(--text-main)', margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
                        {t('modal.request_title')}
                    </h3>
                    <p id="trip-request-desc" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                        {t('modal.request_desc')}
                    </p>
                    {/* Таймер */}
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        marginTop: '6px',
                        padding: '4px 12px', borderRadius: '20px',
                        background: urgency ? 'var(--danger-soft)' : 'var(--bg-subtle)',
                        color: urgency ? 'var(--danger-strong)' : 'var(--primary-hover)',
                        fontSize: '0.82rem', fontWeight: 700,
                    }}>
                        <Clock size={13} />
                        {urgency
                            ? t('modal.request_urgent', { seconds: timeLeft })
                            : t('modal.request_auto_decline', { seconds: timeLeft })}
                    </div>
                </div>

                {/* Информация о пассажире */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    background: 'var(--bg-input)', borderRadius: '14px', padding: '14px',
                    marginBottom: '1rem',
                    border: '1.5px solid var(--border-subtle)',
                }}>
                    <img
                        src={request.requester_photo || `https://i.pravatar.cc/80?u=${request.requester_id}`}
                        alt={request.requester_name}
                        style={{
                            width: 56, height: 56, borderRadius: '50%',
                            objectFit: 'cover', border: '2.5px solid var(--accent-soft)',
                            boxShadow: '0 2px 8px var(--shadow-medium)',
                        }}
                    />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '1.05rem' }}>
                            {request.requester_name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--warning)', fontSize: '0.85rem', marginTop: '3px' }}>
                            <Star size={13} fill="var(--warning)" />
                            <span style={{ fontWeight: 600 }}>{(request.requester_rating || 5.0).toFixed(1)}</span>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{t('profile.rating')}</span>
                        </div>
                    </div>
                </div>

                {/* Маршрут */}
                <div style={{
                    background: 'var(--accent-soft)', borderRadius: '12px', padding: '12px 14px',
                    marginBottom: '1.2rem', fontSize: '0.88rem',
                    border: '1px solid var(--accent-soft)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '8px', color: 'var(--text-muted)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 500 }}>{request.origin}</span>
                    </div>
                    <div style={{ width: 1, height: 12, background: 'var(--accent-border)', marginLeft: 3, marginBottom: 8 }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '8px', color: 'var(--text-muted)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 500 }}>{request.destination}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', marginTop: 4 }}>
                        <Clock size={13} />
                        <span>{request.time}</span>
                    </div>
                </div>

                {/* Кнопки */}
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        onClick={() => onDecline(request.id)}
                        style={{
                            flex: 1, padding: '13px', border: '1.5px solid var(--border-subtle)',
                            borderRadius: '14px', background: 'var(--bg-card)',
                            color: 'var(--text-muted)', fontWeight: 600, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            fontSize: '0.95rem', transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-soft)'; e.currentTarget.style.borderColor = 'var(--danger-border)'; e.currentTarget.style.color = 'var(--danger)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-card)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                    >
                        <X size={18} /> {t('modal.decline')}
                    </button>
                    <button
                        type="button"
                        data-autofocus
                        onClick={() => onAccept(request.id, request.trip_id, request.requester_id, request.requester_trip_id)}
                        style={{
                            flex: 2, minHeight: 46, padding: '12px', border: 'none',
                            borderRadius: '14px',
                            background: 'var(--primary)',
                            color: 'var(--on-primary)', fontWeight: 800, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            fontSize: '0.95rem', transition: 'background-color 0.2s ease',
                            letterSpacing: '0.3px',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--primary-hover)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--primary)'; }}
                    >
                        <Check size={18} /> {t('modal.accept')}
                    </button>
                </div>
            </div>
        </div>
    );
}
