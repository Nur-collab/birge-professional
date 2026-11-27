import React, { useEffect, useRef, useState } from 'react';
import { Send, ShieldCheck, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import CodeStep from './login/CodeStep';
import PhoneStep from './login/PhoneStep';
import TelegramChallengeStep from './login/TelegramChallengeStep';
import { readStoredFlow, writeStoredFlow } from './login/authFlowStorage';
import './login/login.css';

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
          <p className="login-brand-heading">
            {t('auth.brand_heading_1')}<br />
            {t('auth.brand_heading_2')}<br />
            {t('auth.brand_heading_3')}
          </p>
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
    </main>
  );
}
