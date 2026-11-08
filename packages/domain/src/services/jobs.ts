// Scheduled jobs (WF-01 to WF-03, G-04): Sunday evening weekly report, Monday plan, monthly and quarterly reports.
// Idempotent through job_run (one row per job and period); catches up if the worker was down at the due time,
// and retries a failed job at the next tick (C-07). Nightly backup of the database (D-135).
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, copyDb, eq, schema } from '@memento/db';
import { type Ctx, ctxNow, newId, tx } from '../context.ts';
import { escapeHtml, isOnVacation } from '../rules/daily.ts';
import { getSettings } from '../settings.ts';
import {
  isoDay,
  isoWeekOf,
  monthOf,
  parisClock,
  quarterOf,
  quarterStart,
  shiftMonth,
  shiftQuarter,
  shiftWeek,
} from '../time.ts';
import { getDailyFacts, notifyReportReady, notifyStatus, sendDailyRecap } from './daily.ts';
import { recordNotification } from './notifications.ts';
import { closeWeek, proposeWeek } from './planning.ts';
import { rollMonth } from './projects.ts';
import type { PushSender } from './push.ts';
import { closeRecurringObjectives } from './recurrence.ts';
import { generateReport } from './reports.ts';

const JOB_LABELS: Record<string, string> = {
  month: 'Rapport du mois et bascule des projets du mois',
  week_report: 'Rapport de la semaine',
  week: 'Clôture de la semaine et proposition du plan',
  quarter: 'Rapport du trimestre et objectifs récurrents',
  backup: 'Sauvegarde de la nuit',
};

/** Records the outcome of a job for its period (one job_run row, updated on a retry); returns the row it found. */
function saveRun(ctx: Ctx, job: string, periodKey: string, ok: boolean, error: string | null) {
  const { jobRun } = schema;
  const ranAt = ctxNow(ctx).toISOString();
  const existing = lastRun(ctx, job, periodKey);
  if (existing) ctx.db.update(jobRun).set({ ranAt, ok, error }).where(eq(jobRun.id, existing.id)).run();
  else ctx.db.insert(jobRun).values({ id: newId(), job, periodKey, ranAt, ok, error }).run();
  return existing;
}

const lastRun = (ctx: Ctx, job: string, periodKey: string) =>
  ctx.db
    .select()
    .from(schema.jobRun)
    .where(and(eq(schema.jobRun.job, job), eq(schema.jobRun.periodKey, periodKey)))
    .get();

/** C-07: records a failure; only the first failure of a job and period is announced in the notifications. */
function recordFailure(ctx: Ctx, job: string, periodKey: string, error: string) {
  tx(ctx, () => {
    if (saveRun(ctx, job, periodKey, false, error)) return; // already announced at the first failure
    recordNotification(ctx, {
      kind: 'job',
      title: `Échec : ${JOB_LABELS[job] ?? job} (${periodKey})`,
      html: `<b>${escapeHtml(JOB_LABELS[job] ?? job)}</b> (${escapeHtml(periodKey)}) a échoué ; nouvel essai à chaque minute.\n\n<i>${escapeHtml(error)}</i>`,
    });
  });
}

/**
 * C-07: a job counts as done only once it succeeded. It runs in one transaction (all or nothing, its job_run row
 * included); a failure is recorded, retried at every tick until it succeeds, and announced once per job and
 * period (the first failure).
 */
function once(ctx: Ctx, job: string, periodKey: string, fn: () => void): 'done' | 'skipped' | 'failed' {
  if (lastRun(ctx, job, periodKey)?.ok) return 'skipped';
  try {
    tx(ctx, () => {
      fn();
      saveRun(ctx, job, periodKey, true, null);
    });
    return 'done';
  } catch (e) {
    recordFailure(ctx, job, periodKey, (e as Error).message);
    return 'failed';
  }
}

/** D-135: time (Paris) from which the nightly backup is taken, and number of daily copies kept. */
export const BACKUP_TIME = '03:00';
export const BACKUP_KEEP = 7;
const BACKUP_NAME = /^memento-\d{4}-\d{2}-\d{2}\.db$/;

/** D-135: the backup files beyond the BACKUP_KEEP most recent ones (other files of the folder are never listed). */
export function backupsToDelete(names: string[], keep = BACKUP_KEEP): string[] {
  return names
    .filter((n) => BACKUP_NAME.test(n))
    .sort()
    .reverse()
    .slice(keep);
}

/**
 * D-135: every day from 03:00 (Paris), a consistent copy of the database (SQLite backup API, safe while the app
 * writes) in `dir`/memento-YYYY-MM-DD.db, checked, then only the 7 most recent copies are kept. Same rule as the
 * other jobs (C-07): retried at every tick until it succeeds, first failure announced.
 */
export async function runBackupJob(ctx: Ctx, dir: string): Promise<'done' | 'skipped' | 'failed'> {
  const { date, time } = parisClock(ctxNow(ctx));
  if (time < BACKUP_TIME || lastRun(ctx, 'backup', date)?.ok) return 'skipped';
  const file = join(dir, `memento-${date}.db`);
  const partial = `${file}.partial`;
  try {
    mkdirSync(dir, { recursive: true });
    rmSync(partial, { force: true });
    await copyDb(ctx.sqlite, partial);
    renameSync(partial, file);
    for (const old of backupsToDelete(readdirSync(dir))) rmSync(join(dir, old));
    saveRun(ctx, 'backup', date, true, null);
    return 'done';
  } catch (e) {
    if (existsSync(partial)) rmSync(partial);
    recordFailure(ctx, 'backup', date, (e as Error).message);
    return 'failed';
  }
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
  // D-116: the week report is frozen on Sunday evening (the weekend counts); on the other days, catch-up of
  // the last week's one if the worker was down then. Before the Monday close, as before (R-07 reads the reports).
  const sundayEvening = isoDay(date) === 7 && time >= s['schedule.week_report'].time;
  if (sundayEvening || isoDay(date) !== 7) {
    const key = sundayEvening ? week : shiftWeek(week, -1);
    let created = false;
    const r = once(ctx, 'week_report', key, () => {
      created = generateReport(ctx, 'week', key).created;
    });
    // Already frozen by hand or by an earlier version: nothing new to announce.
    out.week_report = r === 'done' && !created ? 'skipped' : r;
  }
  const plan = s['schedule.week_plan'];
  // Weekly: from the configured day/time until the end of the ISO week (catch-up).
  if (isoDay(date) > plan.day || (isoDay(date) === plan.day && time >= plan.time)) {
    out.week = once(ctx, 'week', week, () => {
      closeWeek(ctx, shiftWeek(week, -1)); // RB-10
      proposeWeek(ctx, week); // §6 (C-07: never fails on a validated week since D-52, so a failure is real)
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
 * D-116: nothing on Sunday (the week report comes that evening), Saturday only when something was done, never
 * on a holiday.
 */
export async function runDailyRecapJob(
  ctx: Ctx,
  env: Record<string, string | undefined>,
  pushSender?: PushSender,
): Promise<'done' | 'skipped' | 'failed'> {
  const s = getSettings(ctx);
  const r = s['notify.daily_recap'];
  const { date, time } = parisClock(ctxNow(ctx));
  const st = notifyStatus(ctx, env);
  if (!r.enabled || time < r.time || (!st.configured && !st.pushDevices)) return 'skipped';
  if (isoDay(date) === 7 || isOnVacation(date, s['notify.vacations'])) return 'skipped';
  if (isoDay(date) === 6 && getDailyFacts(ctx, date).nothingDone) return 'skipped';
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
    await sendDailyRecap(ctx, { env, date, pushSender });
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

/**
 * User request 01/11/2026: after `runDueJobs`, a Telegram notice for each report it has just frozen (the week,
 * month or quarter that ended). A failed sending is logged by the worker, never retried.
 */
export async function notifyFrozenReports(
  ctx: Ctx,
  env: Record<string, string | undefined>,
  ran: Record<string, string>,
  pushSender?: PushSender,
): Promise<Record<string, string>> {
  const { date } = parisClock(ctxNow(ctx));
  const periods = {
    // D-116: on Sunday the week that ends, otherwise the last one (catch-up).
    week: isoDay(date) === 7 ? isoWeekOf(date) : shiftWeek(isoWeekOf(date), -1),
    month: shiftMonth(monthOf(date), -1),
    quarter: shiftQuarter(quarterOf(date), -1),
  };
  const out: Record<string, string> = {};
  for (const kind of ['week', 'month', 'quarter'] as const) {
    if (ran[kind === 'week' ? 'week_report' : kind] !== 'done') continue;
    try {
      out[`notify_${kind}`] = await notifyReportReady(ctx, env, kind, periods[kind], pushSender);
    } catch (e) {
      out[`notify_${kind}`] = `failed: ${(e as Error).message}`;
    }
  }
  return out;
}
