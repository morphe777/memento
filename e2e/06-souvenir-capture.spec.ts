// Scenario 6 (D-158): « + Souvenir » with a photo opens the check screen; « Enregistrer » gives the souvenir sheet
// with its photo; the souvenir is in the journal; « Supprimer » removes it.
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { login, unique } from './helpers.ts';

const sharp = createRequire(new URL('../packages/domain/package.json', import.meta.url))('sharp');

test('a photo becomes a souvenir through the check screen', async ({ page }) => {
  await login(page);
  const photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#1F8A9C' } })
    .jpeg({ quality: 85 })
    .toBuffer();
  const phrase = unique('Goûter au bord du lac');

  await page.goto('/souvenirs');
  await expect(page.getByRole('heading', { name: 'Souvenirs', level: 1 })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '+ Souvenir' }).first().click();
  await (await chooser).setFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });

  // The check screen, title pre-filled (no place: « Sortie du … »), the photo arrives in the background.
  await expect(page.getByText('Nouveau souvenir')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Titre' })).toHaveValue(/^Sortie du /);
  await expect(page.getByRole('button', { name: 'Photo à la une' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Une phrase' }).fill(phrase);
  await page.getByRole('button', { name: 'À refaire' }).click();
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  // The sheet.
  await expect(page.getByText(`« ${phrase} »`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voir les photos en grand' })).toBeVisible();

  // In the journal, then deleted.
  await page.goto('/souvenirs');
  await expect(page.getByText(`« ${phrase} »`)).toBeVisible();
  await page.getByText(`« ${phrase} »`).click();
  await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page).toHaveURL(/\/souvenirs$/);
  await expect(page.getByText(`« ${phrase} »`)).toHaveCount(0);
});
