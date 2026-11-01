// Planifier › Mois (decision D-43): choose the month projects against the time available in the month.
// Ready-to-display page: capacity from the weekly budgets, chosen projects, backlog candidates, quarter objectives.
import { and, asc, eq, gte, inArray, isNull, lt, lte, schema } from '@memento/db';
import { type Ctx, ctxNow } from '../context.ts';
import { DomainError } from '../errors.ts';
import { FOCUS_ORDER, objectiveFocus } from '../rules/objectives.ts';
import { getSettings } from '../settings.ts';
import {
  addDays,
  daysBetween,
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
    // D-103: deadline of the project, else of its objective (sort « Deadline » and box « du trimestre »).
    deadline: p.dueDate ?? objectives.find((o) => o.id === p.objectiveId)?.deadline ?? null,
    remainingMin: p.taskStats.totalMin - p.taskStats.doneMin,
    doneMin: p.taskStats.doneMin,
    todo: p.taskStats.todo,
    gaps: p.gaps,
    carriedOver: p.previousMonthFlag === shiftMonth(month, -1),
    motive: p.motive, // D-100
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
  // D-108: the path of each quarter objective (ideas and abandoned projects aside), to tell where it stands.
  const pathProjects = quarterObjectives.length
    ? serializeProjects(
        ctx,
        ctx.db
          .select()
          .from(project)
          .where(
            inArray(
              project.objectiveId,
              quarterObjectives.map((o) => o.id),
            ),
          )
          .all(),
      ).filter((p) => p.status !== 'idea' && p.status !== 'abandoned')
    : [];
  const from = today > first ? today : first;
  const objectiveRows = quarterObjectives
    .map((o) => {
      const path = pathProjects.filter((p) => p.objectiveId === o.id);
      const open = path.filter((p) => p.status !== 'done');
      const remainingMin = open.reduce((a, p) => a + p.taskStats.totalMin - p.taskStats.doneMin, 0);
      const totalMin = path.reduce((a, p) => a + p.taskStats.totalMin, 0);
      const daysLeft = daysBetween(today, o.deadline);
      const covered = chosen.some((p) => p.objectiveId === o.id);
      const capacityToDeadlineMin =
        o.deadline >= from ? capacityBetween(ctx, from, o.deadline).capacityMin : 0;
      const { focus, reason } = objectiveFocus({
        criticality: o.criticality,
        progressPct: o.progressPct,
        openProjects: open.length,
        remainingMin,
        covered,
        daysLeft,
        capacityToDeadlineMin,
      });
      return {
        id: o.id,
        title: o.title,
        deadline: o.deadline,
        daysLeft,
        criticality: o.criticality,
        progressPct: o.progressPct,
        pathDone: path.length - open.length,
        pathTotal: path.length,
        remainingMin,
        /** Share of the estimated work of the path already done (tasks without duration count 0). */
        workPct: totalMin ? Math.round(((totalMin - remainingMin) / totalMin) * 100) : 0,
        unestimated: open.reduce((a, p) => a + p.taskStats.withoutDuration, 0),
        monthProjects: chosen.filter((p) => p.objectiveId === o.id).length,
        covered,
        readyProjects: candidates.filter((p) => p.objectiveId === o.id).length,
        focus,
        reason,
      };
    })
    .sort(
      (a, b) =>
        FOCUS_ORDER.indexOf(a.focus) - FOCUS_ORDER.indexOf(b.focus) ||
        b.criticality - a.criticality ||
        a.deadline.localeCompare(b.deadline),
    );
  // D-108: three levels — critical (red), warn (orange), info (grey); `items` lists the projects concerned.
  type Level = 'critical' | 'warn' | 'info';
  const alerts: {
    level: Level | 'ok';
    code: string;
    text: string;
    items?: { id: string; title: string; type: 'project' | 'objective' }[];
  }[] = [];
  const list = (ps: { id: string; title: string }[]) =>
    ps.map((p) => ({ id: p.id, title: p.title, type: 'project' as const }));
  if (neededMin > availableMin)
    alerts.push({
      level: neededMin - availableMin > availableMin * 0.1 ? 'critical' : 'warn',
      code: 'MONTH_OVER',
      text: `Plus de travail prévu que de temps disponible : ${Math.round((neededMin - availableMin) / 60)} h de trop.`,
    });
  // D-47: too many month projects at once dilutes the effort.
  const openChosen = chosen.filter((p) => p.status !== 'done');
  if (openChosen.length > s['month.max_projects'])
    alerts.push({
      level: 'warn',
      code: 'TOO_MANY_PROJECTS',
      text: `${openChosen.length} projets en même temps (limite ${s['month.max_projects']}) : risque de dispersion.`,
    });
  // D-108: an idle critical objective is named; the others are grouped (the objectives box details them).
  const idle = objectiveRows.filter((x) => x.monthProjects === 0 && x.focus !== 'done');
  for (const o of idle.filter((x) => x.focus === 'critical'))
    alerts.push({
      level: 'critical',
      code: 'OBJECTIVE_EMPTY',
      text: `Objectif « ${o.title} » : aucun projet ce mois-ci, il n'avancera pas.`,
      items: [{ id: o.id, title: o.title, type: 'objective' }],
    });
  const quiet = idle.filter((x) => x.focus !== 'critical' && x.focus !== 'no_path');
  if (quiet.length)
    alerts.push({
      level: quiet.some((o) => o.criticality >= 2) ? 'warn' : 'info',
      code: 'OBJECTIVE_EMPTY',
      text:
        quiet.length > 1
          ? `${quiet.length} objectifs sans projet ce mois-ci : ils n'avanceront pas.`
          : `Objectif « ${quiet[0].title} » : aucun projet ce mois-ci, il n'avancera pas.`,
      items: quiet.map((o) => ({ id: o.id, title: o.title, type: 'objective' as const })),
    });
  const noPath = idle.filter((x) => x.focus === 'no_path');
  if (noPath.length)
    alerts.push({
      level: 'info',
      code: 'OBJECTIVE_NO_PATH',
      text: `${noPath.length} objectif${noPath.length > 1 ? 's' : ''} sans projet sur son chemin.`,
      items: noPath.map((o) => ({ id: o.id, title: o.title, type: 'objective' as const })),
    });
  const carried = candidates.filter((p) => p.carriedOver);
  if (carried.length)
    alerts.push({
      level: 'warn',
      code: 'CARRIED_OVER',
      text: `${carried.length} projet${carried.length > 1 ? 's' : ''} du mois dernier non terminé${carried.length > 1 ? 's' : ''} : à reprendre ou non.`,
      items: list(carried),
    });
  const offObjective = openChosen.filter((p) => !p.inQuarterObjective);
  if (offObjective.length && quarterObjectives.length)
    alerts.push({
      level: 'info',
      code: 'OFF_OBJECTIVE',
      text: `${offObjective.length} projet${offObjective.length > 1 ? 's' : ''} du mois hors objectifs du trimestre.`,
      items: list(offObjective),
    });
  const rank: Record<string, number> = { critical: 0, warn: 1, info: 2, ok: 3 };
  alerts.sort((a, b) => rank[a.level] - rank[b.level]);
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
