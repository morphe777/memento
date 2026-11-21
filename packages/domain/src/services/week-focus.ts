// D-175 (user request 21/11/2026): « Cap de la semaine », the 2 aims the week's plan stands for: where the plan
// puts its time (projects by planned minutes), told as the result to get out of it this week. Written on Monday
// morning (worker, after the plan) or on demand (↻), kept in week_plan.focus; never computed when a page opens.
// Without AI, or when it fails: the titles of the 2 projects with the most planned time. Editable by hand.
import { and, eq, inArray, ne, schema } from '@memento/db';
import { z } from 'zod';
import { DATA_RULE, dataBlock } from '../ai/prompts.ts';
import { parseJsonObject } from '../ai/propose.ts';
import type { Llm } from '../ai/providers.ts';
import { audit, type Ctx, ctxNowIso, tx } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getSettings } from '../settings.ts';
import { assertWeek } from './planning.ts';
import { getOrCreatePlan, getPlanRow } from './unplanned.ts';

const { weekPlan, weekPlanItem, task, project, objective } = schema;

/** At most this many aims. */
export const FOCUS_MAX = 2;
/** An aim is a few words: longer ones are cut. */
export const FOCUS_TEXT_MAX = 80;

export type WeekFocus = NonNullable<typeof weekPlan.$inferSelect.focus>;

/** The projects of the week's plan (planned items, done or not, not cancelled), most planned time first. */
export function weekFocusFacts(ctx: Ctx, isoWeek: string) {
  assertWeek(isoWeek);
  const plan = getPlanRow(ctx, isoWeek);
  const rows = plan
    ? ctx.db
        .select({ t: task })
        .from(weekPlanItem)
        .innerJoin(task, eq(task.id, weekPlanItem.taskId))
        .where(
          and(
            eq(weekPlanItem.weekPlanId, plan.id),
            eq(weekPlanItem.kind, 'week'),
            ne(task.status, 'cancelled'),
          ),
        )
        .all()
        .map((r) => r.t)
    : [];
  const ids = [...new Set(rows.map((t) => t.projectId).filter((x): x is string => !!x))];
  const projects = ids.length ? ctx.db.select().from(project).where(inArray(project.id, ids)).all() : [];
  const objIds = projects.map((p) => p.objectiveId).filter((x): x is string => !!x);
  const objectives = objIds.length
    ? ctx.db.select().from(objective).where(inArray(objective.id, objIds)).all()
    : [];
  const out = projects.map((p) => {
    const mine = rows.filter((t) => t.projectId === p.id);
    const o = objectives.find((x) => x.id === p.objectiveId);
    return {
      id: p.id,
      title: p.title,
      plannedMin: mine.reduce((a, t) => a + (t.durationMin ?? 0), 0),
      motive: p.motive,
      successCriterion: p.successCriterion,
      monthProject: !!p.monthFlag,
      objective: o ? { title: o.title, motive: o.motive } : null,
      tasks: mine.map((t) => ({ title: t.title, done: t.status === 'done' })),
    };
  });
  out.sort((a, b) => b.plannedMin - a.plannedMin || a.title.localeCompare(b.title, 'fr'));
  const inboxMin = rows.filter((t) => !t.projectId).reduce((a, t) => a + (t.durationMin ?? 0), 0);
  return { isoWeek, budgetMin: plan?.budgetMin ?? null, projects: out, inboxMin };
}

type Facts = ReturnType<typeof weekFocusFacts>;

/** Without AI: the titles of the 2 projects with the most planned time. */
export const plainWeekFocus = (f: Facts) =>
  f.projects.slice(0, FOCUS_MAX).map((p) => ({ text: p.title, projectId: p.id }));

const clean = (text: string) => text.trim().replace(/\s+/g, ' ').slice(0, FOCUS_TEXT_MAX);

const AI_OUTPUT = z.object({
  items: z.array(z.object({ text: z.string(), projectId: z.string().nullable().optional() })),
});

async function aiWeekFocus(ctx: Ctx, f: Facts, llm: Llm) {
  const s = getSettings(ctx);
  const { text } = await llm({
    task: 'week-focus',
    system: `${s['ai.prompt.system']}\n\nRéponds uniquement par un objet JSON {"items": [{"text": string, "projectId": string | null}]}.\n\n${DATA_RULE}`,
    user: `${s['ai.prompt.week_focus']}\n\nDonnées (JSON, durées en minutes) :\n${dataBlock({
      ...f,
      projects: f.projects.slice(0, 5),
      userContext: s['ai.instructions'].trim() || null,
    })}`,
    schema: z.toJSONSchema(AI_OUTPUT) as Record<string, unknown>,
  });
  const out = AI_OUTPUT.safeParse(parseJsonObject(text));
  const known = new Set(f.projects.map((p) => p.id));
  const items = out.success
    ? out.data.items
        .map((i) => ({
          text: clean(i.text),
          projectId: i.projectId && known.has(i.projectId) ? i.projectId : null,
        }))
        .filter((i) => i.text)
        .slice(0, FOCUS_MAX)
    : [];
  if (!items.length)
    throw new DomainError('AI_BAD_ANSWER', "La réponse de l'IA ne respecte pas le format attendu.");
  return items;
}

function saveFocus(ctx: Ctx, isoWeek: string, focus: WeekFocus) {
  return tx(ctx, () => {
    const plan = getOrCreatePlan(ctx, isoWeek);
    ctx.db
      .update(weekPlan)
      .set({ focus, updatedAt: ctxNowIso(ctx) })
      .where(eq(weekPlan.id, plan.id))
      .run();
    audit(ctx, 'week_plan', plan.id, 'update', { focus: plan.focus }, { focus });
    return focus;
  });
}

/**
 * Writes the aims of the week from its plan: by the AI when `llm` is given (null: no AI), else, or when it fails,
 * the plain ones (`aiError` then says why). Nothing planned: no aim.
 */
export async function refreshWeekFocus(ctx: Ctx, isoWeek: string, llm: Llm | null) {
  const f = weekFocusFacts(ctx, isoWeek);
  let items: WeekFocus['items'] = plainWeekFocus(f);
  let source: WeekFocus['source'] = 'plain';
  let aiError: string | null = null;
  if (llm && f.projects.length) {
    try {
      items = await aiWeekFocus(ctx, f, llm);
      source = 'ai';
    } catch (e) {
      aiError = (e as Error).message;
    }
  }
  return { focus: saveFocus(ctx, isoWeek, { items, source, at: ctxNowIso(ctx) }), aiError };
}

/** By hand: 2 lines at most, empty ones dropped. */
export function setWeekFocus(ctx: Ctx, isoWeek: string, texts: string[]) {
  assertWeek(isoWeek);
  const items = texts
    .map(clean)
    .filter(Boolean)
    .slice(0, FOCUS_MAX)
    .map((text) => ({ text, projectId: null }));
  return saveFocus(ctx, isoWeek, { items, source: 'me', at: ctxNowIso(ctx) });
}

export const getWeekFocus = (ctx: Ctx, isoWeek: string): WeekFocus | null => {
  assertWeek(isoWeek);
  return getPlanRow(ctx, isoWeek)?.focus ?? null;
};
