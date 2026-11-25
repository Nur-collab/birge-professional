export const PAGE_CACHE_NAME = 'pages';

// These query parameters can contain a credential. Navigation responses with
// them must never be stored in Cache Storage, even though main.jsx removes the
// parameter from the address bar after the document has loaded.
const SENSITIVE_AUTH_PARAMS = new Set(['token', 'code']);

export function isSensitiveAuthNavigation(url) {
    try {
        const parsed = new URL(url, 'https://birge.local');
        for (const key of parsed.searchParams.keys()) {
            if (SENSITIVE_AUTH_PARAMS.has(key.toLowerCase())) {
                return true;
            }
        }
    } catch {
        // A malformed navigation URL is not safe to cache either.
        return true;
    }
    return false;
}

// Workbox calls route matchers with { url, request, event, sameOrigin }.
export function shouldCacheNavigation({ request } = {}) {
    return request?.mode === 'navigate' && !isSensitiveAuthNavigation(request.url);
}

/**
 * Remove entries left in the runtime navigation cache by older service worker
 * versions. This runs on activation, before the new worker serves requests.
 */
export async function purgeSensitivePageCache(cacheStorage = globalThis.caches) {
    if (!cacheStorage || typeof cacheStorage.has !== 'function' || typeof cacheStorage.open !== 'function') {
        return 0;
    }
    if (!(await cacheStorage.has(PAGE_CACHE_NAME))) {
        return 0;
    }

    const cache = await cacheStorage.open(PAGE_CACHE_NAME);
    const requests = await cache.keys();
    const sensitiveRequests = requests.filter((request) => isSensitiveAuthNavigation(request.url));
    await Promise.all(sensitiveRequests.map((request) => cache.delete(request)));
    return sensitiveRequests.length;
}
