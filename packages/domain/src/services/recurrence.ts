// D-62: recurring projects and objectives (user request 25/10/2026). A recurring project, once completed, is
// renewed: a copy with its tasks (all to do), planned for the next period. A recurring objective, once closed
// (achieved, partial or failed — not abandoned), is renewed for the next quarter / year. The new occurrence
// keeps a link to the one it renews (previous_id); stopping the recurrence = removing it on the new occurrence.
import { and, asc, eq, inArray, schema } from '@memento/db';
import { type Ctx, ctxNow, ctxNowIso } from '../context.ts';
import { DomainError } from '../errors.ts';
import { OBJECTIVE_RECURRENCE_MONTHS } from '../rules/recurrence.ts';
import { addMonths, monthOf, parisDate, quarterOf, shiftMonth } from '../time.ts';
import { createProject, getProject, getProjectRow, promoteProject, setProjectMonth } from './projects.ts';
import { createObjective, getObjective } from './referential.ts';
import { createTask } from './tasks.ts';

const { project, projectGroup, task, objective } = schema;

export const PROJECT_RECURRENCE_MONTHS = { monthly: 1, quarterly: 3, yearly: 12 } as const;
const OPEN_OBJECTIVE = ['active', 'paused'];

/** The open occurrence that renews this objective, if any (to re-attach renewed projects). */
function openSuccessor(ctx: Ctx, objectiveId: string): string | null {
  let id: string | null = objectiveId;
  for (let i = 0; i < 20 && id; i++) {
    const o = getObjective(ctx, id);
    if (OPEN_OBJECTIVE.includes(o.status)) return o.id;
    id =
      ctx.db.select({ id: objective.id }).from(objective).where(eq(objective.previousId, id)).get()?.id ??
      null;
  }
  return null;
}

export function renewProject(ctx: Ctx, id: string) {
  const p = getProjectRow(ctx, id);
  if (!p.recurrence) return null;
  if (ctx.db.select({ id: project.id }).from(project).where(eq(project.previousId, id)).get()) return null;
  const months = PROJECT_RECURRENCE_MONTHS[p.recurrence];
  const current = monthOf(parisDate(ctxNow(ctx)));
  // The next period follows the one the project was planned for (or now), and is never in the past.
  let month = shiftMonth(p.monthFlag ?? current, months);
  while (month <= current) month = shiftMonth(month, months);
  const groupIds = ctx.db
    .select({ g: projectGroup.groupId })
    .from(projectGroup)
    .where(eq(projectGroup.projectId, id))
    .all()
    .map((r) => r.g);
  const next = createProject(ctx, {
    title: p.title,
    description: p.description,
    groupIds,
    primaryDomainId: p.primaryDomainId,
    objectiveId: p.objectiveId ? openSuccessor(ctx, p.objectiveId) : null,
    isFree: p.isFree,
    sequenceMode: p.sequenceMode,
    successCriterion: p.successCriterion,
    importance: p.importance,
    startDate: p.startDate ? addMonths(p.startDate, months) : null,
    dueDate: p.dueDate ? addMonths(p.dueDate, months) : null,
  });
  ctx.db
    .update(project)
    .set({ recurrence: p.recurrence, previousId: id, updatedAt: ctxNowIso(ctx) })
    .where(eq(project.id, next.id))
    .run();
  const tasks = ctx.db
    .select()
    .from(task)
    .where(and(eq(task.projectId, id), inArray(task.status, ['todo', 'done'])))
    .orderBy(asc(task.position))
    .all();
  for (const t of tasks)
    createTask(ctx, {
      projectId: next.id,
      title: t.title,
      description: t.description,
      durationMin: t.durationMin,
      isExperience: t.isExperience,
      isFree: t.isFree,
    });
  promoteProject(ctx, next.id);
  try {
    setProjectMonth(ctx, next.id, month); // planned for the next period (D-42), if complete (RB-02)
  } catch (e) {
    if (!(e instanceof DomainError)) throw e; // incomplete: stays « prêt », listed « à compléter »
  }
  return getProject(ctx, next.id);
}

export function renewObjective(ctx: Ctx, id: string) {
  const o = getObjective(ctx, id);
  if (!o.recurrence) return null;
  if (ctx.db.select({ id: objective.id }).from(objective).where(eq(objective.previousId, id)).get())
    return null;
  const deadline = addMonths(o.deadline, OBJECTIVE_RECURRENCE_MONTHS[o.recurrence]);
  const next = createObjective(ctx, {
    title: o.title,
    description: o.description,
    metaObjectiveId: o.metaObjectiveId,
    smartIndicator: o.smartIndicator,
    smartTarget: o.smartTarget,
    criticality: o.criticality,
    deadline,
    quarter: quarterOf(deadline),
  });
  ctx.db
    .update(objective)
    .set({ recurrence: o.recurrence, previousId: id, updatedAt: ctxNowIso(ctx) })
    .where(eq(objective.id, next.id))
    .run();
  return getObjective(ctx, next.id);
}
