// D-77: the evening report on Telegram (19:30 by default). Mémento computes the day's facts (today, last 7 days,
// week, projects). With the AI on, the « Bilan du jour » prompt writes the whole message from those facts
// (Telegram HTML, cleaned up before sending); otherwise a plain report: achievements sentence, KPIs, done tasks.
import { eq, gte, inArray, schema } from '@memento/db';
import { z } from 'zod';
import { parseJsonObject } from '../ai/propose.ts';
import { getAiKey, type Llm, makeLlm, SECRET_SETTING_PREFIX } from '../ai/providers.ts';
import { audit, type Ctx, ctxNow, tx } from '../context.ts';
import { DomainError } from '../errors.ts';
import {
  composeDailyRecap,
  type Recap,
  type RecapFacts,
  type RecapTask,
  recapToTelegramHtml,
  sanitizeTelegramHtml,
  stripTelegramHtml,
} from '../rules/daily.ts';
import { getSettings } from '../settings.ts';
import { addDays, frDay, isoDay, isoWeekOf, isValidDate, monthOf, parisDate } from '../time.ts';
import { getExecution } from './planning.ts';
import { serializeProjects } from './projects.ts';

type Env = Record<string, string | undefined>;
const doneDate = (iso: string | null) => (iso ? parisDate(new Date(iso)) : null);
const FR_MONTHS_LONG = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
// RB-09: experiences are out of the time; actual time when entered (D-61).
const workMin = (t: { isExperience: boolean; actualMin: number | null; durationMin: number | null }) =>
  t.isExperience ? 0 : (t.actualMin ?? t.durationMin ?? 0);

/** The facts of a day (today by default): what the report shows and what the AI receives. */
export function getDailyFacts(ctx: Ctx, date?: string): RecapFacts {
  const day = date ?? parisDate(ctxNow(ctx));
  if (!isValidDate(day)) throw new DomainError('VALIDATION', 'Date invalide (AAAA-MM-JJ).');
  const s = schema;
  const settings = getSettings(ctx);
  // Done tasks of the last 60 days: today's ones, the last 7 days and the streak.
  const since = new Date(Date.parse(`${addDays(day, -60)}T00:00:00Z`)).toISOString();
  const recent = ctx.db
    .select()
    .from(s.task)
    .where(gte(s.task.doneAt, since))
    .all()
    .filter((t) => t.status === 'done');
  const byDay = new Map<string, typeof recent>();
  for (const t of recent) {
    const d = doneDate(t.doneAt) as string;
    byDay.set(d, [...(byDay.get(d) ?? []), t]);
  }
  const done = byDay.get(day) ?? [];
  let streakDays = 0;
  while (byDay.has(addDays(day, -streakDays))) streakDays++;
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(day, i - 7);
    const ts = byDay.get(d) ?? [];
    return { date: d, doneTasks: ts.length, doneMin: ts.reduce((a, t) => a + workMin(t), 0) };
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
    .filter((p) => p.status === 'done' && doneDate(p.completedAt) === day)
    .map((p) => p.title);

  const ex = getExecution(ctx, isoWeekOf(day));
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const d = Number(day.slice(8, 10));
  return {
    date: day,
    dayLabel: `${frDay(day)} ${d === 1 ? '1er' : d} ${FR_MONTHS_LONG[Number(day.slice(5, 7)) - 1]}`,
    today: {
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
    streakDays,
    week: {
      plannedTasks: ex.tasks.filter((t) => t.kind === 'week').length,
      doneTasks: ex.tasks.filter((t) => t.done).length,
      remainingTasks: ex.remaining,
      doneMin: ex.doneMin,
      budgetMin: ex.budget.budgetMin,
      daysLeftAfterToday: 7 - isoDay(day),
    },
    projects: {
      active: allProjects.filter((p) => p.status === 'active').length,
      month: ex.monthProjects.filter((p) => p.status === 'active').length,
      monthLimit: settings['month.max_projects'],
    },
    experiences: ex.experiences,
  };
}

/** GET /daily-recap?date=: the plain report of a day and the facts it is made from. */
export function getDailyRecap(ctx: Ctx, date?: string): Recap & { facts: RecapFacts } {
  const facts = getDailyFacts(ctx, date);
  return { ...composeDailyRecap(facts), facts };
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
  const recap = composeDailyRecap(facts);
  if (recap.empty) return { empty: true as const, ai: false, text: '', aiError: null };
  if (s['notify.daily_recap'].ai && opts.llm !== null) {
    try {
      const llm = opts.llm ?? makeLlm(s, opts.env, getAiKey(ctx, s['ai.provider']));
      return {
        empty: false as const,
        ai: true,
        text: await writeDailyReportWithAi(ctx, facts, llm),
        aiError: null,
      };
    } catch (e) {
      // AI off, unreachable or off-format: the plain report is sent.
      return {
        empty: false as const,
        ai: false,
        text: recapToTelegramHtml(recap),
        aiError: (e as Error).message,
      };
    }
  }
  return { empty: false as const, ai: false, text: recapToTelegramHtml(recap), aiError: null };
}

/** Builds the message of the day and sends it on Telegram (plain text if Telegram refuses the HTML). */
export async function sendDailyRecap(ctx: Ctx, opts: SendRecapOptions) {
  const s = getSettings(ctx);
  const token = telegramToken(ctx, opts.env);
  const chatId = s['notify.telegram_chat_id'];
  if (!token || !chatId)
    throw new DomainError('NOTIFY_NOT_CONFIGURED', 'Telegram non configuré (jeton du bot et chat).');
  const msg = await buildDailyMessage(ctx, opts);
  if (msg.empty) return { sent: false as const, ...msg };
  const base = { chat_id: chatId, link_preview_options: { is_disabled: true } };
  try {
    await telegram(token, 'sendMessage', { ...base, text: msg.text, parse_mode: 'HTML' });
  } catch (e) {
    if (!/parse entities|can't parse|message is too long/i.test((e as Error).message)) throw e;
    await telegram(token, 'sendMessage', { ...base, text: stripTelegramHtml(msg.text).slice(0, 4096) });
  }
  return { sent: true as const, ...msg };
}
