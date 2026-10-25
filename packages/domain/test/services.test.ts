import { eq, openDb, runMigrations, schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import type { DomainError } from '../src/errors.ts';
import {
  addExperienceIdea,
  addProjectDependency,
  addTaskDependency,
  aiStatus,
  buildEngineInput,
  closeWeek,
  completeProject,
  completeTask,
  createGroup,
  createMetaObjective,
  createObjective,
  createProject,
  createTask,
  deleteMetaObjective,
  deleteObjective,
  deleteProject,
  deleteTask,
  generateReport,
  getExecution,
  getExperiencesPage,
  getMonthPlanningPage,
  getObjective,
  getObjectivesMap,
  getPlanningPage,
  getProject,
  getProjectReadiness,
  getQuarterPlanningPage,
  getSettings,
  listBoardTasks,
  listChanges,
  listDomains,
  listInbox,
  listObjectives,
  listProjectDependencies,
  listProjects,
  listTasks,
  markReviewed,
  parseJsonObject,
  patchSettings,
  promoteProject,
  propose,
  proposeWeek,
  proposeWithAi,
  purgeData,
  reorderTasks,
  replanProject,
  rollMonth,
  scoreCandidates,
  search,
  seed,
  setObjectiveQuarter,
  setProjectGroups,
  setProjectMonth,
  setTaskInCurrentWeek,
  setWeekItems,
  tx,
  updateGroup,
  updateObjective,
  updateProject,
  updateTask,
  validateWeek,
} from '../src/index.ts';
import { monthOf, parisDate } from '../src/time.ts';
import { lookups, makeCtx } from './helpers.ts';

const errCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code ?? (e as Error).name;
  }
  return null;
};

/** An active project with n tasks of 60 min. */
function activeProject(
  ctx: ReturnType<typeof makeCtx>,
  title: string,
  groupName: string,
  n = 3,
  extra: Record<string, unknown> = {},
) {
  const { group } = lookups(ctx);
  const p = createProject(ctx, {
    title,
    groupIds: [group(groupName).id],
    successCriterion: 'Fait',
    startDate: '2026-10-20',
    dueDate: '2026-11-15',
    ...extra,
  });
  const tasks = Array.from({ length: n }, (_, i) =>
    createTask(ctx, { projectId: p.id, title: `${title} ${i + 1}`, durationMin: 60 }),
  );
  promoteProject(ctx, p.id);
  setProjectMonth(ctx, p.id, monthOf(parisDate(ctx.now!()))); // D-42: actif = projet du mois
  return { project: getProject(ctx, p.id), tasks };
}

describe('L0 socle', () => {
  it('migrations replay on an existing database and seed is idempotent with 8 ordered domains', () => {
    const { db, sqlite } = openDb(':memory:');
    runMigrations(db);
    runMigrations(db);
    const ctx = { db, sqlite, actor: 'me' as const };
    seed(ctx);
    seed(ctx);
    expect(listDomains(ctx).map((d) => d.name)).toEqual([
      'Santé',
      'Famille',
      'Carrière',
      'Patrimoine',
      'Sécurité',
      'Maison',
      'Amis & Social',
      'Loisirs & Découverte',
    ]);
    expect(listDomains(ctx).map((d) => d.priorityRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('RB-15 settings patch is audited; a failing mutation leaves no audit row', () => {
    const ctx = makeCtx();
    patchSettings(ctx, { 'budget.weekly_min': 420 });
    expect(getSettings(ctx)['budget.weekly_min']).toBe(420);
    const count = () => ctx.db.select().from(schema.auditLog).all().length;
    const before = count();
    expect(
      errCode(() =>
        tx(ctx, () => {
          createGroup(ctx, { name: 'Temp', domainId: listDomains(ctx)[0].id });
          throw new Error('boom');
        }),
      ),
    ).toBe('Error');
    expect(count()).toBe(before);
    expect(
      ctx.db
        .select()
        .from(schema.group)
        .all()
        .some((g) => g.name === 'Temp'),
    ).toBe(false);
  });
});

describe('D-64 seed au démarrage', () => {
  it('never recreates a renamed domain or a deleted group (UNIQUE priority_rank crash in prod)', () => {
    const ctx = makeCtx();
    const d = lookups(ctx).domain('Amis & Social');
    ctx.db.update(schema.domain).set({ name: 'Amis' }).where(eq(schema.domain.id, d.id)).run();
    const sante = lookups(ctx).domain('Santé');
    ctx.db.update(schema.domain).set({ description: '' }).where(eq(schema.domain.id, sante.id)).run();
    const before = ctx.db.select().from(schema.group).all().length;
    const g = ctx.db.select().from(schema.group).all()[0];
    ctx.db.delete(schema.group).where(eq(schema.group.id, g.id)).run();
    expect(() => seed(ctx)).not.toThrow();
    expect(ctx.db.select().from(schema.domain).all()).toHaveLength(8);
    expect(ctx.db.select().from(schema.group).all()).toHaveLength(before - 1);
    expect(lookups(ctx).domain('Santé').description).toBe(''); // configuration is never rewritten
  });
});

describe('L1 référentiel', () => {
  it('RB-01 + D-04: an idea needs a title and a group, nothing else', () => {
    const ctx = makeCtx();
    const { group } = lookups(ctx);
    const idea = createProject(ctx, { title: 'Monter un NAS', groupIds: [group('Labo Tech').id] });
    expect(idea.status).toBe('idea');
    expect(idea.domainIds).toHaveLength(1);
  });

  it('D-42: promoting an incomplete idea gives a « prêt » project flagged with its RB-02 gaps', () => {
    const ctx = makeCtx();
    const { group } = lookups(ctx);
    const idea = createProject(ctx, { title: 'Clim', groupIds: [group('Travaux').id] });
    const ready = promoteProject(ctx, idea.id);
    expect(ready.status).toBe('ready');
    expect(ready.gaps).toEqual(['SUCCESS_CRITERION_MISSING', 'TASK_MISSING']);
    try {
      setProjectMonth(ctx, idea.id, '2026-10');
      throw new Error('should fail');
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe('MONTH_PROJECT_INCOMPLETE');
      expect((err.details as { code: string }[]).map((d) => d.code)).toEqual([
        'SUCCESS_CRITERION_MISSING',
        'TASK_MISSING',
      ]);
    }
  });

  it('D-42: month projects are « actif »; later months stay « prêt » until the month roll', () => {
    const ctx = makeCtx(); // October 2026
    const { project } = activeProject(ctx, 'PV', 'Travaux');
    expect(project.status).toBe('active');
    expect(project.monthFlag).toBe('2026-10');
    expect(updateProject(ctx, project.id, { dueDate: '2027-03-31' }).status).toBe('active'); // no 31-day cap
    const { project: next } = activeProject(ctx, 'Combles', 'Travaux');
    expect(setProjectMonth(ctx, next.id, '2026-11')).toMatchObject({ status: 'ready', monthFlag: '2026-11' });
    expect(errCode(() => setProjectMonth(ctx, next.id, '2026-09'))).toBe('MONTH_IN_PAST');
    ctx.setNow('2026-11-01T08:00:00.000Z');
    expect(rollMonth(ctx, '2026-11')).toEqual({ backToReady: 1, activated: 1 });
    expect(getProject(ctx, project.id)).toMatchObject({
      status: 'ready',
      monthFlag: null,
      previousMonthFlag: '2026-10',
    });
    expect(getProject(ctx, next.id).status).toBe('active');
    expect(rollMonth(ctx, '2026-11')).toEqual({ backToReady: 0, activated: 0 });
    expect(setProjectMonth(ctx, next.id, null).status).toBe('ready');
  });

  it('RB-03: tasks longer than 2 h are refused', () => {
    const ctx = makeCtx();
    expect(errCode(() => createTask(ctx, { title: 'Gros truc', durationMin: 240 }))).toBe('TASK_TOO_LONG');
  });

  it('RB-04 / RB-13: domains follow groups, primary defaults to highest priority, change is journaled', () => {
    const ctx = makeCtx();
    const { group, domain } = lookups(ctx);
    const p = createProject(ctx, {
      title: 'Photovoltaïque',
      groupIds: [group('Travaux').id, group('Résilience').id],
    });
    expect(p.domainIds).toEqual([domain('Sécurité').id, domain('Maison').id]);
    const p2 = setProjectGroups(
      ctx,
      p.id,
      [group('Travaux').id, group('Résilience').id],
      domain('Maison').id,
    );
    expect(p2.primaryDomainId).toBe(domain('Maison').id);
    expect(
      ctx.db
        .select()
        .from(schema.auditLog)
        .all()
        .some((a) => a.action === 'domain_change' && a.entityId === p.id),
    ).toBe(true);
    // A group moving to another domain recomputes its projects.
    updateGroup(ctx, group('Résilience').id, { domainId: domain('Santé').id });
    expect(getProject(ctx, p.id).domainIds).toContain(domain('Santé').id);
  });

  it('RB-05: objective deadline within its quarter', () => {
    const ctx = makeCtx();
    expect(createObjective(ctx, { title: 'POC IA', deadline: '2026-12-20' }).quarter).toBe('2026-Q4');
    expect(
      errCode(() => createObjective(ctx, { title: 'X', deadline: '2027-01-10', quarter: '2026-Q4' })),
    ).toBe('DEADLINE_AFTER_QUARTER');
  });

  it('RB-06: reordering changes availability', () => {
    const ctx = makeCtx();
    const { project, tasks } = activeProject(ctx, 'Sport', 'Sport');
    const locked = () =>
      listTasks(ctx, { projectId: project.id })
        .filter((t) => !t.locked)
        .map((t) => t.title);
    expect(locked()).toEqual(['Sport 1']);
    reorderTasks(ctx, project.id, [tasks[2].id, tasks[0].id, tasks[1].id]);
    expect(locked()).toEqual(['Sport 3']);
    updateTask(ctx, tasks[1].id, { isFree: true });
    expect(locked().sort()).toEqual(['Sport 2', 'Sport 3']);
  });

  it('RB-07: task and project dependency cycles are refused', () => {
    const ctx = makeCtx();
    const a = createTask(ctx, { title: 'A' });
    const b = createTask(ctx, { title: 'B' });
    addTaskDependency(ctx, b.id, a.id);
    expect(errCode(() => addTaskDependency(ctx, a.id, b.id))).toBe('DEPENDENCY_CYCLE');
    const { group } = lookups(ctx);
    const p1 = createProject(ctx, { title: 'P1', groupIds: [group('IA').id] });
    const p2 = createProject(ctx, { title: 'P2', groupIds: [group('IA').id] });
    addProjectDependency(ctx, p2.id, p1.id);
    expect(errCode(() => addProjectDependency(ctx, p1.id, p2.id))).toBe('DEPENDENCY_CYCLE');
  });

  it('RB-08 (now RB-02 at activation): a month project needs tasks, all with duration', () => {
    const ctx = makeCtx();
    const { group } = lookups(ctx);
    const idea = createProject(ctx, {
      title: 'Jardin',
      groupIds: [group('Jardin').id],
      successCriterion: 'Haie taillée',
    });
    promoteProject(ctx, idea.id);
    expect(errCode(() => setProjectMonth(ctx, idea.id, '2026-10'))).toBe('MONTH_PROJECT_INCOMPLETE');
    createTask(ctx, { projectId: idea.id, title: 'Tailler', durationMin: null });
    expect(errCode(() => setProjectMonth(ctx, idea.id, '2026-10'))).toBe('MONTH_PROJECT_INCOMPLETE');
  });

  it('RB-11: completing a recurring Inbox task creates the next occurrence', () => {
    const ctx = makeCtx();
    const t = createTask(ctx, {
      title: 'Déclaration d’impôts',
      durationMin: 120,
      dueDate: '2026-05-20',
      recurrenceRule: 'FREQ=YEARLY',
    });
    const r = completeTask(ctx, t.id);
    expect(r.next?.dueDate).toBe('2027-05-20');
    expect(r.next?.status).toBe('todo');
  });

  it('RB-12: completion needs yes/no and updates stored objective progress (D-05)', () => {
    const ctx = makeCtx();
    const o = createObjective(ctx, { title: 'Sport', deadline: '2026-12-31' });
    const { project } = activeProject(ctx, 'Escalade', 'Sport', 1, { objectiveId: o.id });
    activeProject(ctx, 'Natation', 'Sport', 1, { objectiveId: o.id });
    expect(errCode(() => completeProject(ctx, project.id, undefined))).toBe('SUCCESS_ANSWER_REQUIRED');
    completeProject(ctx, project.id, true);
    expect(getObjective(ctx, o.id).progressPct).toBe(50);
  });

  it('F-25: AI changes appear in "À revoir" with their author, and disappear once reviewed', () => {
    const ctx = makeCtx();
    const ai = ctx.as('ai:claude');
    const t = createTask(ai, { title: 'Créée par l’IA' });
    const changes = listChanges(ctx, { actor: 'ai' });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ actor: 'ai:claude', entityId: t.id, title: 'Créée par l’IA' });
    markReviewed(ctx, { ids: [changes[0].id] });
    expect(listChanges(ctx, { actor: 'ai' })).toHaveLength(0);
  });

  it('search ranks titles and tolerates accents', () => {
    const ctx = makeCtx();
    const { group } = lookups(ctx);
    createProject(ctx, { title: 'Sécuriser le réseau', groupIds: [group('Sécu digitale').id] });
    createTask(ctx, { title: 'Appeler le notaire' });
    const r = search(ctx, 'securiser');
    expect(r.idea[0].title).toBe('Sécuriser le réseau');
    expect(search(ctx, 'notaire').inbox[0].title).toBe('Appeler le notaire');
  });
});

describe('L3 planification', () => {
  function world() {
    const ctx = makeCtx('2026-10-30T08:00:00.000Z'); // Friday of W44, planning W45
    const { project: pv } = activeProject(ctx, 'Panneaux', 'Travaux', 3);
    setProjectMonth(ctx, pv.id, '2026-11');
    const { project: ia } = activeProject(ctx, 'POC RAG', 'IA', 3);
    activeProject(ctx, 'Firewall', 'Sécu digitale', 2);
    const inbox = createTask(ctx, {
      title: 'Renouveler l’assurance',
      durationMin: 30,
      dueDate: '2026-11-05',
    });
    return { ctx, pv, ia, inbox };
  }

  it('same data = same proposal (Q-25)', () => {
    const { ctx } = world();
    const a = propose(buildEngineInput(ctx, '2026-W45'));
    const b = propose(buildEngineInput(ctx, '2026-W45'));
    expect(a).toEqual(b);
  });

  it('builds the 3 bins in order, pre-checks only mandatory tasks, reveals the next task when chosen', () => {
    const { ctx, pv, inbox } = world();
    const page = proposeWeek(ctx, '2026-W45');
    expect(page.groups.map((g) => g.name)).toEqual(['Inbox', 'Projets du mois', 'À considérer aussi']);
    const inboxRow = page.groups[0].cards[0].tasks.find((t) => t.taskId === inbox.id)!;
    expect(inboxRow.selection).toBe('week');
    expect(inboxRow.why).toMatch(/Deadline jeudi/);
    const pvCard = page.groups[1].cards.find((c) => c.projectId === pv.id)!;
    const visible = pvCard.tasks.length;
    // Engine suggestion placed in Bonus counts as chosen, so the next task is revealed and unlocked (V-16).
    expect(pvCard.tasks[0].selection).toBe('bonus');
    expect(pvCard.tasks.at(-1)?.selection).toBeNull();
    const chosen = pvCard.tasks.map((t) => ({ taskId: t.taskId, kind: 'week' as const }));
    const after = setWeekItems(ctx, '2026-W45', [{ taskId: inbox.id, kind: 'week' }, ...chosen]);
    const pvAfter = after.groups[1].cards.find((c) => c.projectId === pv.id)!;
    expect(pvAfter.tasks.length).toBe(Math.min(visible + 1, 3));
  });

  it('D-37: Inbox shows 3 tasks by closest deadline and warns about a hidden deadline of the week', () => {
    const ctx = makeCtx('2026-10-30T08:00:00.000Z'); // planning W45 (2–8 Nov)
    for (const [i, due] of ['2026-11-06', '2026-11-03', '2026-11-20', '2026-11-04', '2026-11-05'].entries())
      createTask(ctx, { title: `Inbox ${i}`, durationMin: 30, dueDate: due });
    const inbox = () => getPlanningPage(ctx, '2026-W45').groups.find((g) => g.key === 'inbox')!.cards[0];
    let c = inbox();
    expect(c.tasks.map((t) => t.title)).toEqual(['Inbox 1', 'Inbox 3', 'Inbox 4']);
    expect(c.hiddenTasks.map((t) => t.title)).toEqual(['Inbox 0', 'Inbox 2']);
    expect(c.hiddenDueCount).toBe(1);
    proposeWeek(ctx, '2026-W45'); // mandatory deadlines are pre-checked, so they stay visible
    c = inbox();
    expect(c.tasks).toHaveLength(4);
    expect(c.hiddenDueCount).toBe(0);
  });

  it('objectives map: lanes by meta-objective, quarters, ordered paths without abandoned projects', () => {
    const ctx = makeCtx();
    const meta = createMetaObjective(ctx, { title: 'Autonomie' });
    const q4 = createObjective(ctx, { title: 'Q4', deadline: '2026-12-20', metaObjectiveId: meta.id });
    const q1 = createObjective(ctx, { title: 'Q1', deadline: '2027-02-20', metaObjectiveId: meta.id });
    createObjective(ctx, { title: 'Libre', deadline: '2026-12-01' });
    const g = [lookups(ctx).group('Travaux').id];
    const a = createProject(ctx, { title: 'A', groupIds: g, objectiveId: q4.id });
    createProject(ctx, { title: 'B', groupIds: g, objectiveId: q4.id });
    updateProject(ctx, a.id, { status: 'abandoned' });
    const map = getObjectivesMap(ctx);
    expect(map.quarters).toEqual(['2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3']); // rolling year
    expect(map.lanes.map((l) => l.meta?.title ?? null)).toEqual(['Autonomie', null]);
    expect(map.lanes[0].objectives.map((o) => o.id)).toEqual([q4.id, q1.id]);
    expect(map.lanes[0].objectives[0].path.map((p) => p.title)).toEqual(['B']);
  });

  it('RB-02 readiness checklist lists what an idea still needs', () => {
    const ctx = makeCtx();
    const idea = createProject(ctx, { title: 'PV', groupIds: [lookups(ctx).group('Travaux').id] });
    const missing = (id: string) =>
      getProjectReadiness(ctx, id)
        .filter((r) => !r.ok)
        .map((r) => r.code);
    expect(missing(idea.id)).toEqual(['SUCCESS_CRITERION_MISSING', 'TASK_MISSING', 'TASK_DURATION_MISSING']);
    const { project } = activeProject(ctx, 'Prêt', 'Travaux', 1);
    expect(missing(project.id)).toEqual([]);
  });

  it('refuses a locked task (RB-06) and never blocks an overflow (RB-14)', () => {
    const { ctx, ia } = world();
    const tasks = listTasks(ctx, { projectId: ia.id });
    expect(errCode(() => setWeekItems(ctx, '2026-W45', [{ taskId: tasks[1].id, kind: 'week' }]))).toBe(
      'TASK_LOCKED',
    );
    const many = listTasks(ctx).filter((t) => t.status === 'todo');
    const all = [];
    for (const t of many) {
      all.push({ taskId: t.id, kind: 'week' as const });
    }
    const page = setWeekItems(ctx, '2026-W45', all);
    expect(page.budget.overMin).toBeGreaterThan(0);
    expect(page.alerts[0].code).toBe('BUDGET_OVER');
    expect(validateWeek(ctx, '2026-W45').plan?.status).toBe('validated');
  });

  it('alerts on empty Santé / Famille / no experience, and "Rien à signaler" otherwise', () => {
    const { ctx } = world();
    const page = getPlanningPage(ctx, '2026-W45');
    expect(page.alerts.map((a) => a.code)).toEqual(['EMPTY_HEALTH', 'EMPTY_FAMILY', 'NO_EXPERIENCE']);
    const sport = activeProject(ctx, 'Escalade', 'Sport', 1);
    const fam = createProject(ctx, {
      title: 'Balade',
      groupIds: [lookups(ctx).group('Sorties & activités famille').id],
      successCriterion: 'ok',
      startDate: '2026-11-01',
      dueDate: '2026-11-20',
    });
    const exp = createTask(ctx, {
      projectId: fam.id,
      title: 'Pique-nique',
      durationMin: 120,
      isExperience: true,
    });
    promoteProject(ctx, fam.id);
    const p2 = setWeekItems(ctx, '2026-W45', [
      { taskId: sport.tasks[0].id, kind: 'week' },
      { taskId: exp.id, kind: 'week' },
    ]);
    expect(p2.alerts.map((a) => a.code)).toEqual(['OK']);
    expect(p2.budget.plannedMin).toBe(60); // RB-09: experience out of budget
  });
});

describe('L4 exécution', () => {
  it('checking updates "Fait"; bonus done joins the list; RB-10 carries over and counts postponements', () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z'); // Monday W44
    const { tasks } = activeProject(ctx, 'Sport', 'Sport', 2);
    const inboxA = createTask(ctx, { title: 'Colis', durationMin: 30 });
    const inboxB = createTask(ctx, { title: 'Lire doc', durationMin: 30 });
    const exp = createTask(ctx, { title: 'Sortie vélo', durationMin: 120, isExperience: true });
    setWeekItems(ctx, '2026-W44', [
      { taskId: tasks[0].id, kind: 'week' },
      { taskId: inboxA.id, kind: 'week' },
      { taskId: exp.id, kind: 'week' },
      { taskId: inboxB.id, kind: 'bonus' },
    ]);
    let ex = getExecution(ctx, '2026-W44');
    expect(ex.budget.plannedMin).toBe(90);
    expect(ex.bonusOpen).toHaveLength(1);
    completeTask(ctx, inboxA.id);
    completeTask(ctx, exp.id);
    completeTask(ctx, inboxB.id);
    ex = getExecution(ctx, '2026-W44');
    expect(ex.doneMin).toBe(60); // 30 + bonus 30, experience excluded (RB-09)
    expect(ex.experiences.done).toBe(1);
    expect(ex.bonusOpen).toHaveLength(0);
    expect(ex.tasks.map((t) => t.title)).toEqual(['Sport 1', 'Colis', 'Sortie vélo', 'Lire doc']);
    expect(ex.tasks[3].kind).toBe('bonus');
    // End of week: the undone planned task is carried over with postpone_count + 1.
    ctx.setNow('2026-11-02T06:00:00.000Z');
    expect(closeWeek(ctx, '2026-W44').carried).toBe(1);
    expect(closeWeek(ctx, '2026-W44').carried).toBe(0);
    const next = getPlanningPage(ctx, '2026-W45');
    const row = next.groups
      .flatMap((g) => g.cards.flatMap((c) => c.tasks))
      .find((t) => t.taskId === tasks[0].id)!;
    expect(row.selection).toBe('week');
    expect(row.postponeCount).toBe(1);
  });

  it('RB-16 replan brings the month project back to the centre', () => {
    const ctx = makeCtx('2026-11-10T08:00:00.000Z');
    const { group } = lookups(ctx);
    const p = createProject(ctx, {
      title: 'PV',
      groupIds: [group('Travaux').id],
      successCriterion: 'ok',
      startDate: '2026-11-01',
      dueDate: '2026-11-30',
    });
    for (let i = 0; i < 4; i++) createTask(ctx, { projectId: p.id, title: `t${i}`, durationMin: 120 });
    promoteProject(ctx, p.id);
    setProjectMonth(ctx, p.id, '2026-11');
    const delta = () => getExecution(ctx, '2026-W46').monthProjects[0].deltaMin;
    expect(delta()).toBeLessThan(0);
    replanProject(ctx, p.id);
    expect(delta()).toBe(0);
  });
});

describe('vues Tableau / Kanban des tâches (D-33)', () => {
  it('derives columns from state; adding to the current week follows the plan rules (RB-06)', () => {
    const ctx = makeCtx(); // Friday 23 Oct 2026, W43
    const { project: pv, tasks } = activeProject(ctx, 'Panneaux', 'Travaux', 3);
    const idea = createProject(ctx, { title: 'Idée', groupIds: [lookups(ctx).group('Travaux').id] });
    createTask(ctx, { projectId: idea.id, title: 'Tâche d’idée', durationMin: 30 });
    const inbox = createTask(ctx, { title: 'Inbox', durationMin: 30 });
    const col = () => Object.fromEntries(listBoardTasks(ctx).map((t) => [t.title, t.bucket]));
    expect(col()).toEqual({
      'Panneaux 1': 'todo',
      'Panneaux 2': 'waiting',
      'Panneaux 3': 'waiting',
      Inbox: 'todo',
    });
    expect(errCode(() => setTaskInCurrentWeek(ctx, tasks[1].id, true))).toBe('TASK_LOCKED');
    expect(setTaskInCurrentWeek(ctx, tasks[0].id, true).inPlan).toBe(true);
    // Choosing the first task unlocks the next one (D-18).
    expect(col()).toMatchObject({ 'Panneaux 1': 'week', 'Panneaux 2': 'todo' });
    completeTask(ctx, inbox.id);
    expect(col().Inbox).toBe('done');
    setTaskInCurrentWeek(ctx, tasks[0].id, false);
    expect(col()['Panneaux 1']).toBe('todo');
    expect(listBoardTasks(ctx, { projectId: pv.id }).every((t) => t.colorDomainId === pv.domainIds[0])).toBe(
      true,
    );
    // Done before Monday: no longer on the board.
    ctx.setNow('2026-10-27T08:00:00.000Z');
    expect(col().Inbox).toBeUndefined();
  });
});

describe('modèles de description et suppression (D-35)', () => {
  it('applies the description template on every creation unless a description is given', () => {
    const ctx = makeCtx();
    patchSettings(ctx, {
      'templates.task': 'T',
      'templates.project': 'P',
      'templates.objective': 'O',
      'templates.meta_objective': 'M',
    });
    const g = lookups(ctx).group('Travaux').id;
    expect(createTask(ctx, { title: 'a' }).description).toBe('T');
    expect(createTask(ctx, { title: 'b', description: 'mine' }).description).toBe('mine');
    expect(createProject(ctx, { title: 'p', groupIds: [g] }).description).toBe('P');
    expect(createObjective(ctx, { title: 'o', deadline: '2026-12-20' }).description).toBe('O');
    expect(createMetaObjective(ctx, { title: 'm', description: '  ' }).description).toBe('M');
  });

  it('deletes a task, a project with its tasks, an objective and a meta-objective, journaled', () => {
    const ctx = makeCtx();
    const { project: pv, tasks } = activeProject(ctx, 'Panneaux', 'Travaux', 3);
    const { project: other } = activeProject(ctx, 'Autre', 'Travaux', 1);
    addProjectDependency(ctx, other.id, pv.id);
    setTaskInCurrentWeek(ctx, tasks[0].id, true);
    deleteTask(ctx, tasks[2].id);
    expect(listTasks(ctx, { projectId: pv.id })).toHaveLength(2);
    const meta = createMetaObjective(ctx, { title: 'Autonomie' });
    const o = createObjective(ctx, { title: 'Énergie', deadline: '2026-12-20', metaObjectiveId: meta.id });
    updateProject(ctx, pv.id, { objectiveId: o.id });
    deleteProject(ctx, pv.id);
    expect(errCode(() => getProject(ctx, pv.id))).toBe('NotFoundError');
    expect(listTasks(ctx).some((t) => t.projectId === pv.id)).toBe(false);
    expect(listProjectDependencies(ctx, other.id)).toEqual([]);
    updateProject(ctx, other.id, { objectiveId: o.id });
    deleteMetaObjective(ctx, meta.id);
    expect(getObjective(ctx, o.id).metaObjectiveId).toBeNull();
    deleteObjective(ctx, o.id);
    expect(getProject(ctx, other.id).objectiveId).toBeNull();
    const deleted = listChanges(ctx, { actor: 'me' }).filter((c) => c.action === 'delete');
    expect(deleted.map((c) => c.title).sort()).toEqual(['Autonomie', 'Panneaux', 'Panneaux 3', 'Énergie']);
  });
});

describe('D-44 Inbox', () => {
  it('moves far recurring tasks to « Plus tard » and keeps only this month’s done tasks', () => {
    const ctx = makeCtx(); // 23 Oct 2026, horizon 14 days → 6 Nov
    createTask(ctx, {
      title: 'Impôts',
      durationMin: 60,
      dueDate: '2027-05-20',
      recurrenceRule: 'FREQ=YEARLY',
    });
    createTask(ctx, { title: 'Box', durationMin: 30, dueDate: '2026-11-01', recurrenceRule: 'FREQ=MONTHLY' });
    createTask(ctx, { title: 'Courrier', durationMin: 30, dueDate: '2027-01-10' });
    const old = createTask(ctx, { title: 'Ancien', durationMin: 30 });
    ctx.setNow('2026-09-20T08:00:00.000Z');
    completeTask(ctx, old.id);
    ctx.setNow('2026-10-23T08:00:00.000Z');
    const inbox = listInbox(ctx);
    expect(inbox.open.map((t) => t.title)).toEqual(['Box', 'Courrier']);
    expect(inbox.later.map((t) => t.title)).toEqual(['Impôts']);
    expect(inbox.doneThisMonth).toEqual([]);
  });
});

describe('D-43 Planifier le mois', () => {
  it('capacity from weekly budgets, chosen projects, backlog candidates, quarter objectives', () => {
    const ctx = makeCtx(); // Friday 23 Oct 2026
    const o = createObjective(ctx, { title: 'Énergie', deadline: '2026-12-20' });
    const { project: pv } = activeProject(ctx, 'PV', 'Travaux', 3, { objectiveId: o.id }); // 3 h, month of Oct
    const { project: backlog } = activeProject(ctx, 'Combles', 'Travaux', 2);
    setProjectMonth(ctx, backlog.id, null);
    createTask(ctx, { title: 'Assurance', durationMin: 30, dueDate: '2026-11-10' });
    const page = getMonthPlanningPage(ctx, '2026-11');
    // November 2026: W44 (1 day), W45–W48 (7 days each), W49 (1 day, Monday 30) → 30 days × 6 h / 7.
    expect(page.budget.capacityMin).toBe(Math.round(360 / 7) * 2 + 360 * 4);
    expect(page.chosen).toEqual([]);
    expect(page.candidates.map((c) => c.title)).toEqual(['Combles']);
    expect(page.budget.inboxReserveMin).toBe(30);
    expect(page.alerts.map((a) => a.code)).toContain('OBJECTIVE_EMPTY');
    setProjectMonth(ctx, backlog.id, '2026-11');
    const after = getMonthPlanningPage(ctx, '2026-11');
    expect(after.chosen.map((c) => [c.title, c.remainingMin])).toEqual([['Combles', 120]]);
    expect(after.budget.neededMin).toBe(150);
    expect(getMonthPlanningPage(ctx, '2026-10').chosen.map((c) => c.id)).toEqual([pv.id]);
  });
});

describe('D-48 Planifier le trimestre', () => {
  it('quarter objectives with remaining work, pull-in of other objectives, alerts', () => {
    const ctx = makeCtx(); // 23 Oct 2026, Q4
    const meta = createMetaObjective(ctx, { title: 'Autonomie' });
    const q4 = createObjective(ctx, { title: 'Facture', deadline: '2026-12-20', metaObjectiveId: meta.id });
    activeProject(ctx, 'PV', 'Travaux', 3, { objectiveId: q4.id });
    const q1 = createObjective(ctx, { title: 'Batterie', deadline: '2027-02-15' });
    createProject(ctx, {
      title: 'Choisir',
      groupIds: [lookups(ctx).group('Travaux').id],
      objectiveId: q1.id,
    });
    let page = getQuarterPlanningPage(ctx, '2026-Q4');
    expect(page.chosen.map((o) => [o.title, o.remainingMin])).toEqual([['Facture', 180]]);
    expect(page.candidates.map((o) => o.title)).toEqual(['Batterie']);
    expect(page.metas).toEqual([expect.objectContaining({ title: 'Autonomie', objectives: 1 })]);
    expect(setObjectiveQuarter(ctx, q1.id, '2026-Q4').deadline).toBe('2026-12-31');
    page = getQuarterPlanningPage(ctx, '2026-Q4');
    expect(page.chosen.find((o) => o.title === 'Batterie')!.unknownSize).toBe(1);
    expect(page.alerts.map((a) => a.code)).toContain('UNKNOWN_SIZE');
  });
});

describe('D-53 importance d’un projet', () => {
  it('multiplies the value: same domain, « haute » ranks above « basse »', () => {
    const ctx = makeCtx('2026-10-30T08:00:00.000Z');
    const { project: low, tasks: lt } = activeProject(ctx, 'Bas', 'Travaux', 1, { importance: 'low' });
    const { project: high, tasks: ht } = activeProject(ctx, 'Haut', 'Travaux', 1, { importance: 'high' });
    expect(getProject(ctx, low.id).importance).toBe('low');
    const scores = new Map(
      scoreCandidates(buildEngineInput(ctx, '2026-W45')).map((s) => [s.taskId, s.parts.V]),
    );
    expect(scores.get(ht[0].id)! / scores.get(lt[0].id)!).toBeCloseTo(3);
    updateProject(ctx, high.id, { importance: 'normal' });
    const after = new Map(
      scoreCandidates(buildEngineInput(ctx, '2026-W45')).map((s) => [s.taskId, s.parts.V]),
    );
    expect(after.get(ht[0].id)! / after.get(lt[0].id)!).toBeCloseTo(2);
  });
});

describe('D-54 Expériences', () => {
  it('target over the window, memories, planned and reserve', () => {
    const ctx = makeCtx(); // Friday 23 Oct 2026, W43; window 4 weeks from Monday 28 Sep
    const old = createTask(ctx, { title: 'Escalade', durationMin: 120, isExperience: true });
    ctx.setNow('2026-09-10T08:00:00.000Z');
    completeTask(ctx, old.id);
    ctx.setNow('2026-10-23T08:00:00.000Z');
    const recent = createTask(ctx, { title: 'Concert', durationMin: 120, isExperience: true });
    completeTask(ctx, recent.id);
    createTask(ctx, { title: 'Parapente', durationMin: 120, isExperience: true, dueDate: '2026-11-07' });
    const idea = addExperienceIdea(ctx, { title: 'Plongée' });
    expect(idea.isExperience).toBe(true);
    const page = getExperiencesPage(ctx);
    expect(page.doneInWindow).toBe(1);
    expect(page.lived.map((t) => t.title)).toEqual(['Concert', 'Escalade']);
    expect(page.planned.map((t) => t.title)).toEqual(['Parapente']);
    expect(page.reserve.map((t) => t.title)).toEqual(['Plongée']);
    expect(page.months.at(-1)).toEqual({ month: '2026-10', count: 1 });
  });
});

describe('L5 rapports', () => {
  it('a weekly report is frozen: changing a task afterwards does not change it', () => {
    const ctx = makeCtx('2026-10-21T08:00:00.000Z'); // W43
    const t = createTask(ctx, { title: 'Colis', durationMin: 30 });
    setWeekItems(ctx, '2026-W43', [{ taskId: t.id, kind: 'week' }]);
    completeTask(ctx, t.id);
    ctx.setNow('2026-10-26T06:00:00.000Z');
    const { report, created } = generateReport(ctx, 'week', '2026-W43');
    expect(created).toBe(true);
    const payload = report.payload as {
      tasksDone: { count: number };
      rhythm: { doneMin: number };
      global: { light: string };
    };
    expect(payload.tasksDone.count).toBe(1);
    expect(payload.global.light).toBe('red');
    updateTask(ctx, t.id, { durationMin: 120 });
    const again = generateReport(ctx, 'week', '2026-W43');
    expect(again.created).toBe(false);
    expect((again.report.payload as typeof payload).rhythm.doneMin).toBe(30);
  });
});

describe('worker jobs (WF-01 to WF-03)', () => {
  it('runs Monday jobs once at 07:00 Paris, with catch-up and idempotence', async () => {
    const { runDueJobs } = await import('../src/services/jobs.ts');
    const ctx = makeCtx('2026-11-02T05:30:00.000Z'); // Monday 06:30 Paris (CET)
    const early = runDueJobs(ctx);
    expect(early.week).toBeUndefined(); // not before 07:00
    expect(early.month).toBe('done'); // 2nd of the month: catch-up of the October report
    ctx.setNow('2026-11-02T06:05:00.000Z'); // 07:05 Paris
    const r = runDueJobs(ctx);
    expect(r.week).toBe('done');
    expect(r.month).toBe('skipped');
    expect(runDueJobs(ctx).week).toBe('skipped');
    expect(getPlanningPage(ctx, '2026-W45').plan?.proposedAt).toBeTruthy();
    expect(
      ctx.db
        .select()
        .from(schema.report)
        .all()
        .map((x) => `${x.kind}:${x.periodKey}`)
        .sort(),
    ).toEqual(['month:2026-10', 'quarter:2026-Q3', 'week:2026-W44']);
  });
});

describe('D-57 vider les données', () => {
  it('removes meta-objectives, objectives, projects and tasks, keeps the configuration', () => {
    const ctx = makeCtx();
    const { tasks } = activeProject(ctx, 'Panneaux', 'Travaux', 2);
    setTaskInCurrentWeek(ctx, tasks[0].id, true);
    const meta = createMetaObjective(ctx, { title: 'Autonomie' });
    createObjective(ctx, { title: 'Énergie', deadline: '2026-12-20', metaObjectiveId: meta.id });
    createTask(ctx, { title: 'Passeport' });
    patchSettings(ctx, { 'month.max_projects': 5 });
    generateReport(ctx, 'week', '2026-W42');
    const r = purgeData(ctx, { history: false });
    expect(r.counts).toMatchObject({ project: 1, task: 3, objective: 1, metaObjective: 1, weekPlanItem: 1 });
    for (const t of [
      schema.task,
      schema.project,
      schema.objective,
      schema.metaObjective,
      schema.weekPlanItem,
    ])
      expect(ctx.db.select().from(t).all()).toHaveLength(0);
    expect(listDomains(ctx)).toHaveLength(8);
    expect(lookups(ctx).group('Travaux')).toBeDefined();
    expect(getSettings(ctx)['month.max_projects']).toBe(5);
    expect(ctx.db.select().from(schema.report).all()).toHaveLength(1);
    expect(listChanges(ctx, { actor: 'me' }).length).toBeGreaterThan(1);
  });

  it('with history, also empties week plans, reports and the journal (except the purge entry)', () => {
    const ctx = makeCtx();
    activeProject(ctx, 'Panneaux', 'Travaux', 1);
    generateReport(ctx, 'week', '2026-W42');
    purgeData(ctx, { history: true });
    expect(ctx.db.select().from(schema.report).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.weekPlan).all()).toHaveLength(0);
    const log = ctx.db.select().from(schema.auditLog).all();
    expect(log.map((l) => l.action)).toEqual(['purge']);
  });
});

describe('D-58 Proposer avec l’IA', () => {
  const fake =
    (answer: (user: string) => unknown) =>
    async ({ user }: { user: string }) => ({
      text: `Voici :\n${JSON.stringify(answer(user))}`,
      model: 'fake',
    });

  it('week: turns the AI selection into keep / add / remove, drops unknown ids, keeps due tasks', async () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z'); // Monday W44
    const { tasks } = activeProject(ctx, 'Panneaux', 'Travaux', 3);
    const { tasks: other } = activeProject(ctx, 'Garage', 'Travaux', 1);
    const due = createTask(ctx, { title: 'Passeport', durationMin: 30, dueDate: '2026-10-28' });
    setTaskInCurrentWeek(ctx, other[0].id, true);
    let sent = '';
    const p = await proposeWithAi(
      ctx,
      'week',
      '2026-W44',
      fake((user) => {
        sent = user;
        return {
          summary: 'Une semaine centrée sur les panneaux.',
          items: [
            { id: tasks[0].id, kind: 'week', reason: 'Première étape.' },
            { id: 'inventé', kind: 'week', reason: '?' },
          ],
        };
      }),
    );
    expect(sent).toContain('Panneaux 1');
    const by = Object.fromEntries(p.changes.map((c) => [c.title, c.action]));
    expect(by).toEqual({ 'Panneaux 1': 'add', 'Garage 1': 'remove', Passeport: expect.any(String) });
    expect(p.changes.find((c) => c.id === due.id)?.kind).toBe('week');
    expect(p.summary).toMatch(/panneaux/);
  });

  it('month: complete projects to add, chosen ones not kept are removed, incomplete ones get a warning', async () => {
    const ctx = makeCtx();
    const { project: kept } = activeProject(ctx, 'Gardé', 'Travaux', 1);
    const { project: dropped } = activeProject(ctx, 'Lâché', 'Travaux', 1);
    const idea = createProject(ctx, { title: 'Incomplet', groupIds: [lookups(ctx).group('Travaux').id] });
    promoteProject(ctx, idea.id);
    const p = await proposeWithAi(
      ctx,
      'month',
      '2026-11',
      fake(() => ({
        summary: 'ok',
        projects: [
          { id: kept.id, reason: 'À finir.' },
          { id: idea.id, reason: 'Tentant.' },
        ],
      })),
    );
    const c = Object.fromEntries(p.changes.map((x) => [x.title, x]));
    expect(c.Incomplet.action).toBe('add');
    expect(c.Incomplet.warning).toMatch(/incomplet/i);
    expect(c.Lâché?.action ?? 'absent').not.toBe('keep');
    expect(dropped.id).toBeTruthy();
  });

  it('refuses an unreadable answer and reports the configuration status', async () => {
    const ctx = makeCtx();
    await expect(
      proposeWithAi(ctx, 'quarter', '2026-Q4', async () => ({ text: 'désolé', model: 'x' })),
    ).rejects.toMatchObject({ code: 'AI_BAD_ANSWER' });
    expect(() => parseJsonObject('```json\n{"a":1}\n```')).not.toThrow();
    const s = getSettings(ctx);
    expect(aiStatus(s, {}).configured).toBe(false);
    const anth = { ...s, 'ai.provider': 'anthropic' as const };
    expect(aiStatus(anth, {}).reason).toMatch(/ANTHROPIC_API_KEY/);
    expect(aiStatus(anth, { ANTHROPIC_API_KEY: 'k' })).toMatchObject({
      configured: true,
      model: 'claude-opus-5-5',
    });
    expect(aiStatus({ ...s, 'ai.provider': 'openrouter' }, { OPENROUTER_API_KEY: 'k' }).reason).toMatch(
      /Modèle/,
    );
    expect(aiStatus({ ...s, 'ai.provider': 'ollama', 'ai.model': 'm' }, {}).configured).toBe(true);
  });
});

describe('D-61 temps réellement passé', () => {
  it('the actual time replaces the estimate in Ma semaine and the weekly report, with an estimation summary', () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z'); // Monday W44
    const { tasks } = activeProject(ctx, 'Garage', 'Travaux', 2);
    setTaskInCurrentWeek(ctx, tasks[0].id, true);
    setTaskInCurrentWeek(ctx, tasks[1].id, true);
    completeTask(ctx, tasks[0].id, { actualMin: 240 });
    completeTask(ctx, tasks[1].id);
    expect(getExecution(ctx, '2026-W44').doneMin).toBe(300);
    ctx.setNow('2026-11-02T06:00:00.000Z');
    const { report } = generateReport(ctx, 'week', '2026-W44');
    const p = report.payload as {
      rhythm: { doneMin: number };
      estimation: { ratioPct: number; overruns: unknown[] };
    };
    expect(p.rhythm.doneMin).toBe(300);
    expect(p.estimation).toMatchObject({
      ratioPct: 250,
      overruns: [{ title: 'Garage 1', estimateMin: 60, actualMin: 240 }],
    });
  });
});

describe('D-65 occurrences à venir sur la carte', () => {
  it('a recurring objective shows its upcoming quarters until it is renewed', () => {
    const ctx = makeCtx(); // 23 Oct 2026: map shows 2026-Q4 → 2027-Q3
    const o = createObjective(ctx, { title: 'Bilan santé', deadline: '2026-12-15', recurrence: 'quarterly' });
    createObjective(ctx, { title: 'Bilan annuel', deadline: '2026-12-20', recurrence: 'yearly' });
    const find = (title: string) =>
      getObjectivesMap(ctx)
        .lanes.flatMap((l) => l.objectives)
        .find((x) => x.title === title && x.status === 'active')!;
    expect(find('Bilan santé').upcoming).toEqual([
      { quarter: '2027-Q1', deadline: '2027-03-15' },
      { quarter: '2027-Q2', deadline: '2027-06-15' },
      { quarter: '2027-Q3', deadline: '2027-09-15' },
    ]);
    expect(find('Bilan annuel').upcoming).toEqual([]); // next one is in 2027-Q4, beyond the map
    updateObjective(ctx, o.id, { status: 'achieved' }); // renewed: the projection moves to the new occurrence
    const next = find('Bilan santé');
    expect(next.quarter).toBe('2027-Q1');
    expect(next.upcoming.map((u) => u.quarter)).toEqual(['2027-Q2', '2027-Q3']);
  });
});

describe('D-62 récurrence', () => {
  it('a completed recurring project is renewed with its tasks, planned for the next month', () => {
    const ctx = makeCtx();
    const { project: p } = activeProject(ctx, 'Compta du mois', 'Travaux', 2, { recurrence: 'monthly' });
    const done = completeProject(ctx, p.id, true);
    const next = listProjects(ctx, {}).find((x) => x.id === done.nextOccurrenceId)!;
    expect(next).toMatchObject({
      title: 'Compta du mois',
      status: 'ready',
      monthFlag: '2026-11',
      recurrence: 'monthly',
    });
    expect(next.previousId).toBe(p.id);
    expect(listTasks(ctx, { projectId: next.id }).map((t) => [t.title, t.status])).toEqual([
      ['Compta du mois 1', 'todo'],
      ['Compta du mois 2', 'todo'],
    ]);
  });

  it('a closed recurring objective is renewed next quarter; an abandoned one is not', () => {
    const ctx = makeCtx();
    const o = createObjective(ctx, { title: 'Bilan santé', deadline: '2026-12-15', recurrence: 'quarterly' });
    updateObjective(ctx, o.id, { status: 'achieved' });
    const next = listObjectives(ctx).find((x) => x.previousId === o.id)!;
    expect(next).toMatchObject({
      title: 'Bilan santé',
      deadline: '2027-03-15',
      quarter: '2027-Q1',
      status: 'active',
    });
    updateObjective(ctx, next.id, { status: 'abandoned' });
    expect(listObjectives(ctx).filter((x) => x.title === 'Bilan santé')).toHaveLength(2);
  });
});
