// D-109 (user request 02/11/2026): duplicate a project or an objective to reuse its structure. A copy starts
// fresh: every task to do, no month, no dates, no recurrence, no time spent; an idea stays an idea, any other
// status gives a « prêt » copy. An objective copy brings its projects (not the abandoned ones) and the order of
// its path.
import { and, asc, eq, inArray, schema } from '@memento/db';
import { type Ctx, tx } from '../context.ts';
import { setProjectDependencies } from './dependencies.ts';
import { createProject, getProject, getProjectRow, promoteProject } from './projects.ts';
import { createObjective, getObjective, refreshObjectiveProgress } from './referential.ts';
import { addTaskDependency, createTask } from './tasks.ts';

const { project, projectGroup, projectDependency, task, taskDependency } = schema;

export const copyTitle = (title: string) => `${title} (copie)`.slice(0, 200);

export function duplicateProject(
  ctx: Ctx,
  id: string,
  opts: { title?: string; objectiveId?: string | null; dependsOn?: string[] } = {},
) {
  return tx(ctx, () => {
    const p = getProjectRow(ctx, id);
    const groupIds = ctx.db
      .select({ g: projectGroup.groupId })
      .from(projectGroup)
      .where(eq(projectGroup.projectId, id))
      .all()
      .map((r) => r.g);
    const objectiveId = opts.objectiveId === undefined ? p.objectiveId : opts.objectiveId;
    const copy = createProject(ctx, {
      title: opts.title?.trim() || copyTitle(p.title),
      description: p.description,
      groupIds,
      primaryDomainId: p.primaryDomainId,
      objectiveId,
      isFree: p.isFree,
      sequenceMode: p.sequenceMode,
      successCriterion: p.successCriterion,
      importance: p.importance,
      motive: p.motive,
      // Same objective: at the end of its path (DM-101); another objective: the caller rebuilds the path.
      dependsOn: opts.dependsOn,
    });
    const tasks = ctx.db
      .select()
      .from(task)
      .where(and(eq(task.projectId, id), inArray(task.status, ['todo', 'done'])))
      .orderBy(asc(task.position))
      .all();
    const ids = new Map<string, string>();
    for (const t of tasks)
      ids.set(
        t.id,
        createTask(ctx, {
          projectId: copy.id,
          title: t.title,
          description: t.description,
          durationMin: t.durationMin,
          isExperience: t.isExperience,
          isFree: t.isFree,
        }).id,
      );
    // Explicit task links (RB-06) between copied tasks follow.
    const links = tasks.length
      ? ctx.db
          .select()
          .from(taskDependency)
          .where(inArray(taskDependency.taskId, [...ids.keys()]))
          .all()
      : [];
    for (const l of links) {
      const from = ids.get(l.taskId);
      const to = ids.get(l.dependsOnTaskId);
      if (from && to) addTaskDependency(ctx, from, to);
    }
    if (p.status !== 'idea') promoteProject(ctx, copy.id);
    return getProject(ctx, copy.id);
  });
}

export function duplicateObjective(
  ctx: Ctx,
  id: string,
  opts: { title?: string; withProjects?: boolean } = {},
) {
  return tx(ctx, () => {
    const o = getObjective(ctx, id);
    const numeric = /^\s*\d+([.,]\d+)?\s*$/.test(o.smartTarget);
    const copy = createObjective(ctx, {
      title: opts.title?.trim() || copyTitle(o.title),
      description: o.description,
      metaObjectiveId: o.metaObjectiveId,
      smartIndicator: o.smartIndicator,
      smartTarget: o.smartTarget,
      smartCurrent: numeric ? '0' : '', // like a new occurrence (DM-108): starts at 0 / target
      criticality: o.criticality,
      deadline: o.deadline,
      quarter: o.quarter,
      motive: o.motive,
    });
    if (opts.withProjects !== false) {
      const sources = ctx.db
        .select()
        .from(project)
        .where(eq(project.objectiveId, id))
        .orderBy(asc(project.positionInObjective))
        .all()
        .filter((p) => p.status !== 'abandoned');
      const ids = new Map<string, string>();
      for (const p of sources)
        ids.set(
          p.id,
          duplicateProject(ctx, p.id, { title: p.title, objectiveId: copy.id, dependsOn: [] }).id,
        );
      // The path (DM-101) is rebuilt between the copies; links to projects outside the objective are not kept.
      const edges = sources.length
        ? ctx.db
            .select()
            .from(projectDependency)
            .where(inArray(projectDependency.projectId, [...ids.keys()]))
            .all()
        : [];
      for (const [from, to] of ids) {
        const wanted = edges
          .filter((e) => e.projectId === from && ids.has(e.dependsOnProjectId))
          .map((e) => ids.get(e.dependsOnProjectId)!);
        if (wanted.length) setProjectDependencies(ctx, to, wanted);
      }
      refreshObjectiveProgress(ctx, copy.id);
    }
    return getObjective(ctx, copy.id);
  });
}
