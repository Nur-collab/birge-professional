import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import {
    PAGE_CACHE_NAME,
    purgeSensitivePageCache,
    shouldCacheNavigation,
} from './swPolicy.js';

// Это обязательная часть для vite-plugin-pwa injectManifest
cleanupOutdatedCaches();
// directoryIndex: null — запрос "/" не матчится по index.html, иначе навигация
// снова станет cache-first и после деплоя отдаст старый бандл.
precacheAndRoute(self.__WB_MANIFEST, { directoryIndex: null });

// HTML всегда запрашивается из сети. Прекеш index.html используется только
// как офлайн-запас для навигаций, которых ещё нет в runtime-кеше.
const navigationRoute = registerRoute(
    shouldCacheNavigation,
    new NetworkFirst({ cacheName: PAGE_CACHE_NAME, networkTimeoutSeconds: 3 })
);
navigationRoute.setCatchHandler(async ({ request }) => {
    if (request.mode !== 'navigate') return Response.error();
    return (await matchPrecache('/index.html')) || Response.error();
});

// Удаляем из runtime-кеша навигации, оставленные старой версией SW.
self.addEventListener('activate', (event) => {
    event.waitUntil(purgeSensitivePageCache());
});

// Позволяет Service Worker моментально взять контроль над страницей
self.skipWaiting();
clientsClaim();

// Обработка входящего Push-уведомления (если бэкенд шлёт реальные Web Push)
self.addEventListener('push', (event) => {
    if (!event.data) return;

    try {
        const data = event.data.json();

        const options = {
            body: data.message || 'Новое уведомление',
            icon: '/pwa-192x192.png',
            badge: '/mask-icon.svg',
            vibrate: [100, 50, 100],
            data: {
                url: data.url || '/'
            }
        };

        event.waitUntil(
            self.registration.showNotification(data.title || 'БИРГЕ', options)
        );
    } catch (e) {
        console.error('Ошибка при обработке push-уведомления:', e);
    }
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const rawUrl = event.notification.data?.url || '/';
    const resolvedUrl = new URL(rawUrl, self.location.origin).href;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
            for (const client of clientList) {
                if (client.url === resolvedUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    if ('navigate' in client) {
                        await client.navigate(resolvedUrl);
                    }
                    return client.focus();
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(resolvedUrl);
            }
        })
    );
});
