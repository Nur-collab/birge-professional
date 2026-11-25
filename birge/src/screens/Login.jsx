import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, ShieldCheck, Loader2, Send, AlertCircle, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';

const mapAuthError = (message) => {
  if (!message) return 'Неверный или просроченный код';
  if (/invalid,\s*expired,\s*or\s*locked\s*code/i.test(message)) {
    return 'Неверный или просроченный код подтверждения';
  }
  if (/phone number required/i.test(message)) {
    return 'Укажите номер телефона';
  }
  if (/too many requests/i.test(message)) {
    return 'Слишком много попыток. Подождите 1 минуту.';
  }
  return message;
};

// SVG флаг Кыргызстана для международного поля ввода
const KyrgyzstanFlag = () => (
  <svg width="20" height="14" viewBox="0 0 20 14" fill="none" style={{ borderRadius: 2, flexShrink: 0 }} aria-hidden="true">
    <rect width="20" height="14" fill="#E8112D" />
    <circle cx="10" cy="7" r="3.2" fill="#FFE800" />
    <circle cx="10" cy="7" r="2.4" fill="#E8112D" />
    <circle cx="10" cy="7" r="1.8" fill="#FFE800" />
    <path d="M10 4.2V9.8M7.2 7H12.8M8 5.2L12 8.8M8 8.8L12 5.2" stroke="#E8112D" strokeWidth="0.6" />
  </svg>
);

// ─── Шаг 1: Ввод номера телефона ────────────────────────────
function PhoneStep({ onNext }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const formatPhone = (val) => {
    let digits = val.replace(/\D/g, '');
    if (digits.startsWith('996')) digits = digits.slice(3);
    if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
    digits = digits.slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return digits.slice(0, 3) + ' ' + digits.slice(3);
    return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 9) {
      setError(t('auth.error_invalid_phone') || 'Введите 9 цифр после +996');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const fullPhone = '+996' + digits;
      await api.sendCode(fullPhone);
      onNext(fullPhone);
    } catch (err) {
      console.error('[PhoneStep]', err);
      setError(mapAuthError(err.message) || 'Ошибка отправки кода. Попробуйте еще раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-step">
      <div className="login-step-header">
        <h1 className="login-title">Вход в BIRGE</h1>
        <p className="login-desc">Войдите по номеру телефона — код придёт в Telegram.</p>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <div className="field-group">
          <label className="input-label" htmlFor="login-phone">Номер телефона</label>
          <div className={`phone-input-wrap ${error ? 'has-error' : ''}`}>
            <div className="phone-prefix-pill">
              <KyrgyzstanFlag />
              <span className="prefix-code">+996</span>
            </div>
            <input
              id="login-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              enterKeyHint="send"
              value={phone}
              onChange={(e) => { setError(''); setPhone(formatPhone(e.target.value)); }}
              placeholder="555 123 456"
              className="phone-native-input"
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? 'login-phone-error' : undefined}
              autoFocus
            />
          </div>
          {error && (
            <div className="auth-error-banner" id="login-phone-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <button
          type="submit"
          className="primary-btn submit-btn"
          disabled={loading || phone.replace(/\D/g, '').length < 9}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="spin" aria-hidden="true" />
              <span className="sr-only">Отправка кода</span>
            </>
          ) : (
            <>
              <span>Получить код</span>
              <ArrowRight size={17} aria-hidden="true" />
            </>
          )}
        </button>

        <div className="auth-channel-card">
          <div className="channel-icon-wrap">
            <Send size={15} aria-hidden="true" />
          </div>
          <div className="channel-info">
            <span className="channel-title">Быстрый код в Telegram</span>
            <span className="channel-sub">
              Запустите бота <a href="https://t.me/BirgeAuthBot" target="_blank" rel="noopener noreferrer">@BirgeAuthBot</a> для моментального получения кода
            </span>
          </div>
        </div>
      </form>
    </div>
  );
}

// ─── Шаг 2: Ввод кода подтверждения ─────────────────────────
function CodeStep({ phone, onBack, onVerified }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (code.length < 6) return;
    setLoading(true);
    setError('');

    try {
      const data = await api.verifyCode(phone, code, name.trim());
      const user = data?.user || await api.getCurrentUser();
      if (!user) {
        throw new Error('Не удалось загрузить профиль. Попробуйте войти еще раз.');
      }
      onVerified(user);
    } catch (err) {
      console.error('[CodeStep]', err);
      setError(mapAuthError(err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-step">
      <div className="login-step-header">
        <h1 className="login-title">Подтверждение</h1>
        <p className="login-desc">Введите код для номера <strong>{phone}</strong></p>
      </div>

      <div className="delivery-notice">
        <Send size={16} aria-hidden="true" />
        <span>Если номер доступен, код придёт в Telegram-бот @BirgeAuthBot.</span>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <div className="field-group">
          <label className="input-label" htmlFor="login-code">6-значный код</label>
          <input
            id="login-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            value={code}
            onChange={(e) => { setError(''); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
            placeholder="••••••"
            className="code-digit-input"
            maxLength={6}
            aria-invalid={error ? 'true' : 'false'}
            aria-describedby={error ? 'login-code-error' : undefined}
            autoFocus
          />
        </div>

        <div className="field-group">
          <label className="input-label" htmlFor="login-name">Имя</label>
          <input
            id="login-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Как вас зовут"
            className="pro-input"
          />
          <p className="field-hint">Нужно только при первом входе</p>
        </div>

        {error && (
          <div className="auth-error-banner" id="login-code-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          className="primary-btn submit-btn"
          disabled={loading || code.length < 6}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="spin" aria-hidden="true" />
              <span className="sr-only">Проверка кода</span>
            </>
          ) : (
            <>
              <span>Подтвердить и войти</span>
              <ArrowRight size={17} aria-hidden="true" />
            </>
          )}
        </button>

        <button type="button" className="auth-back-action" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span>Изменить номер</span>
        </button>
      </form>
    </div>
  );
}

// ─── Главный экран авторизации ───────────────────────────────
export default function Login({ onLoggedIn }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');

  return (
    <main className="login-screen">
      <aside className="login-brand-panel" aria-label="О сервисе BIRGE">
        <div className="login-brand-lockup">
          <span className="auth-logo-badge" aria-hidden="true">B</span>
          <span>
            <span className="login-brand-lockup-title">BIRGE</span>
            <span className="login-brand-lockup-sub">Совместные поездки</span>
          </span>
        </div>

        <div className="login-brand-copy">
          <p className="login-eyebrow">Бишкек · Чуйская область</p>
          <p className="login-brand-heading">Дорога,<br />в которой есть<br />попутчик.</p>
          <p className="login-brand-description">
            Находите проверенных водителей и пассажиров по пути. Договаривайтесь о цене заранее
            и делите дорогу с теми, кому по пути.
          </p>
        </div>

        <ul className="login-benefits">
          <li>
            <span className="login-benefit-icon"><ShieldCheck size={17} aria-hidden="true" /></span>
            <span>
              <span className="login-benefit-title">Проверенные профили</span>
              <span className="login-benefit-text">Рейтинг, подтверждение и история поездок</span>
            </span>
          </li>
          <li>
            <span className="login-benefit-icon"><Send size={16} aria-hidden="true" /></span>
            <span>
              <span className="login-benefit-title">Код в Telegram</span>
              <span className="login-benefit-text">Быстрый и безопасный вход без пароля</span>
            </span>
          </li>
          <li>
            <span className="login-benefit-icon"><Users size={17} aria-hidden="true" /></span>
            <span>
              <span className="login-benefit-title">Поездки рядом</span>
              <span className="login-benefit-text">Город, микрорайоны и пригород</span>
            </span>
          </li>
        </ul>

        <p className="login-brand-footnote">Поездки по городу и области — в одном приложении.</p>
      </aside>

      <section className="login-form-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="auth-logo-badge" aria-hidden="true">B</span>
            <span>
              <span className="auth-mobile-brand-title">BIRGE</span>
              <span className="auth-mobile-brand-sub">Совместные поездки</span>
            </span>
          </div>

          <div className="auth-progress-meta">
            <span>Шаг {step === 'phone' ? '1' : '2'} из 2</span>
            <span>{step === 'phone' ? 'Номер телефона' : 'Подтверждение'}</span>
          </div>

          <div className="auth-progress-bar" aria-hidden="true">
            <div className={`progress-segment ${step === 'phone' ? 'active' : 'completed'}`} />
            <div className={`progress-segment ${step === 'code' ? 'active' : ''}`} />
          </div>

          {step === 'phone' ? (
            <PhoneStep
              onNext={(ph) => {
                setPhone(ph);
                setStep('code');
              }}
            />
          ) : (
            <CodeStep
              phone={phone}
              onBack={() => setStep('phone')}
              onVerified={onLoggedIn}
            />
          )}
        </div>

        <p className="auth-footer-legal">
          Нажимая «Получить код», вы соглашаетесь с <a href="/terms.html" target="_blank" rel="noopener noreferrer">Правилами</a> и <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Политикой конфиденциальности</a>
        </p>
      </section>

      <style>{`
        .login-screen {
          min-height: 100vh;
          min-height: 100dvh;
          background: var(--bg-page);
          color: var(--text-main);
          display: grid;
          grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr);
          position: relative;
        }

        .login-brand-panel {
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 2.5rem;
          padding: clamp(2rem, 4.5vw, 4.5rem);
          background: var(--brand-panel-bg);
          color: var(--brand-panel-text);
        }

        .login-brand-panel::before {
          content: '';
          position: absolute;
          width: 520px;
          height: 520px;
          right: -230px;
          top: -190px;
          border: 1px solid var(--brand-panel-line);
          border-radius: 50%;
        }

        .login-brand-panel::after {
          content: '';
          position: absolute;
          width: 220px;
          height: 220px;
          left: -120px;
          bottom: -80px;
          border: 1px solid var(--brand-panel-line);
          border-radius: 50%;
        }

        .login-brand-lockup {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .auth-logo-badge {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.12rem;
          font-weight: 800;
          letter-spacing: -0.04em;
          flex-shrink: 0;
          background: var(--primary);
          color: var(--on-primary);
        }

        .login-brand-lockup .auth-logo-badge {
          background: var(--brand-panel-button-bg);
          color: var(--brand-panel-button-fg);
        }

        .login-brand-lockup-title {
          display: block;
          font-size: 1.05rem;
          font-weight: 800;
          letter-spacing: 0.14em;
          line-height: 1.1;
          color: var(--brand-panel-text);
        }

        .login-brand-lockup-sub {
          display: block;
          margin-top: 2px;
          font-size: 0.6rem;
          font-weight: 700;
          letter-spacing: 0.13em;
          text-transform: uppercase;
          color: var(--brand-panel-subtle);
        }

        .login-brand-copy {
          position: relative;
          z-index: 1;
          margin-top: auto;
          max-width: 470px;
        }

        .login-eyebrow {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 18px;
          color: var(--brand-panel-icon);
          font-size: 0.67rem;
          font-weight: 800;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }

        .login-eyebrow::before {
          content: '';
          width: 25px;
          height: 1px;
          background: currentColor;
        }

        .login-brand-heading {
          margin-bottom: 22px;
          color: var(--brand-panel-text);
          font-size: clamp(2.4rem, 4.2vw, 4.2rem);
          font-weight: 800;
          line-height: 1.03;
          letter-spacing: -0.055em;
        }

        .login-brand-description {
          max-width: 37ch;
          color: var(--brand-panel-muted);
          font-size: 0.92rem;
          line-height: 1.65;
        }

        .login-benefits {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          gap: 14px;
          list-style: none;
          margin-top: auto;
          padding-top: 1.5rem;
          border-top: 1px solid var(--brand-panel-line);
        }

        .login-benefits li {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .login-benefit-icon {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: var(--brand-panel-line);
          color: var(--brand-panel-icon);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .login-benefit-title {
          display: block;
          color: var(--brand-panel-text);
          font-size: 0.8rem;
          font-weight: 700;
          line-height: 1.35;
        }

        .login-benefit-text {
          display: block;
          margin-top: 2px;
          color: var(--brand-panel-subtle);
          font-size: 0.72rem;
          line-height: 1.45;
        }

        .login-brand-footnote {
          position: relative;
          z-index: 1;
          color: var(--brand-panel-subtle);
          font-size: 0.67rem;
          line-height: 1.5;
        }

        .login-form-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(1.5rem, 4vw, 3rem);
        }

        .auth-card {
          width: 100%;
          max-width: 420px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 28px;
          padding: clamp(1.4rem, 3vw, 2.25rem);
          box-shadow: var(--floating-shadow);
          transition: background-color 0.25s ease, border-color 0.25s ease;
        }

        .auth-mobile-brand {
          display: none;
          align-items: center;
          gap: 10px;
          margin-bottom: 22px;
        }

        .auth-mobile-brand .auth-logo-badge {
          width: 38px;
          height: 38px;
          border-radius: 11px;
          font-size: 1rem;
        }

        .auth-mobile-brand-title {
          display: block;
          color: var(--text-main);
          font-size: 0.95rem;
          font-weight: 800;
          letter-spacing: 0.13em;
          line-height: 1.1;
        }

        .auth-mobile-brand-sub {
          display: block;
          margin-top: 2px;
          color: var(--text-subtle);
          font-size: 0.58rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .auth-progress-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
          color: var(--text-subtle);
          font-size: 0.64rem;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .auth-progress-meta span:last-child {
          color: var(--primary);
        }

        .auth-progress-bar {
          display: flex;
          gap: 6px;
          margin-bottom: 24px;
        }

        .progress-segment {
          flex: 1;
          height: 3px;
          border-radius: 999px;
          background: var(--border-subtle);
          transition: background-color 0.25s ease, opacity 0.25s ease;
        }

        .progress-segment.active {
          background: var(--primary);
        }

        .progress-segment.completed {
          background: var(--primary);
          opacity: 0.4;
        }

        .login-step-header {
          margin-bottom: 20px;
        }

        .login-title {
          margin-bottom: 7px;
          color: var(--text-main);
          font-size: 1.65rem;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: -0.045em;
        }

        .login-desc {
          color: var(--text-muted);
          font-size: 0.85rem;
          line-height: 1.55;
        }

        .login-desc strong {
          color: var(--text-main);
          font-weight: 700;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .field-group {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .input-label {
          color: var(--text-subtle);
          font-size: 0.66rem;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .field-hint {
          color: var(--text-subtle);
          font-size: 0.68rem;
          line-height: 1.4;
        }

        .phone-input-wrap {
          display: flex;
          align-items: center;
          min-height: 56px;
          overflow: hidden;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: var(--bg-input);
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
        }

        .phone-input-wrap:focus-within {
          border-color: var(--primary);
          background: var(--bg-card);
          box-shadow: 0 0 0 3px var(--primary-glow);
        }

        .phone-input-wrap.has-error {
          border-color: var(--danger);
        }

        .phone-prefix-pill {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 54px;
          padding: 0 13px;
          background: var(--bg-subtle);
          border-right: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .prefix-code {
          color: var(--text-main);
          font-size: 0.9rem;
          font-weight: 800;
        }

        .phone-native-input {
          flex: 1;
          min-width: 0;
          height: 54px;
          padding: 0 15px;
          border: none;
          background: transparent;
          color: var(--text-main);
          font-size: 1.05rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          outline: none;
        }

        .phone-native-input::placeholder {
          color: var(--text-subtle);
          font-weight: 500;
          letter-spacing: 0;
        }

        .code-digit-input {
          width: 100%;
          height: 62px;
          padding-left: 0.55em;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: var(--bg-input);
          color: var(--text-main);
          text-align: center;
          font-size: 1.9rem;
          font-weight: 800;
          letter-spacing: 0.55em;
          font-variant-numeric: tabular-nums;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
        }

        .code-digit-input::placeholder {
          color: var(--text-subtle);
          letter-spacing: 0.5em;
        }

        .code-digit-input:focus {
          border-color: var(--primary);
          background: var(--bg-card);
          box-shadow: 0 0 0 3px var(--primary-glow);
        }

        .auth-error-banner {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          padding: 9px 11px;
          border: 1px solid var(--danger-border);
          border-radius: 11px;
          background: var(--danger-soft);
          color: var(--danger);
          font-size: 0.76rem;
          font-weight: 600;
          line-height: 1.4;
        }


        .delivery-notice {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 18px;
          padding: 11px 12px;
          border: 1px solid transparent;
          border-radius: 12px;
          background: var(--accent-soft);
          color: var(--primary);
          font-size: 0.78rem;
          font-weight: 600;
          line-height: 1.45;
        }

        .auth-channel-card {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          padding: 12px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: var(--bg-input);
          text-align: left;
        }

        .channel-icon-wrap {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          background: var(--info-soft);
          color: var(--info);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .channel-info {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .channel-title {
          color: var(--text-main);
          font-size: 0.78rem;
          font-weight: 800;
        }

        .channel-sub {
          color: var(--text-muted);
          font-size: 0.72rem;
          line-height: 1.5;
        }

        .channel-sub a {
          color: var(--info);
          font-weight: 700;
          text-decoration: none;
          border-bottom: 1px solid currentColor;
        }

        .submit-btn {
          min-height: 52px;
          margin-top: 2px;
          border-radius: 14px;
        }

        .auth-back-action {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 44px;
          padding: 6px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-size: 0.83rem;
          font-weight: 700;
          cursor: pointer;
          transition: color 0.15s ease;
        }

        .auth-back-action:hover {
          color: var(--text-main);
        }

        .auth-footer-legal {
          max-width: 380px;
          margin-top: 18px;
          color: var(--text-subtle);
          font-size: 0.68rem;
          line-height: 1.55;
          text-align: center;
        }

        .auth-footer-legal a {
          color: var(--text-muted);
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        @keyframes spin { 100% { transform: rotate(360deg); } }
        .spin { animation: spin 0.8s linear infinite; }

        @media (max-width: 900px) {
          .login-screen {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 1.5rem 1rem calc(1.5rem + env(safe-area-inset-bottom));
          }

          .login-brand-panel {
            display: none;
          }

          .login-form-panel {
            width: 100%;
            padding: 0;
          }

          .auth-card {
            max-width: 420px;
            padding: 1.4rem 1.25rem;
            border-radius: 24px;
            box-shadow: var(--card-shadow);
          }

          .auth-mobile-brand {
            display: flex;
          }
        }

        @media (max-width: 380px) {
          .auth-card {
            padding: 1.2rem 1rem;
          }

          .login-title {
            font-size: 1.5rem;
            line-height: 1.18;
          }

          .code-digit-input {
            padding-left: 0.42em;
            letter-spacing: 0.42em;
          }
        }

      `}</style>
    </main>
  );
}
