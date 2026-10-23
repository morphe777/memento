import { openDb, runMigrations, schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import type { DomainError } from '../src/errors.ts';
import {
  addProjectDependency,
  addTaskDependency,
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
  getObjective,
  getPlanningPage,
  getProject,
  getSettings,
  listBoardTasks,
  listChanges,
  listDomains,
  listProjectDependencies,
  listTasks,
  markReviewed,
  patchSettings,
  promoteProject,
  propose,
  proposeWeek,
  reorderTasks,
  replanProject,
  search,
  seed,
  setProjectGroups,
  setTaskInCurrentWeek,
  setWeekItems,
  tx,
  updateGroup,
  updateProject,
  updateTask,
  validateWeek,
} from '../src/index.ts';
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

describe('L1 référentiel', () => {
  it('RB-01 + D-04: an idea needs a title and a group, nothing else', () => {
    const ctx = makeCtx();
    const { group } = lookups(ctx);
    const idea = createProject(ctx, { title: 'Monter un NAS', groupIds: [group('Labo Tech').id] });
    expect(idea.status).toBe('idea');
    expect(idea.domainIds).toHaveLength(1);
  });

  it('RB-02: promoting an idea without tasks returns 422 with the gaps', () => {
    const ctx = makeCtx();
    const { group } = lookups(ctx);
    const idea = createProject(ctx, { title: 'Clim', groupIds: [group('Travaux').id] });
    try {
      promoteProject(ctx, idea.id);
      throw new Error('should fail');
    } catch (e) {
      const err = e as DomainError;
      expect(err.code).toBe('PROMOTION_INCOMPLETE');
      expect((err.details as { code: string }[]).map((d) => d.code)).toEqual([
        'SUCCESS_CRITERION_MISSING',
        'TASK_MISSING',
        'DATES_MISSING',
      ]);
    }
  });

  it('D-13: an active project cannot be stretched beyond 31 days', () => {
    const ctx = makeCtx();
    const { project } = activeProject(ctx, 'PV', 'Travaux');
    expect(errCode(() => updateProject(ctx, project.id, { dueDate: '2026-12-31' }))).toBe('PROJECT_TOO_LONG');
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

  it('RB-08: month flag needs tasks all with duration', () => {
    const ctx = makeCtx();
    const { group } = lookups(ctx);
    const idea = createProject(ctx, { title: 'Jardin', groupIds: [group('Jardin').id] });
    expect(errCode(() => updateProject(ctx, idea.id, { monthFlag: '2026-10' }))).toBe(
      'MONTH_FLAG_REQUIRES_TASKS',
    );
    createTask(ctx, { projectId: idea.id, title: 'Tailler', durationMin: null });
    expect(errCode(() => updateProject(ctx, idea.id, { monthFlag: '2026-10' }))).toBe(
      'MONTH_FLAG_REQUIRES_TASKS',
    );
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
    updateProject(ctx, pv.id, { monthFlag: '2026-11' });
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
    updateProject(ctx, p.id, { monthFlag: '2026-11' });
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
