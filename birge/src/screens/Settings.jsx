import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Save, Car, User, Camera, ShieldAlert, Globe, CreditCard, Smartphone, Download, Trash2, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
import './Settings.css';

export default function Settings({ currentUser, onBack, onUpdate, onAccountDeleted }) {
  const { t, i18n } = useTranslation();
  const [formData, setFormData] = useState({
    name: currentUser?.name || '',
    photo: currentUser?.photo || '',
    car_model: currentUser?.car_model || '',
    car_color: currentUser?.car_color || '',
    car_plate: currentUser?.car_plate || '',
    mbank_phone: currentUser?.mbank_phone || '',
    elkart_number: currentUser?.elkart_number || '',
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [privacyNotice, setPrivacyNotice] = useState({ type: '', text: '' });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const savedTimerRef = useRef(null);
  const deleteCancelRef = useRef(null);

  useEffect(() => () => {
    clearTimeout(savedTimerRef.current);
  }, []);

  useEffect(() => {
    if (!showDeleteModal) return undefined;
    deleteCancelRef.current?.focus();
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !deleting) {
        setShowDeleteModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDeleteModal, deleting]);

  const handleLanguageChange = (e) => {
    i18n.changeLanguage(e.target.value);
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setSaved(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const updatedUser = await api.updateProfile(formData);
      setSaved(true);
      if (onUpdate) onUpdate(updatedUser);
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(t('settings.save_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleExportData = async () => {
    if (exporting) return;
    setExporting(true);
    setPrivacyNotice({ type: '', text: '' });
    let objectUrl = null;
    try {
      const payload = await api.exportMyData();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const dateStamp = new Date().toISOString().slice(0, 10);
        link.href = objectUrl;
        link.download = `birge-data-export-${dateStamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setPrivacyNotice({ type: 'success', text: t('settings.export_success') });
    } catch (err) {
      setPrivacyNotice({ type: 'error', text: err?.message || t('settings.export_error') });
    } finally {
      if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(objectUrl);
      }
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirmed || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api.deleteAccount();
      setShowDeleteModal(false);
      if (onAccountDeleted) onAccountDeleted();
    } catch (err) {
      const msg = err?.status === 409
        ? t('settings.delete_active_trip_error')
        : (err?.message || t('settings.delete_error'));
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="settings screen-content">
      <div className="settings-header">
        <button type="button" className="back-btn" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft size={24} aria-hidden="true" />
        </button>
        <h2>{t('settings.title')}</h2>
        <div style={{ width: 24 }}></div>
      </div>

      <form onSubmit={handleSubmit} className="settings-form">

        {/* Блок Язык приложения */}
        <div className="settings-section glass-panel">
          <div className="section-title">
            <Globe size={18} color="var(--primary)" />
            <span>{t('settings.language')}</span>
          </div>
          <div className="form-group">
            <select
              aria-label={t('settings.language')}
              value={i18n.language}
              onChange={handleLanguageChange}
              className="language-select"
            >
              <option value="ru">Русский</option>
              <option value="ky">Кыргызча</option>
            </select>
          </div>
        </div>

        {/* Блок Личные данные */}
        <div className="settings-section glass-panel">
          <div className="section-title">
            <User size={18} color="var(--primary)" />
            <span>{t('settings.personal')}</span>
          </div>

          <div className="form-group">
            <label htmlFor="settings-name">{t('settings.name')}</label>
            <input
              id="settings-name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="settings-photo">{t('settings.photo_url')}</label>
            <div className="input-with-icon">
              <Camera size={18} color="var(--text-subtle)" aria-hidden="true" />
              <input
                id="settings-photo"
                type="text"
                name="photo"
                value={formData.photo}
                onChange={handleChange}
                placeholder="https://..."
              />
            </div>
            {formData.photo && (
              <img
                src={formData.photo}
                alt={t('settings.photo_preview')}
                style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover', marginTop: 10, border: '2px solid var(--bg-card)', boxShadow: '0 2px 4px var(--shadow-medium)' }}
                onError={(e) => e.target.style.display = 'none'}
              />
            )}
          </div>
        </div>

        {/* Блок Данные машины */}
        <div className="settings-section glass-panel">
          <div className="section-title">
            <Car size={18} color="var(--primary)" />
            <span>{t('settings.driver_info')}</span>
          </div>

          <div className="form-group">
            <label htmlFor="settings-car-model">{t('settings.car_model')}</label>
            <input
              id="settings-car-model"
              type="text"
              name="car_model"
              value={formData.car_model}
              onChange={handleChange}
              placeholder="e.g. Toyota Camry"
            />
          </div>

          <div className="form-group" style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="settings-car-color">{t('settings.car_color')}</label>
              <input
                id="settings-car-color"
                type="text"
                name="car_color"
                value={formData.car_color}
                onChange={handleChange}
                placeholder={t('settings.car_color_placeholder')}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="settings-car-plate">{t('settings.car_plate')}</label>
              <input
                id="settings-car-plate"
                type="text"
                name="car_plate"
                value={formData.car_plate}
                onChange={handleChange}
                placeholder="01KG 123 ABC"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
          </div>
        </div>

        {/* Блок Реквизиты оплаты (MBank / Элкарт) */}
        <div className="settings-section glass-panel">
          <div className="section-title">
            <CreditCard size={18} color="var(--primary)" />
            <span>{t('settings.payment_info')}</span>
          </div>

          <div className="form-group">
            <label htmlFor="settings-mbank-phone">{t('settings.mbank_phone')}</label>
            <div className="input-with-icon">
              <Smartphone size={18} color="var(--text-subtle)" aria-hidden="true" />
              <input
                id="settings-mbank-phone"
                type="tel"
                name="mbank_phone"
                value={formData.mbank_phone}
                onChange={handleChange}
                placeholder="0555 123 456"
              />
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0 2px' }}>
              {t('settings.mbank_hint')}
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="settings-elkart-number">{t('settings.elkart_number')}</label>
            <div className="input-with-icon">
              <CreditCard size={18} color="var(--text-subtle)" aria-hidden="true" />
              <input
                id="settings-elkart-number"
                type="text"
                name="elkart_number"
                value={formData.elkart_number}
                onChange={handleChange}
                placeholder="9417 0000 0000 0000"
                maxLength={19}
              />
            </div>
          </div>
        </div>

        {/* Блок Безопасность */}
        <div className="settings-section glass-panel" style={{ borderLeft: '4px solid var(--warning)' }}>
          <div className="section-title" style={{ color: 'var(--warning)' }}>
            <ShieldAlert size={18} />
            <span>{t('settings.verification_section')}</span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            {t('settings.your_phone')} <b>{currentUser?.phone}</b>
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {t('settings.status_label')} {currentUser?.is_verified ? <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{t('settings.status_verified')}</span> : <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{t('settings.status_basic')}</span>}
          </p>
        </div>

        {error && <div className="error-msg" role="alert">{error}</div>}

        <button
          type="submit"
          className="primary-btn save-btn"
          disabled={loading || saved}
          aria-busy={loading}
        >
          {loading ? <div className="loader-small" aria-hidden="true"></div> : <Save size={20} aria-hidden="true" />}
          <span>{saved ? t('settings.saved_success') : t('save')}</span>
        </button>

      </form>

      {/* Блок Данные и конфиденциальность */}
      <section className="settings-section glass-panel" style={{ marginTop: '1.2rem' }} aria-labelledby="settings-privacy-heading">
        <div className="section-title" id="settings-privacy-heading">
          <FileText size={18} color="var(--primary)" aria-hidden="true" />
          <span>{t('settings.privacy_section')}</span>
        </div>
        <p className="section-desc" style={{ marginTop: 0 }}>
          {t('settings.privacy_desc')}
        </p>
        <div className="privacy-links">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">{t('auth.legal_privacy')}</a>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">{t('auth.legal_terms')}</a>
        </div>

        <div className="privacy-actions">
          <button
            type="button"
            className="export-data-btn"
            onClick={handleExportData}
            disabled={exporting}
            aria-busy={exporting}
          >
            <Download size={17} aria-hidden="true" />
            <span>{exporting ? t('settings.exporting') : t('settings.export_data')}</span>
          </button>

          <button
            type="button"
            className="delete-account-trigger-btn"
            onClick={() => {
              setDeleteConfirmed(false);
              setDeleteError('');
              setShowDeleteModal(true);
            }}
          >
            <Trash2 size={17} aria-hidden="true" />
            <span>{t('settings.delete_account')}</span>
          </button>
        </div>

        {privacyNotice.text && (
          <div
            className={`privacy-feedback ${privacyNotice.type === 'success' ? 'is-success' : 'is-error'}`}
            role={privacyNotice.type === 'error' ? 'alert' : 'status'}
          >
            {privacyNotice.text}
          </div>
        )}
      </section>

      {showDeleteModal && (
        <div
          className="delete-modal-overlay"
          onClick={() => !deleting && setShowDeleteModal(false)}
        >
          <div
            className="delete-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            aria-describedby="delete-account-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-account-title" className="delete-modal-title">
              {t('settings.delete_modal_title')}
            </h3>
            <p id="delete-account-desc" className="delete-modal-desc">
              {t('settings.delete_modal_desc')}
            </p>

            <label className="delete-confirm-checkbox" htmlFor="confirm-delete-account">
              <input
                id="confirm-delete-account"
                type="checkbox"
                checked={deleteConfirmed}
                onChange={(e) => setDeleteConfirmed(e.target.checked)}
                disabled={deleting}
              />
              <span>{t('settings.delete_confirm_checkbox')}</span>
            </label>

            {deleteError && (
              <div className="privacy-feedback is-error" role="alert">
                {deleteError}
              </div>
            )}

            <div className="delete-modal-actions">
              <button
                ref={deleteCancelRef}
                type="button"
                className="delete-cancel-btn"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                className="delete-confirm-btn"
                onClick={handleDeleteAccount}
                disabled={!deleteConfirmed || deleting}
                aria-busy={deleting}
              >
                {deleting ? t('settings.deleting') : t('settings.delete_confirm_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
