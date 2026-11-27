import React, { useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Calendar, Clock, CreditCard, Users } from 'lucide-react';
import RealMap from './RealMap';
import './RouteMapPreview.css';

const HISTORY_ENTRY_KEY = '__birgeRoutePreview';
const seatsLabel = (seats) => `${seats} ${seats === 1 ? 'место' : seats < 5 ? 'места' : 'мест'}`;

export default function RouteMapPreview({
  role,
  from,
  to,
  dateLabel,
  time,
  seats,
  price,
  onClose,
  onSearch,
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const onSearchRef = useRef(onSearch);
  const historyEntryRef = useRef(false);
  const pendingSearchRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  const requestClose = useCallback((searchAfter = false) => {
    if (historyEntryRef.current) {
      if (searchAfter) pendingSearchRef.current = true;
      window.history.back();
      return;
    }
    onCloseRef.current();
    if (searchAfter) onSearchRef.current();
  }, []);

  useEffect(() => {
    if (!historyEntryRef.current) {
      try {
        window.history.pushState(
          { ...(window.history.state || {}), [HISTORY_ENTRY_KEY]: true },
          document.title
        );
        historyEntryRef.current = true;
      } catch {
        historyEntryRef.current = false;
      }
    }

    const handlePopState = () => {
      if (!historyEntryRef.current) return;
      historyEntryRef.current = false;
      onCloseRef.current();
      if (pendingSearchRef.current) {
        pendingSearchRef.current = false;
        onSearchRef.current();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;

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

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (typeof previousFocus?.focus === 'function') {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [requestClose]);

  return (
    <div
      className="route-preview"
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-preview-title"
      ref={dialogRef}
    >
      <div className="route-preview-map">
        <RealMap
          from={from}
          to={to}
          height="100%"
          borderRadius="0"
          framed={false}
          showLegend={false}
          showFallbackRoute={false}
        />
      </div>

      <div className="route-preview-topbar">
        <button
          type="button"
          className="route-preview-icon-btn"
          onClick={() => requestClose()}
          aria-label="Вернуться к поиску"
          ref={closeRef}
        >
          <ArrowLeft size={19} aria-hidden="true" />
        </button>
        <span className="route-preview-topbar-title">Маршрут</span>
        <button type="button" className="route-preview-edit" onClick={() => requestClose()}>
          Изменить
        </button>
      </div>

      <section className="route-preview-sheet">
        <div className="route-preview-sheet-head">
          <h2 id="route-preview-title">Маршрут поездки</h2>
          <span className="route-preview-role">{role === 'driver' ? 'Водитель' : 'Пассажир'}</span>
        </div>

        <div className="route-preview-route">
          <div className="route-preview-point">
            <span className="route-preview-dot route-preview-dot-from" aria-hidden="true" />
            <div className="route-preview-point-copy">
              <span className="route-preview-point-label">Откуда</span>
              <span className="route-preview-point-value">{from}</span>
            </div>
          </div>
          <div className="route-preview-connector" aria-hidden="true" />
          <div className="route-preview-point">
            <span className="route-preview-dot route-preview-dot-to" aria-hidden="true" />
            <div className="route-preview-point-copy">
              <span className="route-preview-point-label">Куда</span>
              <span className="route-preview-point-value">{to}</span>
            </div>
          </div>
        </div>

        <div className="route-preview-meta">
          <span><Calendar size={14} aria-hidden="true" />{dateLabel}</span>
          <span><Clock size={14} aria-hidden="true" />{time}</span>
          {role === 'driver' && (
            <>
              <span><Users size={14} aria-hidden="true" />{seatsLabel(seats)}</span>
              <span><CreditCard size={14} aria-hidden="true" />{price > 0 ? `${price} сом` : 'бесплатно'}</span>
            </>
          )}
        </div>

        <button type="button" className="primary-btn route-preview-cta" onClick={() => requestClose(true)}>
          <span>{role === 'driver' ? 'Найти пассажиров по пути' : 'Найти подходящего водителя'}</span>
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </section>

    </div>
  );
}
