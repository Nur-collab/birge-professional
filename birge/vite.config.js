import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const apiUrl = (env.VITE_API_URL || '').trim()

    // .env.local is loaded in every Vite mode, including production.
    // Fail loudly instead of shipping a build that calls a developer machine.
    if (mode === 'production' && /(^|:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(apiUrl)) {
        throw new Error(
            `Refusing production build: VITE_API_URL points to a local address (${apiUrl}). ` +
            'Set the production URL in the hosting environment or .env.production.'
        )
    }

    return {
    plugins: [
        react(),
        VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.js',
            registerType: 'autoUpdate',
            injectManifest: {
                // index.html не прекешируется: иначе старый service worker
                // отдаёт HTML со ссылками на предыдущий бандл до обновления SW.
                globIgnores: ['**/index.html'],
                // Избегаем кеширования больших ассетов
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024
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
        })
    ],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
                        return 'vendor-react';
                    }
                    if (id.includes('node_modules/@pbe')) {
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
