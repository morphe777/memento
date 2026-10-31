// Vue Plan (memento-vue-plan): the whole quarter-and-beyond plan in one call (API-07, API-10), its capacity
// (CH-20 to CH-23) and alerts (§5), and the atomic application or simulation of a draft (API-08, API-09).
import { and, eq, inArray, isNull, schema, sql } from '@memento/db';
import { z } from 'zod';
import { audit, type Ctx, ctxNow, ctxNowIso, newId, tx } from '../context.ts';
import { ConflictError, DomainError, NotFoundError } from '../errors.ts';
import { isOnVacation } from '../rules/daily.ts';
import { type DepEdge, monthsLeftInQuarter, objectivePathMonths } from '../rules/plan.ts';
import { quarterKey, uuid } from '../schemas.ts';
import { getSettings } from '../settings.ts';
import {
  addDays,
  fmtMin,
  isoWeekOf,
  parisDate,
  quarterEnd,
  quarterOf,
  quarterStart,
  shiftQuarter,
} from '../time.ts';
import { allDependencies, setProjectDependencies } from './dependencies.ts';
import { serializeProjects, updateProject } from './projects.ts';
import { setObjectiveQuarter } from './quarter.ts';
import { getMetaObjective, getObjective, updateObjective } from './referential.ts';

const { project, objective, metaObjective, task, weekPlan, domain, auditLog } = schema;

const OPEN_PROJECT = new Set(['idea', 'ready', 'active', 'paused']);
const OPEN_OBJECTIVE = new Set(['active', 'paused']);
/** Number of quarters shown after the current one (Q-04). */
export const PLAN_QUARTERS_AHEAD = 4;
/** DEP_RELEASED alerts stay this many days after the release (DM-107 « dans la prochaine revue »). */
export const DEP_RELEASED_DAYS = 14;

export const quarterLabel = (q: string) => `T${q.slice(-1)} ${q.slice(0, 4)}`;
const quarterShort = (q: string) => `T${q.slice(-1)}`;

export interface PlanAlert {
  level: 'error' | 'warn' | 'info';
  code: string;
  text: string;
  /** Element to centre the canvas on (V-26). */
  target: { type: 'quarter' | 'objective' | 'project'; id: string } | null;
}

// ---------- Capacity (CH-20 to CH-22) ----------

/**
 * CH-20: budget of a quarter = its ISO weeks' budgets (adjusted plan or default), each prorated by its days in
 * the quarter that are neither past nor on vacation. The current quarter counts from today: the load is what
 * remains to do, so is the budget.
 */
export function quarterBudgetMin(ctx: Ctx, quarter: string, today = parisDate(ctxNow(ctx))): number {
  const s = getSettings(ctx);
  const vacations = s['notify.vacations'];
  const first = quarterStart(quarter) > today ? quarterStart(quarter) : today;
  const last = quarterEnd(quarter);
  const days = new Map<string, number>();
  for (let d = first; d <= last; d = addDays(d, 1))
    if (!isOnVacation(d, vacations)) days.set(isoWeekOf(d), (days.get(isoWeekOf(d)) ?? 0) + 1);
  if (!days.size) return 0;
  const plans = new Map(
    ctx.db
      .select({ w: weekPlan.isoWeek, b: weekPlan.budgetMin })
      .from(weekPlan)
      .where(inArray(weekPlan.isoWeek, [...days.keys()]))
      .all()
      .map((r) => [r.w, r.b]),
  );
  let total = 0;
  for (const [w, n] of days) total += ((plans.get(w) ?? s['budget.weekly_min']) * n) / 7;
  return Math.round(total);
}

/**
 * CH-21: load of each quarter = durations of the unfinished tasks of (a) projects of its objectives, (b) prêt or
 * actif projects whose month falls in it (that month wins over the objective's quarter), (c) Inbox tasks due in
 * it. Every domain counts, whatever the filter; experiences never count.
 */
export function quarterLoads(ctx: Ctx): Map<string, number> {
  const objectives = new Map(
    ctx.db
      .select({ id: objective.id, quarter: objective.quarter })
      .from(objective)
      .all()
      .map((o) => [o.id, o.quarter]),
  );
  const projects = new Map(
    ctx.db
      .select({
        id: project.id,
        status: project.status,
        objectiveId: project.objectiveId,
        monthFlag: project.monthFlag,
      })
      .from(project)
      .all()
      .map((p) => [p.id, p]),
  );
  const quarterOfProject = (id: string): string | null => {
    const p = projects.get(id);
    if (!p || !OPEN_PROJECT.has(p.status)) return null;
    if ((p.status === 'ready' || p.status === 'active') && p.monthFlag) return quarterOf(`${p.monthFlag}-01`);
    return p.objectiveId ? (objectives.get(p.objectiveId) ?? null) : null;
  };
  const rows = ctx.db
    .select({ projectId: task.projectId, durationMin: task.durationMin, dueDate: task.dueDate })
    .from(task)
    .where(and(eq(task.status, 'todo'), eq(task.isExperience, false)))
    .all();
  const out = new Map<string, number>();
  for (const t of rows) {
    const q = t.projectId ? quarterOfProject(t.projectId) : t.dueDate ? quarterOf(t.dueDate) : null;
    if (q) out.set(q, (out.get(q) ?? 0) + (t.durationMin ?? 0));
  }
  return out;
}

export interface QuarterCapacity {
  quarter: string;
  budgetMin: number;
  loadMin: number;
  overMin: number;
  monthsLeft: number;
  /** CH-22 per open objective of the quarter. */
  paths: { objectiveId: string; months: number }[];
  /** Longest path among the quarter's objectives (« chemin 3 / 3 mois »). */
  longestPath: number;
}

function capacityOf(
  ctx: Ctx,
  quarters: string[],
  today: string,
  objectives: (typeof objective.$inferSelect)[],
  projects: { id: string; status: string; objectiveId: string | null }[],
  deps: DepEdge[],
): QuarterCapacity[] {
  const loads = quarterLoads(ctx);
  return quarters.map((q) => {
    const paths = objectives
      .filter((o) => o.quarter === q && OPEN_OBJECTIVE.has(o.status))
      .map((o) => ({
        objectiveId: o.id,
        months: objectivePathMonths(
          projects.filter((p) => p.objectiveId === o.id),
          deps,
        ),
      }));
    const budgetMin = quarterBudgetMin(ctx, q, today); // 0 for a past quarter
    const loadMin = loads.get(q) ?? 0;
    return {
      quarter: q,
      budgetMin,
      loadMin,
      overMin: Math.max(0, loadMin - budgetMin),
      monthsLeft: monthsLeftInQuarter(q, today),
      paths,
      longestPath: Math.max(0, ...paths.map((p) => p.months)),
    };
  });
}

// ---------- Alerts (§5) ----------

function planAlerts(
  ctx: Ctx,
  capacity: QuarterCapacity[],
  objectives: (typeof objective.$inferSelect)[],
  projects: { id: string; title: string; status: string; objectiveId: string | null; gaps: string[] }[],
  deps: DepEdge[],
  today: string,
): PlanAlert[] {
  const alerts: PlanAlert[] = [];
  const objById = new Map(objectives.map((o) => [o.id, o]));
  const projById = new Map(projects.map((p) => [p.id, p]));
  const inRange = new Set(capacity.map((c) => c.quarter));
  for (const c of capacity) {
    if (c.loadMin > c.budgetMin)
      alerts.push({
        level: 'error',
        code: 'QUARTER_OVER',
        text: `${quarterLabel(c.quarter)} : ${fmtMin(c.loadMin)} prévues pour ${fmtMin(c.budgetMin)} de budget (tous domaines).`,
        target: { type: 'quarter', id: c.quarter },
      });
    for (const p of c.paths) {
      const o = objById.get(p.objectiveId)!;
      if (p.months > c.monthsLeft)
        alerts.push({
          level: 'error',
          code: 'PATH_TOO_LONG',
          text: `${o.title} : chemin de ${p.months} mois pour ${c.monthsLeft} mois restant${c.monthsLeft > 1 ? 's' : ''}.`,
          target: { type: 'objective', id: o.id },
        });
    }
  }
  // DEP_AFTER: A waits for B, and B's objective is in a later quarter than A's.
  for (const d of deps) {
    const a = projById.get(d.projectId);
    const b = projById.get(d.dependsOnProjectId);
    if (!a || !b || a.status === 'done' || b.status === 'done') continue;
    const qa = a.objectiveId ? objById.get(a.objectiveId)?.quarter : undefined;
    const qb = b.objectiveId ? objById.get(b.objectiveId)?.quarter : undefined;
    if (qa && qb && qb > qa && inRange.has(qa))
      alerts.push({
        level: 'warn',
        code: 'DEP_AFTER',
        text: `${a.title} (${quarterShort(qa)}) attend ${b.title} (${quarterShort(qb)}).`,
        target: { type: 'project', id: a.id },
      });
  }
  for (const o of objectives.filter((x) => inRange.has(x.quarter) && OPEN_OBJECTIVE.has(x.status))) {
    if (!projects.some((p) => p.objectiveId === o.id && p.status !== 'abandoned'))
      alerts.push({
        level: 'warn',
        code: 'OBJECTIVE_EMPTY',
        text: `Objectif « ${o.title} » : aucun projet, il n'avancera pas.`,
        target: { type: 'objective', id: o.id },
      });
  }
  for (const c of capacity) {
    const incomplete = projects.filter(
      (p) =>
        p.gaps.length &&
        OPEN_PROJECT.has(p.status) &&
        p.objectiveId &&
        objById.get(p.objectiveId)?.quarter === c.quarter,
    );
    if (incomplete.length)
      alerts.push({
        level: 'warn',
        code: 'PROJECT_INCOMPLETE',
        text: `${quarterLabel(c.quarter)} : ${incomplete.length} projet${incomplete.length > 1 ? 's' : ''} incomplet${incomplete.length > 1 ? 's' : ''} (critère, tâches, durées).`,
        target: { type: 'project', id: incomplete[0].id },
      });
  }
  // DEP_RELEASED (DM-107): releases journaled over the last days.
  const since = `${addDays(today, -DEP_RELEASED_DAYS)}T00:00:00.000Z`;
  const released = ctx.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'dependency_release'), sql`${auditLog.at} >= ${since}`))
    .all();
  if (released.length) {
    const titles = new Map(
      ctx.db
        .select({ id: project.id, title: project.title })
        .from(project)
        .all()
        .map((p) => [p.id, p.title]),
    );
    for (const r of released) {
      const diff = r.diff as Record<string, [unknown, unknown]> | null;
      const gone = diff?.dependsOnProjectId?.[0] as string | undefined;
      alerts.push({
        level: 'info',
        code: 'DEP_RELEASED',
        text: `${titles.get(r.entityId) ?? 'Un projet'} attendait ${titles.get(gone ?? '') ?? 'un projet'}, abandonné : dépendance retirée.`,
        target: { type: 'project', id: r.entityId },
      });
    }
  }
  return alerts;
}

/** API-16: capacity, paths and plan alerts of one quarter (Planifier › Trimestre data, all domains). */
export function quarterPlanCheck(ctx: Ctx, quarter: string) {
  const today = parisDate(ctxNow(ctx));
  const objectives = ctx.db.select().from(objective).all();
  const projects = serializeProjects(ctx, ctx.db.select().from(project).all());
  const deps = allDependencies(ctx);
  const capacity = capacityOf(ctx, [quarter], today, objectives, projects, deps);
  const alerts = planAlerts(ctx, capacity, objectives, projects, deps, today).filter(
    (a) => a.code !== 'OBJECTIVE_EMPTY',
  );
  return { capacity: capacity[0], alerts };
}

// ---------- Graph (API-07) and reserve (API-10) ----------

/** API-08 conflict guard: changes as soon as a project, objective or meta-objective is written. */
export function planVersion(ctx: Ctx): string {
  const r = ctx.db
    .select({ n: sql<number>`count(*)`, at: sql<string | null>`max(${auditLog.at})` })
    .from(auditLog)
    .where(inArray(auditLog.entityType, ['project', 'objective', 'meta_objective']))
    .get()!;
  return `${r.n}:${r.at ?? ''}`;
}

export const planGraphQuery = z.object({
  /** Comma-separated domain ids; empty = every domain (organisation view, V-30). */
  domainIds: z.string().optional(),
  from: quarterKey.optional(),
  to: quarterKey.optional(),
  includeReserve: z.enum(['true', 'false']).optional(),
});
export type PlanGraphQuery = z.infer<typeof planGraphQuery>;

export function getPlanGraph(ctx: Ctx, q: PlanGraphQuery = {}) {
  const today = parisDate(ctxNow(ctx));
  const current = quarterOf(today);
  const from = q.from ?? current;
  const to = q.to ?? shiftQuarter(current, PLAN_QUARTERS_AHEAD);
  if (to < from) throw new DomainError('INVALID_QUARTER', 'La fin de la période précède son début.');
  const quarters: string[] = [];
  for (let x = from; x <= to && quarters.length < 12; x = shiftQuarter(x, 1)) quarters.push(x);
  const filter = (q.domainIds ?? '').split(',').filter(Boolean);
  const inFilter = (ids: (string | null)[]) => !filter.length || ids.some((id) => id && filter.includes(id));

  const ranks = new Map(
    ctx.db
      .select({ id: domain.id, rank: domain.priorityRank })
      .from(domain)
      .all()
      .map((d) => [d.id, d.rank]),
  );
  const allObjectives = ctx.db.select().from(objective).all();
  const allProjects = serializeProjects(ctx, ctx.db.select().from(project).all());
  const deps = allDependencies(ctx);
  const metas = ctx.db
    .select()
    .from(metaObjective)
    .all()
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));

  /** Most served primary domain (ties → higher priority). */
  const dominant = (ps: { domainIds: string[] }[]) => {
    const count = new Map<string, number>();
    for (const p of ps) if (p.domainIds[0]) count.set(p.domainIds[0], (count.get(p.domainIds[0]) ?? 0) + 1);
    return (
      [...count].sort((a, b) => b[1] - a[1] || (ranks.get(a[0]) ?? 99) - (ranks.get(b[0]) ?? 99))[0]?.[0] ??
      null
    );
  };
  const projectsOf = (oid: string) =>
    allProjects.filter((p) => p.objectiveId === oid && p.status !== 'abandoned');
  // DM-114: domain of a meta-objective, else deduced from its projects.
  const metaDomain = new Map(
    metas.map((m) => [
      m.id,
      m.primaryDomainId ??
        dominant(allObjectives.filter((o) => o.metaObjectiveId === m.id).flatMap((o) => projectsOf(o.id))),
    ]),
  );
  const metaIds = new Set(metas.map((m) => m.id));
  const shownMetas = metas.filter(
    (m) => (m.status === 'active' || m.status === 'paused') && inFilter([metaDomain.get(m.id) ?? null]),
  );
  const shownMetaIds = new Set(shownMetas.map((m) => m.id));
  const visibleObjective = (o: typeof objective.$inferSelect) =>
    quarters.includes(o.quarter) &&
    (OPEN_OBJECTIVE.has(o.status) || o.quarter === current) &&
    o.status !== 'abandoned';
  const shownObjectives = allObjectives
    .filter(visibleObjective)
    .filter((o) =>
      o.metaObjectiveId && metaIds.has(o.metaObjectiveId)
        ? shownMetaIds.has(o.metaObjectiveId)
        : projectsOf(o.id).some((p) => inFilter(p.domainIds)) || (!filter.length && true),
    )
    .sort(
      (a, b) =>
        a.quarter.localeCompare(b.quarter) || a.position - b.position || a.deadline.localeCompare(b.deadline),
    );
  const shownObjectiveIds = new Set(shownObjectives.map((o) => o.id));

  const lite = (p: (typeof allProjects)[number]) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    objectiveId: p.objectiveId,
    objectiveTitle: p.objectiveTitle,
    positionInObjective: p.positionInObjective,
    isFree: p.isFree,
    primaryDomainId: p.primaryDomainId,
    domainIds: p.domainIds,
    groups: p.groups.map((g) => g.name),
    remainingMin: p.taskStats.totalMin - p.taskStats.doneMin,
    unknownSize: p.taskStats.todo === 0 || p.taskStats.withoutDuration > 0,
    gaps: p.gaps,
    dependsOn: p.dependsOn,
    waitingOn: p.waitingOn,
    monthFlag: p.monthFlag,
    recurrence: p.recurrence,
    completedAt: p.completedAt,
  });
  const projects = allProjects.filter(
    (p) => p.objectiveId && shownObjectiveIds.has(p.objectiveId) && p.status !== 'abandoned',
  );
  const capacity = capacityOf(ctx, quarters, today, allObjectives, allProjects, deps);
  const alerts = planAlerts(ctx, capacity, allObjectives, allProjects, deps, today).filter((a) =>
    !a.target || a.target.type === 'quarter'
      ? true
      : a.target.type === 'objective'
        ? shownObjectiveIds.has(a.target.id)
        : projects.some((p) => p.id === a.target!.id),
  );

  const graph = {
    version: planVersion(ctx),
    today,
    currentQuarter: current,
    quarters,
    domainIds: filter,
    metas: shownMetas.map((m) => ({
      id: m.id,
      title: m.title,
      outcomeTitle: m.outcomeTitle,
      primaryDomainId: m.primaryDomainId,
      domainId: metaDomain.get(m.id) ?? null,
      status: m.status,
      horizonDate: m.horizonDate,
      description: m.description,
      position: m.position,
      objectiveCount: allObjectives.filter((o) => o.metaObjectiveId === m.id && OPEN_OBJECTIVE.has(o.status))
        .length,
      projectCount: allObjectives
        .filter((o) => o.metaObjectiveId === m.id && OPEN_OBJECTIVE.has(o.status))
        .reduce((a, o) => a + projectsOf(o.id).length, 0),
    })),
    objectives: shownObjectives.map((o) => {
      const ps = projectsOf(o.id);
      const cap = capacity.find((c) => c.quarter === o.quarter);
      return {
        id: o.id,
        title: o.title,
        outcomeTitle: o.outcomeTitle,
        metaObjectiveId: o.metaObjectiveId && metaIds.has(o.metaObjectiveId) ? o.metaObjectiveId : null,
        quarter: o.quarter,
        deadline: o.deadline,
        position: o.position,
        status: o.status,
        criticality: o.criticality,
        progressPct: o.progressPct,
        smartIndicator: o.smartIndicator,
        smartTarget: o.smartTarget,
        smartCurrent: o.smartCurrent,
        recurrence: o.recurrence,
        domainId: dominant(ps) ?? (o.metaObjectiveId ? (metaDomain.get(o.metaObjectiveId) ?? null) : null),
        pathMonths: cap?.paths.find((p) => p.objectiveId === o.id)?.months ?? 0,
        monthsLeft: cap?.monthsLeft ?? 0,
      };
    }),
    projects: projects.map(lite),
    capacity,
    alerts,
  };
  if (q.includeReserve !== 'true') return { ...graph, reserve: null };

  const reserveProjects = allProjects
    .filter((p) => !p.objectiveId && OPEN_PROJECT.has(p.status) && inFilter(p.domainIds))
    .map((p) => ({ ...lite(p), related: !!filter.length && !filter.includes(p.primaryDomainId ?? '') }));
  const elsewhere = allProjects
    .filter(
      (p) =>
        p.objectiveId &&
        !shownObjectiveIds.has(p.objectiveId) &&
        OPEN_PROJECT.has(p.status) &&
        filter.length &&
        inFilter(p.domainIds),
    )
    .map((p) => ({ ...lite(p), related: true }));
  const reserveObjectives = allObjectives
    .filter((o) => OPEN_OBJECTIVE.has(o.status) && !shownObjectiveIds.has(o.id))
    .map((o) => ({
      id: o.id,
      title: o.title,
      outcomeTitle: o.outcomeTitle,
      quarter: o.quarter,
      deadline: o.deadline,
      status: o.status,
      metaObjectiveId: o.metaObjectiveId,
      metaTitle: metas.find((m) => m.id === o.metaObjectiveId)?.title ?? null,
      overdue: o.quarter < current,
      domainId: dominant(projectsOf(o.id)),
      projectCount: projectsOf(o.id).length,
    }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter) || a.title.localeCompare(b.title));
  return {
    ...graph,
    reserve: {
      projects: [...reserveProjects, ...elsewhere].sort(
        (a, b) => Number(a.related) - Number(b.related) || a.title.localeCompare(b.title),
      ),
      objectives: {
        noMeta: reserveObjectives.filter((o) => !o.metaObjectiveId || !metaIds.has(o.metaObjectiveId)),
        otherMeta: reserveObjectives.filter((o) => o.metaObjectiveId && metaIds.has(o.metaObjectiveId)),
      },
    },
  };
}

/** API-10: the reserve alone (same filter). */
export function getPlanReserve(ctx: Ctx, q: PlanGraphQuery = {}) {
  return getPlanGraph(ctx, { ...q, includeReserve: 'true' }).reserve!;
}

// ---------- Draft: apply (API-08) and preview (API-09) ----------

export const planOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setDependencies'), projectId: uuid, dependsOn: z.array(uuid).max(50) }),
  z.object({
    op: z.literal('attachProject'),
    projectId: uuid,
    objectiveId: uuid,
    /** Explicit prerequisites after the move; absent = kept (DM-101 default when coming from the reserve). */
    dependsOn: z.array(uuid).max(50).optional(),
    free: z.boolean().optional(),
  }),
  z.object({ op: z.literal('detachProject'), projectId: uuid }),
  z.object({ op: z.literal('setFree'), projectId: uuid, free: z.boolean() }),
  z.object({ op: z.literal('setObjectiveQuarter'), objectiveId: uuid, quarter: quarterKey }),
  z.object({ op: z.literal('setObjectiveMeta'), objectiveId: uuid, metaObjectiveId: uuid.nullable() }),
  z.object({ op: z.literal('reorderObjectives'), quarter: quarterKey, ids: z.array(uuid).min(1).max(100) }),
]);
export const planApplyBody = z.object({
  ops: z.array(planOp).min(1).max(500),
  /** `version` of the graph the draft was built on: a newer state → 409 PLAN_APPLY_CONFLICT. */
  baseVersion: z.string().max(100).optional(),
  /** Same filter as GET /plan-graph, for the graph returned after the write. */
  domainIds: z.string().optional(),
});
export type PlanOp = z.infer<typeof planOp>;
export type PlanApplyBody = z.infer<typeof planApplyBody>;

function runOp(ctx: Ctx, o: PlanOp) {
  switch (o.op) {
    case 'setDependencies':
      setProjectDependencies(ctx, o.projectId, o.dependsOn);
      return;
    case 'attachProject':
      updateProject(ctx, o.projectId, { objectiveId: o.objectiveId, ...(o.free ? { isFree: true } : {}) });
      if (o.free === false) updateProject(ctx, o.projectId, { isFree: false });
      if (o.dependsOn && !o.free) setProjectDependencies(ctx, o.projectId, o.dependsOn);
      return;
    case 'detachProject':
      updateProject(ctx, o.projectId, { objectiveId: null, isFree: false });
      return;
    case 'setFree':
      updateProject(ctx, o.projectId, { isFree: o.free });
      return;
    case 'setObjectiveQuarter':
      setObjectiveQuarter(ctx, o.objectiveId, o.quarter);
      return;
    case 'setObjectiveMeta':
      if (o.metaObjectiveId) getMetaObjective(ctx, o.metaObjectiveId);
      updateObjective(ctx, o.objectiveId, { metaObjectiveId: o.metaObjectiveId }); // DM-111 (journaled)
      return;
    case 'reorderObjectives':
      o.ids.forEach((id, i) => {
        const before = getObjective(ctx, id);
        if (before.quarter !== o.quarter)
          throw new DomainError(
            'NOT_IN_QUARTER',
            `« ${before.title} » n'est pas dans ${quarterLabel(o.quarter)}.`,
          );
        if (before.position !== i) {
          ctx.db
            .update(objective)
            .set({ position: i, updatedAt: ctxNowIso(ctx) })
            .where(eq(objective.id, id))
            .run();
          audit(ctx, 'objective', id, 'reorder', { position: before.position }, { position: i }); // DM-112
        }
      });
      return;
  }
}

function runOps(ctx: Ctx, ops: PlanOp[]) {
  ops.forEach((o, i) => {
    try {
      runOp(ctx, o);
    } catch (e) {
      if (e instanceof DomainError)
        throw new DomainError(e.code, e.message, { opIndex: i, details: e.details });
      if (e instanceof NotFoundError)
        throw new DomainError('NOT_FOUND', `Élément introuvable dans le brouillon (${e.entity}).`, {
          opIndex: i,
        });
      throw e;
    }
  });
}

/** API-08: all or nothing. One audit row per write, all sharing a batchId (F-23). */
export function applyPlanChanges(ctx: Ctx, body: PlanApplyBody) {
  if (body.baseVersion && body.baseVersion !== planVersion(ctx))
    throw new ConflictError(
      'PLAN_APPLY_CONFLICT',
      "Le plan a changé depuis l'ouverture du brouillon : recharge-le avant d'appliquer.",
      getPlanGraph(ctx, { domainIds: body.domainIds, includeReserve: 'true' }),
    );
  const batchId = newId();
  tx(ctx, () => runOps({ ...ctx, batchId }, body.ops));
  return {
    batchId,
    applied: body.ops.length,
    graph: getPlanGraph(ctx, { domainIds: body.domainIds, includeReserve: 'true' }),
  };
}

class Rollback extends Error {}

/** API-09: the same draft simulated: capacity and alerts recomputed, nothing written (journal untouched). */
export function previewPlanChanges(ctx: Ctx, body: PlanApplyBody) {
  let out: ReturnType<typeof getPlanGraph> | undefined;
  try {
    tx(ctx, () => {
      runOps(ctx, body.ops);
      out = getPlanGraph(ctx, { domainIds: body.domainIds });
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return {
    capacity: out!.capacity,
    alerts: out!.alerts,
    objectives: out!.objectives.map((o) => ({
      id: o.id,
      pathMonths: o.pathMonths,
      monthsLeft: o.monthsLeft,
    })),
  };
}

/** DM-114 at migration: meta-objectives without a domain get the domain most of their projects serve. */
export function fillMetaDomains(ctx: Ctx) {
  const metas = ctx.db.select().from(metaObjective).where(isNull(metaObjective.primaryDomainId)).all();
  if (!metas.length) return;
  const graph = getPlanGraph(ctx, { includeReserve: 'false' });
  for (const m of metas) {
    const domainId = graph.metas.find((x) => x.id === m.id)?.domainId;
    if (!domainId) continue;
    ctx.db.update(metaObjective).set({ primaryDomainId: domainId }).where(eq(metaObjective.id, m.id)).run();
    audit(
      { ...ctx, actor: 'system:migration' },
      'meta_objective',
      m.id,
      'update',
      { primaryDomainId: null },
      { primaryDomainId: domainId },
    );
  }
}
