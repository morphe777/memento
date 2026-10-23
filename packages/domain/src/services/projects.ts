import { and, asc, desc, eq, inArray, schema, sql } from '@memento/db';
// Projects and ideas (DM-89: same object, status). RB-01, RB-02, RB-04, RB-07, RB-08, RB-12, RB-13, RB-16.
import { audit, type Ctx, ctxNow, ctxNowIso, newId, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import { blockedProjectIds } from '../rules/availability.ts';
import { assertNoCycle } from '../rules/graph.ts';
import {
  assertCanFlagMonth,
  assertCompletion,
  assertStatusTransition,
  GAP_LABELS,
  type PromotionGap,
  promotionGaps,
  readiness,
  resolveProjectDomains,
} from '../rules/projects.ts';
import type { ProjectCreate, ProjectPatch } from '../schemas.ts';
import { withTemplate } from '../settings.ts';
import { parisDate } from '../time.ts';
import { refreshObjectiveProgress } from './referential.ts';

const { project, projectGroup, group, domain, task, projectDependency, objective } = schema;

export type ProjectRow = typeof project.$inferSelect;

export function getProjectRow(ctx: Ctx, id: string): ProjectRow {
  return assertFound(ctx.db.select().from(project).where(eq(project.id, id)).get(), 'project', id);
}

function groupDomainsOf(ctx: Ctx, groupIds: string[]) {
  if (!groupIds.length) return [];
  const rows = ctx.db
    .select({ groupId: group.id, id: domain.id, priorityRank: domain.priorityRank })
    .from(group)
    .innerJoin(domain, eq(domain.id, group.domainId))
    .where(inArray(group.id, groupIds))
    .all();
  const missing = groupIds.filter((g) => !rows.some((r) => r.groupId === g));
  if (missing.length) throw new DomainError('GROUP_NOT_FOUND', 'Groupe inconnu.', missing);
  return rows;
}

const projectGroupIds = (ctx: Ctx, id: string) =>
  ctx.db
    .select({ g: projectGroup.groupId })
    .from(projectGroup)
    .where(eq(projectGroup.projectId, id))
    .all()
    .map((r) => r.g);

/** Serialized project: row + groups, domains (primary first), task stats. */
export function serializeProjects(ctx: Ctx, rows: ProjectRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const links = ctx.db
    .select({
      projectId: projectGroup.projectId,
      groupId: group.id,
      groupName: group.name,
      domainId: domain.id,
      rank: domain.priorityRank,
    })
    .from(projectGroup)
    .innerJoin(group, eq(group.id, projectGroup.groupId))
    .innerJoin(domain, eq(domain.id, group.domainId))
    .where(inArray(projectGroup.projectId, ids))
    .all();
  const stats = ctx.db
    .select({
      projectId: task.projectId,
      status: task.status,
      n: sql<number>`count(*)`,
      minutes: sql<number>`coalesce(sum(${task.durationMin}), 0)`,
      noDuration: sql<number>`sum(case when ${task.durationMin} is null then 1 else 0 end)`,
    })
    .from(task)
    .where(inArray(task.projectId, ids))
    .groupBy(task.projectId, task.status)
    .all();
  const objectives = ctx.db
    .select({ id: objective.id, title: objective.title })
    .from(objective)
    .where(
      inArray(
        objective.id,
        rows.map((r) => r.objectiveId).filter((x): x is string => !!x),
      ),
    )
    .all();
  return rows.map((r) => {
    const mine = links.filter((l) => l.projectId === r.id);
    const domainRanks = new Map(mine.map((l) => [l.domainId, l.rank]));
    const others = [...domainRanks]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id)
      .filter((id) => id !== r.primaryDomainId);
    const st = stats.filter((s) => s.projectId === r.id);
    const by = (s: string) => st.find((x) => x.status === s);
    return {
      ...r,
      groups: mine.map((l) => ({ id: l.groupId, name: l.groupName, domainId: l.domainId })),
      groupIds: mine.map((l) => l.groupId),
      domainIds: r.primaryDomainId ? [r.primaryDomainId, ...others] : others,
      objectiveTitle: objectives.find((o) => o.id === r.objectiveId)?.title ?? null,
      taskStats: {
        todo: by('todo')?.n ?? 0,
        done: by('done')?.n ?? 0,
        totalMin: (by('todo')?.minutes ?? 0) + (by('done')?.minutes ?? 0),
        doneMin: by('done')?.minutes ?? 0,
        withoutDuration: (by('todo')?.noDuration ?? 0) + (by('done')?.noDuration ?? 0),
      },
    };
  });
}

export const getProject = (ctx: Ctx, id: string) => serializeProjects(ctx, [getProjectRow(ctx, id)])[0];

export function listProjects(
  ctx: Ctx,
  f: { status?: string; groupId?: string; domainId?: string; month?: string; objectiveId?: string } = {},
) {
  const statuses = f.status?.split(',').filter(Boolean) as ProjectRow['status'][] | undefined;
  let rows = ctx.db
    .select()
    .from(project)
    .where(
      and(
        statuses?.length ? inArray(project.status, statuses) : undefined,
        f.month ? eq(project.monthFlag, f.month) : undefined,
        f.objectiveId ? eq(project.objectiveId, f.objectiveId) : undefined,
      ),
    )
    .orderBy(asc(project.title))
    .all();
  let out = serializeProjects(ctx, rows);
  if (f.groupId) out = out.filter((p) => p.groupIds.includes(f.groupId!));
  if (f.domainId) out = out.filter((p) => p.domainIds.includes(f.domainId!));
  rows = [];
  return out;
}

/** RB-04: recompute domains after a group change. Keeps the current primary when still valid. */
export function recomputeProjectDomains(ctx: Ctx, id: string, requestedPrimary?: string | null) {
  const p = getProjectRow(ctx, id);
  const doms = groupDomainsOf(ctx, projectGroupIds(ctx, id));
  const keep = requestedPrimary ?? (doms.some((d) => d.id === p.primaryDomainId) ? p.primaryDomainId : null);
  const { primaryDomainId } = resolveProjectDomains(doms, keep);
  if (primaryDomainId !== p.primaryDomainId) {
    ctx.db
      .update(project)
      .set({ primaryDomainId, updatedAt: ctxNowIso(ctx) })
      .where(eq(project.id, id))
      .run();
    // RB-13: domain change is journaled; frozen reports are untouched.
    audit(ctx, 'project', id, 'domain_change', { primaryDomainId: p.primaryDomainId }, { primaryDomainId });
  }
}

function promotionInput(ctx: Ctx, p: ProjectRow) {
  const tasks = ctx.db
    .select({ durationMin: task.durationMin, status: task.status })
    .from(task)
    .where(eq(task.projectId, p.id))
    .all();
  return {
    successCriterion: p.successCriterion,
    startDate: p.replannedAt && p.startDate && p.replannedAt > p.startDate ? p.replannedAt : p.startDate,
    dueDate: p.dueDate,
    groupCount: projectGroupIds(ctx, p.id).length,
    tasks,
  };
}

/** Decision D-13: an active project keeps satisfying RB-02 (except "≥ 1 task", which may drop as tasks complete). */
export function assertActiveInvariant(ctx: Ctx, id: string) {
  const p = getProjectRow(ctx, id);
  if (p.status !== 'active') return;
  const gaps = promotionGaps(promotionInput(ctx, p)).filter((g) => g !== 'TASK_MISSING');
  if (gaps.length) throw activeGapError(gaps);
}

const activeGapError = (gaps: PromotionGap[]) =>
  new DomainError(
    gaps.includes('PROJECT_TOO_LONG') ? 'PROJECT_TOO_LONG' : 'ACTIVE_PROJECT_INCOMPLETE',
    `Projet actif : ${gaps.map((g) => GAP_LABELS[g]).join(' · ')}`,
    gaps.map((g) => ({ code: g, label: GAP_LABELS[g] })),
  );

function nextPositionInObjective(ctx: Ctx, objectiveId: string | null | undefined) {
  if (!objectiveId) return 0;
  return (
    ctx.db
      .select({ m: sql<number>`coalesce(max(${project.positionInObjective}), 0)` })
      .from(project)
      .where(eq(project.objectiveId, objectiveId))
      .get()!.m + 1
  );
}

export function createProject(ctx: Ctx, input: ProjectCreate) {
  return tx(ctx, () => {
    const { groupIds, primaryDomainId: requested, ...fields } = input;
    const { primaryDomainId } = resolveProjectDomains(groupDomainsOf(ctx, groupIds), requested); // RB-04
    if (fields.objectiveId)
      assertFound(
        ctx.db.select().from(objective).where(eq(objective.id, fields.objectiveId)).get(),
        'objective',
        fields.objectiveId,
      );
    if (fields.monthFlag)
      throw new DomainError(
        'MONTH_FLAG_REQUIRES_TASKS',
        'Ajoute des tâches avant de cocher « projet du mois ».',
      );
    const id = newId();
    ctx.db
      .insert(project)
      .values({
        id,
        createdBy: ctx.actor,
        ...fields,
        description: withTemplate(ctx, 'project', fields.description),
        status: 'idea', // RB-01: an idea only needs a title (and a group, D-04)
        primaryDomainId,
        positionInObjective: nextPositionInObjective(ctx, fields.objectiveId),
      })
      .run();
    for (const g of [...new Set(groupIds)])
      ctx.db.insert(projectGroup).values({ projectId: id, groupId: g }).run();
    const after = getProject(ctx, id);
    audit(ctx, 'project', id, 'create', null, after);
    return after;
  });
}

export function updateProject(ctx: Ctx, id: string, patch: ProjectPatch) {
  return tx(ctx, () => {
    const before = getProject(ctx, id);
    if (patch.status !== undefined) assertStatusTransition(before.status, patch.status);
    if (patch.primaryDomainId)
      resolveProjectDomains(groupDomainsOf(ctx, before.groupIds), patch.primaryDomainId);
    if (patch.monthFlag) {
      assertCanFlagMonth(
        ctx.db
          .select({ durationMin: task.durationMin, status: task.status })
          .from(task)
          .where(eq(task.projectId, id))
          .all(),
      ); // RB-08
    }
    const set: Partial<typeof project.$inferInsert> = {
      ...patch,
      updatedAt: ctxNowIso(ctx),
      lastTouchedAt: ctxNowIso(ctx),
    };
    if (patch.objectiveId !== undefined && patch.objectiveId !== before.objectiveId) {
      if (patch.objectiveId)
        assertFound(
          ctx.db.select().from(objective).where(eq(objective.id, patch.objectiveId)).get(),
          'objective',
          patch.objectiveId,
        );
      set.positionInObjective = nextPositionInObjective(ctx, patch.objectiveId);
    }
    if (patch.status === 'active' && before.status === 'done') {
      set.success = null;
      set.completedAt = null;
    }
    ctx.db.update(project).set(set).where(eq(project.id, id)).run();
    assertActiveInvariant(ctx, id);
    const after = getProject(ctx, id);
    audit(
      ctx,
      'project',
      id,
      patch.status && patch.status !== before.status ? `status_${patch.status}` : 'update',
      before,
      after,
    );
    refreshObjectiveProgress(ctx, before.objectiveId);
    if (after.objectiveId !== before.objectiveId) refreshObjectiveProgress(ctx, after.objectiveId);
    return after;
  });
}

export function setProjectGroups(ctx: Ctx, id: string, groupIds: string[], primaryDomainId?: string | null) {
  return tx(ctx, () => {
    const before = getProject(ctx, id);
    resolveProjectDomains(groupDomainsOf(ctx, groupIds), primaryDomainId); // validates before writing
    ctx.db.delete(projectGroup).where(eq(projectGroup.projectId, id)).run();
    for (const g of [...new Set(groupIds)])
      ctx.db.insert(projectGroup).values({ projectId: id, groupId: g }).run();
    recomputeProjectDomains(ctx, id, primaryDomainId);
    const after = getProject(ctx, id);
    audit(
      ctx,
      'project',
      id,
      'groups',
      { groupIds: before.groupIds, domainIds: before.domainIds },
      { groupIds: after.groupIds, domainIds: after.domainIds },
    );
    return after;
  });
}

/** RB-02 checklist for the project page (« Pour devenir actif »). */
export const getProjectReadiness = (ctx: Ctx, id: string) =>
  readiness(promotionInput(ctx, getProjectRow(ctx, id)));

/** RB-02: idea → active, or 422 with the list of gaps. */
export function promoteProject(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getProject(ctx, id);
    if (before.status !== 'idea' && before.status !== 'paused') {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        'Seule une idée (ou un projet en pause) peut être activée.',
      );
    }
    const gaps = promotionGaps(promotionInput(ctx, getProjectRow(ctx, id)));
    if (gaps.length) {
      throw new DomainError(
        'PROMOTION_INCOMPLETE',
        `Il manque : ${gaps.map((g) => GAP_LABELS[g]).join(' · ')}`,
        gaps.map((g) => ({ code: g, label: GAP_LABELS[g] })),
      );
    }
    ctx.db
      .update(project)
      .set({ status: 'active', updatedAt: ctxNowIso(ctx), lastTouchedAt: ctxNowIso(ctx) })
      .where(eq(project.id, id))
      .run();
    const after = getProject(ctx, id);
    audit(ctx, 'project', id, 'promote', before, after);
    refreshObjectiveProgress(ctx, after.objectiveId);
    return after;
  });
}

/** RB-12: complete with "critère de succès atteint ?" yes/no. */
export function completeProject(ctx: Ctx, id: string, success: unknown) {
  assertCompletion(success);
  return tx(ctx, () => {
    const before = getProject(ctx, id);
    if (before.status !== 'active' && before.status !== 'paused') {
      throw new DomainError(
        'INVALID_STATUS_TRANSITION',
        'Seul un projet actif ou en pause peut être terminé.',
      );
    }
    ctx.db
      .update(project)
      .set({
        status: 'done',
        success,
        completedAt: ctxNowIso(ctx),
        monthFlag: before.monthFlag,
        updatedAt: ctxNowIso(ctx),
        lastTouchedAt: ctxNowIso(ctx),
      })
      .where(eq(project.id, id))
      .run();
    const after = getProject(ctx, id);
    audit(ctx, 'project', id, 'complete', before, after);
    refreshObjectiveProgress(ctx, after.objectiveId);
    return after;
  });
}

/** Order of projects in an objective path (DM-26, F-10). */
export function reorderProjects(ctx: Ctx, objectiveId: string, ids: string[]) {
  return tx(ctx, () => {
    ids.forEach((id, i) => {
      const p = getProjectRow(ctx, id);
      if (p.objectiveId !== objectiveId)
        throw new DomainError('NOT_IN_OBJECTIVE', `« ${p.title} » n'est pas dans cet objectif.`);
      if (p.positionInObjective !== i + 1) {
        ctx.db
          .update(project)
          .set({ positionInObjective: i + 1, updatedAt: ctxNowIso(ctx) })
          .where(eq(project.id, id))
          .run();
        audit(
          ctx,
          'project',
          id,
          'reorder',
          { positionInObjective: p.positionInObjective },
          { positionInObjective: i + 1 },
        );
      }
    });
    return getObjectivePath(ctx, objectiveId);
  });
}

/** RB-16: accept the delay; the bar returns to the centre; previous state kept in audit_log and frozen reports. */
export function replanProject(ctx: Ctx, id: string, dueDate?: string) {
  return tx(ctx, () => {
    const before = getProject(ctx, id);
    const today = parisDate(ctxNow(ctx));
    ctx.db
      .update(project)
      .set({
        replannedAt: today,
        replanDoneMin: before.taskStats.doneMin,
        dueDate: dueDate ?? before.dueDate,
        updatedAt: ctxNowIso(ctx),
      })
      .where(eq(project.id, id))
      .run();
    assertActiveInvariant(ctx, id);
    const after = getProject(ctx, id);
    audit(ctx, 'project', id, 'replan', before, after);
    return after;
  });
}

export function addProjectDependency(ctx: Ctx, id: string, dependsOnId: string) {
  return tx(ctx, () => {
    getProjectRow(ctx, id);
    getProjectRow(ctx, dependsOnId);
    const edges = ctx.db
      .select()
      .from(projectDependency)
      .all()
      .map((e) => ({ from: e.projectId, to: e.dependsOnProjectId }));
    assertNoCycle(edges, id, dependsOnId); // RB-07
    ctx.db
      .insert(projectDependency)
      .values({ projectId: id, dependsOnProjectId: dependsOnId })
      .onConflictDoNothing()
      .run();
    audit(ctx, 'project', id, 'dependency_add', null, { dependsOnProjectId: dependsOnId });
    return listProjectDependencies(ctx, id);
  });
}

export function removeProjectDependency(ctx: Ctx, id: string, dependsOnId: string) {
  return tx(ctx, () => {
    ctx.db
      .delete(projectDependency)
      .where(and(eq(projectDependency.projectId, id), eq(projectDependency.dependsOnProjectId, dependsOnId)))
      .run();
    audit(ctx, 'project', id, 'dependency_remove', { dependsOnProjectId: dependsOnId }, null);
    return listProjectDependencies(ctx, id);
  });
}

export const listProjectDependencies = (ctx: Ctx, id: string) =>
  ctx.db
    .select()
    .from(projectDependency)
    .where(eq(projectDependency.projectId, id))
    .all()
    .map((d) => d.dependsOnProjectId);

/** V-02: ordered path of an objective's projects with prerequisites and blocked state. */
export function getObjectivePath(ctx: Ctx, objectiveId: string) {
  const rows = ctx.db
    .select()
    .from(project)
    .where(eq(project.objectiveId, objectiveId))
    .orderBy(asc(project.positionInObjective), asc(project.createdAt))
    .all();
  const deps = ctx.db.select().from(projectDependency).all();
  const blocked = blockedProjectIds(rows, deps);
  return serializeProjects(ctx, rows).map((p) => ({
    ...p,
    blocked: blocked.has(p.id),
    dependsOn: deps.filter((d) => d.projectId === p.id).map((d) => d.dependsOnProjectId),
  }));
}

/** Ideas view (DM-90): sorted by age, oldest first. */
export function listIdeas(ctx: Ctx, f: { groupId?: string; domainId?: string } = {}) {
  const rows = ctx.db
    .select()
    .from(project)
    .where(eq(project.status, 'idea'))
    .orderBy(asc(project.createdAt))
    .all();
  return serializeProjects(ctx, rows).filter(
    (p) =>
      (!f.groupId || p.groupIds.includes(f.groupId)) && (!f.domainId || p.domainIds.includes(f.domainId)),
  );
}

export const recentProjects = (ctx: Ctx, limit = 10) =>
  serializeProjects(
    ctx,
    ctx.db.select().from(project).orderBy(desc(project.lastTouchedAt)).limit(limit).all(),
  );
