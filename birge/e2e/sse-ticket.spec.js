import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

test('passenger search exchanges the access token for an SSE ticket', async ({ page, request }) => {
  const auth = readAuth();
  await openAuthenticatedApp(page, request, auth);

  const searchButton = page.getByRole('button', {
    name: 'Найти подходящего водителя',
  });
  await expect(searchButton).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder('Откуда едем...').fill('Жилмассив Ала-Арча');
  await page.getByPlaceholder('Куда направляемся...').fill('ЦУМ (Центр)');

  const ticketResponsePromise = page.waitForResponse(
    (response) => response.url().includes('/trip-requests/sse-ticket')
      && response.request().method() === 'POST',
  );
  const ticketRequestPromise = page.waitForRequest(
    (request) => request.url().includes('/trip-requests/sse-ticket')
      && request.method() === 'POST',
  );
  const sseRequestPromise = page.waitForRequest(
    (request) => request.url().includes(`/trip-requests/events/${auth.userId}`),
  );
  const sseResponsePromise = page.waitForResponse(
    (response) => response.url().includes(`/trip-requests/events/${auth.userId}`),
  );

  await searchButton.click();

  const ticketResponse = await ticketResponsePromise;
  expect(ticketResponse.status()).toBe(200);
  const ticketBody = await ticketResponse.json();
  expect(ticketBody.ticket).toBeTruthy();
  expect(ticketBody.expires_in).toBe(60);

  const ticketRequest = await ticketRequestPromise;
  expect(ticketRequest.headers().authorization).toMatch(/^Bearer \S+$/);

  const sseRequest = await sseRequestPromise;
  const sseUrl = new URL(sseRequest.url());
  const sseTicket = sseUrl.searchParams.get('ticket');
  // The dev app can create more than one ticket while StrictMode mounts the
  // search screen; the stream must use a ticket, not necessarily the first one
  // observed by the response listener.
  expect(sseTicket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  expect(sseTicket).not.toBe(auth.token);
  expect(sseUrl.searchParams.get('token')).toBeNull();
  expect(sseUrl.href).not.toContain(auth.token);

  const sseResponse = await sseResponsePromise;
  expect(sseResponse.status()).toBe(200);
  expect(sseResponse.headers()['content-type']).toContain('text/event-stream');
});

test('access token in the SSE query is rejected by the browser', async ({ page, request }) => {
  const auth = readAuth();
  await openAuthenticatedApp(page, request, auth);

  const result = await page.evaluate(async ({ userId, token, api }) => {
    const source = new EventSource(
      `${api}/trip-requests/events/${userId}?token=${encodeURIComponent(token)}`,
    );
    return new Promise((resolve) => {
      const finish = (value) => {
        source.close();
        resolve(value);
      };
      source.onopen = () => finish('opened');
      source.onerror = () => finish('rejected');
      window.setTimeout(() => finish('timeout'), 3_000);
    });
  }, { userId: auth.userId, token: auth.token, api: apiUrl });

  expect(result).toBe('rejected');
});

test('logout revokes an already issued SSE ticket in the browser', async ({ page, request }) => {
  const auth = readAuth();
  await openAuthenticatedApp(page, request, auth);

  const result = await page.evaluate(async ({ userId, token, api }) => {
    const ticketResponse = await fetch(
      `${api}/trip-requests/sse-ticket?stream=requester`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    );
    if (!ticketResponse.ok) return `ticket-${ticketResponse.status}`;
    const { ticket } = await ticketResponse.json();

    const logoutResponse = await fetch(`${api}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!logoutResponse.ok) return `logout-${logoutResponse.status}`;

    const source = new EventSource(
      `${api}/trip-requests/events/${userId}?ticket=${encodeURIComponent(ticket)}`,
    );
    return new Promise((resolve) => {
      const finish = (value) => {
        source.close();
        resolve(value);
      };
      source.onopen = () => finish('opened');
      source.onerror = () => finish('rejected');
      window.setTimeout(() => finish('timeout'), 3_000);
    });
  }, { userId: auth.userId, token: auth.token, api: apiUrl });

  expect(result).toBe('rejected');
});
