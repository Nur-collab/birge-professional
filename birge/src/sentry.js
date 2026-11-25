let sentryClient = null
let initPromise = null

// Sentry is optional and lazy-loaded: without a DSN the SDK is not imported,
// initialized or contacted from development, tests or a DSN-less deployment.
export function initSentry() {
  if (initPromise) return initPromise
  const dsn = (import.meta.env.VITE_SENTRY_DSN || '').trim()
  if (!dsn) return Promise.resolve(false)

  initPromise = (async () => {
    try {
      const Sentry = await import('@sentry/react')
      Sentry.init({
        dsn,
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
        release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: import.meta.env.PROD ? 0.05 : 1.0,
        sendDefaultPii: false,
      })
      sentryClient = Sentry
      return true
    } catch (error) {
      console.warn('[Sentry] initialization failed', error)
      return false
    }
  })()

  return initPromise
}

export function captureException(error, context) {
  if (sentryClient) {
    sentryClient.captureException(error, context)
    return
  }
  initPromise?.then(() => sentryClient?.captureException(error, context))
}
