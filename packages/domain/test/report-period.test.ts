// H-05: a report is frozen only for a real period that is over, from the time the job freezes it (D-116).
import { describe, expect, it } from 'vitest';
import { runDueJobs } from '../src/services/jobs.ts';
import { generateReport } from '../src/services/reports.ts';
import { makeCtx } from './helpers.ts';

const code = (f: () => unknown) => {
  try {
    f();
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe('H-05 freezable periods', () => {
  it('refuses impossible periods and periods not over yet', () => {
    const ctx = makeCtx('2026-11-11T09:00:00.000Z'); // Wednesday 11 Nov 2026, 10:00 Paris
    expect(code(() => generateReport(ctx, 'month', '2026-13'))).toBe('INVALID_PERIOD');
    expect(code(() => generateReport(ctx, 'month', '2026-00'))).toBe('INVALID_PERIOD');
    expect(code(() => generateReport(ctx, 'week', '2026-W54'))).toBe('INVALID_PERIOD');
    expect(code(() => generateReport(ctx, 'week', '2099-W01'))).toBe('PERIOD_NOT_OVER');
    expect(code(() => generateReport(ctx, 'quarter', '2099-Q1'))).toBe('PERIOD_NOT_OVER');
    expect(code(() => generateReport(ctx, 'week', '2026-W47'))).toBe('PERIOD_NOT_OVER'); // next week
    expect(code(() => generateReport(ctx, 'week', '2026-W46'))).toBe('PERIOD_NOT_OVER'); // this week, Wednesday
    expect(code(() => generateReport(ctx, 'month', '2026-11'))).toBe('PERIOD_NOT_OVER');
    expect(code(() => generateReport(ctx, 'quarter', '2026-Q4'))).toBe('PERIOD_NOT_OVER');
    expect(code(() => generateReport(ctx, 'week', '2026-W45'))).toBe('ok');
    expect(code(() => generateReport(ctx, 'month', '2026-10'))).toBe('ok');
    expect(code(() => generateReport(ctx, 'quarter', '2026-Q3'))).toBe('ok');
  });

  it('a week becomes freezable on its Sunday at the week report time, by hand as by the job', () => {
    const ctx = makeCtx('2026-11-15T18:59:00.000Z'); // Sunday 15 Nov (W46), 19:59 Paris
    expect(code(() => generateReport(ctx, 'week', '2026-W46'))).toBe('PERIOD_NOT_OVER');
    ctx.setNow('2026-11-15T19:00:00.000Z'); // 20:00 Paris
    expect(runDueJobs(ctx).week_report).toBe('done');
    expect(generateReport(ctx, 'week', '2026-W46').created).toBe(false);
  });

  it('a month becomes freezable on the 1st of the next one at the reports time', () => {
    const ctx = makeCtx('2026-12-01T05:59:00.000Z'); // 06:59 Paris
    expect(code(() => generateReport(ctx, 'month', '2026-11'))).toBe('PERIOD_NOT_OVER');
    ctx.setNow('2026-12-01T06:00:00.000Z'); // 07:00 Paris
    expect(code(() => generateReport(ctx, 'month', '2026-11'))).toBe('ok');
  });
});
