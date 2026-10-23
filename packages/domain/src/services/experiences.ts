// Page « Expériences » (decision D-54): the goal of living more experiences, made visible.
// Target over the sliding window (same rule as Ma semaine, R-02), memories (done experiences), planned ones
// (in the current week plan or with a deadline) and the reserve (other experience tasks to do).
import { desc, eq, schema } from '@memento/db';
import { type Ctx, ctxNow } from '../context.ts';
import type { ExperienceIdea } from '../schemas.ts';
import { getSettings } from '../settings.ts';
import { addDays, currentWeek, parisDate, weekMonday } from '../time.ts';
import { serializeProjects } from './projects.ts';
import { createTask, listTasks } from './tasks.ts';

const { task, project } = schema;

export function getExperiencesPage(ctx: Ctx) {
  const s = getSettings(ctx);
  const today = parisDate(ctxNow(ctx));
  const monday = weekMonday(currentWeek(ctxNow(ctx)));
  const windowWeeks = s['experience.window_weeks'];
  const from = addDays(monday, -7 * (windowWeeks - 1)); // same window as Ma semaine

  const all = ctx.db
    .select()
    .from(task)
    .where(eq(task.isExperience, true))
    .orderBy(desc(task.doneAt), desc(task.createdAt))
    .all();
  const projectIds = [...new Set(all.map((t) => t.projectId).filter((x): x is string => !!x))];
  const projects = new Map(
    serializeProjects(
      ctx,
      projectIds.length
        ? ctx.db
            .select()
            .from(project)
            .all()
            .filter((p) => projectIds.includes(p.id))
        : [],
    ).map((p) => [p.id, p]),
  );
  const inPlan = new Set(
    listTasks(ctx, { status: 'todo' })
      .filter((t) => t.isExperience && t.inPlan)
      .map((t) => t.id),
  );
  const view = (t: (typeof all)[number]) => {
    const p = t.projectId ? projects.get(t.projectId) : null;
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      durationMin: t.durationMin,
      dueDate: t.dueDate,
      doneAt: t.doneAt,
      doneDate: t.doneAt ? parisDate(new Date(t.doneAt)) : null,
      projectId: t.projectId,
      projectTitle: p?.title ?? null,
      domainId: p ? (p.domainIds[0] ?? null) : t.domainId,
      inPlan: inPlan.has(t.id),
    };
  };
  const lived = all.filter((t) => t.status === 'done').map(view);
  const open = all.filter((t) => t.status === 'todo').map(view);
  const planned = open
    .filter((t) => t.inPlan || !!t.dueDate)
    .sort(
      (a, b) =>
        Number(b.inPlan) - Number(a.inPlan) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    );
  const reserve = open.filter((t) => !t.inPlan && !t.dueDate);
  const doneInWindow = lived.filter((t) => t.doneDate && t.doneDate >= from && t.doneDate <= today).length;
  // Last 12 months, oldest first: how many experiences each month.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (11 - i));
    const m = d.toISOString().slice(0, 7);
    return { month: m, count: lived.filter((t) => t.doneDate?.slice(0, 7) === m).length };
  });
  const year = today.slice(0, 4);
  return {
    target: s['experience.target'],
    windowWeeks,
    windowFrom: from,
    doneInWindow,
    onTrack: doneInWindow >= s['experience.target'],
    thisYear: lived.filter((t) => t.doneDate?.startsWith(year)).length,
    months,
    lived,
    planned,
    reserve,
  };
}

/** « Ajouter à la réserve »: an experience idea is an Inbox task flagged as experience (no date). */
export function addExperienceIdea(ctx: Ctx, input: ExperienceIdea) {
  return createTask(ctx, { ...input, isExperience: true });
}
