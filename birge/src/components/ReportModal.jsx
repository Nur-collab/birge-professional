import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Flag, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import './ReviewModal.css';
import './ReportModal.css';

const REPORT_REASONS = [
  { id: 'no_show', labelKey: 'report.reason_no_show' },
  { id: 'unsafe_driving', labelKey: 'report.reason_unsafe' },
  { id: 'rude_behavior', labelKey: 'report.reason_rude' },
  { id: 'payment_issue', labelKey: 'report.reason_payment' },
  { id: 'spam', labelKey: 'report.reason_spam' },
  { id: 'other', labelKey: 'report.reason_other' },
];

export default function ReportModal({ targetUser, tripId = null, onClose }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('no_show');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [onClose, submitting]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!targetUser?.id || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await api.submitReport({
        target_user_id: targetUser.id,
        trip_id: tripId,
        reason,
        details: details.trim(),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err?.message || t('report.submit_error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && !submitting && onClose()}>
      <div
        ref={dialogRef}
        className="review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
      >
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>
            <div style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'var(--accent-soft)', color: 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 12px',
            }}>
              <CheckCircle2 size={28} aria-hidden="true" />
            </div>
            <h3 id="report-modal-title" style={{ margin: '0 0 6px', color: 'var(--text-main)' }}>
              {t('report.sent_title')}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
              {t('report.sent_desc')}
            </p>
            <button type="button" className="primary-btn" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Flag size={18} color="var(--danger)" aria-hidden="true" />
                <h3 id="report-modal-title" style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                  {t('report.title', { name: targetUser?.name || t('matches.driver') })}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                aria-label={t('cancel')}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="report-modal-reasons" role="radiogroup" aria-label={t('report.reason_label')}>
              {REPORT_REASONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={reason === item.id}
                  className={`report-reason-btn ${reason === item.id ? 'active' : ''}`}
                  onClick={() => setReason(item.id)}
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>

            <textarea
              className="report-details-input"
              rows={3}
              maxLength={1000}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={t('report.details_placeholder')}
              aria-label={t('report.details_placeholder')}
            />

            {error && (
              <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.8rem', margin: '0 0 10px', fontWeight: 600 }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              className="primary-btn"
              disabled={submitting}
              aria-busy={submitting}
              style={{ background: 'var(--danger)' }}
            >
              {submitting ? t('report.sending') : t('report.submit_btn')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
