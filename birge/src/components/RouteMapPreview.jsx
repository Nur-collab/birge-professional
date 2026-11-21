import React, { useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Calendar, Clock, CreditCard, Users } from 'lucide-react';
import RealMap from './RealMap';

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

      <style>{`
        .route-preview {
          position: fixed;
          top: 0;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1500;
          width: 100%;
          max-width: 480px;
          overflow: hidden;
          background: var(--bg-page);
        }
        .route-preview-map {
          position: absolute;
          inset: 0;
        }
        .route-preview-topbar {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          z-index: 2;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: calc(12px + env(safe-area-inset-top, 0px)) 14px 18px;
          background: linear-gradient(to bottom, var(--bg-page) 0%, transparent 100%);
        }
        .route-preview-icon-btn,
        .route-preview-edit {
          min-height: 44px;
          border: 1px solid var(--border-subtle);
          background: var(--surface-glass);
          color: var(--text-main);
          box-shadow: var(--card-shadow);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          cursor: pointer;
        }
        .route-preview-icon-btn {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .route-preview-topbar-title {
          font-size: 0.9rem;
          font-weight: 800;
          color: var(--text-main);
          letter-spacing: -0.02em;
        }
        .route-preview-edit {
          margin-left: auto;
          padding: 0 14px;
          border-radius: 12px;
          font: inherit;
          font-size: 0.76rem;
          font-weight: 700;
        }
        .route-preview-sheet {
          position: absolute;
          left: 12px;
          right: 12px;
          bottom: calc(12px + env(safe-area-inset-bottom, 0px));
          z-index: 3;
          max-height: min(52dvh, 430px);
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 18px;
          border: 1px solid var(--border-subtle);
          border-radius: 24px;
          background: var(--bg-card);
          box-shadow: var(--floating-shadow);
        }
        .route-preview-sheet-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .route-preview-sheet-head h2 {
          margin: 0;
          font-size: 1rem;
          font-weight: 800;
          letter-spacing: -0.03em;
          color: var(--text-main);
        }
        .route-preview-role {
          padding: 4px 8px;
          border-radius: var(--radius-pill);
          background: var(--accent-soft);
          color: var(--primary);
          font-size: 0.66rem;
          font-weight: 800;
        }
        .route-preview-route {
          margin: 14px 0 12px;
        }
        .route-preview-point {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .route-preview-dot {
          width: 10px;
          height: 10px;
          margin-top: 5px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .route-preview-dot-from {
          background: var(--primary);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .route-preview-dot-to {
          background: var(--danger);
          box-shadow: 0 0 0 3px var(--danger-soft);
        }
        .route-preview-connector {
          width: 2px;
          height: 14px;
          margin-left: 4px;
          border-radius: 2px;
          background: var(--border-strong);
        }
        .route-preview-point-copy {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .route-preview-point-label {
          color: var(--text-subtle);
          font-size: 0.64rem;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .route-preview-point-value {
          color: var(--text-main);
          font-size: 0.86rem;
          font-weight: 700;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }
        .route-preview-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .route-preview-meta > span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 8px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-pill);
          background: var(--bg-subtle);
          color: var(--text-muted);
          font-size: 0.7rem;
          font-weight: 700;
        }
        .route-preview-meta svg {
          color: var(--primary);
          flex-shrink: 0;
        }
        .route-preview-cta {
          width: 100%;
          min-height: 50px;
          margin-top: 14px;
          border-radius: 14px;
        }
        @media (max-height: 600px) {
          .route-preview-sheet {
            max-height: 64dvh;
            padding: 15px;
          }
          .route-preview-route { margin: 10px 0; }
          .route-preview-cta { margin-top: 10px; }
        }
      `}</style>
    </div>
  );
}
