import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/bundler-plugins/vite'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const isMobileBuild = mode === 'mobile' || env.VITE_NATIVE_APP === 'true'
    const apiUrl = (env.VITE_API_URL || '').trim()
    const sentryAuthToken = (env.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN || '').trim()
    const enableSentrySourcemaps = mode === 'production' && Boolean(sentryAuthToken)
    // Auth must be same-origin so the HttpOnly refresh cookie is first-party.
    // Vite (dev/preview) and Vercel both expose the same /api/auth path and
    // forward it to the backend's /auth router.
    const authProxy = {
        '/api/auth': {
            target: apiUrl || 'http://127.0.0.1:8000',
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api\/auth/, '/auth'),
        },
    }

    // .env.local is loaded in every Vite mode, including production/mobile.
    // Fail loudly instead of shipping a build that calls a developer machine.
    if ((mode === 'production' || mode === 'mobile') && /(^|:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(apiUrl)) {
        throw new Error(
            `Refusing ${mode} build: VITE_API_URL points to a local address (${apiUrl}). ` +
            'Set the production URL in the hosting environment or .env.production.'
        )
    }

    return {
    define: isMobileBuild
        ? { 'import.meta.env.VITE_NATIVE_APP': JSON.stringify('true') }
        : undefined,
    server: { proxy: authProxy },
    preview: { proxy: authProxy },
    plugins: [
        react(),
        VitePWA({
            disable: isMobileBuild,
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.js',
            registerType: 'autoUpdate',
            injectManifest: {
                // Избегаем кеширования больших ассетов и source maps
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
                globIgnores: ['**/*.map'],
            },
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'apple-touch-icon.svg', 'mask-icon.svg'],
            manifest: {
                name: 'БИРГЕ — Попутные поездки',
                short_name: 'БИРГЕ',
                description: 'Твой сосед — твой попутчик. Карпулинг в Бишкеке.',
                theme_color: '#0f6b57',
                background_color: '#f5f3ee',
                display: 'standalone',
                orientation: 'portrait',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    },
                    {
                        src: 'pwa-icon.svg',
                        sizes: '512x512',
                        type: 'image/svg+xml',
                        purpose: 'any'
                    }
                ]
            }
        }),
        ...(enableSentrySourcemaps ? [
            sentryVitePlugin({
                org: 'birge',
                project: 'birge-web',
                authToken: sentryAuthToken,
                sourcemaps: {
                    filesToDeleteAfterUpload: ['./dist/**/*.map'],
                },
            }),
        ] : []),
    ],
    build: {
        sourcemap: enableSentrySourcemaps ? 'hidden' : false,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
                        return 'vendor-react';
                    }
                    if (id.includes('node_modules/leaflet')) {
                        return 'vendor-maps';
                    }
                    if (id.includes('node_modules/lucide-react')) {
                        return 'vendor-icons';
                    }
                },
            },
        },
        chunkSizeWarningLimit: 600,
    },
    }
})
