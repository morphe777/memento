// D-70: « Découper avec l'IA » — proposes the tasks of a project from its description, as a short dialogue:
// the AI may ask a few questions, the user answers or comments in free text, the AI proposes again. The
// conversation lives in the browser only; nothing is created here: the checked tasks are added afterwards
// through POST /tasks/batch (same rules, same journal).
import { and, eq, ne, schema } from '@memento/db';
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import { DomainError } from '../errors.ts';
import { ALLOWED_DURATIONS, type TaskDuration } from '../rules/tasks.ts';
import { getProject } from '../services/projects.ts';
import { getSettings } from '../settings.ts';
import { parseJsonObject } from './propose.ts';
import type { Llm } from './providers.ts';

export const aiBreakdownBody = z.object({
  projectId: z.uuid(),
  /** The dialogue so far (oldest first): the AI's turns and the user's answers / remarks. */
  messages: z
    .array(z.object({ role: z.enum(['ai', 'user']), text: z.string().max(20_000) }))
    .max(40)
    .default([]),
});
export type AiBreakdownInput = z.input<typeof aiBreakdownBody>;

const OUTPUT = z.object({
  message: z.string(),
  questions: z.array(z.string()),
  tasks: z.array(z.object({ title: z.string(), durationMin: z.number(), description: z.string() })),
});

const MAX_TASKS = 30;

/**
 * The closest allowed duration (RB-03): the AI may answer 45 or 90; a tie goes to the longer one (better a
 * little too much than a budget that lies); > 120 should have been split and becomes 120.
 */
export function snapDuration(min: number): TaskDuration {
  return ALLOWED_DURATIONS.reduce((best, d) => (Math.abs(d - min) <= Math.abs(best - min) ? d : best));
}

/** A description is « written » when it says more than the untouched project template. */
export function hasOwnDescription(description: string, template: string) {
  const strip = (t: string) =>
    t
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('')
      .replace(/\s+/g, '');
  return strip(description).length > 0 && strip(description) !== strip(template);
}

export async function breakdownWithAi(ctx: Ctx, raw: AiBreakdownInput, llm: Llm) {
  const input = aiBreakdownBody.parse(raw);
  const settings = getSettings(ctx);
  const p = getProject(ctx, input.projectId);
  if (!hasOwnDescription(p.description, settings['templates.project']))
    throw new DomainError(
      'AI_BREAKDOWN_NO_DESCRIPTION',
      "Écris d'abord la description du projet : l'IA s'en sert pour proposer les tâches.",
    );
  const s = schema;
  const objective = p.objectiveId
    ? ctx.db.select().from(s.objective).where(eq(s.objective.id, p.objectiveId)).get()
    : null;
  const existing = ctx.db
    .select({ title: s.task.title, durationMin: s.task.durationMin, status: s.task.status })
    .from(s.task)
    .where(and(eq(s.task.projectId, p.id), ne(s.task.status, 'cancelled')))
    .orderBy(s.task.position)
    .all();
  const data = {
    project: {
      title: p.title,
      description: p.description,
      successCriterion: p.successCriterion || null,
      dates: { start: p.startDate, due: p.dueDate },
      sequenceMode: p.sequenceMode,
      groups: p.groups.map((g) => g.name),
      objective: objective
        ? { title: objective.title, deadline: objective.deadline, smartIndicator: objective.smartIndicator }
        : null,
    },
    existingTasks: existing,
    allowedDurationsMin: ALLOWED_DURATIONS,
    userContext: settings['ai.instructions'].trim() || null,
    conversation: input.messages,
  };
  const { text, model } = await llm({
    system: `${settings['ai.prompt.breakdown']}\n\nRéponds uniquement par un objet JSON {"message": string, "questions": string[], "tasks": [{"title": string, "durationMin": ${ALLOWED_DURATIONS.join('|')}, "description": string}]}.`,
    user: `Propose les tâches de ce projet.\n\nDonnées (JSON) :\n${JSON.stringify(data)}`,
    schema: z.toJSONSchema(OUTPUT) as Record<string, unknown>,
  });
  const parsed = OUTPUT.safeParse(parseJsonObject(text));
  if (!parsed.success)
    throw new DomainError('AI_BAD_ANSWER', "La proposition de l'IA ne respecte pas le format attendu.");
  const out = parsed.data;
  const tasks = out.tasks
    .map((t) => ({
      title: t.title.trim().slice(0, 200),
      durationMin: snapDuration(t.durationMin),
      description: t.description.trim(),
    }))
    .filter((t) => t.title)
    .slice(0, MAX_TASKS);
  return {
    message: out.message.trim(),
    questions: out.questions
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 5),
    tasks,
    model,
  };
}
