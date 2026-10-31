// Vue Plan acceptance criteria CA-01 to CA-15 (memento-vue-plan/04-criteres-acceptation.md).
import { readFileSync } from 'node:fs';
import { eq, schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import type { DomainError } from '../src/errors.ts';
import {
  addProjectDependency,
  buildEngineInput,
  closeRecurringObjectives,
  createMetaObjective,
  createObjective,
  createProject,
  createTask,
  getObjective,
  getPlanGraph,
  getProject,
  migrateDependencies,
  promoteProject,
  rollMonth,
  scoreCandidates,
  setProjectDependencies,
  setProjectMonth,
  setWeekItems,
  updateProject,
} from '../src/index.ts';
import { monthOf, parisDate } from '../src/time.ts';
import { lookups, makeCtx } from './helpers.ts';

type TestCtx = ReturnType<typeof makeCtx>;

const errCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code ?? (e as Error).name;
  }
  return null;
};

const MONTH = '2026-10';
const group = (ctx: TestCtx, name = 'Sport') => [lookups(ctx).group(name).id];
const depsOf = (ctx: TestCtx, id: string) =>
  ctx.db
    .select()
    .from(schema.projectDependency)
    .where(eq(schema.projectDependency.projectId, id))
    .all()
    .map((d) => d.dependsOnProjectId);
const auditCount = (ctx: TestCtx) => ctx.db.select().from(schema.auditLog).all().length;

/** A project in an objective, no automatic dependency unless given. */
function mk(ctx: TestCtx, title: string, extra: Record<string, unknown> = {}) {
  return createProject(ctx, { title, groupIds: group(ctx), dependsOn: [], ...extra });
}

/** A « prêt » project (complete, RB-02) with n tasks of 60 min, not yet planned for a month. */
function readyProject(ctx: TestCtx, title: string, n = 2, extra: Record<string, unknown> = {}) {
  const p = mk(ctx, title, {
    successCriterion: 'Fait',
    startDate: '2026-10-20',
    dueDate: '2026-11-15',
    ...extra,
  });
  const tasks = Array.from({ length: n }, (_, i) =>
    createTask(ctx, { projectId: p.id, title: `${title} ${i + 1}`, durationMin: 60 }),
  );
  promoteProject(ctx, p.id);
  return { project: p, tasks };
}

function activeProject(ctx: TestCtx, title: string, n = 2, extra: Record<string, unknown> = {}) {
  const r = readyProject(ctx, title, n, extra);
  setProjectMonth(ctx, r.project.id, monthOf(parisDate(ctx.now!())));
  return r;
}

// ---------- Real data: Carrière 31/10/2026 ----------

interface CareerJson {
  metaObjectif: { outcomeTitlePropose: string };
  objectifs: {
    id: string;
    title: string;
    outcomeTitlePropose: string;
    quarter: string;
    deadline: string;
    smartIndicator: string;
    smartTarget: string;
  }[];
  projetsDansObjectifs: {
    title: string;
    objectiveId: string;
    positionInObjective: number;
    isFree: boolean;
    status: string;
  }[];
}
const career: CareerJson = JSON.parse(
  readFileSync(
    new URL('../../../memento-vue-plan/donnees/carriere-2026-10-31.json', import.meta.url),
    'utf8',
  ),
);

/** Builds the Carrière case; the projects carry no dependency, as in the real data (DM-109 not yet run). */
function buildCareer(ctx: TestCtx) {
  const meta = createMetaObjective(ctx, {
    title: 'Employabilité',
    outcomeTitle: career.metaObjectif.outcomeTitlePropose.slice(0, 80),
    primaryDomainId: lookups(ctx).domain('Carrière').id,
  });
  const objectives = new Map<string, string>();
  for (const o of career.objectifs) {
    const created = createObjective(ctx, {
      title: o.title,
      outcomeTitle: o.outcomeTitlePropose,
      deadline: o.deadline,
      quarter: o.quarter,
      metaObjectiveId: meta.id,
    });
    objectives.set(o.id, created.id);
  }
  const projects = new Map<string, string>();
  for (const p of career.projetsDansObjectifs) {
    const created = mk(ctx, p.title, { objectiveId: objectives.get(p.objectiveId), isFree: p.isFree });
    // positions have holes in the real data; the status is set directly
    ctx.db
      .update(schema.project)
      .set({ positionInObjective: p.positionInObjective, isFree: p.isFree, status: p.status as 'idea' })
      .where(eq(schema.project.id, created.id))
      .run();
    projects.set(p.title, created.id);
  }
  return { meta, objectives, projects };
}

describe('Vue Plan — model and rules', () => {
  it('CA-01 migration chains Plan, Profil & ADR → Refonte du CV → ADR Novembre; the free project has none', () => {
    const ctx = makeCtx();
    const { projects } = buildCareer(ctx);
    expect(ctx.db.select().from(schema.projectDependency).all()).toHaveLength(0);
    migrateDependencies(ctx, { dryRun: false });
    const id = (t: string) => projects.get(t)!;
    expect(depsOf(ctx, id('Refonte du CV'))).toEqual([id('Plan, Profil & ADR')]);
    expect(depsOf(ctx, id('ADR Novembre'))).toEqual([id('Refonte du CV')]);
    expect(depsOf(ctx, id('Plan, Profil & ADR'))).toEqual([]);
    expect(depsOf(ctx, id('Formation LangGraph'))).toEqual([]);
    expect(depsOf(ctx, id('Premier RAG'))).toEqual([]);
    const journal = ctx.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'dependency_add'))
      .all();
    expect(journal).toHaveLength(2);
    expect(journal.every((r) => r.actor === 'system:migration')).toBe(true);
  });

  it('CA-02 migration is idempotent and dryRun writes nothing', () => {
    const ctx = makeCtx();
    buildCareer(ctx);
    const edges = () => ctx.db.select().from(schema.projectDependency).all().length;
    const audits = auditCount(ctx);
    const dry = migrateDependencies(ctx, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.created).toHaveLength(2);
    expect(edges()).toBe(0);
    expect(auditCount(ctx)).toBe(audits);
    const first = migrateDependencies(ctx, { dryRun: false });
    expect(first.created).toHaveLength(2);
    expect(edges()).toBe(2);
    const second = migrateDependencies(ctx, { dryRun: false });
    expect(second).toMatchObject({ alreadyDone: true });
    expect(second.created).toEqual([]);
    expect(edges()).toBe(2);
  });

  it('CA-03 a project created in an objective follows the last open non-free one; free: none', () => {
    const ctx = makeCtx();
    const o = createObjective(ctx, { title: 'Obj', deadline: '2026-12-20' });
    const g = group(ctx);
    const a = createProject(ctx, { title: 'A', groupIds: g, objectiveId: o.id });
    expect(a.dependsOn).toEqual([]);
    const b = createProject(ctx, { title: 'B', groupIds: g, objectiveId: o.id });
    expect(b.dependsOn).toEqual([a.id]);
    const free = createProject(ctx, { title: 'Libre', groupIds: g, objectiveId: o.id, isFree: true });
    expect(free.dependsOn).toEqual([]);
    const c = createProject(ctx, { title: 'C', groupIds: g, objectiveId: o.id });
    expect(c.dependsOn).toEqual([b.id]); // the free one is skipped
    ctx.db.update(schema.project).set({ status: 'done' }).where(eq(schema.project.id, c.id)).run();
    const d = createProject(ctx, { title: 'D', groupIds: g, objectiveId: o.id });
    expect(d.dependsOn).toEqual([b.id]); // the finished one is skipped
    const e = createProject(ctx, { title: 'E', groupIds: g, objectiveId: o.id, dependsOn: [a.id] });
    expect(e.dependsOn).toEqual([a.id]); // explicit wins
  });

  it('CA-04 a loop is DEPENDENCY_CYCLE, a self-dependency DEPENDENCY_SELF', () => {
    const ctx = makeCtx();
    const a = mk(ctx, 'A');
    const b = mk(ctx, 'B');
    setProjectDependencies(ctx, a.id, [b.id]); // A → B
    expect(errCode(() => setProjectDependencies(ctx, b.id, [a.id]))).toBe('DEPENDENCY_CYCLE');
    expect(errCode(() => addProjectDependency(ctx, b.id, a.id))).toBe('DEPENDENCY_CYCLE');
    expect(errCode(() => setProjectDependencies(ctx, a.id, [a.id]))).toBe('DEPENDENCY_SELF');
    expect(depsOf(ctx, b.id)).toEqual([]);
  });

  it('CA-05 a project whose prerequisite has remaining tasks can become project of the month (waitingOn)', () => {
    const ctx = makeCtx();
    const pre = activeProject(ctx, 'Prérequis', 3).project;
    const next = readyProject(ctx, 'Suite', 2, { dependsOn: [pre.id] }).project;
    const res = setProjectMonth(ctx, next.id, MONTH);
    expect(res.status).toBe('active');
    expect(res.waitingOn).toEqual([pre.id]);
  });

  it('CA-06 tasks of a waiting project join the week plan; the 2nd task of a sequential project stays locked', () => {
    const ctx = makeCtx();
    const pre = activeProject(ctx, 'Prérequis', 3).project;
    const next = activeProject(ctx, 'Suite', 3, { dependsOn: [pre.id], sequenceMode: 'sequential' });
    expect(getProject(ctx, next.project.id).waitingOn).toEqual([pre.id]);
    expect(
      errCode(() => setWeekItems(ctx, '2026-W44', [{ taskId: next.tasks[0].id, kind: 'week' }])),
    ).toBeNull();
    expect(errCode(() => setWeekItems(ctx, '2026-W45', [{ taskId: next.tasks[1].id, kind: 'week' }]))).toBe(
      'TASK_LOCKED',
    );
  });

  it('CA-07 the engine ranks the prerequisite tasks before the waiting project, with a why', () => {
    const ctx = makeCtx();
    const pre = activeProject(ctx, 'Prérequis', 2);
    const next = activeProject(ctx, 'Suite', 2, { dependsOn: [pre.project.id] });
    const scored = scoreCandidates(buildEngineInput(ctx, '2026-W44'));
    const rank = (id: string) => scored.findIndex((s) => s.taskId === id);
    expect(rank(pre.tasks[0].id)).toBeGreaterThanOrEqual(0);
    expect(rank(next.tasks[0].id)).toBeGreaterThanOrEqual(0);
    expect(rank(pre.tasks[0].id)).toBeLessThan(rank(next.tasks[0].id));
    const why = scored.find((s) => s.taskId === next.tasks[0].id)!.why;
    expect(why).toContain('Attend');
    expect(why).toContain('Prérequis');
    expect(scored.find((s) => s.taskId === pre.tasks[0].id)!.why).not.toContain('Attend');
  });

  it('CA-08 abandoning X releases the projects waiting for it (journal + DEP_RELEASED); pausing keeps them', () => {
    const ctx = makeCtx();
    const o = createObjective(ctx, { title: 'Obj', deadline: '2026-12-20' });
    const x = mk(ctx, 'X', { objectiveId: o.id });
    const y = mk(ctx, 'Y', { objectiveId: o.id, dependsOn: [x.id] });
    const z = readyProject(ctx, 'Z', 1, { objectiveId: o.id }).project;
    const w = mk(ctx, 'W', { objectiveId: o.id, dependsOn: [z.id] });
    updateProject(ctx, z.id, { status: 'paused' });
    expect(depsOf(ctx, w.id)).toEqual([z.id]);
    expect(getProject(ctx, w.id).waitingOn).toEqual([z.id]);
    updateProject(ctx, x.id, { status: 'abandoned' });
    expect(depsOf(ctx, y.id)).toEqual([]);
    const released = ctx.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'dependency_release'))
      .all();
    expect(released.map((r) => r.entityId)).toEqual([y.id]);
    const alerts = getPlanGraph(ctx).alerts.filter((a) => a.code === 'DEP_RELEASED');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].target).toEqual({ type: 'project', id: y.id });
  });

  it('CA-09 an unfinished monthly project is closed without carry-over; the new occurrence has no dependency', () => {
    const ctx = makeCtx();
    const o = createObjective(ctx, { title: 'Obj', deadline: '2026-12-20' });
    const before = mk(ctx, 'Avant', { objectiveId: o.id });
    const rec = activeProject(ctx, 'Revue', 2, {
      objectiveId: o.id,
      dependsOn: [before.id],
      recurrence: 'monthly',
    }).project;
    const after = mk(ctx, 'Après', { objectiveId: o.id, dependsOn: [rec.id] });
    ctx.setNow('2026-11-01T08:00:00.000Z');
    rollMonth(ctx, '2026-11');
    const old = getProject(ctx, rec.id);
    expect(old.status).toBe('done');
    expect(old.success).toBe(false);
    const next = ctx.db.select().from(schema.project).where(eq(schema.project.previousId, rec.id)).get()!;
    expect(next).toBeTruthy();
    expect(next.title).toBe('Revue');
    expect(next.status).not.toBe('done');
    expect(depsOf(ctx, next.id)).toEqual([]);
    const pointingAtNext = ctx.db
      .select()
      .from(schema.projectDependency)
      .where(eq(schema.projectDependency.dependsOnProjectId, next.id))
      .all();
    expect(pointingAtNext).toEqual([]);
    expect(depsOf(ctx, after.id)).toEqual([rec.id]); // history kept on the closed occurrence
    rollMonth(ctx, '2026-11'); // idempotent: no second occurrence
    expect(
      ctx.db.select().from(schema.project).where(eq(schema.project.previousId, rec.id)).all(),
    ).toHaveLength(1);
  });

  it('CA-10 a recurring quarterly objective at 3 / 5 is closed partial; the next starts at 0 / 5', () => {
    const ctx = makeCtx();
    const o = createObjective(ctx, {
      title: 'Activités Famille',
      deadline: '2026-12-20',
      smartIndicator: 'Sorties',
      smartTarget: '5',
      smartCurrent: '3',
      recurrence: 'quarterly',
    });
    expect(closeRecurringObjectives(ctx, '2026-Q4')).toBe(0); // quarter not over yet
    expect(closeRecurringObjectives(ctx, '2027-Q1')).toBe(1);
    expect(getObjective(ctx, o.id).status).toBe('partial');
    const next = ctx.db.select().from(schema.objective).where(eq(schema.objective.previousId, o.id)).get()!;
    expect(next.quarter).toBe('2027-Q1');
    expect(next.smartCurrent).toBe('0');
    expect(next.smartTarget).toBe('5');
    expect(next.status).toBe('active');
  });

  it('CA-11 the plan graph carries everything to draw Carrière T4 2026 → T4 2027, with meta titles', () => {
    const ctx = makeCtx();
    const { meta, objectives, projects } = buildCareer(ctx);
    migrateDependencies(ctx, { dryRun: false });
    const g = getPlanGraph(ctx, { domainIds: lookups(ctx).domain('Carrière').id, includeReserve: 'true' });
    expect(g.quarters).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3', '2027-Q4']);
    expect(g.capacity.map((c) => c.quarter)).toEqual(g.quarters);
    expect(g.version).toBeTruthy();
    const m = g.metas.find((x) => x.id === meta.id)!;
    expect(m.title).toBe('Employabilité');
    expect(m.outcomeTitle).toBe(career.metaObjectif.outcomeTitlePropose);
    expect(m.objectiveCount).toBe(2);
    expect(g.objectives.map((o) => o.title).sort()).toEqual(career.objectifs.map((o) => o.title).sort());
    const fond = g.objectives.find((o) => o.id === objectives.get(career.objectifs[0].id))!;
    expect(fond).toMatchObject({
      quarter: '2026-Q4',
      deadline: '2026-12-31',
      metaObjectiveId: meta.id,
      outcomeTitle: career.objectifs[0].outcomeTitlePropose,
    });
    const vitrine = g.objectives.find((o) => o.title === '2 Projets Vitrine & ADR')!;
    expect(vitrine.quarter).toBe('2027-Q1');
    expect(vitrine.deadline).toBe('2027-03-31');
    expect(g.projects).toHaveLength(career.projetsDansObjectifs.length);
    const cv = g.projects.find((p) => p.title === 'Refonte du CV')!;
    expect(cv.dependsOn).toEqual([projects.get('Plan, Profil & ADR')]);
    expect(cv.waitingOn).toEqual([projects.get('Plan, Profil & ADR')]);
    expect(Array.isArray(g.alerts)).toBe(true);
    expect(g.reserve).not.toBeNull();
  });

  it('CA-14 a quarter load counts every domain whatever the filter, and excludes experiences', () => {
    const ctx = makeCtx();
    const o = createObjective(ctx, { title: 'Obj', deadline: '2026-12-20' });
    const sante = mk(ctx, 'Santé', { objectiveId: o.id });
    const maison = mk(ctx, 'Maison', { objectiveId: o.id, groupIds: group(ctx, 'Travaux') });
    expect(sante.domainIds[0]).not.toBe(maison.domainIds[0]);
    createTask(ctx, { projectId: sante.id, title: 's1', durationMin: 60 });
    createTask(ctx, { projectId: maison.id, title: 'm1', durationMin: 120 });
    createTask(ctx, { projectId: maison.id, title: 'exp', durationMin: 120, isExperience: true });
    const load = (domainIds?: string) =>
      getPlanGraph(ctx, { domainIds }).capacity.find((c) => c.quarter === '2026-Q4')!.loadMin;
    expect(load()).toBe(180);
    expect(load(sante.domainIds[0])).toBe(180);
    expect(load(maison.domainIds[0])).toBe(180);
  });

  it('CA-15 QUARTER_OVER, PATH_TOO_LONG and DEP_AFTER appear and never block a write', () => {
    const ctx = makeCtx();
    const q4 = createObjective(ctx, { title: 'Q4', deadline: '2026-12-20' });
    const q1 = createObjective(ctx, { title: 'Q1', deadline: '2027-02-20' });
    const codes = () => getPlanGraph(ctx).alerts.map((a) => a.code);
    expect(codes()).not.toContain('QUARTER_OVER');
    expect(codes()).not.toContain('PATH_TOO_LONG');
    // 4 chained projects for 3 months left (Oct, Nov, Dec)
    const chain: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = createProject(ctx, { title: `P${i}`, groupIds: group(ctx), objectiveId: q4.id });
      chain.push(p.id);
    }
    expect(depsOf(ctx, chain[3])).toEqual([chain[2]]);
    const long = getPlanGraph(ctx);
    expect(long.alerts.find((a) => a.code === 'PATH_TOO_LONG')?.target).toEqual({
      type: 'objective',
      id: q4.id,
    });
    expect(long.objectives.find((o) => o.id === q4.id)).toMatchObject({ pathMonths: 4, monthsLeft: 3 });
    // QUARTER_OVER: far more work than the budget of the quarter
    for (let i = 0; i < 40; i++)
      createTask(ctx, { projectId: chain[0], title: `Gros ${i}`, durationMin: 120 });
    const over = getPlanGraph(ctx);
    expect(over.alerts.find((a) => a.code === 'QUARTER_OVER')?.target).toEqual({
      type: 'quarter',
      id: '2026-Q4',
    });
    expect(over.capacity.find((c) => c.quarter === '2026-Q4')!.overMin).toBeGreaterThan(0);
    // DEP_AFTER: a Q4 project waits for a Q1 one
    const later = createProject(ctx, {
      title: 'Plus tard',
      groupIds: group(ctx),
      objectiveId: q1.id,
      dependsOn: [],
    });
    expect(() => setProjectDependencies(ctx, chain[0], [later.id])).not.toThrow();
    expect(depsOf(ctx, chain[0])).toEqual([later.id]);
    const after = getPlanGraph(ctx).alerts.find((a) => a.code === 'DEP_AFTER');
    expect(after?.target).toEqual({ type: 'project', id: chain[0] });
  });
});
