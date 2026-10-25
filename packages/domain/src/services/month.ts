// Planifier › Mois (decision D-43): choose the month projects against the time available in the month.
// Ready-to-display page: capacity from the weekly budgets, chosen projects, backlog candidates, quarter objectives.
import { and, asc, eq, gte, isNull, lt, lte, schema } from '@memento/db';
import { type Ctx, ctxNow } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getSettings } from '../settings.ts';
import {
  addDays,
  isoWeekOf,
  monthEnd,
  monthOf,
  monthStart,
  parisDate,
  quarterOf,
  shiftMonth,
} from '../time.ts';
import { serializeProjects } from './projects.ts';

const { project, objective, task, weekPlan, domain } = schema;

/** Capacity of a period: each ISO week's budget (adjusted plan or default), prorated by its days in the period. */
export function capacityBetween(ctx: Ctx, first: string, last: string) {
  const s = getSettings(ctx);
  const weeks: {
    isoWeek: string;
    days: number;
    budgetMin: number;
    shareMin: number;
    reason: string | null;
  }[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const w = isoWeekOf(d);
    const row = weeks.find((x) => x.isoWeek === w);
    if (row) row.days += 1;
    else weeks.push({ isoWeek: w, days: 1, budgetMin: 0, shareMin: 0, reason: null });
  }
  for (const w of weeks) {
    const plan = ctx.db.select().from(weekPlan).where(eq(weekPlan.isoWeek, w.isoWeek)).get();
    w.budgetMin = plan?.budgetMin ?? s['budget.weekly_min'];
    w.reason = plan?.budgetReason ?? null;
    w.shareMin = Math.round((w.budgetMin * w.days) / 7);
  }
  return { weeks, capacityMin: weeks.reduce((a, w) => a + w.shareMin, 0) };
}

/** Work minutes done in [first, last] (experiences excluded, RB-09; actual time when entered, D-61). */
export function workDoneBetween(ctx: Ctx, first: string, last: string) {
  return ctx.db
    .select({ m: task.durationMin, actual: task.actualMin, exp: task.isExperience })
    .from(task)
    .where(
      and(
        eq(task.status, 'done'),
        gte(task.doneAt, `${first}T00:00:00`),
        lt(task.doneAt, `${addDays(last, 1)}T00:00:00`),
      ),
    )
    .all()
    .filter((t) => !t.exp)
    .reduce((a, t) => a + (t.actual ?? t.m ?? 0), 0); // D-61: time spent when entered
}

export function getMonthPlanningPage(ctx: Ctx, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new DomainError('INVALID_MONTH', `Mois invalide : ${month}`);
  const s = getSettings(ctx);
  const today = parisDate(ctxNow(ctx));
  const current = monthOf(today);
  const first = monthStart(month);
  const last = monthEnd(month);

  const { weeks, capacityMin } = capacityBetween(ctx, first, last);
  const spentMin = month === current ? workDoneBetween(ctx, first, last) : 0;
  // Reserve for Inbox tasks due this month (they must be done whatever the projects).
  const inboxDue = ctx.db
    .select()
    .from(task)
    .where(
      and(isNull(task.projectId), eq(task.status, 'todo'), gte(task.dueDate, first), lte(task.dueDate, last)),
    )
    .all();
  const inboxReserveMin = inboxDue.reduce((a, t) => a + (t.durationMin ?? 0), 0);

  const quarter = quarterOf(first);
  const objectives = ctx.db.select().from(objective).orderBy(asc(objective.deadline)).all();
  const quarterObjectives = objectives.filter(
    (o) => o.quarter === quarter && (o.status === 'active' || o.status === 'paused'),
  );
  const ranks = new Map(
    ctx.db
      .select()
      .from(domain)
      .all()
      .map((d) => [d.id, d.priorityRank]),
  );
  const view = (p: ReturnType<typeof serializeProjects>[number]) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    domainId: p.domainIds[0] ?? null,
    objectiveId: p.objectiveId,
    objectiveTitle: p.objectiveTitle,
    inQuarterObjective: quarterObjectives.some((o) => o.id === p.objectiveId),
    remainingMin: p.taskStats.totalMin - p.taskStats.doneMin,
    doneMin: p.taskStats.doneMin,
    todo: p.taskStats.todo,
    gaps: p.gaps,
    carriedOver: p.previousMonthFlag === shiftMonth(month, -1),
  });

  const chosen = serializeProjects(
    ctx,
    ctx.db.select().from(project).where(eq(project.monthFlag, month)).all(),
  ).map(view);
  const candidates = serializeProjects(
    ctx,
    ctx.db.select().from(project).where(eq(project.status, 'ready')).all(),
  )
    .filter((p) => p.monthFlag !== month)
    .map(view)
    .sort(
      (a, b) =>
        Number(b.carriedOver) - Number(a.carriedOver) ||
        Number(b.inQuarterObjective) - Number(a.inQuarterObjective) ||
        Number(a.gaps.length > 0) - Number(b.gaps.length > 0) ||
        (ranks.get(a.domainId ?? '') ?? 99) - (ranks.get(b.domainId ?? '') ?? 99) ||
        a.title.localeCompare(b.title),
    );

  const plannedMin = chosen.filter((p) => p.status !== 'done').reduce((a, p) => a + p.remainingMin, 0);
  const availableMin = capacityMin - spentMin;
  const neededMin = plannedMin + inboxReserveMin;
  const objectiveRows = quarterObjectives.map((o) => ({
    id: o.id,
    title: o.title,
    deadline: o.deadline,
    progressPct: o.progressPct,
    monthProjects: chosen.filter((p) => p.objectiveId === o.id).length,
    covered: chosen.some((p) => p.objectiveId === o.id),
    readyProjects: candidates.filter((p) => p.objectiveId === o.id).length,
  }));
  const alerts: { level: 'warn' | 'ok'; code: string; text: string }[] = [];
  // D-47: too many month projects at once dilutes the effort.
  const open = chosen.filter((p) => p.status !== 'done').length;
  if (open > s['month.max_projects'])
    alerts.push({
      level: 'warn',
      code: 'TOO_MANY_PROJECTS',
      text: `${open} projets en même temps (limite ${s['month.max_projects']}) : risque de dispersion.`,
    });
  if (neededMin > availableMin)
    alerts.push({
      level: 'warn',
      code: 'MONTH_OVER',
      text: `Plus de travail prévu que de temps disponible : ${Math.round((neededMin - availableMin) / 60)} h de trop.`,
    });
  for (const o of objectiveRows.filter((x) => x.monthProjects === 0))
    alerts.push({
      level: 'warn',
      code: 'OBJECTIVE_EMPTY',
      text: `Objectif « ${o.title} » : aucun projet ce mois-ci, il n'avancera pas.`,
    });
  const offObjective = chosen.filter((p) => p.status !== 'done' && !p.inQuarterObjective).length;
  if (offObjective && quarterObjectives.length)
    alerts.push({
      level: 'warn',
      code: 'OFF_OBJECTIVE',
      text: `${offObjective} projet${offObjective > 1 ? 's' : ''} du mois hors objectifs du trimestre.`,
    });
  const carried = candidates.filter((p) => p.carriedOver).length;
  if (carried)
    alerts.push({
      level: 'warn',
      code: 'CARRIED_OVER',
      text: `${carried} projet${carried > 1 ? 's' : ''} du mois dernier non terminé${carried > 1 ? 's' : ''} : à reprendre ou non.`,
    });
  if (!alerts.length) alerts.push({ level: 'ok', code: 'NOTHING', text: 'Rien à signaler.' });

  return {
    month,
    isCurrent: month === current,
    isPast: month < current,
    quarter,
    weeks,
    budget: {
      capacityMin,
      spentMin,
      availableMin,
      plannedMin,
      inboxReserveMin,
      neededMin,
      overMin: Math.max(0, neededMin - availableMin),
    },
    inboxDue: inboxDue.map((t) => ({
      id: t.id,
      title: t.title,
      durationMin: t.durationMin,
      dueDate: t.dueDate,
    })),
    chosen,
    candidates,
    objectives: objectiveRows,
    alerts,
    navigation: { previous: shiftMonth(month, -1), next: shiftMonth(month, 1) },
  };
}
