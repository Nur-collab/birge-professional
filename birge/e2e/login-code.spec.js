import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:8765';

function readAuth() {
  return JSON.parse(
    readFileSync(new URL('./.auth.json', import.meta.url), 'utf8'),
  );
}

async function expectLoginScreen(page) {
  await expect(
    page.getByRole('heading', { level: 1, name: 'Вход в BIRGE' }),
  ).toBeVisible({ timeout: 15_000 });
}

test('a ?code= link signs in once and a legacy ?token= is stripped from history', async ({ page, request }) => {
  const auth = readAuth();

  const issued = await request.post(`${apiUrl}/auth/login-code`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(issued.ok()).toBeTruthy();
  const { code } = await issued.json();
  expect(code).toBeTruthy();

  const loginUrl = `/?code=${encodeURIComponent(code)}`;
  await page.goto(loginUrl);

  await expect(page.getByRole('button', {
    name: 'Найти подходящего водителя',
  })).toBeVisible({ timeout: 15_000 });
  await expect(page).not.toHaveURL(/[?&]code=/);

  const stored = await page.evaluate(() => ({
    access: localStorage.getItem('birge_token'),
    refresh: localStorage.getItem('birge_refresh_token'),
    csrf: localStorage.getItem('birge_csrf_token'),
  }));
  expect(stored.access).toBeNull();
  expect(stored.refresh).toBeNull();
  expect(stored.csrf).toBeTruthy();

  const cookies = await page.context().cookies();
  const refreshCookie = cookies.find((cookie) => cookie.name === 'birge_refresh');
  expect(refreshCookie).toBeTruthy();
  expect(refreshCookie.httpOnly).toBe(true);
  expect(refreshCookie.sameSite).toBe('Lax');
  // Set-Cookie must survive the same-origin /api/auth proxy unchanged.
  expect(refreshCookie.path).toBe('/api/auth');
  expect(cookies.some((cookie) => cookie.name === 'birge_csrf')).toBe(true);

  // The same link must not sign in a second time after local state is gone.
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.goto(loginUrl);
  await expectLoginScreen(page);
  await expect(page).not.toHaveURL(/[?&]code=/);
  await expect.poll(async () => page.evaluate(() => (
    localStorage.getItem('birge_csrf_token')
  ))).toBeNull();

  // The old URL contract is neither accepted nor left in history.
  await page.goto('/?ref=history');
  await page.goto(`/?token=${encodeURIComponent(auth.token)}&ref=history`);
  await expectLoginScreen(page);
  await expect(page).not.toHaveURL(/[?&]token=/);
  expect(new URL(page.url()).searchParams.get('ref')).toBe('history');

  const legacyStored = await page.evaluate(() => ({
    access: localStorage.getItem('birge_token'),
    refresh: localStorage.getItem('birge_refresh_token'),
  }));
  expect(legacyStored.access).toBeNull();
  expect(legacyStored.refresh).toBeNull();

  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]token=/);
  await page.goForward();
  await expect(page).not.toHaveURL(/[?&]token=/);
});

test('first screen surfaces Telegram prerequisite and starts Telegram challenge', async ({ page }) => {
  await page.goto('/');
  await expectLoginScreen(page);

  await expect(page.getByText('Важно перед получением кода')).toBeVisible();
  const tgButton = page.getByRole('button', { name: /Войти через @BirgeAuthBot/ });
  await expect(tgButton).toBeVisible();

  await tgButton.click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Подтвердите в Telegram' }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: /Открыть @BirgeAuthBot/ })).toHaveAttribute(
    'href',
    /^https:\/\/t\.me\/.+[?&]start=auth_/,
  );
});
