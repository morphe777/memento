// D-68: « Rédiger avec l'IA » — proposes the description of a meta-objective, objective, project, task or
// domain from its template, what is already written, what the user says about himself (userContext) and the surrounding items.
// Nothing is saved here: the text comes back to the editor, where the user keeps, edits or discards it.
import { and, eq, inArray, ne, schema } from '@memento/db';
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import { getSettings } from '../settings.ts';
import { parseJsonObject } from './propose.ts';
import type { Llm } from './providers.ts';

export const DESCRIBE_KINDS = ['meta_objective', 'objective', 'project', 'task', 'domain'] as const;
export type DescribeKind = (typeof DESCRIBE_KINDS)[number];

export const aiDescribeBody = z.object({
  kind: z.enum(DESCRIBE_KINDS),
  /** The item, when it exists; a creation form sends its title and parent instead. */
  id: z.uuid().optional(),
  title: z.string().trim().max(300).optional(),
  /** Creation form: the meta-objective of a new objective, the objective of a new project. */
  parentId: z.uuid().optional(),
  /** What is in the editor right now (may be the template, or empty). */
  current: z.string().max(20_000).default(''),
  /** « Plus court », « insiste sur le budget »…: a remark on the previous proposal. */
  remark: z.string().trim().max(2000).optional(),
});
export type AiDescribeInput = z.input<typeof aiDescribeBody>;

const LABEL: Record<DescribeKind, string> = {
  meta_objective: 'méta-objectif',
  objective: 'objectif',
  project: 'projet',
  task: 'tâche',
  domain: 'domaine',
};
const OUTPUT = z.object({ text: z.string() });

const s = schema;
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).slice(0, 30);

function domainName(ctx: Ctx, id: string | null | undefined) {
  if (!id) return null;
  return ctx.db.select({ name: s.domain.name }).from(s.domain).where(eq(s.domain.id, id)).get()?.name ?? null;
}

function metaContext(ctx: Ctx, id: string | null | undefined) {
  if (!id) return null;
  const m = ctx.db.select().from(s.metaObjective).where(eq(s.metaObjective.id, id)).get();
  return m ? { title: m.title, description: m.description, horizonDate: m.horizonDate } : null;
}

function objectiveContext(ctx: Ctx, id: string | null | undefined) {
  if (!id) return null;
  const o = ctx.db.select().from(s.objective).where(eq(s.objective.id, id)).get();
  if (!o) return null;
  return {
    title: o.title,
    description: o.description,
    deadline: o.deadline,
    smart: { indicator: o.smartIndicator, target: o.smartTarget },
    metaObjective: metaContext(ctx, o.metaObjectiveId)?.title ?? null,
  };
}

function projectDomains(ctx: Ctx, projectId: string, primaryDomainId: string | null) {
  const rows = ctx.db
    .select({ name: s.domain.name, id: s.domain.id })
    .from(s.projectGroup)
    .innerJoin(s.group, eq(s.group.id, s.projectGroup.groupId))
    .innerJoin(s.domain, eq(s.domain.id, s.group.domainId))
    .where(eq(s.projectGroup.projectId, projectId))
    .all();
  const names = [...new Set(rows.map((r) => r.name))];
  return { primary: domainName(ctx, primaryDomainId), all: names };
}

/** The facts the AI may rely on, per kind (never other users' data: Mémento is single-user). */
function context(ctx: Ctx, input: z.output<typeof aiDescribeBody>) {
  const { kind, id, parentId } = input;
  switch (kind) {
    case 'meta_objective': {
      const m = id
        ? assertFound(
            ctx.db.select().from(s.metaObjective).where(eq(s.metaObjective.id, id)).get(),
            'meta_objective',
            id,
          )
        : null;
      const objectives = id
        ? ctx.db
            .select({ title: s.objective.title })
            .from(s.objective)
            .where(eq(s.objective.metaObjectiveId, id))
            .all()
        : [];
      return {
        title: m?.title ?? input.title,
        horizonDate: m?.horizonDate ?? null,
        objectives: titles(objectives),
      };
    }
    case 'objective': {
      const o = id
        ? assertFound(ctx.db.select().from(s.objective).where(eq(s.objective.id, id)).get(), 'objective', id)
        : null;
      const projects = id
        ? ctx.db.select({ title: s.project.title }).from(s.project).where(eq(s.project.objectiveId, id)).all()
        : [];
      return {
        title: o?.title ?? input.title,
        deadline: o?.deadline ?? null,
        smart: o ? { indicator: o.smartIndicator, target: o.smartTarget, current: o.smartCurrent } : null,
        metaObjective: metaContext(ctx, o?.metaObjectiveId ?? parentId),
        projects: titles(projects),
      };
    }
    case 'project': {
      const p = id
        ? assertFound(ctx.db.select().from(s.project).where(eq(s.project.id, id)).get(), 'project', id)
        : null;
      const tasks = id
        ? ctx.db
            .select({ title: s.task.title })
            .from(s.task)
            .where(and(eq(s.task.projectId, id), ne(s.task.status, 'cancelled')))
            .orderBy(s.task.position)
            .all()
        : [];
      return {
        title: p?.title ?? input.title,
        successCriterion: p?.successCriterion || null,
        dates: p ? { start: p.startDate, due: p.dueDate } : null,
        importance: p?.importance ?? null,
        domains: p ? projectDomains(ctx, p.id, p.primaryDomainId) : null,
        objective: objectiveContext(ctx, p?.objectiveId ?? parentId),
        tasks: titles(tasks),
      };
    }
    case 'task': {
      const t = id
        ? assertFound(ctx.db.select().from(s.task).where(eq(s.task.id, id)).get(), 'task', id)
        : null;
      const p = t?.projectId
        ? ctx.db.select().from(s.project).where(eq(s.project.id, t.projectId)).get()
        : null;
      const siblings = p
        ? ctx.db
            .select({ title: s.task.title })
            .from(s.task)
            .where(and(eq(s.task.projectId, p.id), ne(s.task.status, 'cancelled')))
            .orderBy(s.task.position)
            .all()
            .filter((x) => x.title !== t?.title)
        : [];
      return {
        title: t?.title ?? input.title,
        durationMin: t?.durationMin ?? null,
        dueDate: t?.dueDate ?? null,
        inbox: !p,
        domain: domainName(ctx, t?.domainId),
        project: p
          ? {
              title: p.title,
              description: p.description,
              successCriterion: p.successCriterion,
              objective: objectiveContext(ctx, p.objectiveId)?.title ?? null,
            }
          : null,
        otherTasksOfTheProject: titles(siblings),
      };
    }
    case 'domain': {
      const d = id
        ? assertFound(ctx.db.select().from(s.domain).where(eq(s.domain.id, id)).get(), 'domain', id)
        : null;
      const groups = id
        ? ctx.db.select({ title: s.group.name }).from(s.group).where(eq(s.group.domainId, id)).all()
        : [];
      const groupIds = id
        ? ctx.db
            .select({ id: s.group.id })
            .from(s.group)
            .where(eq(s.group.domainId, id))
            .all()
            .map((g) => g.id)
        : [];
      const projects = groupIds.length
        ? ctx.db
            .selectDistinct({ title: s.project.title })
            .from(s.projectGroup)
            .innerJoin(s.project, eq(s.project.id, s.projectGroup.projectId))
            .where(
              and(
                inArray(s.projectGroup.groupId, groupIds),
                inArray(s.project.status, ['ready', 'active', 'paused']),
              ),
            )
            .all()
        : [];
      return { name: d?.name ?? input.title, groups: titles(groups), currentProjects: titles(projects) };
    }
  }
}

export async function describeWithAi(ctx: Ctx, raw: AiDescribeInput, llm: Llm) {
  const input = aiDescribeBody.parse(raw);
  if (!input.id && !input.title)
    throw new DomainError('AI_DESCRIBE_EMPTY', 'Donne d’abord un titre : l’IA en a besoin pour écrire.');
  const settings = getSettings(ctx);
  const template = input.kind === 'domain' ? '' : settings[`templates.${input.kind}`];
  const data = {
    kind: LABEL[input.kind],
    item: context(ctx, input),
    template: template.trim() || null,
    current: input.current.trim() && input.current.trim() !== template.trim() ? input.current : null,
    remark: input.remark || null,
    userContext: settings['ai.instructions'].trim() || null,
  };
  const { text, model } = await llm({
    system: `${settings['ai.prompt.describe']}\n\nRéponds uniquement par un objet JSON {"text": string} : text est la description en Markdown.`,
    user: `Rédige la description de ce ${LABEL[input.kind]}.\n\nDonnées (JSON) :\n${JSON.stringify(data)}`,
    schema: z.toJSONSchema(OUTPUT) as Record<string, unknown>,
  });
  const parsed = OUTPUT.safeParse(parseJsonObject(text));
  if (!parsed.success || !parsed.data.text.trim())
    throw new DomainError('AI_BAD_ANSWER', "L'IA n'a pas renvoyé de description lisible.");
  return { text: parsed.data.text.trim(), model };
}
