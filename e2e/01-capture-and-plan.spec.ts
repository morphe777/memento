// Scenario 1: capture a task into the Inbox, add it to the week plan, see it in « Ma semaine ».
import { expect, test } from '@playwright/test';
import { login, me, unique } from './helpers.ts';

test('a captured task reaches the Inbox, then the week plan', async ({ page }) => {
  await login(page);
  const title = unique('Appeler le plombier');

  // Capture from anywhere (sidebar button).
  await page.getByRole('button', { name: 'Capturer dans l’Inbox' }).first().click();
  const sheet = page.getByRole('textbox', { name: 'Titre' });
  await sheet.fill(title);
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Ajouté à l’Inbox.')).toBeVisible();

  // It is in the Inbox.
  await page.goto('/inbox');
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();

  // Planifier › Semaine (the current week, whatever the weekday): « + Semaine » on the task.
  const { currentWeek } = await me(page.request);
  await page.goto(`/planifier?semaine=${currentWeek}`);
  await expect(page.getByRole('heading', { name: 'Planifier la semaine' })).toBeVisible();
  const row = page
    .locator('.row-line')
    .filter({ has: page.getByRole('button', { name: title, exact: true }) });
  await row.getByRole('button', { name: '+ Semaine' }).click();
  await expect(row.getByRole('button', { name: '✓ Semaine' })).toBeVisible();

  // « Ma semaine » lists it.
  await page.goto('/semaine');
  await expect(page.getByRole('heading', { name: 'Ma semaine', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
});
