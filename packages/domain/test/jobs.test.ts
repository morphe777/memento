// C-07: a failed job is retried at the next tick, the failure is announced once, and a job is all or nothing.
import { schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { runDueJobs } from '../src/services/jobs.ts';
import { makeCtx } from './helpers.ts';

const jobRow = (ctx: ReturnType<typeof makeCtx>, job: string) =>
  ctx.db
    .select()
    .from(schema.jobRun)
    .all()
    .filter((r) => r.job === job);
const jobNotices = (ctx: ReturnType<typeof makeCtx>, label = 'Rapport de la semaine') =>
  ctx.db
    .select()
    .from(schema.notification)
    .all()
    .filter((n) => n.kind === 'job' && n.title.includes(label));

describe('C-07 scheduled jobs', () => {
  it('a failed week report is retried at the next tick, announced once, then frozen', () => {
    const ctx = makeCtx('2026-11-08T19:30:00.000Z'); // Sunday 8 Nov 2026, 20:30 Paris
    ctx.sqlite.exec(
      "create trigger fail_report before insert on report when new.kind = 'week' begin select raise(abort, 'disk full'); end",
    );
    expect(runDueJobs(ctx).week_report).toBe('failed');
    expect(jobRow(ctx, 'week_report')).toMatchObject([{ periodKey: '2026-W45', ok: false }]);
    expect(jobNotices(ctx)).toHaveLength(1);
    expect(jobNotices(ctx)[0].html).toContain('disk full');

    ctx.setNow('2026-11-08T19:31:00.000Z');
    expect(runDueJobs(ctx).week_report).toBe('failed');
    expect(jobRow(ctx, 'week_report')).toHaveLength(1); // the same row, updated
    expect(jobNotices(ctx)).toHaveLength(1); // one notice per job and period, not one per tick

    ctx.sqlite.exec('drop trigger fail_report');
    ctx.setNow('2026-11-08T19:32:00.000Z');
    expect(runDueJobs(ctx).week_report).toBe('done');
    expect(jobRow(ctx, 'week_report')).toMatchObject([{ ok: true, error: null }]);
    expect(
      ctx.db
        .select()
        .from(schema.report)
        .all()
        .map((r) => r.periodKey),
    ).toContain('2026-W45');
    ctx.setNow('2026-11-08T19:33:00.000Z');
    expect(runDueJobs(ctx).week_report).toBe('skipped');
  });

  it('the month job is all or nothing: a failing roll leaves no frozen report, then both happen', () => {
    const ctx = makeCtx('2026-12-01T07:00:00.000Z'); // Tuesday 1 Dec 2026, 08:00 Paris
    ctx.sqlite.exec(
      "create trigger fail_roll before update on project begin select raise(abort, 'roll failed'); end",
    );
    ctx.sqlite.exec(
      "insert into project (id, title, status, month_flag, sequence_mode, importance, created_by) values ('00000000-0000-4000-8000-000000000001', 'Octobre', 'active', '2026-11', 'sequential', 'normal', 'me')",
    );
    expect(runDueJobs(ctx).month).toBe('failed');
    expect(
      ctx.db
        .select()
        .from(schema.report)
        .all()
        .filter((r) => r.kind === 'month'),
    ).toHaveLength(0);
    ctx.sqlite.exec('drop trigger fail_roll');
    ctx.setNow('2026-12-01T07:01:00.000Z');
    expect(runDueJobs(ctx).month).toBe('done');
    expect(
      ctx.db
        .select()
        .from(schema.report)
        .all()
        .filter((r) => r.kind === 'month'),
    ).toHaveLength(1);
    const p = ctx.db.select().from(schema.project).all()[0];
    expect([p.status, p.monthFlag]).toEqual(['ready', null]);
  });

  it('a failing week proposal is a failed job, no longer a silent « done »', () => {
    const ctx = makeCtx('2026-11-09T06:30:00.000Z'); // Monday 9 Nov 2026, 07:30 Paris
    ctx.sqlite.exec(
      "create trigger fail_plan before update of proposed_at on week_plan begin select raise(abort, 'propose failed'); end",
    );
    expect(runDueJobs(ctx).week).toBe('failed');
    expect(jobRow(ctx, 'week')).toMatchObject([{ ok: false }]);
    ctx.sqlite.exec('drop trigger fail_plan');
    ctx.setNow('2026-11-09T06:31:00.000Z');
    expect(runDueJobs(ctx).week).toBe('done');
  });
});
