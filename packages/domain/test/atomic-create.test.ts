// Audit v1.0 Lot 2, H-11: a creation that needs several steps happens in one transaction (all or none).
import { eq, schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { planItemsOf as planItems, setWeekItems } from '../src/services/planning.ts';
import { createProject, createProjects, getProject } from '../src/services/projects.ts';
import { createTask, listTasks } from '../src/services/tasks.ts';
import { getPlanRow } from '../src/services/unplanned.ts';
import { lookups, makeCtx } from './helpers.ts';

const WEEK = '2026-W45';
const weekTaskIds = (ctx: ReturnType<typeof makeCtx>) => {
  const plan = getPlanRow(ctx, WEEK);
  return plan ? planItems(ctx, plan.id).map((i) => i.taskId) : [];
};

describe('H-11 one call, one transaction', () => {
  it('a task created with a week goes at the end of that week, the others kept', () => {
    const ctx = makeCtx('2026-11-03T10:00:00+01:00');
    const first = createTask(ctx, { title: 'Déjà là', durationMin: 15 });
    setWeekItems(ctx, WEEK, [{ taskId: first.id, kind: 'week' }]);
    const added = createTask(ctx, { title: 'Ajoutée', durationMin: 15, isoWeek: WEEK });
    expect(weekTaskIds(ctx)).toEqual([first.id, added.id]);
  });

  it('a task that cannot join the week is not created either', () => {
    const ctx = makeCtx('2026-11-03T10:00:00+01:00');
    expect(() => createTask(ctx, { title: 'Hors semaine', durationMin: 15, isoWeek: '2026-W99' })).toThrow();
    expect(listTasks(ctx, { projectId: 'inbox' }).some((t) => t.title === 'Hors semaine')).toBe(false);
  });

  it('a project comes with its tasks and its promotion, or not at all', () => {
    const ctx = makeCtx('2026-11-03T10:00:00+01:00');
    const { group } = lookups(ctx);
    const p = createProject(ctx, {
      title: 'Avec tâches',
      groupIds: [group('Sport').id],
      successCriterion: 'Fait',
      tasks: [
        { title: 'Un', durationMin: 30 },
        { title: 'Deux', durationMin: 60 },
      ],
      promote: true,
    });
    expect(getProject(ctx, p.id).status).toBe('ready');
    expect(listTasks(ctx, { projectId: p.id }).map((t) => t.title)).toEqual(['Un', 'Deux']);
    const count = () =>
      ctx.db.select().from(schema.project).where(eq(schema.project.title, 'Raté')).all().length;
    expect(() =>
      createProject(ctx, {
        title: 'Raté',
        groupIds: [group('Sport').id],
        tasks: [{ title: 'Durée invalide', durationMin: 7 }],
      }),
    ).toThrow();
    expect(count()).toBe(0);
  });

  it('several projects at once: all or none', () => {
    const ctx = makeCtx('2026-11-03T10:00:00+01:00');
    const { group } = lookups(ctx);
    const g = [group('Sport').id];
    const titles = () =>
      ctx.db
        .select()
        .from(schema.project)
        .all()
        .map((p) => p.title);
    expect(() =>
      createProjects(ctx, [
        { title: 'Lot A', groupIds: g },
        { title: 'Lot B', groupIds: g, objectiveId: '00000000-0000-4000-8000-000000000000' },
      ]),
    ).toThrow();
    expect(titles()).not.toContain('Lot A');
    const made = createProjects(ctx, [
      { title: 'Lot A', groupIds: g },
      { title: 'Lot B', groupIds: g },
    ]);
    expect(made.map((p) => p.title)).toEqual(['Lot A', 'Lot B']);
  });
});
