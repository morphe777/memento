// H-06 (D-142): a week belongs to the month of its Thursday and the month report waits for its last week.
// H-07: the week report of a straddling week keeps its month projects after the month roll.
// M-06: the quarter report freezes the final status of the recurring objectives.
import { schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { reportFreezableFrom } from '../src/rules/reports.ts';
import { runDueJobs } from '../src/services/jobs.ts';
import { createProject, promoteProject, setProjectMonth } from '../src/services/projects.ts';
import { createObjective } from '../src/services/referential.ts';
import { findReport } from '../src/services/reports.ts';
import { completeTask, createTask } from '../src/services/tasks.ts';
import { lastWeekOfMonth, monthOfWeek } from '../src/time.ts';
import { lookups, makeCtx } from './helpers.ts';

const times = { weekReport: '20:00', reports: '07:00' };

describe('H-06 the weeks of a month', () => {
  it('a week belongs to the month holding most of its days (its Thursday)', () => {
    expect(monthOfWeek('2026-W44')).toBe('2026-10'); // Mon 26 Oct – Sun 1 Nov: 6 days in October
    expect(monthOfWeek('2026-W40')).toBe('2026-10'); // Mon 28 Sep – Sun 4 Oct: 4 days in October
    expect(monthOfWeek('2026-W49')).toBe('2026-12'); // Mon 30 Nov – Sun 6 Dec: 6 days in December
    expect(lastWeekOfMonth('2026-12')).toBe('2026-W53');
  });

  it('the month report waits until the month is over and its last week frozen', () => {
    expect(reportFreezableFrom('month', '2026-10', times)).toEqual({ date: '2026-11-01', time: '20:00' });
    expect(reportFreezableFrom('month', '2026-11', times)).toEqual({ date: '2026-12-01', time: '07:00' });
    expect(reportFreezableFrom('month', '2026-12', times)).toEqual({ date: '2027-01-03', time: '20:00' });
  });

  it('the worker, every morning and evening, puts W40 to W44 in the October report', () => {
    const ctx = makeCtx('2026-09-26T06:00:00.000Z');
    const at = (day: string, hhmmUtc: string) => ctx.setNow(`${day}T${hhmmUtc}:00.000Z`);
    for (let d = new Date('2026-09-27'); d <= new Date('2026-11-02'); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      at(day, '07:30'); // morning (08:30 or 09:30 Paris)
      const t = createTask(ctx, { title: `Tâche ${day}`, durationMin: 30 });
      completeTask(ctx, t.id);
      runDueJobs(ctx);
      at(day, '20:30'); // evening (21:30 or 22:30 Paris)
      runDueJobs(ctx);
    }
    const october = findReport(ctx, 'month', '2026-10')!;
    const weeks = (october.payload as { weeks: { isoWeek: string }[] }).weeks.map((w) => w.isoWeek);
    expect(weeks).toEqual(['2026-W40', '2026-W41', '2026-W42', '2026-W43', '2026-W44']);
  });
});

describe('H-07 a straddling week report keeps its month projects', () => {
  it('W44, frozen after the November roll, still shows the delay of the October projects', () => {
    const ctx = makeCtx('2026-10-20T08:00:00.000Z');
    const { group } = lookups(ctx);
    const p = createProject(ctx, {
      title: 'Octobre',
      groupIds: [group('Sport').id],
      successCriterion: 'Fait',
      startDate: '2026-10-01',
      dueDate: '2026-10-31',
    });
    createTask(ctx, { projectId: p.id, title: 'Une', durationMin: 60 });
    promoteProject(ctx, p.id);
    setProjectMonth(ctx, p.id, '2026-10');
    ctx.setNow('2026-11-01T06:30:00.000Z'); // Sunday 1 Nov, 07:30 Paris: month roll
    runDueJobs(ctx);
    ctx.setNow('2026-11-01T19:30:00.000Z'); // 20:30 Paris: W44 frozen
    expect(runDueJobs(ctx).week_report).toBe('done');
    const w44 = findReport(ctx, 'week', '2026-W44')!.payload as { delays: { projectId: string }[] };
    expect(w44.delays.map((d) => d.projectId)).toEqual([p.id]);
  });
});

describe('M-06 the quarter report freezes the final status of the recurring objectives', () => {
  it('an objective achieved at the end of its quarter counts as achieved, not open', () => {
    const ctx = makeCtx('2026-12-20T08:00:00.000Z');
    const o = createObjective(ctx, { title: 'Bilan', deadline: '2026-12-31', recurrence: 'quarterly' });
    ctx.db.update(schema.objective).set({ progressPct: 100 }).run();
    ctx.setNow('2027-01-01T06:30:00.000Z'); // 07:30 Paris
    expect(runDueJobs(ctx).quarter).toBe('done');
    const q4 = findReport(ctx, 'quarter', '2026-Q4')!.payload as {
      objectives: { achieved: number; open: number };
    };
    expect(q4.objectives).toMatchObject({ achieved: 1, open: 0 });
    expect(o.id).toBeTruthy();
  });
});
