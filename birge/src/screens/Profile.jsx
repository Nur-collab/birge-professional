import React, { useState, useEffect } from 'react';
import { ShieldCheck, Star, Car, Settings, LogOut, ChevronRight, Loader, Clock, ShieldAlert, ExternalLink, FileText, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import { isNativeApp, openExternalUrl } from '../utils/platform';
import './Profile.css';

export default function Profile({ currentUser: userProp, onLogout, onShowSettings, onShowHistory }) {
  const { t } = useTranslation();
  const [user, setUser] = useState(userProp || null);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // {status, message, bot_url?}
  const fileInputRef = React.useRef(null);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');
    if (!file.type.startsWith('image/')) {
      setUploadError(t('profile.err_image_type'));
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(t('profile.err_image_size'));
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      // Ключ ImgBB остаётся на сервере; браузер загружает файл в наш API.
      const updatedUser = await api.uploadProfilePhoto(file);
      setUser(updatedUser);

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Birge', { body: t('profile.photo_updated') });
      }
    } catch (err) {
      setUploadError(err.message || t('profile.err_image_upload'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleVerify = async () => {
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const result = await api.verifyAccount();
      setVerifyResult(result || { status: 'error', message: t('profile.err_connection') });
      // Обновляем локальный стейт пользователя если верифицировали
      if (result?.status === 'verified') {
        setUser(prev => prev ? { ...prev, is_verified: true } : prev);
      }
    } catch (e) {
      setVerifyResult({ status: 'error', message: e.message || t('profile.err_connection') });
    } finally {
      setVerifyLoading(false);
    }
  };

  useEffect(() => {
    if (userProp) {
      setUser(userProp);
      setError(false);
    } else {
      setError(false);
      api.getCurrentUser().then(data => {
        if (data) setUser(data);
        else setError(true);
      }).catch(() => setError(true));
    }
  }, [userProp]);

  if (!user && error) {
    return (
      <div className="profile screen-content" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '60vh', gap: '1rem' }}>
        <ShieldAlert size={40} color="var(--danger)" />
        <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{t('profile.backend_unavailable')}<br />{t('profile.try_later')}</p>
        <button className="primary-btn" style={{ width: 'auto', padding: '10px 24px' }} onClick={() => {
          setError(false);
          api.getCurrentUser().then(data => { if (data) setUser(data); else setError(true); }).catch(() => setError(true));
        }}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="profile screen-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Loader className="spin-loader" size={32} color="var(--primary)" />
      </div>
    );
  }

  return (
    <div className="profile screen-content">
      <div className="profile-header glass-panel">
        <button type="button" className="avatar-container" onClick={() => fileInputRef.current?.click()} aria-label={t('profile.change_photo_aria')}>
          {uploading ? (
            <div className="avatar-loader">
              <Loader size={24} color='var(--on-primary)' className="spin-loader" aria-hidden="true" />
            </div>
          ) : (
            <>
              <img src={user.photo} alt={user.name} className="profile-avatar" />
              <div className="avatar-overlay">
                <span style={{ color: 'var(--inverse-text)', fontSize: '10px', fontWeight: 'bold' }}>{t('profile.change_photo_overlay')}</span>
              </div>
            </>
          )}
          {user.is_verified && (
            <div className="verified-badge" role="img" title={t('profile.verified_badge')} aria-label={t('profile.verified_badge')}>
              <ShieldCheck size={16} color='var(--on-primary)' />
            </div>
          )}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handlePhotoUpload}
            accept="image/*"
            aria-label={t('profile.choose_photo_aria')}
            style={{ display: 'none' }}
          />
        </button>

        <h2>{user.name}</h2>
        <p className="user-phone">{user.phone}</p>
        {uploadError && (
          <p role="alert" style={{ color: 'var(--danger)', background: 'var(--danger-soft)', border: '1px solid var(--danger-border)', borderRadius: 10, padding: '8px 10px', fontSize: '0.78rem', fontWeight: 600, marginBottom: '1rem' }}>
            {uploadError}
          </p>
        )}

        <div className="stats-row">
          <div className="stat-item">
            <div className="stat-value">
              <Star size={16} fill="var(--warning)" color="var(--warning)" /> {user.trust_rating}
            </div>
            <div className="stat-label">{t('profile.rating')}</div>
          </div>
          <div className="stat-divider"></div>
          <div className="stat-item">
            <div className="stat-value">{(user.reviews || []).length}</div>
            <div className="stat-label">{t('profile.reviews')}</div>
          </div>
          <div className="stat-divider"></div>
          <div className="stat-item">
            <div className="stat-value">{user.registered_since}</div>
            <div className="stat-label">{t('profile.since')}</div>
          </div>
        </div>
      </div>

      <div className="limits-card glass-panel">
        <div className="limits-header">
          <div className="limits-title">
            <Car size={18} color="var(--primary)" />
            <span>{t('profile.trips_today')}</span>
          </div>
          <div className="limits-count">{user.trips_today} / 3</div>
        </div>
        <div className="progress-bar" role="progressbar" aria-label={t('profile.trips_today_aria')} aria-valuemin="0" aria-valuemax="3" aria-valuenow={Math.min(user.trips_today || 0, 3)}>
          <div
            className="progress-fill"
            style={{ width: `${(user.trips_today / 3) * 100}%`, background: user.trips_today >= 3 ? 'var(--danger)' : 'var(--primary)' }}
          ></div>
        </div>
        <p className="limits-hint">{t('profile.trips_hint')}</p>
      </div>

      {/* Карточка машины водителя */}
      <button type="button" className="car-card glass-panel" onClick={onShowSettings} style={{ cursor: 'pointer', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: user.car_model ? '1rem' : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
            <Car size={18} color={user.car_model ? 'var(--warning)' : 'var(--text-subtle)'} />
            {t('profile.my_car')}
          </div>
          {!user.car_model && (
            <span style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 600 }}>{t('profile.add_car_cta')}</span>
          )}
        </div>

        {user.car_model ? (
          <div style={{ display: 'flex', gap: '10px' }}>
            {/* Иконка машины */}
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--primary)', flexShrink: 0,
            }}>
              <Car size={24} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.96rem', color: 'var(--text-main)' }}>{user.car_model}</div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                {user.car_color && (
                  <span style={{
                    background: 'var(--bg-subtle)', color: 'var(--primary)',
                    padding: '3px 10px', borderRadius: 20,
                    fontSize: '0.78rem', fontWeight: 600,
                    border: '1px solid var(--border-subtle)',
                  }}>
                    {user.car_color}
                  </span>
                )}
                {user.car_plate && (
                  <span style={{
                    background: 'var(--bg-subtle)', color: 'var(--text-main)',
                    padding: '3px 10px', borderRadius: 6,
                    fontSize: '0.8rem', fontWeight: 800,
                    letterSpacing: '1px', fontFamily: 'monospace',
                    border: '1px solid var(--border-strong)',
                  }}>
                    {user.car_plate.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
            <ChevronRight size={18} color="var(--text-subtle)" style={{ alignSelf: 'center' }} />
          </div>
        ) : (
          <div style={{
            marginTop: '10px', padding: '14px', borderRadius: 12,
            background: 'var(--bg-subtle)', border: '1.5px dashed var(--border-subtle)',
            textAlign: 'center',
          }}>
            <Car size={24} color="var(--text-muted)" style={{ margin: '0 auto 6px auto', display: 'block' }} />
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', fontWeight: 600, margin: 0 }}>
              {t('profile.add_car_hint')}
            </p>
          </div>
        )}
      </button>

      {/* ====== КАРТОЧКА ВЕРИФИКАЦИИ ====== */}
      <div className="glass-panel" style={{ padding: '1.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: user.is_verified ? 'var(--primary)' : 'var(--bg-subtle)',
            border: user.is_verified ? 'none' : '1px solid var(--border-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ShieldCheck size={20} color={user.is_verified ? 'var(--on-primary)' : 'var(--text-muted)'} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
              {user.is_verified ? t('profile.verified_title') : t('profile.verify_title')}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {user.is_verified
                ? t('profile.verified_desc')
                : t('profile.verify_desc')}
            </div>
          </div>
        </div>

        {!user.is_verified && (
          <>
            {/* Результат запроса */}
            {verifyResult && (
              <div role="status" aria-live="polite" style={{
                marginBottom: 10, padding: '10px 14px', borderRadius: 12,
                background: verifyResult.status === 'verified' ? 'var(--accent-soft)'
                  : verifyResult.status === 'need_telegram' ? 'var(--warning-soft)'
                  : 'var(--danger-soft)',
                border: `1px solid ${
                  verifyResult.status === 'verified' ? 'var(--accent-soft)'
                  : verifyResult.status === 'need_telegram' ? 'var(--warning-border)'
                  : 'var(--danger-border)'
                }`,
                fontSize: '0.82rem',
                color: verifyResult.status === 'verified' ? 'var(--primary)'
                  : verifyResult.status === 'need_telegram' ? 'var(--warning-strong)'
                  : 'var(--danger-strong)',
              }}>
                {verifyResult.message}
              </div>
            )}

            {/* Кнопка ссылки на бота если нужно привязать Telegram */}
            {verifyResult?.status === 'need_telegram' && verifyResult.bot_url && (
              <a
                href={verifyResult.bot_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (isNativeApp()) {
                    e.preventDefault();
                    void openExternalUrl(verifyResult.bot_url);
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  width: '100%', minHeight: 44, padding: '10px 12px', marginBottom: 8,
                  background: 'var(--info-strong)',
                  color: 'var(--on-primary)', borderRadius: 12, textDecoration: 'none',
                  fontWeight: 700, fontSize: '0.9rem',
                }}
              >
                <ExternalLink size={16} />
                {t('profile.open_tg_bot')}
              </a>
            )}

            {/* Основная кнопка верификации */}
            {verifyResult?.status !== 'verified' && (
              <button
                type="button"
                onClick={handleVerify}
                disabled={verifyLoading}
                aria-busy={verifyLoading}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', minHeight: 46, padding: '11px 14px',
                  background: verifyLoading ? 'var(--border-subtle)' : 'var(--primary)',
                  color: verifyLoading ? 'var(--text-subtle)' : 'var(--on-primary)',
                  border: 'none', borderRadius: 12,
                  fontWeight: 700, fontSize: '0.92rem', cursor: verifyLoading ? 'wait' : 'pointer',
                  transition: 'background-color 0.2s ease',
                }}
              >
                {verifyLoading
                  ? <><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> {t('profile.verifying')}</>
                  : verifyResult?.status === 'need_telegram'
                  ? <><RotateCw size={15} /> {t('profile.check_again')}</>
                  : <><ShieldCheck size={16} /> {t('profile.verify_via_tg')}</>}
              </button>
            )}
          </>
        )}
      </div>

      <div className="reviews-section">
        <h3>{t('profile.reviews_title')}</h3>
        {(user.reviews || []).length === 0 ? (
          <p className="no-reviews">{t('profile.no_reviews')}</p>
        ) : (
          <div className="reviews-list">
            {(user.reviews || []).map(review => (
              <div key={review.id} className="review-card glass-panel">
                <div className="review-header">
                  <span className="review-author">{review.author_name}</span>
                  <div className="review-rating">
                    {[...Array(review.rating)].map((_, i) => (
                      <Star key={i} size={12} fill="var(--warning)" color="var(--warning)" />
                    ))}
                  </div>
                </div>
                <p className="review-text">"{review.text}"</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-menu">
        <button type="button" className="menu-item" onClick={onShowHistory}>
          <Clock size={20} color="var(--text-muted)" />
          <span>{t('profile.history')}</span>
          <ChevronRight size={20} color="var(--text-subtle)" style={{ marginLeft: 'auto' }} />
        </button>
        <button type="button" className="menu-item" onClick={onShowSettings}>
          <Settings size={20} color="var(--text-muted)" />
          <span>{t('profile.settings')}</span>
          <ChevronRight size={20} color="var(--text-subtle)" style={{ marginLeft: 'auto' }} />
        </button>
        <a
          href="/terms.html"
          target="_blank"
          rel="noopener noreferrer"
          className="menu-item"
          style={{ textDecoration: 'none' }}
          onClick={(e) => {
            if (isNativeApp()) {
              e.preventDefault();
              void openExternalUrl('/terms.html', { staticWebPath: true });
            }
          }}
        >
          <FileText size={20} color="var(--text-muted)" />
          <span>{t('legal.terms')}</span>
          <ExternalLink size={16} color="var(--text-subtle)" style={{ marginLeft: 'auto' }} />
        </a>
        <a
          href="/privacy.html"
          target="_blank"
          rel="noopener noreferrer"
          className="menu-item"
          style={{ textDecoration: 'none' }}
          onClick={(e) => {
            if (isNativeApp()) {
              e.preventDefault();
              void openExternalUrl('/privacy.html', { staticWebPath: true });
            }
          }}
        >
          <ShieldCheck size={20} color="var(--text-muted)" />
          <span>{t('legal.privacy')}</span>
          <ExternalLink size={16} color="var(--text-subtle)" style={{ marginLeft: 'auto' }} />
        </a>
        <button type="button" className="menu-item" style={{ color: 'var(--danger)' }} onClick={() => {
          if (onLogout) {
            void onLogout();
          } else {
            // Standalone profile usage: clear the server session and cookie
            // instead of only deleting legacy localStorage keys.
            void api.logout().finally(() => window.location.reload());
          }
        }}>
          <LogOut size={20} color="var(--danger)" />
          <span>{t('profile.logout')}</span>
        </button>
      </div>

    </div>
  );
}
