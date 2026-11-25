import { describe, expect, it, vi } from 'vitest';

import {
  PAGE_CACHE_NAME,
  isSensitiveAuthNavigation,
  purgeSensitivePageCache,
  shouldCacheNavigation,
} from './swPolicy';

describe('service worker navigation cache policy', () => {
  it.each([
    ['https://birge.app/?token=legacy-access-token', true],
    ['https://birge.app/?ref=bot&code=one-time-code', true],
    ['https://birge.app/?TOKEN=legacy-access-token', true],
    ['https://birge.app/?ref=history', false],
    ['https://birge.app/trips/42', false],
  ])('classifies %s as sensitive=%s', (url, expected) => {
    expect(isSensitiveAuthNavigation(url)).toBe(expected);
  });

  it('only caches ordinary navigations', () => {
    expect(shouldCacheNavigation({
      request: { mode: 'navigate', url: 'https://birge.app/?token=legacy' },
    })).toBe(false);
    expect(shouldCacheNavigation({
      request: { mode: 'navigate', url: 'https://birge.app/trips/42' },
    })).toBe(true);
    expect(shouldCacheNavigation({
      request: { mode: 'cors', url: 'https://birge.app/api/trips' },
    })).toBe(false);
  });

  it('purges sensitive entries left by an older service worker', async () => {
    const sensitiveRequest = { url: 'https://birge.app/?token=legacy' };
    const codeRequest = { url: 'https://birge.app/?code=one-time' };
    const normalRequest = { url: 'https://birge.app/?ref=history' };
    const cache = {
      keys: vi.fn(async () => [sensitiveRequest, normalRequest, codeRequest]),
      delete: vi.fn(async () => true),
    };
    const cacheStorage = {
      has: vi.fn(async () => true),
      open: vi.fn(async () => cache),
    };

    await expect(purgeSensitivePageCache(cacheStorage)).resolves.toBe(2);

    expect(cacheStorage.open).toHaveBeenCalledWith(PAGE_CACHE_NAME);
    expect(cache.delete).toHaveBeenCalledWith(sensitiveRequest);
    expect(cache.delete).toHaveBeenCalledWith(codeRequest);
    expect(cache.delete).not.toHaveBeenCalledWith(normalRequest);
  });

  it('does not create the page cache when it does not exist', async () => {
    const cacheStorage = {
      has: vi.fn(async () => false),
      open: vi.fn(),
    };

    await expect(purgeSensitivePageCache(cacheStorage)).resolves.toBe(0);
    expect(cacheStorage.open).not.toHaveBeenCalled();
  });
});
