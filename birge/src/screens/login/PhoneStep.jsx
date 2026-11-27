import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Send,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import {
  BOT_URL,
  KyrgyzstanFlag,
  formatLocalPhone,
  mapAuthError,
} from './authFlowStorage';

export default function PhoneStep({ initialPhone, initialTgOpened, onNext, onStartTelegram }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState(() => formatLocalPhone(initialPhone));
  const [tgOpened, setTgOpened] = useState(Boolean(initialTgOpened));
  const [loading, setLoading] = useState(false);
  const [tgLoading, setTgLoading] = useState(false);
  const [error, setError] = useState('');

  const handleTelegramLogin = async () => {
    setTgLoading(true);
    setError('');
    try {
      const challenge = await api.createTelegramChallenge();
      onStartTelegram(challenge);
    } catch (err) {
      console.error('[PhoneStep][Telegram]', err);
      setError(mapAuthError(err.message, t) || t('auth.error_tg_create'));
    } finally {
      setTgLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, '');
    if (digits.length !== 9) {
      setError(t('auth.error_invalid_phone'));
      return;
    }
    setLoading(true);
    setError('');

    try {
      const fullPhone = `+996${digits}`;
      await api.sendCode(fullPhone);
      onNext(fullPhone, tgOpened);
    } catch (err) {
      console.error('[PhoneStep]', err);
      setError(mapAuthError(err.message, t) || t('auth.error_send_code'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-step">
      <div className="login-step-header">
        <h1 className="login-title">{t('auth.login_title')}</h1>
        <p className="login-desc">
          {t('auth.login_desc')}
        </p>
      </div>

      <button
        type="button"
        className="tg-primary-btn"
        onClick={handleTelegramLogin}
        disabled={tgLoading || loading}
        aria-busy={tgLoading}
      >
        <span className="tg-primary-icon" aria-hidden="true">
          {tgLoading ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
        </span>
        <span className="tg-primary-copy">
          <span className="tg-primary-title">
            {t('auth.tg_quick_btn')}
          </span>
          <span className="tg-primary-sub">
            {t('auth.tg_quick_sub')}
          </span>
        </span>
        <ArrowRight size={17} className="tg-primary-arrow" aria-hidden="true" />
      </button>

      <div className="auth-divider" role="separator">
        <span>{t('auth.or_phone_code')}</span>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <div className="field-group">
          <label className="input-label" htmlFor="login-phone">{t('auth.phone_number')}</label>
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
              onChange={(e) => { setError(''); setPhone(formatLocalPhone(e.target.value)); }}
              placeholder="555 123 456"
              className="phone-native-input"
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? 'login-phone-error' : 'login-phone-prereq'}
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

        <div
          id="login-phone-prereq"
          className={`tg-prereq-card ${tgOpened ? 'is-confirmed' : ''}`}
        >
          <div className="tg-prereq-head">
            {tgOpened ? (
              <CheckCircle2 size={16} className="tg-prereq-icon" aria-hidden="true" />
            ) : (
              <AlertCircle size={16} className="tg-prereq-icon" aria-hidden="true" />
            )}
            <span className="tg-prereq-title">
              {tgOpened
                ? t('auth.prereq_opened_title')
                : t('auth.prereq_title')}
            </span>
          </div>
          <p className="tg-prereq-text">
            {tgOpened
              ? t('auth.prereq_opened_desc')
              : t('auth.prereq_desc')}
          </p>
          <a
            href={BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="tg-prereq-link"
            onClick={() => setTgOpened(true)}
          >
            <Send size={13} aria-hidden="true" />
            <span>{tgOpened ? t('auth.open_bot_again') : t('auth.open_bot_first')}</span>
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>

        <button
          type="submit"
          className="primary-btn submit-btn"
          disabled={loading || tgLoading || phone.replace(/\D/g, '').length < 9}
          aria-busy={loading}
        >
          {loading ? (
            <>
              <Loader2 size={18} className="spin" aria-hidden="true" />
              <span className="sr-only">{t('auth.sending_code')}</span>
            </>
          ) : (
            <>
              <span>{t('auth.get_code')}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
