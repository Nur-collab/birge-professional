// ==============================================================================
// RUNTIME PLATFORM HELPERS (WEB / PWA + CAPACITOR MOBILE WEBVIEW)
// Keeps web behavior unchanged while avoiding WebView-only crashes on iOS/Android.
// ==============================================================================

const PUBLIC_WEB_ORIGIN = (
  import.meta.env.VITE_PUBLIC_WEB_ORIGIN || 'https://birge-professional.vercel.app'
).replace(/\/+$/, '');

export function isNativeApp() {
  if (import.meta.env.VITE_NATIVE_APP === 'true') {
    return true;
  }
  if (typeof window === 'undefined') return false;
  try {
    if (window.Capacitor?.isNativePlatform?.()) return true;
    const protocol = window.location?.protocol || '';
    if (protocol === 'capacitor:' || protocol === 'ionic:' || protocol === 'file:') {
      return true;
    }
  } catch {
    // Ignore restricted location/bridge reads.
  }
  return false;
}

export function getAuthBaseUrl(apiUrl) {
  if (isNativeApp()) {
    const cleanApi = (apiUrl || '').trim().replace(/\/+$/, '');
    return `${cleanApi}/auth`;
  }
  return '/api/auth';
}

export function resolveExternalUrl(url, { staticWebPath = false } = {}) {
  if (!url) return '';
  if (staticWebPath && url.startsWith('/') && isNativeApp()) {
    return `${PUBLIC_WEB_ORIGIN}${url}`;
  }
  return url;
}

export async function openExternalUrl(url, options = {}) {
  const targetUrl = resolveExternalUrl(url, options);
  if (!targetUrl || typeof window === 'undefined') return false;

  try {
    const capBrowser = window.Capacitor?.Plugins?.Browser;
    if (isNativeApp() && capBrowser?.open) {
      await capBrowser.open({ url: targetUrl });
      return true;
    }
  } catch {
    // Fall back to standard browser opening if plugin call fails.
  }

  try {
    if (typeof window.open === 'function') {
      const opened = window.open(targetUrl, '_blank', 'noopener,noreferrer');
      if (opened) return true;
    }
  } catch {
    // Ignore popup blocker failures.
  }

  // Last-resort navigation only for external HTTPS/deep-link targets inside native WebView.
  if (isNativeApp() && /^https?:\/\//i.test(targetUrl)) {
    window.location.href = targetUrl;
    return true;
  }
  return false;
}

export function requestNotificationPermissionSafely() {
  if (isNativeApp() || typeof window === 'undefined') return;
  try {
    if (
      'Notification' in window
      && window.Notification
      && window.Notification.permission === 'default'
      && typeof window.Notification.requestPermission === 'function'
    ) {
      const maybePromise = window.Notification.requestPermission();
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {});
      }
    }
  } catch {
    // WebView/browser denied or threw synchronously.
  }
}

export function showSystemNotificationSafely(title, options = {}) {
  if (isNativeApp() || typeof window === 'undefined' || typeof document === 'undefined') return;
  try {
    if (
      'Notification' in window
      && typeof window.Notification === 'function'
      && window.Notification.permission === 'granted'
      && document.hidden
    ) {
      new window.Notification(title, options);
    }
  } catch {
    // Some Android browsers/WebViews forbid `new Notification()` directly.
  }
}

export async function copyToClipboardSafely(text) {
  if (!text || typeof navigator === 'undefined') return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below when clipboard API requires user gesture / is unavailable.
  }
  return false;
}

export async function exportJsonFile(filename, payload) {
  const json = JSON.stringify(payload, null, 2);

  if (isNativeApp() && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: filename, text: json });
      return 'shared';
    } catch {
      // User dismissed share or share rejected; fall back to blob/clipboard.
    }
  }

  let objectUrl = null;
  try {
    if (
      !isNativeApp()
      && typeof Blob !== 'undefined'
      && typeof URL !== 'undefined'
      && typeof URL.createObjectURL === 'function'
    ) {
      const blob = new Blob([json], { type: 'application/json' });
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      return 'downloaded';
    }
  } finally {
    if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (await copyToClipboardSafely(json)) {
    return 'clipboard';
  }
  throw new Error('Export is unavailable on this device');
}
