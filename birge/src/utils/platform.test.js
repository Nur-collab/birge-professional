import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAuthBaseUrl,
  isNativeApp,
  openExternalUrl,
  requestNotificationPermissionSafely,
  resolveExternalUrl,
  showSystemNotificationSafely,
} from './platform';

describe('platform runtime helpers', () => {
  afterEach(() => {
    delete window.Capacitor;
    vi.restoreAllMocks();
  });

  it('uses /api/auth on web and direct API /auth in Capacitor WebView', () => {
    expect(isNativeApp()).toBe(false);
    expect(getAuthBaseUrl('https://birge-api.onrender.com')).toBe('/api/auth');

    window.Capacitor = { isNativePlatform: () => true };
    expect(isNativeApp()).toBe(true);
    expect(getAuthBaseUrl('https://birge-api.onrender.com/')).toBe('https://birge-api.onrender.com/auth');
  });

  it('resolves static legal paths to public web origin inside native WebView', () => {
    expect(resolveExternalUrl('/terms.html', { staticWebPath: true })).toBe('/terms.html');

    window.Capacitor = { isNativePlatform: () => true };
    expect(resolveExternalUrl('/terms.html', { staticWebPath: true })).toBe(
      'https://birge-professional.vercel.app/terms.html',
    );
  });

  it('uses Capacitor Browser plugin when available in native runtime', async () => {
    const browserOpen = vi.fn().mockResolvedValue(undefined);
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: { Browser: { open: browserOpen } },
    };

    const opened = await openExternalUrl('/privacy.html', { staticWebPath: true });
    expect(opened).toBe(true);
    expect(browserOpen).toHaveBeenCalledWith({
      url: 'https://birge-professional.vercel.app/privacy.html',
    });
  });

  it('never throws when Notification API crashes in mobile WebView', () => {
    const originalNotification = window.Notification;
    try {
      window.Notification = Object.assign(
        function ThrowingNotification() {
          throw new TypeError('Illegal constructor');
        },
        {
          permission: 'default',
          requestPermission: () => {
            throw new Error('Not supported in WebView');
          },
        },
      );
      expect(() => requestNotificationPermissionSafely()).not.toThrow();

      window.Notification.permission = 'granted';
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      expect(() => showSystemNotificationSafely('Test', { body: 'Hi' })).not.toThrow();
    } finally {
      window.Notification = originalNotification;
      delete document.hidden;
    }
  });
});
