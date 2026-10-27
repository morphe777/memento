// D-75: « Proposer un chemin avec l'IA » on an objective — same dialogue as D-70 one level up: the AI proposes
// the ordered projects (ideas) of the objective's path, may ask a few questions, the user answers or comments.
// Nothing is created here: the checked projects are created afterwards through POST /projects (RB-01).
import { asc, eq, schema } from '@memento/db';
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import { getSettings } from '../settings.ts';
import { parseJsonObject } from './propose.ts';
import type { Llm } from './providers.ts';

export const aiPathBody = z.object({
  objectiveId: z.uuid(),
  /** The dialogue so far (oldest first): the AI's turns and the user's answers / remarks. */
  messages: z
    .array(z.object({ role: z.enum(['ai', 'user']), text: z.string().max(20_000) }))
    .max(40)
    .default([]),
});
export type AiPathInput = z.input<typeof aiPathBody>;

const OUTPUT = z.object({
  message: z.string(),
  questions: z.array(z.string()),
  projects: z.array(z.object({ title: z.string(), successCriterion: z.string(), description: z.string() })),
});

const MAX_PROJECTS = 12;

export async function pathWithAi(ctx: Ctx, raw: AiPathInput, llm: Llm) {
  const input = aiPathBody.parse(raw);
  const settings = getSettings(ctx);
  const s = schema;
  const o = assertFound(
    ctx.db.select().from(s.objective).where(eq(s.objective.id, input.objectiveId)).get(),
    'objective',
    input.objectiveId,
  );
  const meta = o.metaObjectiveId
    ? ctx.db.select().from(s.metaObjective).where(eq(s.metaObjective.id, o.metaObjectiveId)).get()
    : null;
  const existing = ctx.db
    .select({
      title: s.project.title,
      status: s.project.status,
      successCriterion: s.project.successCriterion,
    })
    .from(s.project)
    .where(eq(s.project.objectiveId, o.id))
    .orderBy(asc(s.project.positionInObjective), asc(s.project.createdAt))
    .all();
  const data = {
    objective: {
      title: o.title,
      description: o.description,
      smart: { indicator: o.smartIndicator, target: o.smartTarget, current: o.smartCurrent },
      deadline: o.deadline,
      quarter: o.quarter,
    },
    metaObjective: meta ? { title: meta.title, description: meta.description } : null,
    existingProjects: existing,
    userContext: settings['ai.instructions'].trim() || null,
    conversation: input.messages,
  };
  const { text, model } = await llm({
    system: `${settings['ai.prompt.path']}\n\nRéponds uniquement par un objet JSON {"message": string, "questions": string[], "projects": [{"title": string, "successCriterion": string, "description": string}]}.`,
    user: `Propose le chemin (les projets dans l'ordre) de cet objectif.\n\nDonnées (JSON) :\n${JSON.stringify(data)}`,
    schema: z.toJSONSchema(OUTPUT) as Record<string, unknown>,
  });
  const parsed = OUTPUT.safeParse(parseJsonObject(text));
  if (!parsed.success)
    throw new DomainError('AI_BAD_ANSWER', "La proposition de l'IA ne respecte pas le format attendu.");
  const out = parsed.data;
  return {
    message: out.message.trim(),
    questions: out.questions
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 5),
    projects: out.projects
      .map((p) => ({
        title: p.title.trim().slice(0, 200),
        successCriterion: p.successCriterion.trim().slice(0, 500),
        description: p.description.trim(),
      }))
      .filter((p) => p.title)
      .slice(0, MAX_PROJECTS),
    model,
  };
}
