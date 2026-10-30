// D-77: the evening report on Telegram (19:30 by default). Mémento computes the day's facts (today, last 7 days,
// week, projects). With the AI on, the « Bilan du jour » prompt writes the whole message from those facts
// (Telegram HTML, cleaned up before sending); otherwise a plain report: achievements sentence, KPIs, done tasks.
// D-78: no day streak but a week streak and the 4-week volume; encouragement and leads when nothing was done;
// on Sunday the weekend; nothing on Saturday nor during holidays (jobs.ts).
import { eq, gte, inArray, schema } from '@memento/db';
import { z } from 'zod';
import { parseJsonObject } from '../ai/propose.ts';
import { getAiKey, type Llm, makeLlm, SECRET_SETTING_PREFIX } from '../ai/providers.ts';
import { audit, type Ctx, ctxNow, tx } from '../context.ts';
import { DomainError, NotFoundError } from '../errors.ts';
import {
  composeDailyRecap,
  type FocusItem,
  isOnVacation,
  type Recap,
  type RecapFacts,
  type RecapTask,
  recapToTelegramHtml,
  sanitizeTelegramHtml,
  stripTelegramHtml,
  type WeekVolume,
  weekStreak,
} from '../rules/daily.ts';
import { type EngineTask, scoreCandidates } from '../rules/engine.ts';
import { getSettings, patchSettings, vacationSchema } from '../settings.ts';
import {
  addDays,
  frDay,
  frMonth,
  isoDay,
  isoWeekOf,
  isValidDate,
  monthOf,
  parisDate,
  shiftWeek,
  weekMonday,
} from '../time.ts';
import { buildEngineInput, getExecution } from './planning.ts';
import { serializeProjects } from './projects.ts';

type Env = Record<string, string | undefined>;
const doneDate = (iso: string | null) => (iso ? parisDate(new Date(iso)) : null);
// RB-09: experiences are out of the time; actual time when entered (D-61).
const workMin = (t: { isExperience: boolean; actualMin: number | null; durationMin: number | null }) =>
  t.isExperience ? 0 : (t.actualMin ?? t.durationMin ?? 0);

/** The facts of a day (today by default): what the report shows and what the AI receives. */
export function getDailyFacts(ctx: Ctx, date?: string): RecapFacts {
  const day = date ?? parisDate(ctxNow(ctx));
  if (!isValidDate(day)) throw new DomainError('VALIDATION', 'Date invalide (AAAA-MM-JJ).');
  const s = schema;
  const settings = getSettings(ctx);
  // D-78: on Sunday the report covers the weekend (no report on Saturday).
  const mode = isoDay(day) === 7 ? ('weekend' as const) : ('day' as const);
  const from = mode === 'weekend' ? addDays(day, -1) : day;
  // Done tasks of the last year: the period, the last 7 days and the weekly volumes of the week streak.
  const since = new Date(Date.parse(`${addDays(day, -7 * STREAK_WEEKS)}T00:00:00Z`)).toISOString();
  const recent = ctx.db
    .select()
    .from(s.task)
    .where(gte(s.task.doneAt, since))
    .all()
    .filter((t) => t.status === 'done' && (doneDate(t.doneAt) as string) <= day);
  const byDay = new Map<string, typeof recent>();
  for (const t of recent) {
    const d = doneDate(t.doneAt) as string;
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  const done = recent.filter((t) => (doneDate(t.doneAt) as string) >= from);
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(day, i - 7);
    const ts = byDay.get(d) ?? [];
    return { date: d, doneTasks: ts.length, doneMin: ts.reduce((a, t) => a + workMin(t), 0) };
  });

  // D-78: weekly volumes, newest first (current week at 0), budget of the week's plan else the default one.
  const budgets = new Map(
    ctx.db
      .select({ isoWeek: s.weekPlan.isoWeek, budgetMin: s.weekPlan.budgetMin })
      .from(s.weekPlan)
      .all()
      .map((w) => [w.isoWeek, w.budgetMin]),
  );
  const vacations = settings['notify.vacations'];
  const thisWeek = isoWeekOf(day);
  const volumes: WeekVolume[] = Array.from({ length: STREAK_WEEKS }, (_, i) => {
    const isoWeek = shiftWeek(thisWeek, -i);
    const days = Array.from({ length: 7 }, (_, k) => addDays(weekMonday(isoWeek), k));
    return {
      isoWeek,
      doneMin: days.reduce((a, d) => a + (byDay.get(d) ?? []).reduce((b, t) => b + workMin(t), 0), 0),
      budgetMin: budgets.get(isoWeek) ?? settings['budget.weekly_min'],
      vacation: days.some((d) => isOnVacation(d, vacations)),
    };
  });

  const projectIds = [...new Set(done.map((t) => t.projectId).filter((x): x is string => !!x))];
  const projects = serializeProjects(
    ctx,
    projectIds.length ? ctx.db.select().from(s.project).where(inArray(s.project.id, projectIds)).all() : [],
  );
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const objectiveIds = [...new Set(projects.map((p) => p.objectiveId).filter((x): x is string => !!x))];
  const objectives = objectiveIds.length
    ? ctx.db.select().from(s.objective).where(inArray(s.objective.id, objectiveIds)).all()
    : [];
  const domains = new Map(
    ctx.db
      .select()
      .from(s.domain)
      .all()
      .map((d) => [d.id, d.name]),
  );
  const tasks: RecapTask[] = [...done]
    .sort((a, b) => (a.doneAt ?? '').localeCompare(b.doneAt ?? ''))
    .map((t) => {
      const p = t.projectId ? projectById.get(t.projectId) : undefined;
      const o = p?.objectiveId ? objectives.find((x) => x.id === p.objectiveId) : undefined;
      const domainId = p ? (p.domainIds[0] ?? null) : t.domainId;
      return {
        title: t.title,
        durationMin: t.actualMin ?? t.durationMin ?? 0,
        isExperience: t.isExperience,
        domainName: domainId ? (domains.get(domainId) ?? 'Inbox') : 'Inbox',
        projectTitle: p?.title ?? null,
        isMonthProject: p?.monthFlag === monthOf(day),
        objectiveTitle: o?.title ?? null,
        objectiveCriticality: o?.criticality ?? null,
        deadline: t.dueDate,
        postponeCount: t.postponeCount,
      };
    });
  const allProjects = ctx.db.select().from(s.project).all();
  const completedProjects = allProjects
    .filter((p) => {
      const d = p.status === 'done' ? doneDate(p.completedAt) : null;
      return !!d && d >= from && d <= day;
    })
    .map((p) => p.title);
  const nothingDone = done.length === 0 && completedProjects.length === 0;

  const ex = getExecution(ctx, thisWeek);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const d = Number(day.slice(8, 10));
  return {
    date: day,
    dayLabel: `${frDay(day)} ${d === 1 ? '1er' : d} ${frMonth(day)}`,
    mode,
    period: { from, to: day },
    nothingDone,
    done: {
      tasks,
      doneTasks: done.length,
      doneMin: done.reduce((a, t) => a + workMin(t), 0),
      completedProjects,
    },
    last7Days,
    avg7: {
      doneTasks: round1(last7Days.reduce((a, x) => a + x.doneTasks, 0) / 7),
      doneMin: Math.round(last7Days.reduce((a, x) => a + x.doneMin, 0) / 7),
    },
    weekStreak: weekStreak(volumes, settings['report.rhythm_low_pct']),
    weeks: volumes.slice(0, 4).reverse(),
    week: {
      plannedTasks: ex.tasks.filter((t) => t.kind === 'week').length,
      doneTasks: ex.tasks.filter((t) => t.done).length,
      remainingTasks: ex.remaining,
      doneMin: volumes[0].doneMin, // every task done this week, like the weekly report (R-05)
      budgetMin: ex.budget.budgetMin,
      daysLeftAfterToday: 7 - isoDay(day),
    },
    focus: nothingDone ? focusLeads(ctx, mode, thisWeek, ex) : [],
    projects: {
      active: allProjects.filter((p) => p.status === 'active').length,
      month: ex.monthProjects.filter((p) => p.status === 'active').length,
      monthLimit: settings['month.max_projects'],
    },
    experiences: ex.experiences,
  };
}

const STREAK_WEEKS = 52;
const FOCUS_COUNT = 3;

/**
 * D-78: up to 3 leads for the coming days, from the engine's ranking. Weekday: the open tasks of this week's
 * plan, those due within a week first (none when the plan is all done); without a plan, the best candidates.
 * Sunday: the best candidates for next week (its plan comes on Monday).
 */
function focusLeads(
  ctx: Ctx,
  mode: 'day' | 'weekend',
  isoWeek: string,
  ex: ReturnType<typeof getExecution>,
): FocusItem[] {
  const week = mode === 'weekend' ? shiftWeek(isoWeek, 1) : isoWeek;
  const input = buildEngineInput(ctx, week);
  const scored = scoreCandidates(input);
  const open = ex.tasks.filter((t) => !t.done && t.kind === 'week');
  if (mode === 'day' && ex.plan && ex.tasks.some((t) => t.kind === 'week')) {
    const score = new Map(scored.map((x) => [x.taskId, x.score]));
    const soon = addDays(input.today, 7);
    const dueSoon = (t: (typeof open)[number]) => !!t.deadline && t.deadline <= soon;
    return open
      .sort(
        (a, b) =>
          Number(dueSoon(b)) - Number(dueSoon(a)) ||
          (dueSoon(a) ? (a.deadline as string).localeCompare(b.deadline as string) : 0) ||
          (score.get(b.taskId) ?? -1) - (score.get(a.taskId) ?? -1) ||
          a.position - b.position,
      )
      .slice(0, FOCUS_COUNT)
      .map((t) => ({
        title: t.title,
        projectTitle: t.isInbox ? null : t.projectTitle,
        deadline: t.deadline,
        durationMin: t.durationMin,
      }));
  }
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const projects = new Map(input.projects.map((p) => [p.id, p]));
  return scored.slice(0, FOCUS_COUNT).map((x) => {
    const t = tasks.get(x.taskId) as EngineTask;
    const p = t.projectId ? projects.get(t.projectId) : undefined;
    return {
      title: t.title,
      projectTitle: p?.title ?? null,
      deadline: t.dueDate ?? p?.dueDate ?? null,
      durationMin: t.durationMin,
    };
  });
}

/** GET /daily-recap?date=: the plain report of a day and the facts it is made from. */
export function getDailyRecap(ctx: Ctx, date?: string): Recap & { facts: RecapFacts } {
  const facts = getDailyFacts(ctx, date);
  return { ...composeDailyRecap(facts, getSettings(ctx)['report.rhythm_low_pct']), facts };
}

const AI_OUTPUT = z.object({ message: z.string() });

/** D-77: the whole Telegram message written by the AI from the facts (prompt « Bilan du jour »), cleaned up. */
export async function writeDailyReportWithAi(ctx: Ctx, facts: RecapFacts, llm: Llm): Promise<string> {
  const s = getSettings(ctx);
  const { text } = await llm({
    system: `${s['ai.prompt.daily']}\n\nRéponds uniquement par un objet JSON {"message": string} : message = le texte complet du message Telegram (HTML Telegram : <b>, <i>, <u>, <s>, <code>, <blockquote> ; retours à la ligne par \\n, pas de <br> ni de <p>).`,
    user: `Écris le rapport du soir.\n\nDonnées Mémento (JSON, durées en minutes ; les tâches sont planifiées à la semaine, pas au jour ; aucune donnée de forme / énergie n'existe) :\n${JSON.stringify(
      { ...facts, userContext: s['ai.instructions'].trim() || null },
    )}`,
    schema: z.toJSONSchema(AI_OUTPUT) as Record<string, unknown>,
  });
  const out = AI_OUTPUT.safeParse(parseJsonObject(text));
  const message = out.success ? sanitizeTelegramHtml(out.data.message) : '';
  if (!message)
    throw new DomainError('AI_BAD_ANSWER', "La réponse de l'IA ne respecte pas le format attendu.");
  return message;
}

// ---------- Telegram (D-77) ----------

const TOKEN_ROW = `${SECRET_SETTING_PREFIX}telegram.bot_token`;
export const TELEGRAM_TOKEN_ENV = 'MEMENTO_TELEGRAM_BOT_TOKEN';

export const telegramTokenBody = z.object({ token: z.string().max(200) });

function storedToken(ctx: Pick<Ctx, 'db'>): string {
  const row = ctx.db.select().from(schema.setting).where(eq(schema.setting.key, TOKEN_ROW)).get();
  return typeof row?.value === 'string' ? row.value : '';
}
const telegramToken = (ctx: Pick<Ctx, 'db'>, env: Env) => storedToken(ctx) || env[TELEGRAM_TOKEN_ENV] || '';

/** Saves (or clears with an empty value) the bot token. Never read back; the journal records the change only. */
export function setTelegramToken(ctx: Ctx, token: string) {
  const value = token.trim();
  if (value && !/^\d+:[\w-]+$/.test(value))
    throw new DomainError('INVALID_SETTINGS', 'Jeton invalide : il ressemble à 123456789:ABC-def…');
  tx(ctx, () => {
    if (!value) ctx.db.delete(schema.setting).where(eq(schema.setting.key, TOKEN_ROW)).run();
    else
      ctx.db
        .insert(schema.setting)
        .values({ key: TOKEN_ROW, value })
        .onConflictDoUpdate({
          target: schema.setting.key,
          set: { value, updatedAt: new Date().toISOString() },
        })
        .run();
    audit(ctx, 'setting', 'settings', 'update', null, { 'telegram.bot_token': value ? 'saisi' : 'effacé' });
  });
  return { ok: true as const };
}

/** What Configuration › Planning shows: is Telegram usable, never the token itself. */
export function notifyStatus(ctx: Pick<Ctx, 'db'>, env: Env) {
  const stored = storedToken(ctx);
  const token = telegramToken(ctx, env);
  const s = getSettings(ctx);
  return {
    tokenSource: stored ? ('saisie' as const) : env[TELEGRAM_TOKEN_ENV] ? ('env' as const) : null,
    tokenHint: token ? `…${token.slice(-4)}` : null,
    tokenEnv: TELEGRAM_TOKEN_ENV,
    configured: !!token && !!s['notify.telegram_chat_id'],
  };
}

async function telegram(token: string, method: string, body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new DomainError('NOTIFY_FAILED', `Telegram injoignable : ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: unknown;
  } | null;
  if (!res.ok || !json?.ok)
    throw new DomainError('NOTIFY_FAILED', `Telegram a refusé : ${json?.description ?? res.status}`);
  return json.result;
}

/** « Trouver mon chat » : the chat of the last message sent to the bot (the user writes /start first). */
export async function detectTelegramChat(ctx: Pick<Ctx, 'db'>, env: Env) {
  const token = telegramToken(ctx, env);
  if (!token) throw new DomainError('NOTIFY_NOT_CONFIGURED', 'Enregistre d’abord le jeton du bot.');
  const updates = (await telegram(token, 'getUpdates', { limit: 50 })) as {
    message?: { chat: { id: number; first_name?: string; title?: string; username?: string } };
  }[];
  const chat = [...updates].reverse().find((u) => u.message)?.message?.chat;
  if (!chat)
    throw new DomainError(
      'NOTIFY_NOT_FOUND',
      'Aucun message reçu : ouvre ton bot dans Telegram, envoie-lui /start, puis réessaie.',
    );
  return { chatId: String(chat.id), name: chat.title ?? chat.first_name ?? chat.username ?? '' };
}

export interface SendRecapOptions {
  env: Env;
  /** Replaces the configured AI provider (tests). Null: no AI. */
  llm?: Llm | null;
  date?: string;
}

/** The message of the day: written by the AI when enabled and configured, else the plain report. */
export async function buildDailyMessage(ctx: Ctx, opts: SendRecapOptions) {
  const s = getSettings(ctx);
  const facts = getDailyFacts(ctx, opts.date);
  const recap = composeDailyRecap(facts, s['report.rhythm_low_pct']);
  const plain = { ai: false, text: recapToTelegramHtml(recap), aiError: null as string | null };
  if (!s['notify.daily_recap'].ai || opts.llm === null) return plain;
  try {
    const llm = opts.llm ?? makeLlm(s, opts.env, getAiKey(ctx, s['ai.provider']));
    return { ai: true, text: await writeDailyReportWithAi(ctx, facts, llm), aiError: null };
  } catch (e) {
    // AI off, unreachable or off-format: the plain report is sent.
    return { ...plain, aiError: (e as Error).message };
  }
}

/** Builds the message of the day and sends it on Telegram (plain text if Telegram refuses the HTML). */
export async function sendDailyRecap(ctx: Ctx, opts: SendRecapOptions) {
  const s = getSettings(ctx);
  const token = telegramToken(ctx, opts.env);
  const chatId = s['notify.telegram_chat_id'];
  if (!token || !chatId)
    throw new DomainError('NOTIFY_NOT_CONFIGURED', 'Telegram non configuré (jeton du bot et chat).');
  const msg = await buildDailyMessage(ctx, opts);
  const base = { chat_id: chatId, link_preview_options: { is_disabled: true } };
  try {
    await telegram(token, 'sendMessage', { ...base, text: msg.text, parse_mode: 'HTML' });
  } catch (e) {
    if (!/parse entities|can't parse|message is too long/i.test((e as Error).message)) throw e;
    await telegram(token, 'sendMessage', { ...base, text: stripTelegramHtml(msg.text).slice(0, 4096) });
  }
  return { sent: true, ...msg };
}

// ---------- Holidays (D-78) ----------

export const vacationBody = vacationSchema;

/** The holiday periods, sorted, and whether today is one of them. */
export function listVacations(ctx: Ctx) {
  const today = parisDate(ctxNow(ctx));
  const periods = [...getSettings(ctx)['notify.vacations']].sort((a, b) => a.from.localeCompare(b.from));
  return { onVacation: isOnVacation(today, periods), periods };
}

/** Adds a holiday period (no evening report from `from` to `to`, both included). */
export function addVacation(ctx: Ctx, period: { from: string; to: string }) {
  const parsed = vacationSchema.safeParse(period);
  if (!parsed.success || !isValidDate(parsed.data.from) || !isValidDate(parsed.data.to))
    throw new DomainError('VALIDATION', parsed.error?.issues[0]?.message ?? 'Date invalide (AAAA-MM-JJ).');
  const p = parsed.data;
  const periods = getSettings(ctx)['notify.vacations'].filter((x) => x.from !== p.from || x.to !== p.to);
  patchSettings(ctx, { 'notify.vacations': [...periods, p] });
  return listVacations(ctx);
}

/** Removes the holiday period starting on `from`. */
export function removeVacation(ctx: Ctx, from: string) {
  const periods = getSettings(ctx)['notify.vacations'];
  if (!periods.some((x) => x.from === from)) throw new NotFoundError('vacation', from);
  patchSettings(ctx, { 'notify.vacations': periods.filter((x) => x.from !== from) });
  return listVacations(ctx);
}
