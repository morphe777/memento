import { and, asc, desc, eq, gte, inArray, lt, or, schema } from '@memento/db';
// Frozen reports (WF-08, dossier de dev §7). The payload holds every displayed value; it is never recomputed.
import { type Ctx, ctxNow, ctxNowIso, newId, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import { type EngineProject, type EngineTask, projectDelayMin } from '../rules/engine.ts';
import {
  type DoneTask,
  estimationOf,
  focusOf,
  globalIndicator,
  isValidMonth,
  minutesByDomain,
  reportFreezableFrom,
  rhythmOf,
} from '../rules/reports.ts';
import { INBOX_COLORS } from '../seed-data.ts';
import { getSettings } from '../settings.ts';
import {
  addDays,
  frShort,
  frWeekRange,
  isValidIsoWeek,
  isValidQuarter,
  monthEnd,
  monthOfWeek,
  monthStart,
  parisClock,
  parisDayStartIso,
  quarterEnd,
  quarterStart,
  shiftMonth,
  shiftQuarter,
  shiftWeek,
  weekMonday,
  weekSunday,
} from '../time.ts';
import { paceCalendar } from './planning.ts';
import { serializeProjects } from './projects.ts';

const { report, task, project, objective, metaObjective, domain, weekPlan, weekPlanItem, auditLog } = schema;
export const REPORT_SCHEMA_VERSION = 1;
type Kind = 'week' | 'month' | 'quarter';

const FR_MONTH_LONG = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
export const monthLabel = (m: string) => `${FR_MONTH_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

function domainTable(ctx: Ctx) {
  return ctx.db.select().from(domain).orderBy(asc(domain.priorityRank)).all();
}
const domainView = (d: { name: string; colorLight: string; colorDark: string } | undefined) =>
  d
    ? { name: d.name, colorLight: d.colorLight, colorDark: d.colorDark }
    : { name: 'Inbox', colorLight: INBOX_COLORS.light, colorDark: INBOX_COLORS.dark };

/** Done tasks in [from, to) enriched for indicators. */
function doneTasksBetween(ctx: Ctx, from: string, to: string, bonusIds: Set<string> = new Set()) {
  const rows = ctx.db
    .select()
    .from(task)
    .where(
      and(
        eq(task.status, 'done'),
        gte(task.doneAt, parisDayStartIso(from)),
        lt(task.doneAt, parisDayStartIso(to)),
      ),
    )
    .all();
  const pids = [...new Set(rows.map((r) => r.projectId).filter((x): x is string => !!x))];
  const projects = serializeProjects(
    ctx,
    pids.length ? ctx.db.select().from(project).where(inArray(project.id, pids)).all() : [],
  );
  const objectives = ctx.db.select().from(objective).all();
  return rows.map((t): DoneTask & { projectId: string | null } => {
    const p = projects.find((x) => x.id === t.projectId);
    const o = p?.objectiveId ? objectives.find((x) => x.id === p.objectiveId) : undefined;
    return {
      id: t.id,
      title: t.title,
      durationMin: t.actualMin ?? t.durationMin ?? 0, // D-61: time spent
      estimateMin: t.durationMin ?? 0,
      measured: t.actualMin !== null,
      isExperience: t.isExperience,
      isBonus: bonusIds.has(t.id),
      bucket: !t.projectId ? 'inbox' : o && o.status === 'active' ? 'objective' : 'none',
      domainIds: p ? p.domainIds : t.domainId ? [t.domainId] : [],
      projectId: t.projectId,
    };
  });
}

function hoursByDomain(ctx: Ctx, done: DoneTask[]) {
  const m = minutesByDomain(done);
  const rows = domainTable(ctx)
    .filter((d) => !d.archived || m[d.id])
    .map((d) => ({ ...domainView(d), minutes: m[d.id] ?? 0 }));
  if (m.inbox) rows.push({ ...domainView(undefined), minutes: m.inbox });
  return rows;
}

function existing(ctx: Ctx, kind: Kind, periodKey: string) {
  return ctx.db
    .select()
    .from(report)
    .where(and(eq(report.kind, kind), eq(report.periodKey, periodKey)))
    .get();
}

function insertReport(ctx: Ctx, kind: Kind, periodKey: string, payload: Record<string, unknown>) {
  const row = {
    id: newId(),
    kind,
    periodKey,
    generatedAt: ctxNowIso(ctx),
    payload: { schemaVersion: REPORT_SCHEMA_VERSION, ...payload },
    schemaVersion: REPORT_SCHEMA_VERSION,
  };
  ctx.db.insert(report).values(row).run();
  return row;
}

/**
 * D-99: drift from the plan over the weeks starting in [from, to): planned tasks done, and work done outside the
 * plan (« hors planification »), with its share of the time done.
 */
function driftOf(ctx: Ctx, from: string, to: string, doneMin: number) {
  const plans = ctx.db
    .select()
    .from(weekPlan)
    .all()
    .filter((p) => isValidIsoWeek(p.isoWeek) && weekMonday(p.isoWeek) >= from && weekMonday(p.isoWeek) < to);
  const items = plans.length
    ? ctx.db
        .select()
        .from(weekPlanItem)
        .where(
          inArray(
            weekPlanItem.weekPlanId,
            plans.map((p) => p.id),
          ),
        )
        .all()
    : [];
  const ids = [...new Set(items.map((i) => i.taskId))];
  const rows = ids.length ? ctx.db.select().from(task).where(inArray(task.id, ids)).all() : [];
  const byId = new Map(rows.map((t) => [t.id, t]));
  const of = (kind: string) =>
    items
      .filter((i) => i.kind === kind)
      .map((i) => byId.get(i.taskId))
      .filter((t): t is (typeof rows)[number] => !!t && t.status !== 'cancelled');
  const planned = of('week');
  const unplanned = of('unplanned').filter((t) => t.status === 'done');
  const minutes = (t: (typeof rows)[number]) => (t.isExperience ? 0 : (t.actualMin ?? t.durationMin ?? 0));
  const unplannedMin = unplanned.reduce((a, t) => a + minutes(t), 0);
  const pids = [...new Set(unplanned.map((t) => t.projectId).filter((x): x is string => !!x))];
  const titles = new Map(
    (pids.length ? ctx.db.select().from(project).where(inArray(project.id, pids)).all() : []).map((p) => [
      p.id,
      p.title,
    ]),
  );
  // Done in time: a planned task checked after the period does not count for it.
  const plannedDone = planned.filter(
    (t) => t.status === 'done' && (t.doneAt ?? '') < parisDayStartIso(to),
  ).length;
  return {
    plannedCount: planned.length,
    plannedDone,
    plannedDonePct: planned.length ? Math.round((plannedDone / planned.length) * 100) : null,
    unplannedCount: unplanned.length,
    unplannedMin,
    unplannedSharePct: doneMin ? Math.round((unplannedMin / doneMin) * 100) : 0,
    unplannedTasks: unplanned.slice(0, 40).map((t) => ({
      title: t.title,
      projectTitle: t.projectId ? (titles.get(t.projectId) ?? '') : 'Inbox',
      minutes: minutes(t),
    })),
  };
}

// ---------- Weekly ----------

export function buildWeekPayload(ctx: Ctx, isoWeek: string) {
  const s = getSettings(ctx);
  const monday = weekMonday(isoWeek);
  const nextMonday = addDays(monday, 7);
  const plan = ctx.db.select().from(weekPlan).where(eq(weekPlan.isoWeek, isoWeek)).get();
  const items = plan
    ? ctx.db.select().from(weekPlanItem).where(eq(weekPlanItem.weekPlanId, plan.id)).all()
    : [];
  const bonusIds = new Set(items.filter((i) => i.kind === 'bonus').map((i) => i.taskId));
  const done = doneTasksBetween(ctx, monday, nextMonday, bonusIds);
  const budgetMin = plan?.budgetMin ?? s['budget.weekly_min'];
  const work = done.filter((t) => !t.isExperience);
  const doneMin = work.reduce((a, t) => a + t.durationMin, 0); // RB-09; bonus counted (Q-27)
  const domains = domainTable(ctx);
  const health = domains.find((d) => d.name === 'Santé');
  const family = domains.find((d) => d.name === 'Famille');
  const byDomain = minutesByDomain(done);

  const window = s['experience.window_weeks'];
  const expWindow = doneTasksBetween(ctx, addDays(monday, -7 * (window - 1)), nextMonday).filter(
    (t) => t.isExperience,
  ).length;
  const prevReport = existing(ctx, 'week', shiftWeek(isoWeek, -1));
  const prevPayload = prevReport?.payload as
    | { tasksDone?: { count: number }; objectives?: { id: string; progressPct: number }[] }
    | undefined;
  const prevCount =
    prevPayload?.tasksDone?.count ?? doneTasksBetween(ctx, addDays(monday, -7), monday).length;

  const focus = focusOf(done);
  const rhythm = rhythmOf(doneMin, budgetMin, s['report.rhythm_low_pct'], s['report.rhythm_high_pct']);
  const global = globalIndicator({
    experiencesWindow: expWindow,
    experienceTarget: s['experience.target'],
    healthMin: health ? (byDomain[health.id] ?? 0) : 0,
    familyMin: family ? (byDomain[family.id] ?? 0) : 0,
    rhythm,
    focus,
  });

  // R-07 avoidance: tasks still todo with postpone_count ≥ 3.
  const avoided = ctx.db
    .select()
    .from(task)
    .where(and(eq(task.status, 'todo'), gte(task.postponeCount, 3)))
    .all();

  // R-06: month projects at the end of the week.
  const asOf = weekSunday(isoWeek);
  const calendar = paceCalendar(ctx);
  const monthProjects = serializeProjects(
    ctx,
    ctx.db
      .select()
      .from(project)
      .where(
        // H-07: the month of the week (H-06), its projects even if the month roll already sent the unfinished
        // ones back to « prêt » (their previousMonthFlag keeps the month).
        and(
          or(
            eq(project.monthFlag, monthOfWeek(isoWeek)),
            eq(project.previousMonthFlag, monthOfWeek(isoWeek)),
          ),
          inArray(project.status, ['ready', 'active', 'paused', 'done']),
        ),
      )
      .all(),
  ).map((p) => {
    const ptasks = ctx.db.select().from(task).where(eq(task.projectId, p.id)).all() as EngineTask[];
    return {
      projectId: p.id,
      title: p.title,
      done: p.status === 'done', // D-139: shown « terminé », never « ahead »
      ...domainView(domains.find((d) => d.id === p.domainIds[0])),
      deltaMin: projectDelayMin(
        {
          ...p,
          objectiveTitle: null,
          objectiveCriticality: null,
          blocked: false,
          waitingOn: [],
        } as EngineProject,
        ptasks,
        addDays(asOf, 1), // D-118: judged by the week, the reported week counts as ended
        calendar,
      ),
    };
  });

  // "Mes réussites" v1 (no AI): projects completed with success + objectives whose progress increased.
  const completed = serializeProjects(
    ctx,
    ctx.db
      .select()
      .from(project)
      .where(
        and(
          eq(project.status, 'done'),
          eq(project.success, true),
          gte(project.completedAt, parisDayStartIso(monday)),
          lt(project.completedAt, parisDayStartIso(nextMonday)),
        ),
      )
      .all(),
  );
  const objectives = ctx.db.select().from(objective).all();
  const successes = [
    ...completed.map((p) => ({
      sentence: `Projet réussi : ${p.title}`,
      ...domainView(domains.find((d) => d.id === p.domainIds[0])),
      detail: `projet terminé · ${done.filter((t) => t.projectId === p.id).length} tâche(s) cette semaine`,
      entity: { type: 'project', id: p.id },
    })),
    ...objectives
      .map((o) => ({ o, prev: prevPayload?.objectives?.find((x) => x.id === o.id)?.progressPct }))
      .filter(({ o, prev }) => prev !== undefined && o.progressPct > prev)
      .map(({ o, prev }) => {
        const firstProject = serializeProjects(
          ctx,
          ctx.db.select().from(project).where(eq(project.objectiveId, o.id)).limit(1).all(),
        )[0];
        return {
          sentence: `« ${o.title} » avance : ${prev} % → ${o.progressPct} %`,
          ...domainView(domains.find((d) => d.id === firstProject?.domainIds[0])),
          detail: 'objectif trimestriel',
          entity: { type: 'objective', id: o.id },
        };
      }),
  ];

  return {
    period: {
      isoWeek,
      label: `Semaine ${Number(isoWeek.slice(6))} · ${frWeekRange(isoWeek)}`,
      from: monday,
      to: weekSunday(isoWeek),
    },
    navigation: {
      previous: shiftWeek(isoWeek, -1),
      next: shiftWeek(isoWeek, 1),
      month: monthOfWeek(isoWeek),
    },
    global,
    successes,
    tasksDone: { count: done.length, bonus: done.filter((t) => t.isBonus).length, previousWeek: prevCount },
    experiences: {
      done: expWindow,
      target: s['experience.target'],
      windowWeeks: window,
      titles: done.filter((t) => t.isExperience).map((t) => t.title),
    },
    focus,
    rhythm: { tier: rhythm, doneMin, budgetMin, bonus: done.filter((t) => t.isBonus).length },
    // Context given when the weekly budget was adjusted (D-39): kept in the frozen report, readable by AI.
    budgetAdjustment:
      plan && plan.budgetMin !== s['budget.weekly_min']
        ? { defaultMin: s['budget.weekly_min'], budgetMin, reason: plan.budgetReason ?? '' }
        : null,
    avoidance: {
      count: avoided.length,
      tasks: avoided.map((t) => ({ title: t.title, postponeCount: t.postponeCount })),
    },
    delays: monthProjects,
    hoursByDomain: hoursByDomain(ctx, done),
    estimation: estimationOf(done), // D-61
    drift: driftOf(ctx, monday, nextMonday, doneMin), // D-99
    plan: plan ? { status: plan.status, itemCount: items.length } : null,
    objectives: objectives.map((o) => ({
      id: o.id,
      title: o.title,
      progressPct: o.progressPct,
      status: o.status,
    })),
  };
}

// ---------- Monthly ----------

function buildMonthPayload(ctx: Ctx, month: string) {
  const from = monthStart(month);
  const to = addDays(monthEnd(month), 1);
  const done = doneTasksBetween(ctx, from, to);
  const domains = domainTable(ctx);
  const weekly = ctx.db
    .select()
    .from(report)
    .where(eq(report.kind, 'week'))
    .orderBy(asc(report.periodKey))
    .all()
    // H-06 (D-142): the weeks of the month are those holding 4 of their days or more in it.
    .filter((r) => isValidIsoWeek(r.periodKey) && monthOfWeek(r.periodKey) === month);
  const weeks = weekly.map((r) => {
    const p = r.payload as ReturnType<typeof buildWeekPayload>;
    return {
      isoWeek: r.periodKey,
      light: p.global.light,
      tasksDone: p.tasksDone.count,
      doneMin: p.rhythm.doneMin,
      budgetMin: p.rhythm.budgetMin,
      focus: p.focus,
      rhythm: p.rhythm.tier,
    };
  });
  const finished = serializeProjects(
    ctx,
    ctx.db
      .select()
      .from(project)
      .where(
        and(
          eq(project.status, 'done'),
          gte(project.completedAt, parisDayStartIso(from)),
          lt(project.completedAt, parisDayStartIso(to)),
        ),
      )
      .all(),
  ).map((p) => ({
    projectId: p.id,
    title: p.title,
    success: !!p.success,
    ...domainView(domains.find((d) => d.id === p.domainIds[0])),
  }));
  const auditIn = (entityType: string, action: string) =>
    ctx.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, entityType),
          eq(auditLog.action, action),
          gte(auditLog.at, parisDayStartIso(from)),
          lt(auditLog.at, parisDayStartIso(to)),
        ),
      )
      .all();
  const ideasCreated = auditIn('project', 'create').length;
  const ideasPromoted = auditIn('project', 'promote').length;
  const ideasDropped = auditIn('project', 'status_abandoned').length;
  // DM-90: 3 ideas surfaced — most prioritary domain first, then oldest.
  const ideas = serializeProjects(
    ctx,
    ctx.db.select().from(project).where(eq(project.status, 'idea')).orderBy(asc(project.createdAt)).all(),
  );
  const rank = (id?: string) => domains.find((d) => d.id === id)?.priorityRank ?? 99;
  const surfaced = [...ideas]
    .sort((a, b) => rank(a.domainIds[0]) - rank(b.domainIds[0]) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 3)
    .map((p) => ({
      projectId: p.id,
      title: p.title,
      createdAt: p.createdAt,
      ...domainView(domains.find((d) => d.id === p.domainIds[0])),
    }));
  const work = done.filter((t) => !t.isExperience);
  const workMin = work.reduce((a, t) => a + t.durationMin, 0);
  return {
    period: { month, label: monthLabel(month), from, to: monthEnd(month) },
    navigation: { previous: shiftMonth(month, -1), next: shiftMonth(month, 1) },
    totals: {
      tasksDone: done.length,
      doneMin: workMin,
      experiences: done.filter((t) => t.isExperience).length,
    },
    drift: driftOf(ctx, from, to, workMin), // D-99
    weeks,
    weeksOverBudget: weeks.filter((w) => w.doneMin > w.budgetMin * 1.1).length,
    estimation: estimationOf(done), // D-61
    projectsFinished: finished,
    experiencesJournal: done.filter((t) => t.isExperience).map((t) => t.title),
    ideas: { created: ideasCreated, promoted: ideasPromoted, dropped: ideasDropped, surfaced },
    hoursByDomain: hoursByDomain(ctx, done),
  };
}

// ---------- Quarterly ----------

function buildQuarterPayload(ctx: Ctx, quarter: string) {
  const from = quarterStart(quarter);
  const to = addDays(quarterEnd(quarter), 1);
  const done = doneTasksBetween(ctx, from, to);
  const objectives = ctx.db.select().from(objective).where(eq(objective.quarter, quarter)).all();
  const metas = ctx.db.select().from(metaObjective).all();
  const count = (st: string[]) => objectives.filter((o) => st.includes(o.status)).length;
  const hours = hoursByDomain(ctx, done);
  const total = hours.reduce((a, h) => a + h.minutes, 0);
  const workMin = done.filter((t) => !t.isExperience).reduce((a, t) => a + t.durationMin, 0);
  const real = [...hours]
    .filter((h) => h.name !== 'Inbox')
    .sort((a, b) => b.minutes - a.minutes)
    .map((h) => h.name);
  return {
    period: { quarter, label: `${quarter.slice(5)} ${quarter.slice(0, 4)}`, from, to: quarterEnd(quarter) },
    navigation: { previous: shiftQuarter(quarter, -1), next: shiftQuarter(quarter, 1) },
    objectives: {
      achieved: count(['achieved']),
      partial: count(['partial']),
      failed: count(['failed', 'abandoned']),
      open: count(['active', 'paused']),
      list: objectives.map((o) => ({
        id: o.id,
        title: o.title,
        status: o.status,
        progressPct: o.progressPct,
      })),
    },
    metaObjectives: metas.map((m) => {
      const mine = ctx.db.select().from(objective).where(eq(objective.metaObjectiveId, m.id)).all();
      return {
        id: m.id,
        title: m.title,
        objectives: mine.length,
        progressPct: mine.length ? Math.round(mine.reduce((a, o) => a + o.progressPct, 0) / mine.length) : 0,
      };
    }),
    priorityGap: hours.map((h, i) => ({
      ...h,
      declaredRank: i + 1,
      realRank: real.indexOf(h.name) + 1,
      sharePct: total ? Math.round((h.minutes / total) * 100) : 0,
    })),
    experiencesJournal: done.filter((t) => t.isExperience).map((t) => t.title),
    totals: { tasksDone: done.length, doneMin: workMin },
    drift: driftOf(ctx, from, to, workMin), // D-99
  };
}

/** Generates a frozen report; if it already exists it is returned unchanged (WF-08). */
export function generateReport(ctx: Ctx, kind: Kind, periodKey: string) {
  return tx(ctx, () => {
    const found = existing(ctx, kind, periodKey);
    if (found) return { report: found, created: false };
    const valid = kind === 'week' ? isValidIsoWeek : kind === 'month' ? isValidMonth : isValidQuarter;
    if (!valid(periodKey))
      throw new DomainError(
        'INVALID_PERIOD',
        kind === 'week' ? 'Semaine invalide.' : kind === 'month' ? 'Mois invalide.' : 'Trimestre invalide.',
      );
    // H-05: never before the job's own time, so a report is never frozen while its period still runs.
    const s = getSettings(ctx);
    const from = reportFreezableFrom(kind, periodKey, {
      weekReport: s['schedule.week_report'].time,
      reports: s['schedule.reports'].time,
    });
    const now = parisClock(ctxNow(ctx));
    if (now.date < from.date || (now.date === from.date && now.time < from.time))
      throw new DomainError(
        'PERIOD_NOT_OVER',
        `Période pas encore terminée : rapport figeable à partir du ${frShort(from.date)} à ${from.time}.`,
      );
    const payload =
      kind === 'week'
        ? buildWeekPayload(ctx, periodKey)
        : kind === 'month'
          ? buildMonthPayload(ctx, periodKey)
          : buildQuarterPayload(ctx, periodKey);
    return { report: insertReport(ctx, kind, periodKey, payload), created: true };
  });
}

export function listReports(ctx: Ctx, f: { kind?: Kind; from?: string; to?: string } = {}) {
  return ctx.db
    .select({
      id: report.id,
      kind: report.kind,
      periodKey: report.periodKey,
      generatedAt: report.generatedAt,
    })
    .from(report)
    .where(
      and(
        f.kind ? eq(report.kind, f.kind) : undefined,
        f.from ? gte(report.periodKey, f.from) : undefined,
        f.to ? lt(report.periodKey, `${f.to}~`) : undefined,
      ),
    )
    .orderBy(desc(report.periodKey))
    .all();
}

export const getReport = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(report).where(eq(report.id, id)).get(), 'report', id);
export const findReport = (ctx: Ctx, kind: Kind, periodKey: string) => existing(ctx, kind, periodKey) ?? null;
