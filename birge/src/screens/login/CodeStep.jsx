import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { isNativeApp, openExternalUrl } from '../../utils/platform';
import {
  BOT_URL,
  RESCUE_HINT_DELAY_SECONDS,
  RESEND_COOLDOWN_SECONDS,
  clearStoredFlow,
  mapAuthError,
} from './authFlowStorage';

export default function CodeStep({ phone, tgOpenedInitially, onBack, onSwitchToTelegram, onVerified }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [tgStarting, setTgStarting] = useState(false);
  const [error, setError] = useState('');
  const [resendInfo, setResendInfo] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [tgOpened, setTgOpened] = useState(Boolean(tgOpenedInitially));

  useEffect(() => {
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const showRescueHighlight = elapsed >= RESCUE_HINT_DELAY_SECONDS && code.length < 6;

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError('');
    setResendInfo('');
    try {
      await api.sendCode(phone);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setElapsed(0);
      setResendInfo(t('auth.resent_notice'));
    } catch (err) {
      console.error('[CodeStep][resend]', err);
      setError(mapAuthError(err.message, t));
    } finally {
      setResending(false);
    }
  };

  const handleSwitchTelegram = async () => {
    setTgStarting(true);
    setError('');
    try {
      const challenge = await api.createTelegramChallenge();
      onSwitchToTelegram(challenge);
    } catch (err) {
      console.error('[CodeStep][switchTg]', err);
      setError(mapAuthError(err.message, t));
    } finally {
      setTgStarting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (code.length < 6) return;
    setLoading(true);
    setError('');

    try {
      const data = await api.verifyCode(phone, code, name.trim());
      const user = data?.user || await api.getCurrentUser();
      if (!user) {
        throw new Error(t('auth.error_load_profile'));
      }
      clearStoredFlow();
      onVerified(user);
    } catch (err) {
      console.error('[CodeStep]', err);
      setError(mapAuthError(err.message, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-step">
      <div className="login-step-header">
        <h1 className="login-title">{t('auth.confirm_title')}</h1>
        <p className="login-desc">{t('auth.enter_code_for')} <strong>{phone}</strong></p>
      </div>

      <div className="delivery-notice">
        <Send size={16} aria-hidden="true" />
        <span>{t('auth.check_sms')}</span>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <div className="field-group">
          <label className="input-label" htmlFor="login-code">{t('auth.code_label')}</label>
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
          <label className="input-label" htmlFor="login-name">{t('auth.name_label')}</label>
          <input
            id="login-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('auth.name_placeholder')}
            className="pro-input"
          />
          <p className="field-hint">{t('auth.name_hint_first_login')}</p>
        </div>

        {error && (
          <div className="auth-error-banner" id="login-code-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {resendInfo && !error && (
          <div className="delivery-notice is-success" role="status">
            <CheckCircle2 size={15} aria-hidden="true" />
            <span>{resendInfo}</span>
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
              <span className="sr-only">{t('auth.checking_code')}</span>
            </>
          ) : (
            <>
              <span>{t('auth.confirm_and_login')}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </>
          )}
        </button>

        <button
          type="button"
          className="auth-secondary-btn"
          onClick={handleResend}
          disabled={cooldown > 0 || resending}
        >
          <RefreshCw size={14} className={resending ? 'spin' : ''} aria-hidden="true" />
          <span>
            {resending
              ? t('auth.resending')
              : cooldown > 0
                ? t('auth.resend_in', { seconds: cooldown })
                : t('auth.resend_now')}
          </span>
        </button>

        <div className={`bot-rescue-card ${showRescueHighlight ? 'is-highlighted' : ''}`}>
          <div className="bot-rescue-head">
            <AlertCircle size={15} aria-hidden="true" />
            <span>
              {showRescueHighlight
                ? t('auth.rescue_title')
                : t('auth.rescue_default_title')}
            </span>
          </div>
          <p className="bot-rescue-text">
            {t('auth.rescue_desc')} {t('auth.rescue_action_hint')}
          </p>
          <div className="bot-rescue-actions">
            <a
              href={BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="tg-prereq-link"
              onClick={(e) => {
                setTgOpened(true);
                if (isNativeApp()) {
                  e.preventDefault();
                  void openExternalUrl(BOT_URL);
                }
              }}
            >
              <Send size={13} aria-hidden="true" />
              <span>{tgOpened ? t('auth.open_bot_again') : t('auth.open_bot')}</span>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
            <button
              type="button"
              className="bot-rescue-switch"
              onClick={handleSwitchTelegram}
              disabled={tgStarting}
            >
              {tgStarting ? t('auth.creating_link') : t('auth.switch_to_tg')}
            </button>
          </div>
        </div>

        <button type="button" className="auth-back-action" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span>{t('auth.change_phone')}</span>
        </button>
      </form>
    </div>
  );
}
