// F2 / M-10 (D-137): the one definition of « Fait » for a period, shared by the planning pages and « Ma semaine ».
import { and, eq, gte, inArray, lt, schema } from '@memento/db';
import type { Ctx } from '../context.ts';
import { addDays, parisDayStartIso } from '../time.ts';
import { serializeProjects } from './projects.ts';

const { project, task } = schema;

/**
 * Every task done from `first` to `last` included (Paris days, M-01), whatever it was (planned, bonus, outside the
 * plan, Inbox, project since abandoned). A task deleted or unchecked is no longer done. `workMin` is what counts in
 * the budget (experiences aside, RB-09; time spent when entered, D-61); `mix` is by primary domain, experiences
 * included, like the planned mix.
 */
export function doneBetween(ctx: Ctx, first: string, last: string) {
  const rows = ctx.db
    .select()
    .from(task)
    .where(
      and(
        eq(task.status, 'done'),
        gte(task.doneAt, parisDayStartIso(first)),
        lt(task.doneAt, parisDayStartIso(addDays(last, 1))),
      ),
    )
    .all();
  const pids = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
  const primary = new Map(
    serializeProjects(
      ctx,
      pids.length ? ctx.db.select().from(project).where(inArray(project.id, pids)).all() : [],
    ).map((p) => [p.id, p.domainIds[0] ?? null]),
  );
  const spent = (t: (typeof rows)[number]) => t.actualMin ?? t.durationMin ?? 0;
  const mix = new Map<string | null, number>();
  for (const t of rows) {
    const d = t.projectId ? (primary.get(t.projectId) ?? null) : t.domainId;
    mix.set(d, (mix.get(d) ?? 0) + spent(t));
  }
  return {
    taskIds: rows.map((t) => t.id),
    projectIds: pids,
    count: rows.length,
    experiences: rows.filter((t) => t.isExperience).length,
    workMin: rows.filter((t) => !t.isExperience).reduce((a, t) => a + spent(t), 0),
    mix: [...mix].map(([domainId, minutes]) => ({ domainId, minutes })),
  };
}
