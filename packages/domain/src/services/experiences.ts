// Page « Expériences » (decision D-54): the goal of living more experiences, made visible.
// Target per calendar month (R-02, D-154), memories (done experiences), planned ones (in a plan of this week or a
// week ahead, or with a deadline) and the reserve (other experience tasks to do). D-153: a lived experience is
// recorded directly, done.
import { desc, eq, schema } from '@memento/db';
import { type Ctx, ctxNow, tx } from '../context.ts';
import type { ExperienceIdea, ExperienceLived } from '../schemas.ts';
import { getSettings } from '../settings.ts';
import { monthOf, parisDate } from '../time.ts';
import { serializeProjects } from './projects.ts';
import { listDomains } from './referential.ts';
import { completeTask, createTask, listTasks } from './tasks.ts';

const { task, project } = schema;

export function getExperiencesPage(ctx: Ctx) {
  const s = getSettings(ctx);
  const today = parisDate(ctxNow(ctx));
  const month = monthOf(today);

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
  const plannedWeek = new Map(
    listTasks(ctx, { status: 'todo' })
      .filter((t) => t.isExperience && t.plannedWeek)
      .map((t) => [t.id, t.plannedWeek]),
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
      inPlan: plannedWeek.has(t.id),
      plannedWeek: plannedWeek.get(t.id) ?? null, // D-151
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
  const doneThisMonth = lived.filter((t) => t.doneDate?.slice(0, 7) === month).length;
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
    month,
    doneThisMonth,
    onTrack: doneThisMonth >= s['experience.target'],
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

/**
 * D-153: « J'ai vécu une expérience »: an experience recorded already done (Paris time, now by default), traced like
 * any task checked that day. In a project, or else in a domain: Famille when none is given (found by its name, like
 * the guards), none when null.
 */
export function logExperience(ctx: Ctx, input: ExperienceLived) {
  return tx(ctx, () => {
    const { doneAt, projectId, domainId, ...rest } = input;
    const family = listDomains(ctx).find((d) => d.name === 'Famille')?.id ?? null;
    const created = createTask(ctx, {
      ...rest,
      isExperience: true,
      projectId: projectId ?? null,
      domainId: projectId ? null : domainId === undefined ? family : domainId,
    });
    return completeTask(ctx, created.id, { doneAt }).task;
  });
}
