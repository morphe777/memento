// D-62: recurring projects and objectives (user request 25/10/2026). A recurring project, once completed, is
// renewed: a copy with its tasks (all to do), planned for the next period. A recurring objective, once closed
// (achieved, partial or failed — not abandoned), is renewed for the next quarter / year. The new occurrence
// keeps a link to the one it renews (previous_id); stopping the recurrence = removing it on the new occurrence.
import { eq, inArray, schema } from '@memento/db';
import { audit, type Ctx, ctxNow, ctxNowIso } from '../context.ts';
import { DomainError } from '../errors.ts';
import { OBJECTIVE_RECURRENCE_MONTHS } from '../rules/recurrence.ts';
import { addMonths, monthOf, parisDate, quarterOf, shiftMonth } from '../time.ts';
import { duplicateProject } from './duplicate.ts';
import { getProject, getProjectRow, setProjectMonth } from './projects.ts';
import { createObjective, getObjective, refreshObjectiveProgress, updateObjective } from './referential.ts';

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

/**
 * D-62 renewal. `missed` (DM-108): the occurrence was closed unfinished at the end of its month, the next one may
 * start in the current month (« la période suivante repart de zéro »).
 */
export function renewProject(ctx: Ctx, id: string, opts: { missed?: boolean } = {}) {
  const p = getProjectRow(ctx, id);
  if (!p.recurrence) return null;
  if (ctx.db.select({ id: project.id }).from(project).where(eq(project.previousId, id)).get()) return null;
  const months = PROJECT_RECURRENCE_MONTHS[p.recurrence];
  const current = monthOf(parisDate(ctxNow(ctx)));
  // The next period follows the one the project was planned for (or now), and is never in the past.
  let month = shiftMonth(p.monthFlag ?? current, months);
  while (opts.missed ? month < current : month <= current) month = shiftMonth(month, months);
  // M-09: the renewal is a duplicate (D-109: description, criterion, importance, motive, mode, tasks to do with
  // their links), plus the recurrence, its dates moved to the next period and no dependency (DM-108).
  const next = duplicateProject(ctx, id, {
    title: p.title,
    objectiveId: p.objectiveId ? openSuccessor(ctx, p.objectiveId) : null,
    dependsOn: [],
  });
  ctx.db
    .update(project)
    .set({
      recurrence: p.recurrence,
      previousId: id,
      startDate: p.startDate ? addMonths(p.startDate, months) : null,
      dueDate: p.dueDate ? addMonths(p.dueDate, months) : null,
      updatedAt: ctxNowIso(ctx),
    })
    .where(eq(project.id, next.id))
    .run();
  try {
    setProjectMonth(ctx, next.id, month); // planned for the next period (D-42), if complete (RB-02)
  } catch (e) {
    if (!(e instanceof DomainError)) throw e; // incomplete: stays « prêt », listed « à compléter »
  }
  return getProject(ctx, next.id);
}

const numeric = (v: string) => (/^\s*\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : null);

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
    smartCurrent: numeric(o.smartTarget) !== null ? '0' : '', // DM-108: the next one starts at 0 / target
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

/**
 * DM-108: a recurring project still open at the end of its month is closed without carry-over and the next
 * occurrence is created. Called by the month roll before the « back to prêt » rule, which never applies to
 * recurring projects. D-140 (audit M-05): it is abandoned, not « done, success false »: it never counts as progress,
 * and its done tasks stay done.
 */
export function closeMissedRecurringProjects(ctx: Ctx, month: string) {
  const rows = ctx.db
    .select()
    .from(project)
    .where(inArray(project.status, ['active', 'ready', 'paused']))
    .all()
    .filter((r) => r.recurrence && r.monthFlag && r.monthFlag < month);
  for (const r of rows) {
    ctx.db
      .update(project)
      .set({ status: 'abandoned', updatedAt: ctxNowIso(ctx) })
      .where(eq(project.id, r.id))
      .run();
    audit(ctx, 'project', r.id, 'recurrence_missed', { status: r.status }, { status: 'abandoned' });
    refreshObjectiveProgress(ctx, r.objectiveId);
    renewProject(ctx, r.id, { missed: true });
  }
  return rows.length;
}

/**
 * DM-108: a recurring objective still open after its quarter is closed: « atteint » when its measure reached the
 * target, « partiel » with some progress, « échoué » otherwise; closing it renews it (D-62), from 0.
 */
export function closeRecurringObjectives(ctx: Ctx, currentQuarter: string) {
  const rows = ctx.db
    .select()
    .from(objective)
    .where(inArray(objective.status, OPEN_OBJECTIVE as ('active' | 'paused')[]))
    .all()
    .filter((o) => o.recurrence && o.quarter < currentQuarter);
  for (const o of rows) {
    const cur = numeric(o.smartCurrent);
    const target = numeric(o.smartTarget);
    const status =
      (target && cur !== null && cur >= target) || o.progressPct >= 100
        ? 'achieved'
        : (cur ?? 0) > 0 || o.progressPct > 0
          ? 'partial'
          : 'failed';
    updateObjective(ctx, o.id, { status }); // renews it (D-62)
  }
  return rows.length;
}
