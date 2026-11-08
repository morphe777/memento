// Scenario 4: export the data, purge it, then import the exported file: the data comes back.
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { api, login, unique } from './helpers.ts';

test('exported data survives a purge through an import', async ({ page }, testInfo) => {
  await login(page);
  const title = unique('Mon export');
  const group = (await api<{ id: string }[]>(page.request, 'GET', '/groups'))[0].id;
  await api(page.request, 'POST', '/projects', { title, groupIds: [group] });
  await api(page.request, 'POST', '/tasks', { title: `${title} (tâche)`, projectId: null, durationMin: 15 });

  const titles = async () =>
    (await api<{ title: string }[]>(page.request, 'GET', '/projects')).map((p) => p.title);
  const tasks = async () =>
    (await api<{ title: string }[]>(page.request, 'GET', '/tasks')).map((t) => t.title);
  expect(await titles()).toContain(title);

  // Export: a JSON download.
  await page.goto('/configuration/budget');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exporter toutes les données (JSON)' }).click();
  const file = testInfo.outputPath('export.json');
  await (await download).saveAs(file);
  const exported = JSON.parse(await readFile(file, 'utf8'));
  expect(JSON.stringify(exported)).toContain(title);

  // Purge: the confirmation word is typed.
  await page.getByRole('button', { name: 'Vider les données…' }).click();
  const purge = page.getByRole('dialog').filter({ hasText: 'Vider les données ?' });
  await expect(purge.getByRole('button', { name: 'Tout supprimer' })).toBeDisabled();
  await purge.getByLabel('Tape SUPPRIMER pour confirmer').fill('SUPPRIMER');
  await purge.getByRole('button', { name: 'Tout supprimer' }).click();
  await expect(page.getByText(/Données vidées/)).toBeVisible();
  expect(await titles()).not.toContain(title);
  expect(await tasks()).not.toContain(`${title} (tâche)`);

  // Import the exported file.
  await page.locator('input[type=file]').setInputFiles(file);
  const confirm = page.getByRole('dialog').filter({ hasText: 'Remplacer toutes les données ?' });
  await confirm.getByRole('button', { name: 'Importer et remplacer' }).click();
  await expect(page.getByText(/Import terminé/)).toBeVisible();
  expect(await titles()).toContain(title);
  expect(await tasks()).toContain(`${title} (tâche)`);
});
