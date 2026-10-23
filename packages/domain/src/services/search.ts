import { eq, schema } from '@memento/db';
// Spotlight search (F-01 to F-04). Ranking lives in rules/search.ts; volumes are small (mono-user).
import type { Ctx } from '../context.ts';
import { rankResults, type Searchable } from '../rules/search.ts';

export function search(ctx: Ctx, q: string) {
  const { objective, project, task, projectGroup, group, domain } = schema;
  const labelsByProject = new Map<string, string[]>();
  const links = ctx.db
    .select({ projectId: projectGroup.projectId, g: group.name, d: domain.name })
    .from(projectGroup)
    .innerJoin(group, eq(group.id, projectGroup.groupId))
    .innerJoin(domain, eq(domain.id, group.domainId))
    .all();
  for (const l of links) labelsByProject.set(l.projectId, [...(labelsByProject.get(l.projectId) ?? []), l.g, l.d]);
  const items: Searchable[] = [
    ...ctx.db.select().from(objective).all().map((o) => ({ type: 'objective' as const, id: o.id, title: o.title, description: o.description, labels: o.smartIndicator })),
    ...ctx.db.select().from(project).all().map((p) => ({
      type: p.status === 'idea' ? ('idea' as const) : ('project' as const),
      id: p.id,
      title: p.title,
      description: `${p.description} ${p.successCriterion}`,
      labels: (labelsByProject.get(p.id) ?? []).join(' '),
    })),
    ...ctx.db.select().from(task).all().filter((t) => t.status !== 'cancelled').map((t) => ({
      type: t.projectId ? ('task' as const) : ('inbox' as const),
      id: t.id,
      title: t.title,
      description: t.description,
      labels: t.projectId ? (labelsByProject.get(t.projectId) ?? []).join(' ') : '',
    })),
  ];
  const tasks = new Map(ctx.db.select({ id: task.id, projectId: task.projectId, status: task.status }).from(task).all().map((t) => [t.id, t]));
  const groups = rankResults(q, items);
  return {
    ...groups,
    task: groups.task.map((t) => ({ ...t, projectId: tasks.get(t.id)?.projectId ?? null, status: tasks.get(t.id)?.status })),
    inbox: groups.inbox.map((t) => ({ ...t, status: tasks.get(t.id)?.status })),
  };
}
