let sentryClient = null

// Sentry is optional and lazy-loaded: without a DSN the SDK is not imported,
// initialized or contacted from development, tests or a DSN-less deployment.
export async function initSentry() {
  const dsn = (import.meta.env.VITE_SENTRY_DSN || '').trim()
  if (!dsn) return false

  try {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
    })
    sentryClient = Sentry
    return true
  } catch (error) {
    console.warn('[Sentry] initialization failed', error)
    return false
  }
}

export function captureException(error, context) {
  sentryClient?.captureException(error, context)
}
