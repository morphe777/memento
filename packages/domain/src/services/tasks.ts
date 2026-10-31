import { and, asc, eq, inArray, isNull, schema, sql } from '@memento/db';
// Tasks and Inbox. RB-03, RB-06, RB-07, RB-11, RB-15.
import { audit, type Ctx, ctxNow, ctxNowIso, newId, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import { availableTaskIds } from '../rules/availability.ts';
import { assertNoCycle } from '../rules/graph.ts';
import { checkRecurrenceRule, nextOccurrence } from '../rules/recurrence.ts';
import { checkTaskDuration } from '../rules/tasks.ts';
import type { TaskCreate, TaskPatch } from '../schemas.ts';
import { getSettings, withTemplate } from '../settings.ts';
import { addDays, currentWeek, parisDate } from '../time.ts';
import { assertActiveInvariant, getProjectRow } from './projects.ts';
import { traceUnplanned, untraceUnplanned } from './unplanned.ts';

const { task, taskDependency, project, weekPlan, weekPlanItem, domain } = schema;
export type TaskRow = typeof task.$inferSelect;

export const getTaskRow = (ctx: Ctx, id: string): TaskRow =>
  assertFound(ctx.db.select().from(task).where(eq(task.id, id)).get(), 'task', id);

function nextPosition(ctx: Ctx, projectId: string | null) {
  return (
    ctx.db
      .select({ m: sql<number>`coalesce(max(${task.position}), 0)` })
      .from(task)
      .where(projectId ? eq(task.projectId, projectId) : isNull(task.projectId))
      .get()!.m + 1
  );
}

export function touchProject(ctx: Ctx, projectId: string | null) {
  if (projectId)
    ctx.db
      .update(project)
      .set({ lastTouchedAt: ctxNowIso(ctx) })
      .where(eq(project.id, projectId))
      .run();
}

function checkTaskFields(
  ctx: Ctx,
  f: { durationMin?: number | null; recurrenceRule?: string | null; domainId?: string | null },
  projectId: string | null,
) {
  checkTaskDuration(f.durationMin); // RB-03
  checkRecurrenceRule(f.recurrenceRule);
  if (f.recurrenceRule && projectId) {
    throw new DomainError('RECURRENCE_INBOX_ONLY', 'La récurrence est réservée aux tâches Inbox (DM-41).');
  }
  if (f.domainId)
    assertFound(ctx.db.select().from(domain).where(eq(domain.id, f.domainId)).get(), 'domain', f.domainId);
}

/** Tasks of the current week plan count as "chosen" for RB-06 display. */
function currentChosen(ctx: Ctx): Set<string> {
  const plan = ctx.db
    .select()
    .from(weekPlan)
    .where(eq(weekPlan.isoWeek, currentWeek(ctxNow(ctx))))
    .get();
  if (!plan) return new Set();
  return new Set(
    ctx.db
      .select({ t: weekPlanItem.taskId })
      .from(weekPlanItem)
      .where(eq(weekPlanItem.weekPlanId, plan.id))
      .all()
      .map((r) => r.t),
  );
}

/** Tasks with RB-06 availability (`locked` = waiting for a previous task or prerequisite). */
export function listTasks(ctx: Ctx, f: { projectId?: string | 'inbox'; status?: string } = {}) {
  const statuses = f.status?.split(',').filter(Boolean) as TaskRow['status'][] | undefined;
  const rows = ctx.db
    .select()
    .from(task)
    .where(
      and(
        f.projectId === 'inbox'
          ? isNull(task.projectId)
          : f.projectId
            ? eq(task.projectId, f.projectId)
            : undefined,
        statuses?.length ? inArray(task.status, statuses) : undefined,
      ),
    )
    .orderBy(asc(task.position), asc(task.createdAt))
    .all();
  const deps = ctx.db.select().from(taskDependency).all();
  const chosen = currentChosen(ctx);
  const projectIds = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
  const projects = projectIds.length
    ? ctx.db.select().from(project).where(inArray(project.id, projectIds)).all()
    : [];
  const available = new Set<string>();
  for (const p of projects) {
    const all = ctx.db.select().from(task).where(eq(task.projectId, p.id)).all();
    for (const id of availableTaskIds(all, p.sequenceMode, chosen, deps)) available.add(id);
  }
  return rows.map((t) => ({
    ...t,
    inPlan: chosen.has(t.id),
    locked: t.status === 'todo' && !!t.projectId && !available.has(t.id),
    dependsOn: deps.filter((d) => d.taskId === t.id).map((d) => d.dependsOnTaskId),
  }));
}

export const getTask = (ctx: Ctx, id: string) => {
  const row = getTaskRow(ctx, id);
  return listTasks(ctx, { projectId: row.projectId ?? 'inbox' }).find((t) => t.id === id)!;
};

export function createTask(ctx: Ctx, input: TaskCreate) {
  return tx(ctx, () => {
    const projectId = input.projectId ?? null;
    if (projectId) getProjectRow(ctx, projectId);
    checkTaskFields(ctx, input, projectId);
    const id = newId();
    const { position, ...fields } = input;
    ctx.db
      .insert(task)
      .values({
        id,
        createdBy: ctx.actor,
        ...fields,
        description: withTemplate(ctx, 'task', fields.description),
        projectId,
        domainId: projectId ? null : (input.domainId ?? null),
        position: position ?? nextPosition(ctx, projectId),
      })
      .run();
    if (projectId) assertActiveInvariant(ctx, projectId);
    touchProject(ctx, projectId);
    const after = getTaskRow(ctx, id);
    audit(ctx, 'task', id, 'create', null, after);
    return getTask(ctx, id);
  });
}

/** Batch creation (MCP create_tasks: split a project in one call). */
export function createTasks(ctx: Ctx, projectId: string | null, items: Omit<TaskCreate, 'projectId'>[]) {
  return tx(ctx, () => items.map((t) => createTask(ctx, { ...t, projectId })));
}

export function updateTask(ctx: Ctx, id: string, patch: TaskPatch) {
  return tx(ctx, () => {
    const before = getTaskRow(ctx, id);
    checkTaskFields(ctx, patch, before.projectId);
    const set: Partial<typeof task.$inferInsert> = { ...patch, updatedAt: ctxNowIso(ctx) };
    if (before.projectId) set.domainId = null;
    if (patch.status === 'todo' && before.status === 'done') set.doneAt = null;
    ctx.db.update(task).set(set).where(eq(task.id, id)).run();
    if (before.projectId) assertActiveInvariant(ctx, before.projectId);
    touchProject(ctx, before.projectId);
    audit(ctx, 'task', id, patch.status === 'cancelled' ? 'cancel' : 'update', before, getTaskRow(ctx, id));
    return getTask(ctx, id);
  });
}

/** Check a task (G-03: 1 click). RB-11: a recurring Inbox task spawns its next occurrence. */
export function completeTask(ctx: Ctx, id: string, opts: { actualMin?: number | null } = {}) {
  return tx(ctx, () => {
    const before = getTaskRow(ctx, id);
    if (before.status === 'done') return { task: getTask(ctx, id), next: null };
    if (before.status === 'cancelled')
      throw new DomainError('TASK_CANCELLED', 'Tâche annulée : réactive-la d’abord.');
    ctx.db
      .update(task)
      .set({
        status: 'done',
        doneAt: ctxNowIso(ctx),
        updatedAt: ctxNowIso(ctx),
        ...(opts.actualMin !== undefined ? { actualMin: opts.actualMin } : {}), // D-61
      })
      .where(eq(task.id, id))
      .run();
    touchProject(ctx, before.projectId);
    audit(ctx, 'task', id, 'complete', before, getTaskRow(ctx, id));
    traceUnplanned(ctx, id); // D-99
    let next = null;
    if (!before.projectId && before.recurrenceRule) {
      const ref = before.dueDate ?? parisDate(ctxNow(ctx));
      const nextDue = nextOccurrence(before.recurrenceRule, ref);
      if (nextDue) {
        next = createTask(ctx, {
          title: before.title,
          description: before.description,
          durationMin: before.durationMin,
          isExperience: before.isExperience,
          isFree: before.isFree,
          dueDate: nextDue,
          recurrenceRule: before.recurrenceRule,
          domainId: before.domainId,
          projectId: null,
        });
      }
    }
    return { task: getTask(ctx, id), next };
  });
}

/**
 * D-99: « Fait hors plan » from Ma semaine: creates a task already done (in a project or the Inbox), traced as
 * unplanned in the current week by completeTask.
 */
export function logDoneTask(ctx: Ctx, input: TaskCreate) {
  return tx(ctx, () => {
    const { actualMin, ...rest } = input;
    const created = createTask(ctx, rest);
    return completeTask(ctx, created.id, { actualMin: actualMin ?? null }).task;
  });
}

export function uncompleteTask(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getTaskRow(ctx, id);
    if (before.status !== 'done') return getTask(ctx, id);
    ctx.db
      .update(task)
      .set({ status: 'todo', doneAt: null, updatedAt: ctxNowIso(ctx) })
      .where(eq(task.id, id))
      .run();
    audit(ctx, 'task', id, 'uncomplete', before, getTaskRow(ctx, id));
    untraceUnplanned(ctx, id); // D-99
    return getTask(ctx, id);
  });
}

/** F-10 / DM-51: reordering changes the implicit prerequisites (RB-06). */
export function reorderTasks(ctx: Ctx, projectId: string | null, ids: string[]) {
  return tx(ctx, () => {
    ids.forEach((id, i) => {
      const t = getTaskRow(ctx, id);
      if (t.projectId !== projectId)
        throw new DomainError('NOT_IN_PROJECT', `« ${t.title} » n'est pas dans cette liste.`);
      if (t.position !== i + 1) {
        ctx.db
          .update(task)
          .set({ position: i + 1, updatedAt: ctxNowIso(ctx) })
          .where(eq(task.id, id))
          .run();
        audit(ctx, 'task', id, 'reorder', { position: t.position }, { position: i + 1 });
      }
    });
    touchProject(ctx, projectId);
    return listTasks(ctx, { projectId: projectId ?? 'inbox' });
  });
}

/** Move a task to another project or to the Inbox (null). */
export function moveTask(ctx: Ctx, id: string, projectId: string | null, position?: number) {
  return tx(ctx, () => {
    const before = getTaskRow(ctx, id);
    if (projectId) getProjectRow(ctx, projectId);
    if (projectId && before.recurrenceRule) {
      throw new DomainError('RECURRENCE_INBOX_ONLY', 'Une tâche récurrente reste dans l’Inbox.');
    }
    ctx.db
      .update(task)
      .set({
        projectId,
        domainId: projectId ? null : before.domainId,
        position: position ?? nextPosition(ctx, projectId),
        updatedAt: ctxNowIso(ctx),
      })
      .where(eq(task.id, id))
      .run();
    if (projectId) assertActiveInvariant(ctx, projectId);
    touchProject(ctx, before.projectId);
    touchProject(ctx, projectId);
    audit(ctx, 'task', id, 'move', before, getTaskRow(ctx, id));
    return getTask(ctx, id);
  });
}

export function addTaskDependency(ctx: Ctx, id: string, dependsOnId: string) {
  return tx(ctx, () => {
    getTaskRow(ctx, id);
    getTaskRow(ctx, dependsOnId);
    const edges = ctx.db
      .select()
      .from(taskDependency)
      .all()
      .map((e) => ({ from: e.taskId, to: e.dependsOnTaskId }));
    assertNoCycle(edges, id, dependsOnId); // RB-07
    ctx.db
      .insert(taskDependency)
      .values({ taskId: id, dependsOnTaskId: dependsOnId })
      .onConflictDoNothing()
      .run();
    audit(ctx, 'task', id, 'dependency_add', null, { dependsOnTaskId: dependsOnId });
    return getTask(ctx, id);
  });
}

export function removeTaskDependency(ctx: Ctx, id: string, dependsOnId: string) {
  return tx(ctx, () => {
    ctx.db
      .delete(taskDependency)
      .where(and(eq(taskDependency.taskId, id), eq(taskDependency.dependsOnTaskId, dependsOnId)))
      .run();
    audit(ctx, 'task', id, 'dependency_remove', { dependsOnTaskId: dependsOnId }, null);
    return getTask(ctx, id);
  });
}

/**
 * Inbox page (D-44): open tasks; recurring tasks whose deadline is more than N days away (« Plus tard »,
 * N = inbox.recurring_horizon_days); tasks done this month only.
 */
export function listInbox(ctx: Ctx) {
  const today = parisDate(ctxNow(ctx));
  const horizon = addDays(today, getSettings(ctx)['inbox.recurring_horizon_days']);
  const all = listTasks(ctx, { projectId: 'inbox', status: 'todo,done' });
  const later = (t: (typeof all)[number]) => !!t.recurrenceRule && !!t.dueDate && t.dueDate > horizon;
  const month = today.slice(0, 7);
  return {
    horizonDays: getSettings(ctx)['inbox.recurring_horizon_days'],
    open: all.filter((t) => t.status === 'todo' && !later(t)),
    later: all
      .filter((t) => t.status === 'todo' && later(t))
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    doneThisMonth: all.filter(
      (t) => t.status === 'done' && !!t.doneAt && parisDate(new Date(t.doneAt)).slice(0, 7) === month,
    ),
  };
}
