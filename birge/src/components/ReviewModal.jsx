import React, { useState, useEffect, useRef } from 'react';
import { Star, X, Send, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ReviewModal({ partner, onSubmit, onSkip }) {
    const { t } = useTranslation();
    const [rating, setRating] = useState(0);
    const [hover, setHover] = useState(0);
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const dialogRef = useRef(null);

    useEffect(() => {
        const previous = document.activeElement;
        const dialog = dialogRef.current;
        dialog?.querySelector('button, textarea')?.focus();
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onSkip();
                return;
            }
            if (event.key !== 'Tab' || !dialog) return;
            const focusable = [...dialog.querySelectorAll('button:not([disabled]), textarea, input, select, a[href]')]
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
    }, [onSkip]);

    const handleSubmit = async () => {
        if (rating === 0 || submitting) return;
        setSubmitting(true);
        try {
            const ok = await onSubmit(rating, text.trim());
            if (ok !== false) {
                setSubmitted(true);
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) {
        return (
            <div className="modal-overlay">
                <div ref={dialogRef} className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                    <div aria-hidden="true" style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent-border)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                        <CheckCircle2 size={32} />
                    </div>
                    <h3 id="review-title" role="status" style={{ color: 'var(--primary)', marginBottom: '0.5rem' }}>{t('review.thanks')}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('review.community')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && onSkip()}>
            <div ref={dialogRef} className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
                {/* Заголовок */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h3 id="review-title" style={{ color: 'var(--text-main)', fontSize: '1.1rem' }}>{t('review.title')}</h3>
                    <button type="button" onClick={onSkip} aria-label={t('cancel')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                {/* Аватар попутчика */}
                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <img
                        src={partner?.photo || `https://i.pravatar.cc/150?u=${partner?.id}`}
                        alt={partner?.name}
                        style={{ width: 70, height: 70, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent-soft)', marginBottom: '8px' }}
                    />
                    <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{partner?.name || t('matches.passenger')}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('review.how_was_trip')}</div>
                </div>

                {/* Звёзды */}
                <div role="group" aria-label={t('review.title')} style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '1.5rem' }}>
                    {[1, 2, 3, 4, 5].map((star) => (
                        <button
                            key={star}
                            type="button"
                            aria-label={`${star} / 5`}
                            aria-pressed={rating === star}
                            onClick={() => setRating(star)}
                            onMouseEnter={() => setHover(star)}
                            onMouseLeave={() => setHover(0)}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                transition: 'transform 0.1s',
                                transform: (hover || rating) >= star ? 'scale(1.2)' : 'scale(1)',
                            }}
                        >
                            <Star
                                size={36}
                                fill={(hover || rating) >= star ? 'var(--warning)' : 'none'}
                                color={(hover || rating) >= star ? 'var(--warning)' : 'var(--text-muted)'}
                                strokeWidth={1.5}
                            />
                        </button>
                    ))}
                </div>

                {/* Подпись к рейтингу */}
                {(hover || rating) > 0 && (
                    <div style={{ textAlign: 'center', color: 'var(--warning-strong)', fontWeight: 600, fontSize: '0.9rem', marginBottom: '1rem' }}>
                        {[t('review.rating.0'), t('review.terrible'), t('review.bad'), t('review.ok'), t('review.good'), t('review.great')][(hover || rating)]}
                    </div>
                )}

                {/* Комментарий */}
                <label htmlFor="review-comment" className="sr-only">{t('review.placeholder')}</label>
                <textarea
                    id="review-comment"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t('review.placeholder')}
                    rows={3}
                    style={{
                        width: '100%',
                        padding: '10px 14px',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '10px',
                        fontSize: '0.9rem',
                        resize: 'none',
                        outline: 'none',
                        color: 'var(--text-main)',
                        background: 'var(--bg-input)',
                        transition: 'border-color 0.2s',
                        boxSizing: 'border-box',
                        marginBottom: '1rem',
                        fontFamily: 'inherit',
                    }}
                    onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                    onBlur={(e) => e.target.style.borderColor = 'var(--border-subtle)'}
                />

                {/* Кнопки */}
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        type="button"
                        onClick={onSkip}
                        style={{
                            flex: 1,
                            padding: '12px',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '10px',
                            background: 'var(--bg-card)',
                            color: 'var(--text-muted)',
                            fontSize: '0.95rem',
                            cursor: 'pointer',
                        }}
                    >
                        {t('review.skip')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={rating === 0}
                        style={{
                            flex: 2,
                            minHeight: 46,
                            padding: '12px',
                            border: 'none',
                            borderRadius: '12px',
                            background: rating === 0
                                ? 'var(--border-subtle)'
                                : 'var(--primary)',
                            color: rating === 0 ? 'var(--text-subtle)' : 'var(--on-primary)',
                            fontSize: '0.95rem',
                            fontWeight: 700,
                            cursor: rating === 0 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px',
                            transition: 'background-color 0.2s ease',
                        }}
                    >
                        <Send size={16} />
                        {t('review.submit')}
                    </button>
                </div>
            </div>

            <style>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: var(--surface-overlay);
          backdrop-filter: blur(4px);
          z-index: 1000;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          animation: fadeIn 0.2s ease-out;
        }
        .review-modal {
          background: var(--bg-card);
          border-radius: 24px 24px 0 0;
          padding: 1.5rem;
          width: 100%;
          max-width: 480px;
          animation: slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
        </div>
    );
}
