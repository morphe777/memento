// D-58 / V-17: « Proposer avec l'IA ». The AI reads the planning page (the same data the screen shows),
// returns a selection with one reason per choice, and Mémento turns it into a list of changes that the
// user reviews and applies through the usual endpoints. Nothing is written here: an AI proposal never
// changes data by itself. Ids the AI invents or that the rules forbid are dropped, never trusted.
import { z } from 'zod';
import { type Ctx, ctxNow } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getMonthPlanningPage } from '../services/month.ts';
import { getPlanningPage } from '../services/planning.ts';
import { getQuarterPlanningPage } from '../services/quarter.ts';
import { listDomains } from '../services/referential.ts';
import { getReport, listReports } from '../services/reports.ts';
import { getSettings } from '../settings.ts';
import { parisDate } from '../time.ts';
import type { Llm } from './providers.ts';

export type AiScope = 'week' | 'month' | 'quarter';

export interface AiChange {
  action: 'keep' | 'add' | 'remove';
  id: string;
  title: string;
  /** Week only: where the task goes. */
  kind?: 'week' | 'bonus';
  reason: string;
  durationMin?: number | null;
  /** Something that makes the change impossible or doubtful (unchecked by default in the panel). */
  warning?: string;
}

export interface AiProposal {
  scope: AiScope;
  period: string;
  summary: string;
  model: string;
  changes: AiChange[];
}

const reasoned = z.object({ id: z.string(), reason: z.string() });
const OUTPUT = {
  week: z.object({
    summary: z.string(),
    items: z.array(reasoned.extend({ kind: z.enum(['week', 'bonus']) })),
  }),
  month: z.object({ summary: z.string(), projects: z.array(reasoned) }),
  quarter: z.object({ summary: z.string(), objectives: z.array(reasoned) }),
};

// Fixed part, always appended: the format the parser expects (D-58, not editable).
const FORMAT = {
  week: '{"summary": string, "items": [{"id": taskId, "kind": "week"|"bonus", "reason": string}]}',
  month: '{"summary": string, "projects": [{"id": projectId, "reason": string}]}',
  quarter: '{"summary": string, "objectives": [{"id": objectiveId, "reason": string}]}',
};
const FORMAT_RULE =
  'Réponds uniquement par un objet JSON conforme au schéma demandé, sans texte autour. Utilise uniquement les identifiants (id) présents dans les données.';

function recentWeekReports(ctx: Ctx) {
  return listReports(ctx, { kind: 'week' })
    .slice(0, 4)
    .map((r) => {
      const p = getReport(ctx, r.id).payload as {
        global?: { sentence?: string };
        focus?: string;
        rhythm?: unknown;
        avoidance?: { count?: number };
        budgetAdjustment?: { reason?: string | null };
      };
      return {
        week: r.periodKey,
        verdict: p.global?.sentence,
        focus: p.focus,
        rhythm: p.rhythm,
        avoided: p.avoidance?.count,
        budgetContext: p.budgetAdjustment?.reason ?? null,
      };
    });
}

function common(ctx: Ctx) {
  const s = getSettings(ctx);
  return {
    today: parisDate(ctxNow(ctx)),
    userContext: s['ai.instructions'] || null,
    domains: listDomains(ctx, false).map((d) => ({
      id: d.id,
      name: d.name,
      priorityRank: d.priorityRank,
      weight: d.weight,
    })),
  };
}

function weekData(ctx: Ctx, isoWeek: string) {
  const page = getPlanningPage(ctx, isoWeek);
  const tasks = page.groups.flatMap((g) =>
    g.cards.flatMap((c) =>
      c.tasks.map((t) => ({
        ...t,
        bin: g.key,
        projectTitle: c.projectId ? c.title : null,
        domainId: c.domainId,
      })),
    ),
  );
  const data = {
    ...common(ctx),
    week: page.label,
    budgetMin: page.budget.budgetMin,
    budgetContext: page.plan?.budgetReason ?? null,
    experiences: { target: page.experienceTarget, doneInWindow: page.experiencesDone },
    alerts: page.alerts.filter((a) => a.level !== 'ok').map((a) => a.text),
    tasks: tasks.map((t) => ({
      id: t.taskId,
      title: t.title,
      bin: t.bin,
      project: t.projectTitle,
      domainId: t.domainId,
      durationMin: t.durationMin,
      mandatory: t.mandatory,
      locked: t.locked,
      isExperience: t.isExperience,
      postponeCount: t.postponeCount,
      engineScore: t.score,
      engineWhy: t.why,
      currentlySelected: t.selection,
    })),
    recentWeeks: recentWeekReports(ctx),
  };
  return { page, tasks, data };
}

function monthData(ctx: Ctx, month: string) {
  const page = getMonthPlanningPage(ctx, month);
  const s = getSettings(ctx);
  const data = {
    ...common(ctx),
    month,
    budget: page.budget,
    maxProjects: s['month.max_projects'],
    weeksContext: page.weeks.filter((w) => w.reason).map((w) => ({ week: w.isoWeek, context: w.reason })),
    objectives: page.objectives,
    chosen: page.chosen,
    candidates: page.candidates,
    inboxDue: page.inboxDue,
    alerts: page.alerts.filter((a) => a.level !== 'ok').map((a) => a.text),
  };
  return { page, data };
}

function quarterData(ctx: Ctx, quarter: string) {
  const page = getQuarterPlanningPage(ctx, quarter);
  const s = getSettings(ctx);
  const data = {
    ...common(ctx),
    quarter,
    budget: page.budget,
    maxObjectives: s['quarter.max_objectives'],
    chosen: page.chosen,
    candidates: page.candidates,
    metaObjectives: page.metas,
    alerts: page.alerts.filter((a) => a.level !== 'ok').map((a) => a.text),
  };
  return { page, data };
}

/** Lenient JSON extraction: some providers wrap the object in prose or a ``` block. */
export function parseJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new DomainError('AI_BAD_ANSWER', "L'IA n'a pas renvoyé de proposition lisible.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new DomainError('AI_BAD_ANSWER', "L'IA n'a pas renvoyé de proposition lisible (JSON invalide).");
  }
}

async function ask<S extends AiScope>(ctx: Ctx, llm: Llm, scope: S, data: unknown) {
  const schema = z.toJSONSchema(OUTPUT[scope]) as Record<string, unknown>;
  const prompts = getSettings(ctx);
  const { text, model } = await llm({
    system: `${prompts['ai.prompt.system']}\n\n${FORMAT_RULE}`,
    user: `${prompts[`ai.prompt.${scope}`]}\n\nSchéma de la réponse : ${FORMAT[scope]}\n\nDonnées (JSON) :\n${JSON.stringify(data)}`,
    schema,
  });
  const parsed = OUTPUT[scope].safeParse(parseJsonObject(text));
  if (!parsed.success)
    throw new DomainError('AI_BAD_ANSWER', "La proposition de l'IA ne respecte pas le format attendu.");
  return { out: parsed.data as z.infer<(typeof OUTPUT)[S]>, model };
}

/** First reason given for each id (the AI may repeat an id: the first occurrence wins). */
function byId<T extends { id: string }>(list: T[]) {
  const m = new Map<string, T>();
  for (const x of list) if (!m.has(x.id)) m.set(x.id, x);
  return m;
}

export async function proposeWithAi(ctx: Ctx, scope: AiScope, period: string, llm: Llm): Promise<AiProposal> {
  if (scope === 'week') {
    const { tasks, data } = weekData(ctx, period);
    const { out, model } = await ask(ctx, llm, 'week', data);
    const picked = byId(out.items);
    const changes: AiChange[] = [];
    for (const t of tasks) {
      const p = picked.get(t.taskId);
      const base = { id: t.taskId, title: t.title, durationMin: t.durationMin };
      if (p) {
        changes.push({
          ...base,
          action: t.selection ? 'keep' : 'add',
          kind: p.kind,
          reason: p.reason,
          ...(t.locked ? { warning: 'Attend une tâche précédente.' } : {}),
        });
      } else if (t.mandatory) {
        // RB: a task due this week is never dropped, whatever the AI said.
        changes.push({
          ...base,
          action: t.selection ? 'keep' : 'add',
          kind: 'week',
          reason: 'Deadline cette semaine (ajoutée par Mémento).',
        });
      } else if (t.selection) {
        changes.push({ ...base, action: 'remove', kind: t.selection, reason: "Non retenue par l'IA." });
      }
    }
    return { scope, period, summary: out.summary, model, changes };
  }
  if (scope === 'month') {
    const { page, data } = monthData(ctx, period);
    const { out, model } = await ask(ctx, llm, 'month', data);
    const picked = byId(out.projects);
    const chosenIds = new Set(page.chosen.map((p: { id: string }) => p.id));
    const changes: AiChange[] = [];
    for (const p of [...page.chosen, ...page.candidates] as {
      id: string;
      title: string;
      gaps?: string[];
      remainingMin?: number;
    }[]) {
      const pick = picked.get(p.id);
      const base = { id: p.id, title: p.title, durationMin: p.remainingMin ?? null };
      if (pick)
        changes.push({
          ...base,
          action: chosenIds.has(p.id) ? 'keep' : 'add',
          reason: pick.reason,
          ...(p.gaps?.length && !chosenIds.has(p.id)
            ? { warning: `Projet incomplet : ${p.gaps.join(', ')}.` }
            : {}),
        });
      else if (chosenIds.has(p.id))
        changes.push({ ...base, action: 'remove', reason: "Non retenu par l'IA." });
    }
    return { scope, period, summary: out.summary, model, changes };
  }
  const { page, data } = quarterData(ctx, period);
  const { out, model } = await ask(ctx, llm, 'quarter', data);
  const picked = byId(out.objectives);
  const chosenIds = new Set(page.chosen.map((o) => o.id));
  const changes: AiChange[] = [];
  for (const o of [...page.chosen, ...page.candidates]) {
    const pick = picked.get(o.id);
    const base = { id: o.id, title: o.title, durationMin: o.remainingMin };
    if (pick) changes.push({ ...base, action: chosenIds.has(o.id) ? 'keep' : 'add', reason: pick.reason });
    else if (chosenIds.has(o.id))
      changes.push({
        ...base,
        action: 'remove',
        reason: `Non retenu par l'IA : reporté à ${page.navigation.next}.`,
      });
  }
  return { scope, period, summary: out.summary, model, changes };
}
