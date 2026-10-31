// Scheduled jobs (WF-01 to WF-03, G-04): Monday plan + weekly report, monthly and quarterly reports.
// Idempotent through job_run (one row per job and period); catches up if the worker was down at the due time.
import { and, eq, schema } from '@memento/db';
import { type Ctx, ctxNow, newId } from '../context.ts';
import { isOnVacation } from '../rules/daily.ts';
import { getSettings } from '../settings.ts';
import {
  isoDay,
  isoWeekOf,
  monthOf,
  quarterOf,
  quarterStart,
  shiftMonth,
  shiftQuarter,
  shiftWeek,
  TZ,
} from '../time.ts';
import { notifyStatus, sendDailyRecap } from './daily.ts';
import { closeWeek, proposeWeek } from './planning.ts';
import { rollMonth } from './projects.ts';
import { closeRecurringObjectives } from './recurrence.ts';
import { generateReport } from './reports.ts';

function parisClock(at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function once(ctx: Ctx, job: string, periodKey: string, fn: () => void): 'done' | 'skipped' | 'failed' {
  const { jobRun } = schema;
  if (
    ctx.db
      .select()
      .from(jobRun)
      .where(and(eq(jobRun.job, job), eq(jobRun.periodKey, periodKey)))
      .get()
  )
    return 'skipped';
  let ok = true;
  let error: string | null = null;
  try {
    fn();
  } catch (e) {
    ok = false;
    error = (e as Error).message;
  }
  ctx.db
    .insert(jobRun)
    .values({ id: newId(), job, periodKey, ranAt: ctxNow(ctx).toISOString(), ok, error })
    .run();
  return ok ? 'done' : 'failed';
}

/** Runs every job that is due at `now` (Europe/Paris) and not yet run for its period. */
export function runDueJobs(ctx: Ctx): Record<string, string> {
  const s = getSettings(ctx);
  const { date, time } = parisClock(ctxNow(ctx));
  const week = isoWeekOf(date);
  const out: Record<string, string> = {};
  const reportTime = s['schedule.reports'].time;
  const month = monthOf(date);
  // Month first: on a Monday the 1st, the week proposal must see the new month projects.
  if (date > `${month}-01` || time >= reportTime) {
    // WF-02, then D-42 month roll (after the report, which freezes last month's projects as they were).
    out.month = once(ctx, 'month', month, () => {
      generateReport(ctx, 'month', shiftMonth(month, -1));
      rollMonth(ctx, month);
    });
  }
  const plan = s['schedule.week_plan'];
  // Weekly: from the configured day/time until the end of the ISO week (catch-up).
  if (isoDay(date) > plan.day || (isoDay(date) === plan.day && time >= plan.time)) {
    out.week = once(ctx, 'week', week, () => {
      closeWeek(ctx, shiftWeek(week, -1)); // RB-10
      generateReport(ctx, 'week', shiftWeek(week, -1)); // WF-01
      try {
        proposeWeek(ctx, week); // §6
      } catch {
        // already validated by hand: nothing to propose
      }
    });
  }
  const quarter = quarterOf(date);
  if (date > quarterStart(quarter) || time >= reportTime) {
    out.quarter = once(ctx, 'quarter', quarter, () => {
      generateReport(ctx, 'quarter', shiftQuarter(quarter, -1)); // WF-03
      closeRecurringObjectives(ctx, quarter); // DM-108, after the report froze the past quarter
    });
  }
  return out;
}

/**
 * D-77: evening recap « Ta journée » on Telegram, once per day from the configured time until midnight (no
 * catch-up the next day). Waits, without recording anything, while Telegram is not set up.
 * D-78: never on Saturday (Sunday's report covers the weekend) nor on a holiday.
 */
export async function runDailyRecapJob(
  ctx: Ctx,
  env: Record<string, string | undefined>,
): Promise<'done' | 'skipped' | 'failed'> {
  const s = getSettings(ctx);
  const r = s['notify.daily_recap'];
  const { date, time } = parisClock(ctxNow(ctx));
  if (!r.enabled || time < r.time || !notifyStatus(ctx, env).configured) return 'skipped';
  if (isoDay(date) === 6 || isOnVacation(date, s['notify.vacations'])) return 'skipped';
  const { jobRun } = schema;
  if (
    ctx.db
      .select()
      .from(jobRun)
      .where(and(eq(jobRun.job, 'daily_recap'), eq(jobRun.periodKey, date)))
      .get()
  )
    return 'skipped';
  // Claimed before the (slow) sending so that two ticks never send it twice.
  const id = newId();
  ctx.db
    .insert(jobRun)
    .values({
      id,
      job: 'daily_recap',
      periodKey: date,
      ranAt: ctxNow(ctx).toISOString(),
      ok: true,
      error: null,
    })
    .run();
  try {
    await sendDailyRecap(ctx, { env, date });
    return 'done';
  } catch (e) {
    ctx.db
      .update(jobRun)
      .set({ ok: false, error: (e as Error).message })
      .where(eq(jobRun.id, id))
      .run();
    return 'failed';
  }
}
