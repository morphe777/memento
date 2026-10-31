// Project dependencies (memento-vue-plan/02 §2): dependsOn is the only source of truth for the order of projects
// (DM-100). Writes check DM-105 (no loop, no self-dependency); « libre » means « no dependency » (DM-104).
import { and, eq, inArray, or, schema } from '@memento/db';
import { audit, type Ctx, ctxNowIso, tx } from '../context.ts';
import { DomainError } from '../errors.ts';
import { assertNoCycle } from '../rules/graph.ts';
import { type DepEdge, isLinearChain, topoOrder } from '../rules/plan.ts';

const { project, projectDependency, setting } = schema;

export const allDependencies = (ctx: Ctx): DepEdge[] => ctx.db.select().from(projectDependency).all();

const depsOf = (ctx: Ctx, id: string) =>
  ctx.db
    .select()
    .from(projectDependency)
    .where(eq(projectDependency.projectId, id))
    .all()
    .map((d) => d.dependsOnProjectId);

function projectOrFail(ctx: Ctx, id: string, code = 'DEPENDENCY_NOT_FOUND') {
  const p = ctx.db.select().from(project).where(eq(project.id, id)).get();
  if (!p) throw new DomainError(code, 'Projet inconnu dans les dépendances.', [id]);
  return p;
}

const clearFree = (ctx: Ctx, ids: string[]) => {
  if (!ids.length) return;
  ctx.db
    .update(project)
    .set({ isFree: false, updatedAt: ctxNowIso(ctx) })
    .where(and(inArray(project.id, ids), eq(project.isFree, true)))
    .run();
};

/**
 * API-02: replaces the prerequisites of a project. DM-105: unknown id → DEPENDENCY_NOT_FOUND, itself →
 * DEPENDENCY_SELF, loop → DEPENDENCY_CYCLE. DM-104: a link inside an objective takes both ends out of « Libres ».
 */
export function setProjectDependencies(ctx: Ctx, id: string, dependsOn: string[]) {
  return tx(ctx, () => {
    const p = projectOrFail(ctx, id, 'NOT_FOUND_PROJECT');
    const wanted = [...new Set(dependsOn)];
    const targets = wanted.map((d) => projectOrFail(ctx, d));
    const before = depsOf(ctx, id);
    const edges = allDependencies(ctx)
      .filter((e) => e.projectId !== id)
      .map((e) => ({ from: e.projectId, to: e.dependsOnProjectId }));
    for (const d of wanted) {
      assertNoCycle(edges, id, d);
      edges.push({ from: id, to: d });
    }
    ctx.db.delete(projectDependency).where(eq(projectDependency.projectId, id)).run();
    for (const d of wanted)
      ctx.db.insert(projectDependency).values({ projectId: id, dependsOnProjectId: d }).run();
    if (p.objectiveId) {
      const linked = targets.filter((t) => t.objectiveId === p.objectiveId).map((t) => t.id);
      clearFree(ctx, linked.length ? [id, ...linked] : []);
    }
    if (JSON.stringify([...before].sort()) !== JSON.stringify([...wanted].sort()))
      audit(ctx, 'project', id, 'dependencies', { dependsOn: before }, { dependsOn: wanted });
    return depsOf(ctx, id);
  });
}

export function addProjectDependency(ctx: Ctx, id: string, dependsOnId: string) {
  return tx(ctx, () => {
    projectOrFail(ctx, id, 'NOT_FOUND_PROJECT');
    projectOrFail(ctx, dependsOnId);
    const current = depsOf(ctx, id);
    return current.includes(dependsOnId)
      ? current
      : setProjectDependencies(ctx, id, [...current, dependsOnId]);
  });
}

export function removeProjectDependency(ctx: Ctx, id: string, dependsOnId: string) {
  return tx(ctx, () => {
    const current = depsOf(ctx, id);
    return current.includes(dependsOnId)
      ? setProjectDependencies(
          ctx,
          id,
          current.filter((d) => d !== dependsOnId),
        )
      : current;
  });
}

export const listProjectDependencies = depsOf;

/** DM-104: « Libre » = removes every dependency between this project and the other projects of its objective. */
export function stripObjectiveDependencies(ctx: Ctx, id: string) {
  const p = projectOrFail(ctx, id, 'NOT_FOUND_PROJECT');
  if (!p.objectiveId) return;
  const mates = new Set(
    ctx.db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.objectiveId, p.objectiveId))
      .all()
      .map((r) => r.id),
  );
  const edges = allDependencies(ctx).filter(
    (e) =>
      (e.projectId === id && mates.has(e.dependsOnProjectId)) ||
      (e.dependsOnProjectId === id && mates.has(e.projectId)),
  );
  for (const e of edges) {
    ctx.db
      .delete(projectDependency)
      .where(
        and(
          eq(projectDependency.projectId, e.projectId),
          eq(projectDependency.dependsOnProjectId, e.dependsOnProjectId),
        ),
      )
      .run();
    audit(
      ctx,
      'project',
      e.projectId,
      'dependency_remove',
      { dependsOnProjectId: e.dependsOnProjectId },
      null,
    );
  }
}

/** Detaching a project from its objective (V-27 « vers la réserve »): all its dependencies go, both ways. */
export function removeAllDependencies(ctx: Ctx, id: string) {
  const edges = allDependencies(ctx).filter((e) => e.projectId === id || e.dependsOnProjectId === id);
  ctx.db
    .delete(projectDependency)
    .where(or(eq(projectDependency.projectId, id), eq(projectDependency.dependsOnProjectId, id)))
    .run();
  for (const e of edges)
    audit(
      ctx,
      'project',
      e.projectId,
      'dependency_remove',
      { dependsOnProjectId: e.dependsOnProjectId },
      null,
    );
}

/**
 * DM-107: an abandoned project releases the projects waiting for it. Each release is journaled with the action
 * `dependency_release`, read back by the plan alert DEP_RELEASED.
 */
export function releaseDependenciesOn(ctx: Ctx, id: string) {
  const edges = allDependencies(ctx).filter((e) => e.dependsOnProjectId === id);
  if (!edges.length) return;
  ctx.db.delete(projectDependency).where(eq(projectDependency.dependsOnProjectId, id)).run();
  for (const e of edges)
    audit(ctx, 'project', e.projectId, 'dependency_release', { dependsOnProjectId: id }, null);
}

/** Open projects of an objective in display order (DM-102), for DM-101 and DM-103. */
function objectiveProjects(ctx: Ctx, objectiveId: string) {
  const rows = ctx.db.select().from(project).where(eq(project.objectiveId, objectiveId)).all();
  return topoOrder(
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    allDependencies(ctx),
  );
}

/** DM-101: a project added to an objective follows its last non-free, unfinished project (none: no dependency). */
export function defaultDependsOn(ctx: Ctx, objectiveId: string, exceptId?: string): string[] {
  const open = objectiveProjects(ctx, objectiveId).filter(
    (p) => p.id !== exceptId && !p.isFree && !['done', 'abandoned'].includes(p.status),
  );
  const last = open[open.length - 1];
  return last ? [last.id] : [];
}

/**
 * DM-103: reordering a list rewrites the chain when the open non-free projects of the objective form a single
 * chain; with branches the list refuses (PATH_NOT_LINEAR) and the Vue Plan takes over.
 */
export function rewriteChain(ctx: Ctx, objectiveId: string, orderedIds: string[]) {
  const rows = objectiveProjects(ctx, objectiveId).filter(
    (p) => !p.isFree && !['done', 'abandoned'].includes(p.status),
  );
  const ids = rows.map((p) => p.id);
  const deps = allDependencies(ctx);
  if (!isLinearChain(ids, deps))
    throw new DomainError(
      'PATH_NOT_LINEAR',
      'Ce chemin a des branches (projets en parallèle) : réordonne-le dans la Vue Plan.',
    );
  const set = new Set(ids);
  const chain = orderedIds.filter((id) => set.has(id));
  for (const id of ids) if (!chain.includes(id)) chain.push(id);
  chain.forEach((id, i) => {
    const keep = depsOf(ctx, id).filter((d) => !set.has(d)); // links to other objectives are kept
    setProjectDependencies(ctx, id, i ? [...keep, chain[i - 1]] : keep);
  });
}

const MIGRATION_KEY = 'migration.dm109_done';

/**
 * DM-109 (API-19): once, for every objective, its non-free unfinished projects sorted by positionInObjective
 * become a chain. Free projects get nothing, tasks are not migrated. Journaled as `system:migration`.
 * Idempotent: after the first real run nothing is written again; `dryRun` lists what would be created.
 */
export function migrateDependencies(ctx: Ctx, opts: { dryRun?: boolean } = {}) {
  return tx(ctx, () => {
    const done = !!ctx.db.select().from(setting).where(eq(setting.key, MIGRATION_KEY)).get();
    if (done && !opts.dryRun) return { alreadyDone: true, dryRun: false, created: [] as DepEdge[] };
    const rows = ctx.db
      .select()
      .from(project)
      .all()
      .filter((p) => p.objectiveId && !p.isFree && !['done', 'abandoned'].includes(p.status))
      .sort(
        (a, b) => a.positionInObjective - b.positionInObjective || a.createdAt.localeCompare(b.createdAt),
      );
    const existing = allDependencies(ctx);
    const created: DepEdge[] = [];
    const byObjective = new Map<string, typeof rows>();
    for (const p of rows) byObjective.set(p.objectiveId!, [...(byObjective.get(p.objectiveId!) ?? []), p]);
    for (const list of byObjective.values())
      for (let i = 1; i < list.length; i++) {
        const e = { projectId: list[i].id, dependsOnProjectId: list[i - 1].id };
        const has = [...existing, ...created].some(
          (x) => x.projectId === e.projectId && x.dependsOnProjectId === e.dependsOnProjectId,
        );
        if (!has) created.push(e);
      }
    if (opts.dryRun) return { alreadyDone: done, dryRun: true, created };
    const sys: Ctx = { ...ctx, actor: 'system:migration' };
    for (const e of created) {
      const edges = allDependencies(ctx).map((x) => ({ from: x.projectId, to: x.dependsOnProjectId }));
      try {
        assertNoCycle(edges, e.projectId, e.dependsOnProjectId);
      } catch {
        continue; // an explicit prerequisite already goes the other way: keep the user's link
      }
      ctx.db.insert(projectDependency).values(e).run();
      audit(sys, 'project', e.projectId, 'dependency_add', null, {
        dependsOnProjectId: e.dependsOnProjectId,
      });
    }
    ctx.db.insert(setting).values({ key: MIGRATION_KEY, value: true }).run();
    return { alreadyDone: false, dryRun: false, created };
  });
}
