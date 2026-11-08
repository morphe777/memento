// Scenario 5: in the Plan view (Planifier › Plan), a draft is applied while the plan was changed elsewhere in the
// meantime: the API answers 409 PLAN_APPLY_CONFLICT and the page says so; « Recharger » then lets the draft through.
import { expect, test } from '@playwright/test';
import { api, login, me, unique } from './helpers.ts';

interface Id {
  id: string;
}

/** Last day of the quarter of `today` (YYYY-MM-DD). */
function quarterEnd(today: string) {
  const [y, m] = today.split('-').map(Number);
  const endMonth = Math.floor((m - 1) / 3) * 3 + 3;
  return new Date(Date.UTC(y, endMonth, 0)).toISOString().slice(0, 10);
}

test('applying a stale plan draft shows the conflict message', async ({ page }) => {
  const request = page.request;
  await login(page);
  const { today } = await me(request);

  // Data: a domain, its meta-objective and objective (current quarter) holding a project, and a loose idea.
  const domains = await api<(Id & { name: string })[]>(request, 'GET', '/domains');
  const groups = await api<(Id & { domainId: string })[]>(request, 'GET', '/groups');
  const domain = domains.find((d) => groups.some((g) => g.domainId === d.id))!;
  const group = groups.find((g) => g.domainId === domain.id)!;
  const meta = await api<Id>(request, 'POST', '/meta-objectives', {
    title: unique('Méta plan'),
    primaryDomainId: domain.id,
  });
  const objective = await api<Id>(request, 'POST', '/objectives', {
    title: unique('Objectif plan'),
    metaObjectiveId: meta.id,
    deadline: quarterEnd(today),
  });
  const inPlan = unique('Projet rangé');
  const loose = unique('Idée libre');
  await api(request, 'POST', '/projects', { title: inPlan, groupIds: [group.id], objectiveId: objective.id });
  const looseProject = await api<Id>(request, 'POST', '/projects', { title: loose, groupIds: [group.id] });
  const bystander = await api<Id>(request, 'POST', '/projects', {
    title: unique('Autre idée'),
    groupIds: [group.id],
  });

  // The Plan view filtered on that domain.
  await page.addInitScript(
    (id) => localStorage.setItem('memento.plan.domains', JSON.stringify([id])),
    domain.id,
  );
  await page.goto('/planifier?vue=trimestre');
  await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
  const graph = page.getByRole('application', { name: 'Graphe du plan' });
  await expect(graph.getByText(inPlan)).toBeVisible();

  // Draft: drag the loose idea from the reserve into the objective, behind the project already there.
  const card = page.getByText(loose, { exact: true });
  const from = (await card.boundingBox())!;
  const to = (await graph.getByText(inPlan).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  const bar = page.getByRole('region', { name: 'Brouillon du plan' });
  await expect(bar).toContainText(/Brouillon : [1-9]\d* changement/);

  // Meanwhile (another tab, the AI...): the plan changes through the API, which moves its version.
  await api(request, 'PATCH', `/projects/${bystander.id}`, { title: unique('Autre idée renommée') });

  // Applying the stale draft is refused: the page explains and offers to reload.
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/v1/plan/apply'));
  await bar.getByRole('button', { name: 'Appliquer' }).click();
  const res = await answer;
  expect(res.status()).toBe(409);
  expect((await res.json()).code).toBe('PLAN_APPLY_CONFLICT');
  await expect(bar).toContainText("Le plan a changé depuis l'ouverture du brouillon");
  await expect(bar.getByRole('button', { name: 'Recharger' })).toBeVisible();

  // Nothing was written: the idea is still loose.
  const stored = await api<{ objectiveId: string | null }>(request, 'GET', `/projects/${looseProject.id}`);
  expect(stored.objectiveId).toBeNull();

  // After « Recharger » the draft is kept on the fresh plan and now goes through.
  await bar.getByRole('button', { name: 'Recharger' }).click();
  await expect(bar).not.toContainText('Le plan a changé');
  await expect(bar).toContainText(/Brouillon : [1-9]\d* changement/);
  await bar.getByRole('button', { name: 'Appliquer' }).click();
  await expect(page.getByText(/Plan appliqué : \d+ changements?\./)).toBeVisible();
  const applied = await api<{ objectiveId: string | null }>(request, 'GET', `/projects/${looseProject.id}`);
  expect(applied.objectiveId).toBe(objective.id);
});
