import React from 'react';
import { ChevronDown, CreditCard, Minus, Plus, Repeat, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const WEEKDAY_INDICES = [0, 1, 2, 3, 4, 5, 6];

export default function DriverParameters({
  showDetails,
  onToggleDetails,
  seats,
  onChangeSeats,
  price,
  onChangePrice,
  recurrenceDays = [],
  onToggleRecurrenceDay,
}) {
  const { t } = useTranslation();

  const seatWord = seats === 1
    ? t('dash.seat_one')
    : seats < 5
      ? t('dash.seat_few')
      : t('dash.seat_many');

  return (
    <>
      <button
        type="button"
        className="compact-disclosure driver-summary"
        onClick={onToggleDetails}
        aria-expanded={showDetails}
        aria-controls="driver-parameters-panel"
      >
        <span className="compact-disclosure-main">
          <Users size={16} aria-hidden="true" />
          <span>{t('dash.trip_details')}</span>
        </span>
        <span className="driver-summary-value">
          {seats} {seatWord} · {price > 0 ? `${price} ${t('common.som')}` : t('dash.free_lower')}
        </span>
        <ChevronDown
          size={17}
          className={`compact-disclosure-chevron ${showDetails ? 'open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {showDetails && (
        <div className="driver-parameters-card" id="driver-parameters-panel">
          <div className="parameter-row">
            <div className="param-label-group">
              <Users size={16} className="text-muted" />
              <span className="param-title">{t('dash.seats_free')}</span>
            </div>
            <div className="stepper-box">
              <button
                type="button"
                className="stepper-btn"
                onClick={() => onChangeSeats(Math.max(1, seats - 1))}
                disabled={seats <= 1}
                aria-label={t('dash.seats_dec_aria')}
              >
                <Minus size={14} aria-hidden="true" />
              </button>
              <span
                className="stepper-value"
                role="status"
                aria-live="polite"
                aria-label={t('dash.seats_count_aria', { count: seats })}
              >
                {seats}
              </span>
              <button
                type="button"
                className="stepper-btn"
                onClick={() => onChangeSeats(Math.min(8, seats + 1))}
                disabled={seats >= 8}
                aria-label={t('dash.seats_inc_aria')}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="parameter-row">
            <div className="param-label-group">
              <CreditCard size={16} className="text-muted" />
              <span className="param-title">{t('dash.price_per_seat')}</span>
            </div>
            <div className="price-input-wrap">
              <input
                type="number"
                aria-label={t('dash.price_per_seat_aria')}
                min="0"
                max="9999"
                step="50"
                value={price || ''}
                onChange={(e) => onChangePrice(Math.max(0, parseInt(e.target.value, 10) || 0))}
                placeholder="0"
                className="price-number-input"
              />
              <span className="currency-label">{t('common.som_upper')}</span>
            </div>
          </div>

          {typeof onToggleRecurrenceDay === 'function' && (
            <div className="recurrence-block">
              <div className="param-label-group">
                <Repeat size={15} className="text-muted" aria-hidden="true" />
                <span className="param-title">{t('dash.repeat_days')}</span>
              </div>
              <div className="recurrence-days-row" role="group" aria-label={t('dash.repeat_days')}>
                {WEEKDAY_INDICES.map((idx) => {
                  const active = recurrenceDays.includes(String(idx));
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`recurrence-day-btn ${active ? 'active' : ''}`}
                      aria-pressed={active}
                      onClick={() => onToggleRecurrenceDay(idx)}
                    >
                      {t(`dash.weekday_${idx}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
