// Shared by the specs: the login through the real login page and small API helpers that reuse its session.
import { type APIRequestContext, expect, type Page } from '@playwright/test';

import { E2E_LOGIN, E2E_PASSWORD } from './constants.ts';

/** A title that never collides with another test's data. */
export const unique = (label: string) => `${label} ${Math.random().toString(36).slice(2, 8)}`;

/**
 * Logs in through the login page. The server limits logins to 5 a minute per address and trusts X-Forwarded-For
 * from the local test client (server.ts), so each login claims its own address.
 */
export async function login(page: Page) {
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  await page.route('**/api/v1/auth/login', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }),
  );
  await page.goto('/');
  await page.getByLabel('Identifiant').fill(E2E_LOGIN);
  await page.getByLabel('Mot de passe').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('link', { name: 'Ma semaine' }).first()).toBeVisible();
}

export interface Me {
  today: string;
  currentWeek: string;
}

export async function me(request: APIRequestContext): Promise<Me> {
  const res = await request.get('/api/v1/auth/me');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

/** JSON call with the session of the page; fails the test on a non-2xx answer. */
export async function api<T = unknown>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await request.fetch(`/api/v1${path}`, { method, data });
  expect(res.ok(), `${method} ${path} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}
