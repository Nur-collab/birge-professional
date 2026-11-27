import React, { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './InstallPWA.css';

export default function InstallPWA() {
    const { t } = useTranslation();
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showInstallBtn, setShowInstallBtn] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);

    useEffect(() => {
        // Проверяем, установлено ли приложение
        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
            setIsInstalled(true);
            return;
        }

        const handleBeforeInstallPrompt = (e) => {
            // Предотвращаем автоматический показ Safari/Chrome
            e.preventDefault();
            setDeferredPrompt(e);
            setShowInstallBtn(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstallClick = async () => {
        if (!deferredPrompt) return;

        deferredPrompt.prompt();

        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            setShowInstallBtn(false);
            setDeferredPrompt(null);
        }
    };

    if (!showInstallBtn || isInstalled) return null;

    return (
        <div className="install-banner glass-panel" role="region" aria-label={t('install.aria')}>
            <div className="install-content">
                <div className="install-icon" aria-hidden="true">Б</div>
                <div className="install-text">
                    <p className="install-title">{t('install.title')}</p>
                    <p className="install-desc">{t('install.desc')}</p>
                </div>
            </div>
            <div className="install-actions">
                <button type="button" className="primary-btn install-btn" onClick={handleInstallClick}>
                    <Download size={14} aria-hidden="true" /> {t('install.btn')}
                </button>
                <button type="button" className="close-btn" onClick={() => setShowInstallBtn(false)} aria-label={t('install.close_aria')}>
                    <X size={16} aria-hidden="true" />
                </button>
            </div>

        </div>
    );
}
