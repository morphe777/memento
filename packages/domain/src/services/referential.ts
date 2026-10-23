import { and, asc, eq, inArray, schema, sql } from '@memento/db';
// Domains, groups, meta-objectives, objectives, resources. Every mutation is audited (RB-15).
import { audit, type Ctx, ctxNowIso, newId, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import { checkCriticality, checkObjectiveDeadline } from '../rules/objectives.ts';
import { objectiveProgressPct } from '../rules/projects.ts';
import type {
  DomainCreate,
  DomainPatch,
  GroupCreate,
  GroupPatch,
  MetaObjectiveCreate,
  MetaObjectivePatch,
  ObjectiveCreate,
  ObjectivePatch,
  ResourceCreate,
} from '../schemas.ts';
import { recomputeProjectDomains } from './projects.ts';

const { domain, group, metaObjective, objective, project, projectGroup, resourceLink } = schema;

// ---------- Domains ----------

export const listDomains = (ctx: Ctx, includeArchived = true) =>
  ctx.db
    .select()
    .from(domain)
    .where(includeArchived ? undefined : eq(domain.archived, false))
    .orderBy(asc(domain.priorityRank))
    .all();

export const getDomain = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(domain).where(eq(domain.id, id)).get(), 'domain', id);

export function createDomain(ctx: Ctx, input: DomainCreate) {
  return tx(ctx, () => {
    const max = ctx.db
      .select({ m: sql<number>`coalesce(max(${domain.priorityRank}), 0)` })
      .from(domain)
      .get()!.m;
    const row = { id: newId(), createdBy: ctx.actor, priorityRank: max + 1, weight: 0.1, ...input };
    ctx.db.insert(domain).values(row).run();
    const after = getDomain(ctx, row.id);
    audit(ctx, 'domain', row.id, 'create', null, after);
    return after;
  });
}

export function updateDomain(ctx: Ctx, id: string, patch: DomainPatch) {
  return tx(ctx, () => {
    const before = getDomain(ctx, id);
    ctx.db
      .update(domain)
      .set({ ...patch, updatedAt: ctxNowIso(ctx) })
      .where(eq(domain.id, id))
      .run();
    const after = getDomain(ctx, id);
    audit(ctx, 'domain', id, patch.archived === true ? 'archive' : 'update', before, after);
    return after;
  });
}

/** Sets priority order (CH-02). ids = every domain id, most important first. */
export function reorderDomains(ctx: Ctx, ids: string[]) {
  return tx(ctx, () => {
    const all = listDomains(ctx);
    if (ids.length !== all.length || !all.every((d) => ids.includes(d.id))) {
      throw new DomainError('REORDER_INCOMPLETE', 'Donne l’ordre complet des domaines.');
    }
    // Two passes to respect the unique rank index.
    all.forEach((d, i) => {
      ctx.db
        .update(domain)
        .set({ priorityRank: 1000 + i })
        .where(eq(domain.id, d.id))
        .run();
    });
    ids.forEach((id, i) => {
      const before = all.find((d) => d.id === id)!;
      ctx.db
        .update(domain)
        .set({ priorityRank: i + 1, updatedAt: ctxNowIso(ctx) })
        .where(eq(domain.id, id))
        .run();
      if (before.priorityRank !== i + 1)
        audit(ctx, 'domain', id, 'reorder', { priorityRank: before.priorityRank }, { priorityRank: i + 1 });
    });
    return listDomains(ctx);
  });
}

// ---------- Groups ----------

export function listGroups(ctx: Ctx) {
  const rows = ctx.db.select().from(group).orderBy(asc(group.name)).all();
  const counts = ctx.db
    .select({ groupId: projectGroup.groupId, status: project.status, n: sql<number>`count(*)` })
    .from(projectGroup)
    .innerJoin(project, eq(project.id, projectGroup.projectId))
    .groupBy(projectGroup.groupId, project.status)
    .all();
  return rows.map((g) => {
    const mine = counts.filter((c) => c.groupId === g.id);
    return {
      ...g,
      projectCount: mine.reduce((s, c) => s + c.n, 0),
      activeProjectCount: mine.filter((c) => c.status === 'active').reduce((s, c) => s + c.n, 0),
      ideaCount: mine.filter((c) => c.status === 'idea').reduce((s, c) => s + c.n, 0),
    };
  });
}

export const getGroup = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(group).where(eq(group.id, id)).get(), 'group', id);

function assertUniqueGroupName(ctx: Ctx, name: string, exceptId?: string) {
  const clash = ctx.db.select().from(group).where(eq(group.nameKey, name.trim().toLowerCase())).get();
  if (clash && clash.id !== exceptId)
    throw new DomainError('GROUP_NAME_TAKEN', `Le groupe « ${clash.name} » existe déjà.`);
}

export function createGroup(ctx: Ctx, input: GroupCreate) {
  return tx(ctx, () => {
    getDomain(ctx, input.domainId);
    assertUniqueGroupName(ctx, input.name);
    const id = newId();
    ctx.db
      .insert(group)
      .values({
        id,
        createdBy: ctx.actor,
        name: input.name.trim(),
        nameKey: input.name.trim().toLowerCase(),
        domainId: input.domainId,
      })
      .run();
    const after = getGroup(ctx, id);
    audit(ctx, 'group', id, 'create', null, after);
    return after;
  });
}

export function updateGroup(ctx: Ctx, id: string, patch: GroupPatch) {
  return tx(ctx, () => {
    const before = getGroup(ctx, id);
    const set: Partial<typeof group.$inferInsert> = { updatedAt: ctxNowIso(ctx) };
    if (patch.name !== undefined) {
      assertUniqueGroupName(ctx, patch.name, id);
      set.name = patch.name.trim();
      set.nameKey = patch.name.trim().toLowerCase();
    }
    if (patch.domainId !== undefined) {
      getDomain(ctx, patch.domainId);
      set.domainId = patch.domainId;
    }
    ctx.db.update(group).set(set).where(eq(group.id, id)).run();
    const after = getGroup(ctx, id);
    audit(ctx, 'group', id, 'update', before, after);
    if (patch.domainId !== undefined && patch.domainId !== before.domainId) {
      // RB-04: projects of this group get their domains recomputed.
      const pids = ctx.db
        .select({ id: projectGroup.projectId })
        .from(projectGroup)
        .where(eq(projectGroup.groupId, id))
        .all();
      for (const p of pids) recomputeProjectDomains(ctx, p.id);
    }
    return after;
  });
}

export function deleteGroup(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getGroup(ctx, id);
    const used = ctx.db.select().from(projectGroup).where(eq(projectGroup.groupId, id)).get();
    if (used) throw new DomainError('GROUP_IN_USE', 'Ce groupe contient des projets : déplace-les d’abord.');
    ctx.db
      .delete(resourceLink)
      .where(and(eq(resourceLink.ownerType, 'group'), eq(resourceLink.ownerId, id)))
      .run();
    ctx.db.delete(group).where(eq(group.id, id)).run();
    audit(ctx, 'group', id, 'delete', before, null);
  });
}

// ---------- Meta-objectives ----------

export const listMetaObjectives = (ctx: Ctx) =>
  ctx.db.select().from(metaObjective).orderBy(asc(metaObjective.createdAt)).all();
export const getMetaObjective = (ctx: Ctx, id: string) =>
  assertFound(
    ctx.db.select().from(metaObjective).where(eq(metaObjective.id, id)).get(),
    'meta_objective',
    id,
  );

export function createMetaObjective(ctx: Ctx, input: MetaObjectiveCreate) {
  return tx(ctx, () => {
    const id = newId();
    ctx.db
      .insert(metaObjective)
      .values({ id, createdBy: ctx.actor, ...input })
      .run();
    const after = getMetaObjective(ctx, id);
    audit(ctx, 'meta_objective', id, 'create', null, after);
    return after;
  });
}

export function updateMetaObjective(ctx: Ctx, id: string, patch: MetaObjectivePatch) {
  return tx(ctx, () => {
    const before = getMetaObjective(ctx, id);
    ctx.db
      .update(metaObjective)
      .set({ ...patch, updatedAt: ctxNowIso(ctx) })
      .where(eq(metaObjective.id, id))
      .run();
    const after = getMetaObjective(ctx, id);
    audit(ctx, 'meta_objective', id, 'update', before, after);
    return after;
  });
}

// ---------- Objectives ----------

export const listObjectives = (ctx: Ctx, filter: { status?: string; quarter?: string } = {}) =>
  ctx.db
    .select()
    .from(objective)
    .where(
      and(
        filter.status ? eq(objective.status, filter.status as 'active') : undefined,
        filter.quarter ? eq(objective.quarter, filter.quarter) : undefined,
      ),
    )
    .orderBy(asc(objective.deadline))
    .all();

export const getObjective = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(objective).where(eq(objective.id, id)).get(), 'objective', id);

export function createObjective(ctx: Ctx, input: ObjectiveCreate) {
  return tx(ctx, () => {
    const quarter = checkObjectiveDeadline(input.deadline, input.quarter); // RB-05
    checkCriticality(input.criticality ?? 2);
    if (input.metaObjectiveId) getMetaObjective(ctx, input.metaObjectiveId);
    const id = newId();
    ctx.db
      .insert(objective)
      .values({ id, createdBy: ctx.actor, ...input, quarter })
      .run();
    const after = getObjective(ctx, id);
    audit(ctx, 'objective', id, 'create', null, after);
    return after;
  });
}

export function updateObjective(ctx: Ctx, id: string, patch: ObjectivePatch) {
  return tx(ctx, () => {
    const before = getObjective(ctx, id);
    const deadline = patch.deadline ?? before.deadline;
    const quarter = checkObjectiveDeadline(
      deadline,
      patch.quarter ?? (patch.deadline ? undefined : before.quarter),
    );
    if (patch.criticality !== undefined) checkCriticality(patch.criticality);
    if (patch.metaObjectiveId) getMetaObjective(ctx, patch.metaObjectiveId);
    ctx.db
      .update(objective)
      .set({ ...patch, quarter, updatedAt: ctxNowIso(ctx) })
      .where(eq(objective.id, id))
      .run();
    const after = getObjective(ctx, id);
    audit(ctx, 'objective', id, 'update', before, after);
    return after;
  });
}

/** Stored progress (decision D-05), refreshed whenever a project of the path changes. */
export function refreshObjectiveProgress(ctx: Ctx, objectiveId: string | null | undefined) {
  if (!objectiveId) return;
  const before = getObjective(ctx, objectiveId);
  const projects = ctx.db
    .select({ status: project.status })
    .from(project)
    .where(eq(project.objectiveId, objectiveId))
    .all();
  const pct = objectiveProgressPct(projects);
  if (pct !== before.progressPct) {
    ctx.db
      .update(objective)
      .set({ progressPct: pct, updatedAt: ctxNowIso(ctx) })
      .where(eq(objective.id, objectiveId))
      .run();
    audit(
      ctx,
      'objective',
      objectiveId,
      'progress',
      { progressPct: before.progressPct },
      { progressPct: pct },
    );
  }
}

// ---------- Resources (DM-70) ----------

export const listResources = (ctx: Ctx, ownerType: string, ownerIds: string[]) =>
  ownerIds.length
    ? ctx.db
        .select()
        .from(resourceLink)
        .where(
          and(eq(resourceLink.ownerType, ownerType as 'project'), inArray(resourceLink.ownerId, ownerIds)),
        )
        .orderBy(asc(resourceLink.createdAt))
        .all()
    : [];

export function createResource(ctx: Ctx, input: ResourceCreate) {
  return tx(ctx, () => {
    const table = { objective, project, task: schema.task, group }[input.ownerType];
    assertFound(
      ctx.db.select({ id: table.id }).from(table).where(eq(table.id, input.ownerId)).get(),
      input.ownerType,
      input.ownerId,
    );
    const id = newId();
    ctx.db
      .insert(resourceLink)
      .values({ id, createdBy: ctx.actor, ...input })
      .run();
    const after = assertFound(
      ctx.db.select().from(resourceLink).where(eq(resourceLink.id, id)).get(),
      'resource',
      id,
    );
    audit(ctx, 'resource', id, 'create', null, after);
    return after;
  });
}

export function deleteResource(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = assertFound(
      ctx.db.select().from(resourceLink).where(eq(resourceLink.id, id)).get(),
      'resource',
      id,
    );
    ctx.db.delete(resourceLink).where(eq(resourceLink.id, id)).run();
    audit(ctx, 'resource', id, 'delete', before, null);
  });
}
