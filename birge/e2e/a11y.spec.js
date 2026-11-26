import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:8765';

function readAuth() {
  return JSON.parse(
    readFileSync(new URL('./.auth.json', import.meta.url), 'utf8'),
  );
}

async function openAuthenticatedApp(page, request, auth) {
  const issued = await request.post(`${apiUrl}/auth/login-code`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  expect(issued.ok()).toBeTruthy();
  const { code } = await issued.json();

  await page.goto(`/?code=${encodeURIComponent(code)}`);
  await expect(page.getByRole('button', {
    name: 'Найти подходящего водителя',
  })).toBeVisible({ timeout: 15_000 });
}

async function settleAnimations(page) {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations()
        .filter((anim) => anim.effect?.getTiming?.().iterations !== Infinity)
        .map((anim) => anim.finished.catch(() => {})),
    ),
  );
}

async function setTheme(page, theme) {
  await page.evaluate((nextTheme) => {
    document.documentElement.setAttribute('data-theme', nextTheme);
  }, theme);
  await settleAnimations(page);
  await page.waitForTimeout(300);
}

async function collectAxeAudit(page, contextLabel, allViolations) {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  if (results.violations.length > 0) {
    allViolations.push({
      screen: contextLabel,
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.slice(0, 3).map((n) => ({
          target: n.target,
          failureSummary: n.failureSummary,
        })),
      })),
    });
  }
}

test('login screen and telegram challenge pass WCAG 2.1 AA in light and dark themes', async ({ page }) => {
  const allViolations = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Вход в BIRGE' }),
  ).toBeVisible({ timeout: 15_000 });

  await collectAxeAudit(page, 'Login (light)', allViolations);

  await setTheme(page, 'dark');
  await collectAxeAudit(page, 'Login (dark)', allViolations);

  await setTheme(page, 'light');
  await page.getByRole('button', { name: /Войти через @BirgeAuthBot/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Подтвердите в Telegram' }),
  ).toBeVisible({ timeout: 10_000 });
  await collectAxeAudit(page, 'Login Telegram Challenge', allViolations);

  expect(allViolations, 'Axe violations on login flow').toEqual([]);
});

test('authenticated screens pass WCAG 2.1 AA in light and dark themes on mobile', async ({ page, request }) => {
  const allViolations = [];
  await page.setViewportSize({ width: 390, height: 844 });
  const auth = readAuth();
  await openAuthenticatedApp(page, request, auth);

  // Dashboard (light & dark)
  await collectAxeAudit(page, 'Dashboard passenger (light)', allViolations);
  await page.getByRole('button', { name: 'Водитель', exact: true }).click();
  await collectAxeAudit(page, 'Dashboard driver (light)', allViolations);

  const themeBtn = page.getByRole('button', { name: 'Сменить тему оформления' });
  await themeBtn.click();
  await page.waitForTimeout(350);
  await collectAxeAudit(page, 'Dashboard driver (dark)', allViolations);

  // Bottom navigation tabs in dark & light themes
  await page.getByRole('button', { name: /Попутчики/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Нет активного поиска|Попутчики|Активные|Запросы/i })).toBeVisible({ timeout: 5_000 });
  await collectAxeAudit(page, 'Matches (dark)', allViolations);
  await setTheme(page, 'light');
  await collectAxeAudit(page, 'Matches (light)', allViolations);

  await setTheme(page, 'dark');
  await page.getByRole('button', { name: /Поездки/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Запланированные/i })).toBeVisible({ timeout: 5_000 });
  await collectAxeAudit(page, 'ScheduledTrips (dark)', allViolations);

  await page.getByRole('button', { name: 'Профиль' }).click();
  await expect(page.getByRole('button', { name: 'Настройки' })).toBeVisible({ timeout: 5_000 });
  await collectAxeAudit(page, 'Profile (dark)', allViolations);

  await page.getByRole('button', { name: 'Настройки' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Настройки' })).toBeVisible({ timeout: 5_000 });
  await collectAxeAudit(page, 'Settings (dark)', allViolations);

  // Switch back to light theme for Profile, Settings, TripHistory
  await setTheme(page, 'light');
  await collectAxeAudit(page, 'Settings (light)', allViolations);

  await page.getByRole('button', { name: /Назад/i }).click();
  await page.waitForTimeout(350);
  await collectAxeAudit(page, 'Profile (light)', allViolations);

  await page.getByRole('button', { name: /История поездок/i }).click();
  await expect(page.getByRole('heading', { level: 2, name: /История поездок/i })).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(350);
  await collectAxeAudit(page, 'TripHistory (light)', allViolations);
  await setTheme(page, 'dark');
  await collectAxeAudit(page, 'TripHistory (dark)', allViolations);

  // Verify bottom nav tap targets meet mobile ergonomics (>= 44px height)
  const smallNavButtons = await page.evaluate(() => (
    Array.from(document.querySelectorAll('.bottom-nav .nav-item')).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height < 44 || r.width < 44;
    }).length
  ));
  expect(smallNavButtons).toBe(0);

  expect(allViolations, 'Axe violations across authenticated screens').toEqual([]);
});

test('switching language to Kyrgyz translates main shell, dashboard, and passes axe', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const auth = readAuth();
  await openAuthenticatedApp(page, request, auth);

  await page.getByRole('button', { name: 'Профиль' }).click();
  await page.getByRole('button', { name: 'Настройки' }).click();

  await page.getByRole('combobox', { name: 'Язык приложения' }).selectOption('ky');
  await expect.poll(async () => page.evaluate(() => document.documentElement.lang)).toBe('ky');
  await expect(page.getByRole('heading', { level: 2, name: 'Ырастоолор' })).toBeVisible();

  await page.getByRole('button', { name: 'Издөө' }).click();
  await expect(page.getByRole('button', { name: 'Ылайыктуу айдоочуну табуу' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Жолдоштор' })).toBeVisible();

  const kyViolations = [];
  await collectAxeAudit(page, 'Dashboard (ky)', kyViolations);
  expect(kyViolations).toEqual([]);
});
