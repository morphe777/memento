// Scenario 3: create an API token in Configuration › Accès, use it, revoke it in the UI, it stops working.
import { expect, test } from '@playwright/test';
import { login, unique } from './helpers.ts';

test('a token works until it is revoked', async ({ page, request }) => {
  await login(page);
  const name = unique('e2e').replace(' ', '-'); // a token name has no space

  await page.goto('/configuration/acces');
  await expect(page.getByText('Jetons API / MCP')).toBeVisible();
  await page.getByPlaceholder('Nom (ex. claude, n8n)').fill(name);
  await page.getByRole('button', { name: 'Créer un jeton' }).click();
  await expect(page.getByText('Copie ce jeton maintenant')).toBeVisible();
  const token = (await page.locator('code').filter({ hasText: /^mem_/ }).textContent())?.trim();
  expect(token).toMatch(/^mem_/);

  // `request` has no session cookie: only the token authenticates it.
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.get('/api/v1/domains')).status()).toBe(401);
  expect((await request.get('/api/v1/domains', { headers })).status()).toBe(200);

  // Revoke it from the list.
  const row = page.locator('.row-line').filter({ hasText: `ai:${name}` });
  await row.getByRole('button', { name: 'Révoquer' }).click();
  await expect(page.getByText('Jeton révoqué.')).toBeVisible();
  await expect(row).toContainText('révoqué');

  expect((await request.get('/api/v1/domains', { headers })).status()).toBe(401);
});
