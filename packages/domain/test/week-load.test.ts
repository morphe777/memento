// F2 (D-137), M-10, M-01: the load of a week = what is done in it + what is planned still to do, against the
// budget (a guard-rail on the mental load). One definition of « Fait », on Paris days.
import { describe, expect, it } from 'vitest';
import { getExecution, getPlanningPage, patchWeek, setWeekItems } from '../src/services/planning.ts';
import { buildWeekPayload } from '../src/services/reports.ts';
import { completeTask, createTask } from '../src/services/tasks.ts';
import { makeCtx } from './helpers.ts';

const W46 = '2026-W46'; // Mon 9 Nov – Sun 15 Nov 2026
const W47 = '2026-W47';

describe('F2 the week budget keeps what is already done', () => {
  it('a planned task done stays in the load: checking it frees no budget', () => {
    const ctx = makeCtx('2026-11-09T08:00:00.000Z'); // Monday W46, 09:00 Paris
    patchWeek(ctx, W46, 300); // 5 h
    const a = createTask(ctx, { title: 'A', durationMin: 120 });
    const b = createTask(ctx, { title: 'B', durationMin: 120 });
    setWeekItems(ctx, W46, [
      { taskId: a.id, kind: 'week' },
      { taskId: b.id, kind: 'week' },
    ]);
    expect(getPlanningPage(ctx, W46).budget).toMatchObject({ doneMin: 0, plannedMin: 240, remainingMin: 60 });
    completeTask(ctx, a.id);
    const page = getPlanningPage(ctx, W46);
    expect(page.budget).toMatchObject({ doneMin: 120, plannedMin: 120, usedMin: 240, remainingMin: 60 });
    expect(page.counts).toMatchObject({ week: 1, done: 1 });
    // The same numbers on « Ma semaine ».
    expect(getExecution(ctx, W46).budget).toMatchObject({ doneMin: 120, plannedMin: 120, remainingMin: 60 });
  });

  it('work done outside the plan uses the budget too, and once it reaches it nothing is left', () => {
    const ctx = makeCtx('2026-11-11T08:00:00.000Z'); // Wednesday W46
    patchWeek(ctx, W46, 300); // 5 h
    const extra = createTask(ctx, { title: 'Imprévu', durationMin: 120 });
    const planned = createTask(ctx, { title: 'Prévu', durationMin: 60 });
    setWeekItems(ctx, W46, [{ taskId: planned.id, kind: 'week' }]);
    completeTask(ctx, extra.id, { actualMin: 330 }); // took longer than estimated (D-61)
    const page = getPlanningPage(ctx, W46);
    expect(page.budget).toMatchObject({ doneMin: 330, plannedMin: 60, remainingMin: 0, overMin: 90 });
    expect(page.alerts.find((a) => a.code === 'BUDGET_SPENT')?.text).toContain('Plus de budget disponible');
    // The planned mix counts the done work by domain (Inbox here) plus what is still planned.
    expect(page.mix.find((m) => m.domainId === null)?.minutes).toBe(390);
  });

  it('a task planned next week but done this week uses this week and frees the next one', () => {
    const ctx = makeCtx('2026-11-12T08:00:00.000Z'); // Thursday W46
    const early = createTask(ctx, { title: 'En avance', durationMin: 60 });
    setWeekItems(ctx, W47, [{ taskId: early.id, kind: 'week' }]);
    expect(getPlanningPage(ctx, W47).budget.plannedMin).toBe(60);
    completeTask(ctx, early.id);
    expect(getPlanningPage(ctx, W47).budget).toMatchObject({ doneMin: 0, plannedMin: 0 });
    expect(getPlanningPage(ctx, W46).budget.doneMin).toBe(60);
  });

  it('a deleted or unchecked task no longer counts', async () => {
    const ctx = makeCtx('2026-11-10T08:00:00.000Z');
    const t = createTask(ctx, { title: 'Faite puis décochée', durationMin: 60 });
    completeTask(ctx, t.id);
    expect(getPlanningPage(ctx, W46).budget.doneMin).toBe(60);
    const { uncompleteTask } = await import('../src/services/tasks.ts');
    uncompleteTask(ctx, t.id);
    expect(getPlanningPage(ctx, W46).budget.doneMin).toBe(0);
  });
});

describe('M-10 and M-01 one definition of « Fait », on Paris days', () => {
  it('a bonus of the previous week done this week counts this week, in Ma semaine as in the report', () => {
    const ctx = makeCtx('2026-11-06T08:00:00.000Z'); // Friday W45
    const bonus = createTask(ctx, { title: 'Bonus', durationMin: 60 });
    setWeekItems(ctx, '2026-W45', [{ taskId: bonus.id, kind: 'bonus' }]);
    ctx.setNow('2026-11-10T08:00:00.000Z'); // Tuesday W46
    completeTask(ctx, bonus.id);
    expect(getExecution(ctx, W46).doneMin).toBe(60);
    expect(buildWeekPayload(ctx, W46).rhythm.doneMin).toBe(60);
  });

  it('a task checked just after midnight in Paris belongs to that day', () => {
    const ctx = makeCtx('2026-11-08T23:30:00.000Z'); // Monday 9 Nov, 00:30 Paris (still Sunday in UTC)
    const t = createTask(ctx, { title: 'Minuit', durationMin: 30 });
    completeTask(ctx, t.id);
    expect(getExecution(ctx, W46).doneMin).toBe(30);
    expect(getExecution(ctx, '2026-W45').doneMin).toBe(0);
    expect(buildWeekPayload(ctx, W46).rhythm.doneMin).toBe(30);
  });
});
