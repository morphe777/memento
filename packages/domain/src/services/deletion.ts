// Hard deletion of tasks, projects, objectives and meta-objectives (decision D-35).
// Everything is removed in one transaction and journaled with its last state (RB-15). Frozen reports keep
// their payload; links that would dangle are removed (dependencies, plan items, resources, group links).
import { eq, inArray, or, schema } from '@memento/db';
import { audit, type Ctx, ctxNowIso, tx } from '../context.ts';
import { getProjectRow } from './projects.ts';
import { getMetaObjective, getObjective, refreshObjectiveProgress } from './referential.ts';
import { getTaskRow, touchProject } from './tasks.ts';

const {
  task,
  taskDependency,
  weekPlanItem,
  resourceLink,
  project,
  projectGroup,
  projectDependency,
  objective,
  metaObjective,
} = schema;

function removeTaskRows(ctx: Ctx, ids: string[]) {
  if (!ids.length) return;
  ctx.db
    .delete(taskDependency)
    .where(or(inArray(taskDependency.taskId, ids), inArray(taskDependency.dependsOnTaskId, ids)))
    .run();
  ctx.db.delete(weekPlanItem).where(inArray(weekPlanItem.taskId, ids)).run();
  ctx.db.delete(resourceLink).where(inArray(resourceLink.ownerId, ids)).run();
  ctx.db.delete(task).where(inArray(task.id, ids)).run();
}

export function deleteTask(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getTaskRow(ctx, id);
    removeTaskRows(ctx, [id]);
    touchProject(ctx, before.projectId);
    audit(ctx, 'task', id, 'delete', before, null);
    return { ok: true as const };
  });
}

/** Deletes the project with its tasks; the objective's stored progress is refreshed (D-05). */
export function deleteProject(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getProjectRow(ctx, id);
    const taskIds = ctx.db
      .select({ id: task.id })
      .from(task)
      .where(eq(task.projectId, id))
      .all()
      .map((t) => t.id);
    removeTaskRows(ctx, taskIds);
    ctx.db.delete(projectGroup).where(eq(projectGroup.projectId, id)).run();
    ctx.db
      .delete(projectDependency)
      .where(or(eq(projectDependency.projectId, id), eq(projectDependency.dependsOnProjectId, id)))
      .run();
    ctx.db.delete(resourceLink).where(eq(resourceLink.ownerId, id)).run();
    ctx.db.delete(project).where(eq(project.id, id)).run();
    refreshObjectiveProgress(ctx, before.objectiveId);
    audit(ctx, 'project', id, 'delete', { ...before, deletedTaskCount: taskIds.length }, null);
    return { ok: true as const };
  });
}

/** Deletes the objective; its projects stay, « hors objectif ». */
export function deleteObjective(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getObjective(ctx, id);
    const detached = ctx.db.select({ id: project.id }).from(project).where(eq(project.objectiveId, id)).all();
    ctx.db
      .update(project)
      .set({ objectiveId: null, updatedAt: ctxNowIso(ctx) })
      .where(eq(project.objectiveId, id))
      .run();
    for (const p of detached)
      audit(ctx, 'project', p.id, 'update', { objectiveId: id }, { objectiveId: null });
    ctx.db.delete(resourceLink).where(eq(resourceLink.ownerId, id)).run();
    ctx.db.delete(objective).where(eq(objective.id, id)).run();
    audit(ctx, 'objective', id, 'delete', before, null);
    return { ok: true as const };
  });
}

/** Deletes the meta-objective; its objectives stay, without meta-objective. */
export function deleteMetaObjective(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getMetaObjective(ctx, id);
    ctx.db
      .update(objective)
      .set({ metaObjectiveId: null, updatedAt: ctxNowIso(ctx) })
      .where(eq(objective.metaObjectiveId, id))
      .run();
    ctx.db.delete(metaObjective).where(eq(metaObjective.id, id)).run();
    audit(ctx, 'meta_objective', id, 'delete', before, null);
    return { ok: true as const };
  });
}
