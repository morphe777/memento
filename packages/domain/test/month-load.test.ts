// F1 (D-138): planned mix of the month by domain; F2 (D-137) on the month; M-03: experiences outside the loads.
import { describe, expect, it } from 'vitest';
import { getMonthPlanningPage } from '../src/services/month.ts';
import { createProject, promoteProject, setProjectMonth } from '../src/services/projects.ts';
import { getQuarterPlanningPage } from '../src/services/quarter.ts';
import { completeTask, createTask } from '../src/services/tasks.ts';
import { lookups, makeCtx } from './helpers.ts';

function setup() {
  const ctx = makeCtx('2026-11-10T08:00:00.000Z'); // Tuesday 10 Nov 2026
  const { group } = lookups(ctx);
  const sport = group('Sport');
  const p = createProject(ctx, { title: 'Courir', groupIds: [sport.id], successCriterion: 'Fait' });
  const work = createTask(ctx, { projectId: p.id, title: 'Séance', durationMin: 60 });
  createTask(ctx, { projectId: p.id, title: 'Trail', durationMin: 120, isExperience: true });
  promoteProject(ctx, p.id);
  setProjectMonth(ctx, p.id, '2026-11');
  return { ctx, p, work, domainId: sport.domainId };
}

describe('M-03 the month and quarter loads leave the experiences out (RB-09)', () => {
  it('only the work counts in « Prévu »', () => {
    const { ctx } = setup();
    expect(getMonthPlanningPage(ctx, '2026-11').budget.plannedMin).toBe(60);
    expect(getQuarterPlanningPage(ctx, '2026-Q4').budget.neededMin).toBe(0); // no objective chosen
  });
});

describe('F1 planned mix of the month', () => {
  it('done in the month + work left of the month projects + Inbox due, by domain, experiences included', () => {
    const { ctx, work, domainId } = setup();
    createTask(ctx, { title: 'Papiers', durationMin: 30, dueDate: '2026-11-20' });
    completeTask(ctx, work.id);
    const page = getMonthPlanningPage(ctx, '2026-11');
    expect(page.mix.find((m) => m.domainId === domainId)?.minutes).toBe(60 + 120); // done + experience left
    expect(page.mix.find((m) => m.domainId === null)?.minutes).toBe(30); // Inbox due this month
    expect(page.budget).toMatchObject({ spentMin: 60, plannedMin: 0, inboxReserveMin: 30 });
  });
});
