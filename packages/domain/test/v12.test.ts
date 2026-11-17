// v1.2 requests: planned week on every task (D-151), done time editable (D-152), lived experience (D-153),
// experience target per calendar month (D-154), « Compléter le budget » with the AI (D-155).
import { eq, schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import {
  buildWeekPayload,
  completeTask,
  createProject,
  createTask,
  fillWeekWithAi,
  getExecution,
  getExperiencesPage,
  getPlanningPage,
  getTask,
  listTasks,
  logExperience,
  patchWeek,
  promoteProject,
  setProjectMonth,
  setWeekItems,
  updateTask,
} from '../src/index.ts';
import { parisInstant } from '../src/time.ts';
import { lookups, makeCtx } from './helpers.ts';

type TestCtx = ReturnType<typeof makeCtx>;

function project(ctx: TestCtx, title: string, n: number, month = '2026-10') {
  const p = createProject(ctx, {
    title,
    groupIds: [lookups(ctx).group('Travaux').id],
    successCriterion: 'Fait',
    startDate: '2026-10-01',
    dueDate: '2026-11-30',
  });
  const tasks = Array.from({ length: n }, (_, i) =>
    createTask(ctx, { projectId: p.id, title: `${title} ${i + 1}`, durationMin: 60 }),
  );
  promoteProject(ctx, p.id);
  setProjectMonth(ctx, p.id, month);
  return { project: p, tasks };
}

const weeksOf = (ctx: TestCtx, taskId: string) =>
  ctx.db
    .select({ w: schema.weekPlan.isoWeek, kind: schema.weekPlanItem.kind })
    .from(schema.weekPlanItem)
    .innerJoin(schema.weekPlan, eq(schema.weekPlan.id, schema.weekPlanItem.weekPlanId))
    .where(eq(schema.weekPlanItem.taskId, taskId))
    .all();

describe('D-151 planned week on every task', () => {
  it('shows the first week, current or ahead, whose plan holds the task', () => {
    const ctx = makeCtx(); // Friday 23 Oct 2026, W43
    const a = createTask(ctx, { title: 'A', durationMin: 30 });
    const b = createTask(ctx, { title: 'B', durationMin: 30 });
    const c = createTask(ctx, { title: 'C', durationMin: 30 });
    const d = createTask(ctx, { title: 'D', durationMin: 30 });
    setWeekItems(ctx, '2026-W42', [{ taskId: c.id, kind: 'week' }]); // a past week: no longer planned
    setWeekItems(ctx, '2026-W43', [{ taskId: a.id, kind: 'week' }]);
    setWeekItems(ctx, '2026-W44', [
      { taskId: b.id, kind: 'bonus' },
      { taskId: a.id, kind: 'week' },
    ]);
    const by = Object.fromEntries(
      listTasks(ctx, { projectId: 'inbox' }).map((t) => [t.title, t.plannedWeek]),
    );
    expect(by).toEqual({ A: '2026-W43', B: '2026-W44', C: null, D: null });
    expect(getTask(ctx, d.id).plannedWeek).toBeNull();
  });
});

describe('D-152 done time editable', () => {
  it('moves the done time of a done task, never ahead of now, and the unplanned trace follows it', () => {
    const ctx = makeCtx(); // Friday 23 Oct 2026 10:00 Paris
    const t = createTask(ctx, { title: 'Vélo', durationMin: 60 });
    completeTask(ctx, t.id);
    expect(weeksOf(ctx, t.id)).toEqual([{ w: '2026-W43', kind: 'unplanned' }]);
    updateTask(ctx, t.id, { doneAt: '2026-10-14T18:30' });
    expect(getTask(ctx, t.id).doneAt).toBe(parisInstant('2026-10-14', '18:30').toISOString());
    expect(weeksOf(ctx, t.id)).toEqual([{ w: '2026-W42', kind: 'unplanned' }]);
    expect(() => updateTask(ctx, t.id, { doneAt: '2026-10-23T12:00' })).toThrow(/avenir/);
    const todo = createTask(ctx, { title: 'Pas faite', durationMin: 15 });
    expect(() => updateTask(ctx, todo.id, { doneAt: '2026-10-20T10:00' })).toThrow(/pas faite/);
  });
});

describe('D-153 lived experience', () => {
  it('is created done, now by default, in Famille unless another domain or a project is given', () => {
    const ctx = makeCtx();
    const { domain } = lookups(ctx);
    const a = logExperience(ctx, { title: 'Pique-nique au lac' });
    expect(a).toMatchObject({ status: 'done', isExperience: true, domainId: domain('Famille').id });
    expect(a.doneAt).toBe(ctx.now!().toISOString());
    const b = logExperience(ctx, {
      title: 'Concert',
      doneAt: '2026-10-18T21:00',
      domainId: domain('Santé').id,
    });
    expect(b.domainId).toBe(domain('Santé').id);
    expect(b.doneAt).toBe(parisInstant('2026-10-18', '21:00').toISOString());
    const { project: p } = project(ctx, 'Voyage', 1);
    // A task of a month project needs a duration (DM-32), an experience too.
    const c = logExperience(ctx, { title: 'Nuit au refuge', projectId: p.id, durationMin: 120 });
    expect(c).toMatchObject({ projectId: p.id, domainId: null });
    expect(getExperiencesPage(ctx).lived.map((e) => e.title)).toEqual(
      expect.arrayContaining(['Pique-nique au lac', 'Concert', 'Nuit au refuge']),
    );
    expect(() => logExperience(ctx, { title: 'Demain', doneAt: '2026-10-24T10:00' })).toThrow(/avenir/);
  });
});

describe('D-154 experience target per calendar month', () => {
  it('counts the experiences done in the month (a week belongs to the month of its Thursday)', () => {
    const ctx = makeCtx('2026-11-04T09:00:00.000Z'); // Wednesday 4 Nov 2026, W45
    logExperience(ctx, { title: 'Octobre', doneAt: '2026-10-30T12:00' });
    logExperience(ctx, { title: 'Novembre', doneAt: '2026-11-02T12:00' });
    expect(getExperiencesPage(ctx)).toMatchObject({
      target: 2,
      month: '2026-11',
      doneThisMonth: 1,
      onTrack: false,
    });
    expect(getExecution(ctx, '2026-W45').experiences).toEqual({ done: 1, target: 2, month: '2026-11' });
    expect(getPlanningPage(ctx, '2026-W45').experiencesDone).toBe(1);
    // W44 runs from 26 Oct to 1 Nov: Thursday 29 Oct, so October.
    expect(buildWeekPayload(ctx, '2026-W44').experiences).toMatchObject({
      done: 1,
      target: 2,
      month: '2026-10',
    });
  });
});

describe('D-155 « Compléter le budget » with the AI', () => {
  const fake =
    (answer: (user: string) => unknown) =>
    async ({ user }: { user: string }) => ({ text: JSON.stringify(answer(user)), model: 'fake' });

  it('keeps only addable tasks that fit in what is left, 3 at most, and never touches the plan', async () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z'); // Monday W44
    const { tasks } = project(ctx, 'Cuisine', 3);
    const a = createTask(ctx, { title: 'Appeler le notaire', durationMin: 30 });
    const b = createTask(ctx, { title: 'Ranger la cave', durationMin: 60 });
    const c = createTask(ctx, { title: 'Payer la cantine', durationMin: 15 });
    const e = createTask(ctx, { title: 'Planétarium', durationMin: 120, isExperience: true });
    const f = createTask(ctx, { title: 'Arroser', durationMin: 5 });
    patchWeek(ctx, '2026-W44', 120);
    setWeekItems(ctx, '2026-W44', [{ taskId: tasks[0].id, kind: 'week' }]);
    let sent = '';
    const p = await fillWeekWithAi(
      ctx,
      '2026-W44',
      fake((user) => {
        sent = user;
        return {
          summary: 'On équilibre vers la maison.',
          items: [
            { id: tasks[0].id, angle: 'momentum', reason: 'Déjà prévue.', key: 'prévue' },
            { id: 'inventé', angle: 'month', reason: '?', key: '?' },
            { id: tasks[2].id, angle: 'month', reason: 'Bloquée.', key: 'Bloquée' },
            { id: a.id, angle: 'deadline', reason: 'Le dossier attend ta signature.', key: 'ta signature' },
            { id: b.id, angle: 'balance', reason: 'Trop long pour ce qui reste.', key: 'absent' },
            {
              id: e.id,
              angle: 'experience',
              reason: 'Aucune expérience ce mois-ci.',
              key: 'Aucune expérience',
            },
            { id: c.id, angle: 'balance', reason: 'Vite fait.', key: 'Vite' },
            { id: f.id, angle: 'balance', reason: 'Une de trop.', key: 'trop' },
          ],
        };
      }),
    );
    expect(sent).toContain('remainingMin');
    expect(p.remainingMin).toBe(60);
    expect(p.summary).toBe('On équilibre vers la maison.');
    expect(p.items.map((i) => [i.title, i.angle, i.key])).toEqual([
      ['Appeler le notaire', 'deadline', 'ta signature'],
      ['Planétarium', 'experience', 'Aucune expérience'], // an experience is outside the budget (RB-09)
      ['Payer la cantine', 'balance', 'Vite'],
    ]);
    expect(getPlanningPage(ctx, '2026-W44').items.map((i) => i.taskId)).toEqual([tasks[0].id]);
  });

  it('drops a key that is not in the reason, and refuses when the budget is already used', async () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z');
    const a = createTask(ctx, { title: 'Courrier', durationMin: 30 });
    patchWeek(ctx, '2026-W44', 60);
    const p = await fillWeekWithAi(
      ctx,
      '2026-W44',
      fake(() => ({
        summary: 'ok',
        items: [{ id: a.id, angle: 'deadline', reason: 'À poster.', key: 'demain' }],
      })),
    );
    expect(p.items[0].key).toBeNull();
    setWeekItems(ctx, '2026-W44', [{ taskId: a.id, kind: 'week' }]);
    patchWeek(ctx, '2026-W44', 30);
    await expect(
      fillWeekWithAi(
        ctx,
        '2026-W44',
        fake(() => ({ summary: '', items: [] })),
      ),
    ).rejects.toThrow(/budget/i);
  });
});
