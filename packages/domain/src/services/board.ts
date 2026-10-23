// Task views « Tableau » and « Kanban » (decision D-33): open tasks of live projects and the Inbox,
// plus the tasks done since Monday, each with its column, project and colour domain.
import { type Ctx, ctxNow } from '../context.ts';
import { taskBucket } from '../rules/tasks.ts';
import { currentWeek, parisDate, weekMonday } from '../time.ts';
import { getPlanRow, planItemsOf, setWeekItems } from './planning.ts';
import { getProjectRow, serializeProjects } from './projects.ts';
import { getTask, listTasks } from './tasks.ts';

const LIVE = new Set(['active', 'paused']);

export function listBoardTasks(ctx: Ctx, f: { projectId?: string } = {}) {
  const monday = weekMonday(currentWeek(ctxNow(ctx)));
  const tasks = listTasks(ctx, { projectId: f.projectId, status: 'todo,done' });
  const ids = [...new Set(tasks.map((t) => t.projectId).filter((x): x is string => !!x))];
  const projects = new Map(
    serializeProjects(
      ctx,
      ids.map((id) => getProjectRow(ctx, id)),
    ).map((p) => [p.id, p]),
  );
  return tasks
    .filter((t) => {
      const p = t.projectId ? projects.get(t.projectId) : null;
      if (t.status === 'done') return !!t.doneAt && parisDate(new Date(t.doneAt)) >= monday;
      return f.projectId ? true : !p || LIVE.has(p.status);
    })
    .map((t) => {
      const p = t.projectId ? projects.get(t.projectId) : null;
      return {
        ...t,
        bucket: taskBucket(t),
        projectTitle: p?.title ?? null,
        projectStatus: p?.status ?? null,
        colorDomainId: p ? (p.domainIds[0] ?? null) : t.domainId,
      };
    });
}

/** Add a task to (or remove it from) the current week plan as a « Semaine » item; the plan rules apply. */
export function setTaskInCurrentWeek(ctx: Ctx, taskId: string, inWeek: boolean) {
  getTask(ctx, taskId); // 404 if unknown
  const week = currentWeek(ctxNow(ctx));
  const plan = getPlanRow(ctx, week);
  const items = (plan ? planItemsOf(ctx, plan.id) : []).map((i) => ({ taskId: i.taskId, kind: i.kind }));
  const others = items.filter((i) => i.taskId !== taskId);
  setWeekItems(ctx, week, inWeek ? [...others, { taskId, kind: 'week' }] : others);
  return getTask(ctx, taskId);
}
