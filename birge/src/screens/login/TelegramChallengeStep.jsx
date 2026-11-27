import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import { isNativeApp, openExternalUrl } from '../../utils/platform';
import {
  BOT_URL,
  CHALLENGE_POLL_INTERVAL_MS,
  clearStoredFlow,
  mapAuthError,
} from './authFlowStorage';

export default function TelegramChallengeStep({
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
        <div className="auth-error-banner auth-error-banner-spaced" role="alert">
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
        <div className="auth-error-banner auth-error-banner-sm-spaced" role="alert">
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
              onClick={(e) => {
                if (isNativeApp()) {
                  e.preventDefault();
                  void openExternalUrl(challenge?.telegram_url || BOT_URL);
                }
              }}
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
