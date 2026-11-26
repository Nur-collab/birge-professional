import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Loader2,
  Send,
  AlertCircle,
  Users,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';

const BOT_URL = 'https://t.me/BirgeAuthBot';
const LOGIN_FLOW_STORAGE_KEY = 'birge_login_flow_v1';
const RESEND_COOLDOWN_SECONDS = 60;
const RESCUE_HINT_DELAY_SECONDS = 8;
const CHALLENGE_POLL_INTERVAL_MS = 2500;

const readStoredFlow = () => {
  try {
    const raw = window.sessionStorage.getItem(LOGIN_FLOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.challenge?.expiresAt && Date.now() > parsed.challenge.expiresAt) {
      return {
        ...parsed,
        step: parsed.step === 'telegram' ? 'phone' : parsed.step,
        challenge: null,
      };
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeStoredFlow = (state) => {
  try {
    if (!state || state.step === 'phone' && !state.phone && !state.tgOpened && !state.challenge) {
      window.sessionStorage.removeItem(LOGIN_FLOW_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(LOGIN_FLOW_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing or storage quota exceeded must not block login.
  }
};

const clearStoredFlow = () => {
  try {
    window.sessionStorage.removeItem(LOGIN_FLOW_STORAGE_KEY);
  } catch {
    // Ignore storage errors on cleanup.
  }
};

const mapAuthError = (message, t) => {
  if (!message) return t('auth.error_invalid_code');
  if (/invalid,\s*expired,\s*or\s*locked\s*code/i.test(message)) {
    return t('auth.error_expired_code');
  }
  if (/invalid,\s*unverified,\s*or\s*expired\s*telegram\s*challenge/i.test(message)) {
    return t('auth.error_expired_tg');
  }
  if (/phone number required/i.test(message)) {
    return t('auth.error_phone_required');
  }
  if (/too many requests/i.test(message)) {
    return t('auth.error_too_many');
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

const formatLocalPhone = (val) => {
  let digits = (val || '').replace(/\D/g, '');
  if (digits.startsWith('996')) digits = digits.slice(3);
  if (digits.startsWith('0') && digits.length > 9) digits = digits.slice(1);
  digits = digits.slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return digits.slice(0, 3) + ' ' + digits.slice(3);
  return digits.slice(0, 3) + ' ' + digits.slice(3, 6) + ' ' + digits.slice(6);
};

// ─── Шаг 1: Вход через Telegram или ввод номера телефона ─────
function PhoneStep({ initialPhone, initialTgOpened, onNext, onStartTelegram }) {
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
      const fullPhone = '+996' + digits;
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

// ─── Шаг 2A: Ожидание подтверждения через Telegram deep link ──
function TelegramChallengeStep({
  challenge,
  initialVerifiedInfo,
  onRestart,
  onBack,
  onVerified,
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(() => (initialVerifiedInfo ? 'verified' : 'pending'));
  const [verifiedInfo, setVerifiedInfo] = useState(initialVerifiedInfo || null);
  const [name, setName] = useState('');
  const [completing, setCompleting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const completingRef = useRef(false);

  const completeLogin = useCallback(async (customName = '') => {
    if (!challenge || completingRef.current) return;
    completingRef.current = true;
    setCompleting(true);
    setError('');
    try {
      const data = await api.completeTelegramChallenge(
        challenge.challenge_id,
        challenge.verifier,
        customName.trim(),
      );
      const user = data?.user || await api.getCurrentUser();
      if (!user) {
        throw new Error(t('auth.error_load_profile'));
      }
      clearStoredFlow();
      onVerified(user);
    } catch (err) {
      console.error('[TelegramStep][complete]', err);
      setError(mapAuthError(err.message, t));
      completingRef.current = false;
      setCompleting(false);
    }
  }, [challenge, onVerified, t]);

  const checkStatus = useCallback(async (manual = false) => {
    if (!challenge || completingRef.current) return;
    if (manual) setChecking(true);
    try {
      const res = await api.getTelegramChallengeStatus(
        challenge.challenge_id,
        challenge.verifier,
      );
      if (res.status === 'expired') {
        setStatus('expired');
        return;
      }
      if (res.status === 'verified') {
        setStatus('verified');
        setVerifiedInfo({
          phone: res.phone,
          is_new_user: Boolean(res.is_new_user),
        });
        if (!res.is_new_user) {
          await completeLogin();
        }
        return;
      }
      setStatus(res.status || 'pending');
    } catch (err) {
      if (err?.status === 404 || err?.status === 410) {
        setStatus('expired');
      } else if (manual) {
        setError(mapAuthError(err.message, t));
      }
    } finally {
      if (manual) setChecking(false);
    }
  }, [challenge, completeLogin, t]);

  useEffect(() => {
    if (!challenge || status === 'verified' || status === 'expired') return undefined;

    checkStatus(false);
    const intervalId = setInterval(() => {
      checkStatus(false);
    }, CHALLENGE_POLL_INTERVAL_MS);

    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        checkStatus(false);
      }
    };
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleResume);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [challenge, status, checkStatus]);

  const handleCompleteNewUser = async (e) => {
    e.preventDefault();
    await completeLogin(name);
  };

  if (status === 'verified' && verifiedInfo?.is_new_user) {
    return (
      <div className="login-step">
        <div className="login-step-header">
          <h1 className="login-title">{t('auth.tg_complete_title')}</h1>
          <p className="login-desc">
            {t('auth.tg_complete_verified_before')} <strong>{verifiedInfo.phone}</strong> {t('auth.tg_complete_verified_after')}
          </p>
        </div>

        <div className="delivery-notice is-success">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{t('auth.tg_verified_badge')}</span>
        </div>

        <form onSubmit={handleCompleteNewUser} className="login-form">
          <div className="field-group">
            <label className="input-label" htmlFor="login-tg-name">{t('auth.name_label')}</label>
            <input
              id="login-tg-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth.name_placeholder')}
              className="pro-input"
              autoFocus
            />
            <p className="field-hint">{t('auth.name_hint_visible')}</p>
          </div>

          {error && (
            <div className="auth-error-banner" role="alert">
              <AlertCircle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="primary-btn submit-btn"
            disabled={completing}
            aria-busy={completing}
          >
            {completing ? (
              <>
                <Loader2 size={18} className="spin" aria-hidden="true" />
                <span>{t('auth.entering_app')}</span>
              </>
            ) : (
              <>
                <span>{t('auth.complete_login')}</span>
                <ArrowRight size={17} aria-hidden="true" />
              </>
            )}
          </button>

          <button type="button" className="auth-back-action" onClick={onBack}>
            <ArrowLeft size={15} aria-hidden="true" />
            <span>{t('auth.other_login_method')}</span>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-step">
      <div className="login-step-header">
        <h1 className="login-title">{t('auth.tg_confirm_title')}</h1>
        <p className="login-desc">
          {t('auth.tg_confirm_desc', { bot: challenge?.bot_username || 'BirgeAuthBot' })}
        </p>
      </div>

      {status === 'expired' ? (
        <div className="auth-error-banner" role="alert" style={{ marginBottom: 16 }}>
          <AlertCircle size={15} aria-hidden="true" />
          <span>{t('auth.tg_expired')}</span>
        </div>
      ) : (
        <div className="delivery-notice" role="status" aria-live="polite">
          {completing ? (
            <Loader2 size={16} className="spin" aria-hidden="true" />
          ) : (
            <Clock size={16} aria-hidden="true" />
          )}
          <span>
            {completing
              ? t('auth.tg_status_completing')
              : status === 'bot_started'
                ? t('auth.tg_status_bot_started')
                : t('auth.tg_status_pending')}
          </span>
        </div>
      )}

      <ol className="tg-steps-list">
        <li>{t('auth.tg_step_1', { bot: challenge?.bot_username || 'BirgeAuthBot' })}</li>
        <li>{t('auth.tg_step_2')}</li>
        <li>{t('auth.tg_step_3')}</li>
      </ol>

      {error && (
        <div className="auth-error-banner" role="alert" style={{ marginBottom: 14 }}>
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="login-form">
        {status === 'expired' ? (
          <button type="button" className="primary-btn submit-btn" onClick={onRestart}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>{t('auth.tg_create_new_link')}</span>
          </button>
        ) : (
          <>
            <a
              href={challenge?.telegram_url || BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-btn submit-btn tg-open-link-btn"
            >
              <Send size={16} aria-hidden="true" />
              <span>{t('auth.open_bot_named', { bot: challenge?.bot_username || 'BirgeAuthBot' })}</span>
              <ExternalLink size={15} aria-hidden="true" />
            </a>

            <button
              type="button"
              className="auth-secondary-btn"
              onClick={() => checkStatus(true)}
              disabled={checking || completing}
            >
              <RefreshCw size={15} className={checking ? 'spin' : ''} aria-hidden="true" />
              <span>{checking ? t('auth.checking') : t('auth.tg_check_now')}</span>
            </button>
          </>
        )}

        <button type="button" className="auth-back-action" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span>{t('auth.login_by_phone_code')}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Шаг 2B: Ввод 6-значного кода подтверждения ───────────────
function CodeStep({ phone, tgOpenedInitially, onBack, onSwitchToTelegram, onVerified }) {
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
              onClick={() => setTgOpened(true)}
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

// ─── Главный экран авторизации ───────────────────────────────
export default function Login({ onLoggedIn }) {
  const { t } = useTranslation();
  const initialFlow = useRef(readStoredFlow());
  const [step, setStep] = useState(() => initialFlow.current?.step || 'phone');
  const [phone, setPhone] = useState(() => initialFlow.current?.phone || '');
  const [tgOpened, setTgOpened] = useState(() => Boolean(initialFlow.current?.tgOpened));
  const [challenge, setChallenge] = useState(() => initialFlow.current?.challenge || null);

  useEffect(() => {
    writeStoredFlow({ step, phone, tgOpened, challenge });
  }, [step, phone, tgOpened, challenge]);

  const handleStartTelegram = (challengeData) => {
    const expiresAt = Date.now() + (Number(challengeData?.expires_in || 300) * 1000);
    const stored = { ...challengeData, expiresAt };
    setChallenge(stored);
    setStep('telegram');
    if (challengeData?.telegram_url && typeof window !== 'undefined' && typeof window.open === 'function') {
      try {
        window.open(challengeData.telegram_url, '_blank', 'noopener,noreferrer');
      } catch {
        // Popup blocker fallback: the user still sees the direct link inside TelegramChallengeStep.
      }
    }
  };

  const handleRestartTelegram = async () => {
    const challengeData = await api.createTelegramChallenge();
    handleStartTelegram(challengeData);
  };

  const handleBackToPhone = () => {
    setChallenge(null);
    setStep('phone');
  };

  const progressLabel =
    step === 'phone'
      ? t('auth.progress_method')
      : step === 'telegram'
        ? 'Telegram'
        : t('auth.progress_confirm');

  return (
    <main className="login-screen">
      <aside className="login-brand-panel" aria-label={t('auth.brand_about_aria')}>
        <div className="login-brand-lockup">
          <span className="auth-logo-badge" aria-hidden="true">B</span>
          <span>
            <span className="login-brand-lockup-title">BIRGE</span>
            <span className="login-brand-lockup-sub">{t('app.brand_subtitle')}</span>
          </span>
        </div>

        <div className="login-brand-copy">
          <p className="login-eyebrow">{t('auth.brand_eyebrow')}</p>
          <p className="login-brand-heading">{t('auth.brand_heading_1')}<br />{t('auth.brand_heading_2')}<br />{t('auth.brand_heading_3')}</p>
          <p className="login-brand-description">
            {t('auth.brand_description')}
          </p>
        </div>

        <ul className="login-benefits">
          <li>
            <span className="login-benefit-icon"><ShieldCheck size={17} aria-hidden="true" /></span>
            <span>
              <span className="login-benefit-title">{t('auth.benefit_1_title')}</span>
              <span className="login-benefit-text">{t('auth.benefit_1_text')}</span>
            </span>
          </li>
          <li>
            <span className="login-benefit-icon"><Send size={16} aria-hidden="true" /></span>
            <span>
              <span className="login-benefit-title">{t('auth.benefit_2_title')}</span>
              <span className="login-benefit-text">{t('auth.benefit_2_text')}</span>
            </span>
          </li>
          <li>
            <span className="login-benefit-icon"><Users size={17} aria-hidden="true" /></span>
            <span>
              <span className="login-benefit-title">{t('auth.benefit_3_title')}</span>
              <span className="login-benefit-text">{t('auth.benefit_3_text')}</span>
            </span>
          </li>
        </ul>

        <p className="login-brand-footnote">{t('auth.brand_footnote')}</p>
      </aside>

      <section className="login-form-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <span className="auth-logo-badge" aria-hidden="true">B</span>
            <span>
              <span className="auth-mobile-brand-title">BIRGE</span>
              <span className="auth-mobile-brand-sub">{t('app.brand_subtitle')}</span>
            </span>
          </div>

          <div className="auth-progress-meta">
            <span>{t('auth.step_counter', { current: step === 'phone' ? '1' : '2' })}</span>
            <span>{progressLabel}</span>
          </div>

          <div className="auth-progress-bar" aria-hidden="true">
            <div className={`progress-segment ${step === 'phone' ? 'active' : 'completed'}`} />
            <div className={`progress-segment ${step !== 'phone' ? 'active' : ''}`} />
          </div>

          {step === 'phone' && (
            <PhoneStep
              initialPhone={phone}
              initialTgOpened={tgOpened}
              onNext={(ph, opened) => {
                setPhone(ph);
                setTgOpened(opened);
                setStep('code');
              }}
              onStartTelegram={handleStartTelegram}
            />
          )}

          {step === 'telegram' && (
            <TelegramChallengeStep
              challenge={challenge}
              onRestart={handleRestartTelegram}
              onBack={handleBackToPhone}
              onVerified={onLoggedIn}
            />
          )}

          {step === 'code' && (
            <CodeStep
              phone={phone}
              tgOpenedInitially={tgOpened}
              onBack={handleBackToPhone}
              onSwitchToTelegram={handleStartTelegram}
              onVerified={onLoggedIn}
            />
          )}
        </div>

        <p className="auth-footer-legal">
          {t('auth.legal_prefix')} <a href="/terms.html" target="_blank" rel="noopener noreferrer">{t('auth.legal_terms')}</a> {t('auth.legal_and')} <a href="/privacy.html" target="_blank" rel="noopener noreferrer">{t('auth.legal_privacy')}</a>
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

        .delivery-notice.is-success {
          border-color: var(--success-border);
          background: var(--success-soft);
          color: var(--success);
          margin-bottom: 0;
        }

        .tg-primary-btn {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 13px 15px;
          border: 1px solid var(--info-border);
          border-radius: 16px;
          background: var(--info-soft);
          color: var(--text-main);
          text-align: left;
          cursor: pointer;
          transition: transform 0.15s ease, border-color 0.2s ease, background-color 0.2s ease;
        }

        .tg-primary-btn:hover:not(:disabled) {
          border-color: var(--info);
          transform: translateY(-1px);
        }

        .tg-primary-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .tg-primary-icon {
          width: 38px;
          height: 38px;
          border-radius: 11px;
          background: var(--info);
          color: var(--on-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .tg-primary-copy {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .tg-primary-title {
          color: var(--text-main);
          font-size: 0.88rem;
          font-weight: 800;
          line-height: 1.25;
        }

        .tg-primary-sub {
          color: var(--text-muted);
          font-size: 0.72rem;
          line-height: 1.35;
        }

        .tg-primary-arrow {
          color: var(--info-strong);
          flex-shrink: 0;
        }

        .auth-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 18px 0 16px;
          color: var(--text-subtle);
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .auth-divider::before,
        .auth-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border-subtle);
        }

        .tg-prereq-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px 13px;
          border: 1px solid var(--warning-border);
          border-radius: 14px;
          background: var(--warning-soft);
          transition: border-color 0.2s ease, background-color 0.2s ease;
        }

        .tg-prereq-card.is-confirmed {
          border-color: var(--success-border);
          background: var(--success-soft);
        }

        .tg-prereq-head {
          display: flex;
          align-items: center;
          gap: 7px;
          color: var(--warning-strong);
          font-size: 0.78rem;
          font-weight: 800;
        }

        .tg-prereq-card.is-confirmed .tg-prereq-head {
          color: var(--success);
        }

        .tg-prereq-icon {
          flex-shrink: 0;
        }

        .tg-prereq-text {
          color: var(--text-main);
          font-size: 0.75rem;
          line-height: 1.48;
          margin: 0;
        }

        .tg-prereq-link {
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 11px;
          border-radius: 10px;
          border: 1px solid var(--info-border);
          background: var(--bg-card);
          color: var(--info-strong);
          font-size: 0.75rem;
          font-weight: 800;
          text-decoration: none;
          transition: border-color 0.15s ease, background-color 0.15s ease;
        }

        .tg-prereq-link:hover {
          border-color: var(--info);
        }

        .tg-steps-list {
          margin: 0 0 18px;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          color: var(--text-muted);
          font-size: 0.8rem;
          line-height: 1.45;
        }

        .tg-steps-list strong {
          color: var(--text-main);
        }

        .tg-open-link-btn {
          text-decoration: none;
        }

        .auth-secondary-btn {
          width: 100%;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 9px 14px;
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          background: var(--bg-input);
          color: var(--text-main);
          font-size: 0.8rem;
          font-weight: 700;
          cursor: pointer;
          transition: border-color 0.15s ease, background-color 0.15s ease;
        }

        .auth-secondary-btn:hover:not(:disabled) {
          border-color: var(--border-strong);
          background: var(--bg-subtle);
        }

        .auth-secondary-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .bot-rescue-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px 13px;
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          background: var(--bg-input);
          transition: border-color 0.25s ease, background-color 0.25s ease;
        }

        .bot-rescue-card.is-highlighted {
          border-color: var(--warning-border);
          background: var(--warning-soft);
        }

        .bot-rescue-head {
          display: flex;
          align-items: center;
          gap: 7px;
          color: var(--text-main);
          font-size: 0.78rem;
          font-weight: 800;
        }

        .bot-rescue-card.is-highlighted .bot-rescue-head {
          color: var(--warning-strong);
        }

        .bot-rescue-text {
          margin: 0;
          color: var(--text-muted);
          font-size: 0.74rem;
          line-height: 1.48;
        }

        .bot-rescue-card.is-highlighted .bot-rescue-text {
          color: var(--text-main);
        }

        .bot-rescue-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }

        .bot-rescue-switch {
          border: none;
          background: transparent;
          padding: 6px 4px;
          color: var(--primary);
          font-size: 0.74rem;
          font-weight: 800;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        .bot-rescue-switch:disabled {
          opacity: 0.6;
          cursor: not-allowed;
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
            overflow-x: clip;
            padding: calc(1rem + env(safe-area-inset-top)) 1rem calc(1rem + env(safe-area-inset-bottom));
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
            padding: 1.15rem 1.1rem;
            border-radius: 22px;
            box-shadow: var(--card-shadow);
          }

          .auth-mobile-brand {
            display: flex;
            margin-bottom: 14px;
          }

          .auth-progress-bar {
            margin-bottom: 15px;
          }

          .login-step-header {
            margin-bottom: 13px;
          }

          .login-title {
            font-size: 1.45rem;
            margin-bottom: 4px;
          }

          .tg-primary-btn {
            padding: 11px 13px;
          }

          .auth-divider {
            margin: 12px 0 11px;
          }

          .login-form {
            gap: 12px;
          }

          .tg-prereq-card {
            padding: 10px 12px;
            gap: 6px;
          }

          .auth-footer-legal {
            margin-top: 12px;
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
