// Scenario 2: an idea (title + group) becomes a ready project, then a month project, its task is done and the
// project is finished.
import { expect, test } from '@playwright/test';
import { api, login, unique } from './helpers.ts';

test('an idea goes through ready, month project and finished', async ({ page }) => {
  await login(page);
  const title = unique('Rénover la cuisine');
  const task = unique('Choisir la peinture');
  const group = (await api<{ name: string }[]>(page.request, 'GET', '/groups'))[0].name;

  // Create the idea: a title and a group are enough.
  await page.goto('/idees');
  await expect(page.getByRole('heading', { name: 'Idées', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '+ Idée' }).click();
  const panel = page.getByRole('dialog').filter({ hasText: 'Nouvelle idée / nouveau projet' });
  await panel.getByLabel('Titre').fill(title);
  await panel.getByRole('button', { name: group, exact: true }).first().click();
  await panel.getByRole('button', { name: "Créer l'idée" }).click();

  // The project page opens, as an idea.
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(page.getByText(/· Idée$/)).toBeVisible();

  // Promote it to « prêt ».
  await page.getByRole('button', { name: 'Promouvoir en projet prêt' }).first().click();
  await expect(page.getByText('Idée promue : projet prêt.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Projet du mois' })).toBeVisible();

  // Make it complete: a task (with a duration) and a success criterion.
  await page.getByRole('textbox', { name: 'Nouvelle tâche…' }).fill(task);
  await page.getByRole('textbox', { name: 'Nouvelle tâche…' }).press('Enter');
  await expect(page.getByRole('button', { name: task, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Un critère de succès (oui / non)' }).click();
  await page.getByRole('textbox', { name: 'Critère de succès' }).fill('La cuisine est repeinte');
  await page.getByRole('textbox', { name: 'Critère de succès' }).press('Enter');
  await expect(page.getByText('Critère de succès enregistré.')).toBeVisible();

  // Project of the month.
  await page.getByRole('button', { name: 'Projet du mois' }).click();
  await expect(page.getByText('Projets du mois mis à jour.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retirer du mois' })).toBeVisible();

  // Complete its task, then finish the project.
  await page.getByRole('button', { name: `Marquer « ${task} » comme fait` }).click();
  await expect(page.getByRole('button', { name: `Marquer « ${task} » comme à faire` })).toBeVisible();
  await page.getByRole('button', { name: 'Terminer', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Terminer le projet' });
  await dialog.getByRole('button', { name: 'Terminer', exact: true }).click();
  await expect(page.getByText('Projet terminé.')).toBeVisible();

  // It is finished.
  await expect(page.getByText(/· Terminé$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rouvrir' })).toBeVisible();
});
