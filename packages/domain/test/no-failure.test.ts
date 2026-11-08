// D-140 (audit M-05): a project does not fail; one that is not finished is abandoned and its done tasks stay done.
// M-12: data migrations run once.
import { eq, schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { runDataMigrations } from '../src/services/migrations.ts';
import {
  completeProject,
  createProject,
  getProject,
  listProjects,
  promoteProject,
  rollMonth,
  setProjectMonth,
} from '../src/services/projects.ts';
import {
  createMetaObjective,
  createObjective,
  getObjective,
  updateMetaObjective,
} from '../src/services/referential.ts';
import { completeTask, createTask, listTasks } from '../src/services/tasks.ts';
import { lookups, makeCtx } from './helpers.ts';

function project(ctx: ReturnType<typeof makeCtx>, title: string, extra: Record<string, unknown> = {}) {
  const { group } = lookups(ctx);
  const p = createProject(ctx, { title, groupIds: [group('Sport').id], successCriterion: 'Fait', ...extra });
  const tasks = [1, 2].map((i) =>
    createTask(ctx, { projectId: p.id, title: `${title} ${i}`, durationMin: 60 }),
  );
  promoteProject(ctx, p.id);
  setProjectMonth(ctx, p.id, '2026-10');
  return { p, tasks };
}

describe('D-140 no failed project', () => {
  it('« Terminer » is a success; « not succeeded » is refused', () => {
    const ctx = makeCtx();
    const { p } = project(ctx, 'Courir');
    expect(() => completeProject(ctx, p.id, false)).toThrow(/abandonne-le/);
    expect(completeProject(ctx, p.id)).toMatchObject({ status: 'done', success: true });
  });

  it('a recurring project unfinished at the end of its month is abandoned, not counted as progress', () => {
    const ctx = makeCtx(); // October 2026
    const o = createObjective(ctx, { title: 'Bouger', deadline: '2026-12-31' });
    const { p, tasks } = project(ctx, 'Séances', { recurrence: 'monthly', objectiveId: o.id });
    completeTask(ctx, tasks[0].id);
    ctx.setNow('2026-11-01T08:00:00.000Z');
    expect(rollMonth(ctx, '2026-11').missed).toBe(1);
    expect(getProject(ctx, p.id)).toMatchObject({ status: 'abandoned' });
    expect(listTasks(ctx, { projectId: p.id }).map((t) => t.status)).toEqual(['done', 'todo']); // done stays done
    const next = listProjects(ctx, {}).find((x) => x.previousId === p.id)!;
    expect(next.status).toBe('active'); // the next period starts
    expect(getObjective(ctx, o.id).progressPct).toBe(0); // the abandoned one is not on the path
  });

  it('the old « done, success false » projects become abandoned once, their tasks untouched', () => {
    const ctx = makeCtx();
    const o = createObjective(ctx, { title: 'Bouger', deadline: '2026-12-31' });
    const { p, tasks } = project(ctx, 'Ancien échec', { objectiveId: o.id });
    const { p: won } = project(ctx, 'Réussi', { objectiveId: o.id });
    completeTask(ctx, tasks[0].id);
    completeProject(ctx, won.id);
    // As an earlier version stored it.
    ctx.db
      .update(schema.project)
      .set({ status: 'done', success: false })
      .where(eq(schema.project.id, p.id))
      .run();
    runDataMigrations(ctx);
    expect(getProject(ctx, p.id)).toMatchObject({ status: 'abandoned', success: null });
    expect(listTasks(ctx, { projectId: p.id }).map((t) => t.status)).toEqual(['done', 'todo']);
    expect(getObjective(ctx, o.id).progressPct).toBe(100); // 1 done ÷ 1 on the path
    ctx.db
      .update(schema.project)
      .set({ status: 'done', success: false })
      .where(eq(schema.project.id, p.id))
      .run();
    runDataMigrations(ctx);
    expect(getProject(ctx, p.id).status).toBe('done'); // once only
  });
});

describe('M-12 data migrations run once', () => {
  it('a meta-objective domain set back to none by the user is not filled again at the next start', () => {
    const ctx = makeCtx();
    const { p } = project(ctx, 'Avec méta');
    const m = createMetaObjective(ctx, { title: 'Santé durable' });
    const o = createObjective(ctx, { title: 'Bouger', deadline: '2026-12-31', metaObjectiveId: m.id });
    ctx.db.update(schema.project).set({ objectiveId: o.id }).where(eq(schema.project.id, p.id)).run();
    runDataMigrations(ctx); // first start: the domain is filled (DM-114)
    const filled = () =>
      ctx.db.select().from(schema.metaObjective).where(eq(schema.metaObjective.id, m.id)).get()!
        .primaryDomainId;
    expect(filled()).not.toBeNull();
    updateMetaObjective(ctx, m.id, { primaryDomainId: null });
    runDataMigrations(ctx); // next start
    expect(filled()).toBeNull();
  });
});
