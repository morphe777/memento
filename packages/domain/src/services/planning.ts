import { and, asc, eq, gte, inArray, isNull, lt, or, schema } from '@memento/db';
// Week planning (§6, V-16) and execution (V-18). RB-06, RB-09, RB-10, RB-14.
import { audit, type Ctx, ctxNow, ctxNowIso, newId, tx } from '../context.ts';
import { DomainError } from '../errors.ts';
import { availableTaskIds, blockedProjectIds } from '../rules/availability.ts';
import {
  buildPlanningPage,
  type EngineInput,
  type EngineProject,
  type EngineTask,
  projectDelayMin,
  propose,
  type Selection,
  scoreCandidates,
} from '../rules/engine.ts';
import { budgetMinutes, budgetStatus } from '../rules/tasks.ts';
import { getSettings } from '../settings.ts';
import {
  addDays,
  frWeekRange,
  isValidIsoWeek,
  monthOf,
  parisDate,
  shiftWeek,
  weekMonday,
  weekSunday,
} from '../time.ts';
import { serializeProjects } from './projects.ts';

const {
  weekPlan,
  weekPlanItem,
  task,
  project,
  projectGroup,
  group,
  domain,
  objective,
  taskDependency,
  projectDependency,
} = schema;

export function assertWeek(isoWeek: string) {
  if (!isValidIsoWeek(isoWeek)) throw new DomainError('INVALID_WEEK', `Semaine invalide : ${isoWeek}`);
}

export const getPlanRow = (ctx: Ctx, isoWeek: string) =>
  ctx.db.select().from(weekPlan).where(eq(weekPlan.isoWeek, isoWeek)).get();

function getOrCreatePlan(ctx: Ctx, isoWeek: string) {
  const existing = getPlanRow(ctx, isoWeek);
  if (existing) return existing;
  const id = newId();
  ctx.db
    .insert(weekPlan)
    .values({ id, createdBy: ctx.actor, isoWeek, budgetMin: getSettings(ctx)['budget.weekly_min'] })
    .run();
  const row = getPlanRow(ctx, isoWeek)!;
  audit(ctx, 'week_plan', id, 'create', null, row);
  return row;
}

const planItems = (ctx: Ctx, planId: string) =>
  ctx.db
    .select()
    .from(weekPlanItem)
    .where(eq(weekPlanItem.weekPlanId, planId))
    .orderBy(asc(weekPlanItem.position))
    .all();
export const planItemsOf = planItems;

/** Minutes done per domain (domains served, DM-84) and experiences done, in [from, to). */
function doneStats(ctx: Ctx, from: string, to: string) {
  const rows = ctx.db
    .select({
      id: task.id,
      durationMin: task.durationMin,
      isExperience: task.isExperience,
      projectId: task.projectId,
      domainId: task.domainId,
    })
    .from(task)
    .where(
      and(eq(task.status, 'done'), gte(task.doneAt, `${from}T00:00:00`), lt(task.doneAt, `${to}T00:00:00`)),
    )
    .all();
  const links = ctx.db
    .select({ projectId: projectGroup.projectId, domainId: group.domainId })
    .from(projectGroup)
    .innerJoin(group, eq(group.id, projectGroup.groupId))
    .all();
  const minutes: Record<string, number> = {};
  for (const r of rows) {
    const doms = r.projectId
      ? [...new Set(links.filter((l) => l.projectId === r.projectId).map((l) => l.domainId))]
      : r.domainId
        ? [r.domainId]
        : [];
    for (const d of doms) minutes[d] = (minutes[d] ?? 0) + (r.durationMin ?? 0);
  }
  return { minutes, experiences: rows.filter((r) => r.isExperience).length };
}

/** Snapshot of the data the engine needs (deterministic for a given database state and day). */
export function buildEngineInput(ctx: Ctx, isoWeek: string, budgetMin?: number): EngineInput {
  const s = getSettings(ctx);
  const monday = weekMonday(isoWeek);
  const domains = ctx.db
    .select()
    .from(domain)
    .where(eq(domain.archived, false))
    .orderBy(asc(domain.priorityRank))
    .all();
  const allProjects = ctx.db.select().from(project).all();
  const blocked = blockedProjectIds(allProjects, ctx.db.select().from(projectDependency).all());
  const active = allProjects.filter((p) => p.status === 'active');
  const serialized = serializeProjects(ctx, active);
  const objectives = ctx.db.select().from(objective).all();
  const projects: EngineProject[] = serialized.map((p) => {
    const o = objectives.find((x) => x.id === p.objectiveId);
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      objectiveId: p.objectiveId,
      objectiveTitle: o?.title ?? null,
      objectiveCriticality: o && o.status === 'active' ? o.criticality : null,
      domainIds: p.domainIds,
      sequenceMode: p.sequenceMode,
      monthFlag: p.monthFlag,
      startDate: p.startDate,
      dueDate: p.dueDate,
      replannedAt: p.replannedAt,
      replanDoneMin: p.replanDoneMin,
      blocked: blocked.has(p.id),
    };
  });
  const activeIds = active.map((p) => p.id);
  const taskRows = ctx.db
    .select()
    .from(task)
    .where(
      or(
        activeIds.length ? inArray(task.projectId, activeIds) : undefined,
        and(isNull(task.projectId), eq(task.status, 'todo')),
      ),
    )
    .all();
  const tasks: EngineTask[] = taskRows.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    durationMin: t.durationMin,
    position: t.position,
    isFree: t.isFree,
    isExperience: t.isExperience,
    status: t.status,
    dueDate: t.dueDate,
    domainId: t.domainId,
    postponeCount: t.postponeCount,
    doneAt: t.doneAt,
  }));
  const expWindow = s['experience.window_weeks'];
  return {
    isoWeek,
    today: parisDate(ctxNow(ctx)),
    weights: s['engine.weights'],
    bonusCount: s['engine.bonus_count'],
    considerAlsoCount: s['engine.consider_also_count'],
    budgetMin: budgetMin ?? s['budget.weekly_min'],
    experienceTarget: s['experience.target'],
    experienceWindowWeeks: expWindow,
    experiencesDone: doneStats(ctx, addDays(monday, -7 * expWindow), monday).experiences,
    guardDomainMinutes: doneStats(ctx, addDays(monday, -7 * s['guards.window_weeks']), monday).minutes,
    domains: domains.map((d) => ({ id: d.id, name: d.name, priorityRank: d.priorityRank, weight: d.weight })),
    projects,
    tasks,
    taskDeps: ctx.db.select().from(taskDependency).all(),
  };
}

/** GET /week-plans/{week}: the "Planifier la semaine" page ready to display. Never mutates. */
export function getPlanningPage(ctx: Ctx, isoWeek: string) {
  assertWeek(isoWeek);
  const plan = getPlanRow(ctx, isoWeek);
  const input = buildEngineInput(ctx, isoWeek, plan?.budgetMin);
  const items = plan ? planItems(ctx, plan.id) : [];
  const chosen = new Map<string, Selection>(items.map((i) => [i.taskId, i.kind]));
  const page = buildPlanningPage(input, chosen);
  return {
    isoWeek,
    label: frWeekRange(isoWeek),
    monday: weekMonday(isoWeek),
    sunday: weekSunday(isoWeek),
    plan: plan
      ? {
          id: plan.id,
          status: plan.status,
          budgetMin: plan.budgetMin,
          budgetReason: plan.budgetReason,
          proposedAt: plan.proposedAt,
          validatedAt: plan.validatedAt,
        }
      : null,
    experienceTarget: input.experienceTarget,
    experienceWindowWeeks: input.experienceWindowWeeks,
    experiencesDone: input.experiencesDone,
    items: items.map((i) => ({ taskId: i.taskId, kind: i.kind, source: i.source })),
    ...page,
  };
}

/**
 * RB-10: closes a past week. Planned ("week") tasks still todo get postpone_count + 1 and are carried into
 * the next plan (pre-checked). Idempotent through week_plan.closed_at.
 */
export function closeWeek(ctx: Ctx, isoWeek: string) {
  return tx(ctx, () => {
    const plan = getPlanRow(ctx, isoWeek);
    if (!plan || plan.closedAt) return { carried: 0 };
    const items = planItems(ctx, plan.id).filter((i) => i.kind === 'week');
    const todo = items.length
      ? ctx.db
          .select()
          .from(task)
          .where(
            and(
              inArray(
                task.id,
                items.map((i) => i.taskId),
              ),
              eq(task.status, 'todo'),
            ),
          )
          .all()
      : [];
    const next = todo.length ? getOrCreatePlan(ctx, shiftWeek(isoWeek, 1)) : null;
    for (const t of todo) {
      ctx.db
        .update(task)
        .set({ postponeCount: t.postponeCount + 1, updatedAt: ctxNowIso(ctx) })
        .where(eq(task.id, t.id))
        .run();
      audit(
        ctx,
        'task',
        t.id,
        'postpone',
        { postponeCount: t.postponeCount },
        { postponeCount: t.postponeCount + 1 },
      );
      if (next) {
        ctx.db
          .insert(weekPlanItem)
          .values({
            id: newId(),
            createdBy: ctx.actor,
            weekPlanId: next.id,
            taskId: t.id,
            kind: 'week',
            source: 'engine',
            why: `Reportée ${t.postponeCount + 1} fois`,
            position: 0,
          })
          .onConflictDoNothing()
          .run();
      }
    }
    ctx.db
      .update(weekPlan)
      .set({ closedAt: ctxNowIso(ctx), updatedAt: ctxNowIso(ctx) })
      .where(eq(weekPlan.id, plan.id))
      .run();
    audit(
      ctx,
      'week_plan',
      plan.id,
      'close',
      { closedAt: null },
      { closedAt: ctxNowIso(ctx), carried: todo.length },
    );
    return { carried: todo.length };
  });
}

/** POST /week-plans/{week}/propose: engine pre-selection (mandatory → Semaine, suggestions → Bonus). */
export function proposeWeek(ctx: Ctx, isoWeek: string) {
  assertWeek(isoWeek);
  return tx(ctx, () => {
    const prev = shiftWeek(isoWeek, -1);
    if (parisDate(ctxNow(ctx)) > weekSunday(prev)) closeWeek(ctx, prev);
    const plan = getOrCreatePlan(ctx, isoWeek);
    if (plan.status === 'validated') throw new DomainError('WEEK_ALREADY_VALIDATED', 'Semaine déjà validée.');
    const items = planItems(ctx, plan.id);
    // Engine suggestions are replaced; my choices, AI choices and carried-over tasks are kept.
    const keep = items.filter((i) => i.source !== 'engine' || (i.why ?? '').startsWith('Reportée'));
    ctx.db
      .delete(weekPlanItem)
      .where(and(eq(weekPlanItem.weekPlanId, plan.id), eq(weekPlanItem.source, 'engine')))
      .run();
    for (const k of keep.filter((i) => i.source === 'engine')) ctx.db.insert(weekPlanItem).values(k).run();
    const kept = new Set(keep.map((i) => i.taskId));
    const p = propose(buildEngineInput(ctx, isoWeek, plan.budgetMin));
    let pos = items.length;
    for (const [kind, list] of [
      ['week', p.week],
      ['bonus', p.bonus],
    ] as const) {
      for (const s of list) {
        if (kept.has(s.taskId)) continue;
        ctx.db
          .insert(weekPlanItem)
          .values({
            id: newId(),
            createdBy: ctx.actor,
            weekPlanId: plan.id,
            taskId: s.taskId,
            kind,
            source: 'engine',
            score: s.score,
            why: s.why,
            position: ++pos,
          })
          .run();
      }
    }
    ctx.db
      .update(weekPlan)
      .set({ proposedAt: ctxNowIso(ctx), updatedAt: ctxNowIso(ctx) })
      .where(eq(weekPlan.id, plan.id))
      .run();
    audit(
      ctx,
      'week_plan',
      plan.id,
      'propose',
      { items: items.length },
      { items: planItems(ctx, plan.id).length },
    );
    return getPlanningPage(ctx, isoWeek);
  });
}

/** PUT /week-plans/{week}/items: full selection. Validates RB-06 availability for newly chosen tasks. */
export function setWeekItems(ctx: Ctx, isoWeek: string, items: { taskId: string; kind: Selection }[]) {
  assertWeek(isoWeek);
  return tx(ctx, () => {
    const plan = getOrCreatePlan(ctx, isoWeek);
    const before = planItems(ctx, plan.id);
    // Tasks already done stay in the plan even if the new selection omits them (history of the week).
    const listed = new Set(items.map((i) => i.taskId));
    const doneKept = before.filter((b) => !listed.has(b.taskId));
    if (doneKept.length) {
      const doneIds = new Set(
        ctx.db
          .select({ id: task.id })
          .from(task)
          .where(
            and(
              inArray(
                task.id,
                doneKept.map((b) => b.taskId),
              ),
              eq(task.status, 'done'),
            ),
          )
          .all()
          .map((r) => r.id),
      );
      items = [
        ...items,
        ...doneKept.filter((b) => doneIds.has(b.taskId)).map((b) => ({ taskId: b.taskId, kind: b.kind })),
      ];
    }
    const beforeIds = new Set(before.map((i) => i.taskId));
    const ids = [...new Set(items.map((i) => i.taskId))];
    const rows = ids.length ? ctx.db.select().from(task).where(inArray(task.id, ids)).all() : [];
    if (rows.length !== ids.length)
      throw new DomainError('TASK_NOT_FOUND', 'Tâche inconnue dans la sélection.');
    const chosen = new Set(ids);
    const deps = ctx.db.select().from(taskDependency).all();
    for (const t of rows.filter((r) => !beforeIds.has(r.id))) {
      if (t.status !== 'todo') throw new DomainError('TASK_NOT_TODO', `« ${t.title} » n'est plus à faire.`);
      if (!t.projectId) continue;
      const p = ctx.db.select().from(project).where(eq(project.id, t.projectId)).get()!;
      if (p.status !== 'active')
        throw new DomainError('PROJECT_NOT_ACTIVE', `« ${p.title} » n'est pas un projet actif.`);
      const siblings = ctx.db.select().from(task).where(eq(task.projectId, p.id)).all();
      if (!availableTaskIds(siblings, p.sequenceMode, chosen, deps).has(t.id)) {
        throw new DomainError('TASK_LOCKED', `« ${t.title} » attend la tâche précédente.`);
      }
    }
    const scored = new Map(
      scoreCandidates(buildEngineInput(ctx, isoWeek, plan.budgetMin)).map((s) => [s.taskId, s]),
    );
    const source = ctx.actor === 'me' ? 'me' : 'ai';
    ctx.db.delete(weekPlanItem).where(eq(weekPlanItem.weekPlanId, plan.id)).run();
    items.forEach((it, i) => {
      const prev = before.find((b) => b.taskId === it.taskId);
      ctx.db
        .insert(weekPlanItem)
        .values({
          id: prev?.id ?? newId(),
          createdBy: prev?.createdBy ?? ctx.actor,
          weekPlanId: plan.id,
          taskId: it.taskId,
          kind: it.kind,
          source: prev && prev.kind === it.kind ? prev.source : source,
          score: prev?.score ?? scored.get(it.taskId)?.score ?? null,
          why: prev && prev.kind === it.kind ? prev.why : (scored.get(it.taskId)?.why ?? prev?.why ?? null),
          position: i + 1,
        })
        .onConflictDoNothing()
        .run();
    });
    audit(
      ctx,
      'week_plan',
      plan.id,
      'items',
      { items: before.map((b) => `${b.kind}:${b.taskId}`) },
      { items: items.map((b) => `${b.kind}:${b.taskId}`) },
    );
    return getPlanningPage(ctx, isoWeek);
  });
}

/** CH-03: weekly budget override (null = back to default). */
export function patchWeek(ctx: Ctx, isoWeek: string, budgetMin: number | null, budgetReason?: string | null) {
  assertWeek(isoWeek);
  return tx(ctx, () => {
    const plan = getOrCreatePlan(ctx, isoWeek);
    const value = budgetMin ?? getSettings(ctx)['budget.weekly_min'];
    ctx.db
      .update(weekPlan)
      .set({
        budgetMin: value,
        budgetReason: budgetMin === null ? null : (budgetReason ?? plan.budgetReason),
        updatedAt: ctxNowIso(ctx),
      })
      .where(eq(weekPlan.id, plan.id))
      .run();
    const after = getPlanRow(ctx, isoWeek)!;
    audit(
      ctx,
      'week_plan',
      plan.id,
      'budget',
      { isoWeek, budgetMin: plan.budgetMin, budgetReason: plan.budgetReason },
      { isoWeek, budgetMin: after.budgetMin, budgetReason: after.budgetReason },
    );
    return getPlanningPage(ctx, isoWeek);
  });
}

/** RB-14: validation is never blocked by an overflow. */
export function validateWeek(ctx: Ctx, isoWeek: string) {
  assertWeek(isoWeek);
  return tx(ctx, () => {
    const plan = getOrCreatePlan(ctx, isoWeek);
    ctx.db
      .update(weekPlan)
      .set({ status: 'validated', validatedAt: ctxNowIso(ctx), updatedAt: ctxNowIso(ctx) })
      .where(eq(weekPlan.id, plan.id))
      .run();
    audit(ctx, 'week_plan', plan.id, 'validate', { status: plan.status }, { status: 'validated' });
    return getPlanningPage(ctx, isoWeek);
  });
}

/** GET /weeks/{week}/execution: "Ma semaine" ready to display (V-06, V-13, V-18). */
export function getExecution(ctx: Ctx, isoWeek: string) {
  assertWeek(isoWeek);
  const s = getSettings(ctx);
  const plan = getPlanRow(ctx, isoWeek);
  const items = plan ? planItems(ctx, plan.id) : [];
  const taskRows = items.length
    ? ctx.db
        .select()
        .from(task)
        .where(
          inArray(
            task.id,
            items.map((i) => i.taskId),
          ),
        )
        .all()
    : [];
  const projectIds = [...new Set(taskRows.map((t) => t.projectId).filter((x): x is string => !!x))];
  const projects = serializeProjects(
    ctx,
    projectIds.length ? ctx.db.select().from(project).where(inArray(project.id, projectIds)).all() : [],
  );
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const domains = ctx.db.select().from(domain).orderBy(asc(domain.priorityRank)).all();

  const rows = items
    .map((i) => {
      const t = taskRows.find((x) => x.id === i.taskId);
      if (!t || t.status === 'cancelled') return null;
      const p = t.projectId ? projectById.get(t.projectId) : undefined;
      return {
        taskId: t.id,
        title: t.title,
        kind: i.kind,
        why: i.why ?? '',
        durationMin: t.durationMin,
        isExperience: t.isExperience,
        done: t.status === 'done',
        doneAt: t.doneAt,
        domainId: p ? (p.domainIds[0] ?? null) : t.domainId,
        isInbox: !t.projectId,
        projectId: t.projectId,
        projectTitle: p?.title ?? 'Inbox',
        position: i.position,
      };
    })
    .filter((r): r is NonNullable<typeof r> => !!r);
  const listed = rows.filter((r) => r.kind === 'week' || r.done);
  const tasks = [...listed.filter((r) => !r.done), ...listed.filter((r) => r.done)];
  const bonusOpen = rows.filter((r) => r.kind === 'bonus' && !r.done);

  const weekRows = rows.filter((r) => r.kind === 'week');
  const plannedMin = budgetMinutes(
    weekRows.map((r) => ({ durationMin: r.durationMin, isExperience: r.isExperience })),
  );
  const budgetMin = plan?.budgetMin ?? s['budget.weekly_min'];
  const doneMin = budgetMinutes(
    rows.filter((r) => r.done).map((r) => ({ durationMin: r.durationMin, isExperience: r.isExperience })),
  );
  const today = parisDate(ctxNow(ctx));
  const monday = weekMonday(isoWeek);
  const window = s['experience.window_weeks'];
  const experiences = doneStats(ctx, addDays(monday, -7 * (window - 1)), addDays(monday, 7)).experiences;

  const mixMap = new Map<string | null, number>();
  for (const r of rows.filter((x) => x.done))
    mixMap.set(r.domainId, (mixMap.get(r.domainId) ?? 0) + (r.durationMin ?? 0));
  const domainMix = [
    ...domains
      .filter((d) => !d.archived)
      .map((d) => ({ domainId: d.id as string | null, minutes: mixMap.get(d.id) ?? 0 })),
    { domainId: null, minutes: mixMap.get(null) ?? 0 },
  ];

  // Month projects (DM-93) with R-06 delay at today.
  const month = monthOf(today < monday ? monday : today);
  const monthRows = ctx.db
    .select()
    .from(project)
    .where(and(eq(project.monthFlag, month), inArray(project.status, ['active', 'paused', 'done'])))
    .all();
  const monthProjects = serializeProjects(ctx, monthRows).map((p) => {
    const ptasks = ctx.db.select().from(task).where(eq(task.projectId, p.id)).all() as EngineTask[];
    return {
      projectId: p.id,
      title: p.title,
      domainId: p.domainIds[0] ?? null,
      status: p.status,
      deltaMin: projectDelayMin(
        { ...p, objectiveTitle: null, objectiveCriticality: null, blocked: false } as EngineProject,
        ptasks,
        today,
      ),
    };
  });

  return {
    isoWeek,
    label: frWeekRange(isoWeek),
    plan: plan
      ? { id: plan.id, status: plan.status, proposedAt: plan.proposedAt, validatedAt: plan.validatedAt }
      : null,
    tasks,
    remaining: tasks.filter((t) => !t.done).length,
    bonusOpen,
    budget: { budgetMin, plannedMin, ...budgetStatus(plannedMin, budgetMin) },
    doneMin,
    experiences: { done: experiences, target: s['experience.target'], windowWeeks: window },
    monthProjects,
    domainMix,
  };
}
