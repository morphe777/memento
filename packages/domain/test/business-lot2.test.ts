// Audit v1.0 Lot 2, business rules: M-02, M-04, M-07, M-09, M-11.
import { and, eq, schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { deleteMetaObjective } from '../src/services/deletion.ts';
import {
  completeProject,
  createProject,
  getProject,
  listProjects,
  promoteProject,
  replanProject,
  rollMonth,
  setProjectMonth,
  updateProject,
} from '../src/services/projects.ts';
import { placeObjective } from '../src/services/quarter.ts';
import { createMetaObjective, createObjective } from '../src/services/referential.ts';
import { generateReport } from '../src/services/reports.ts';
import {
  addTaskDependency,
  completeTask,
  createTask,
  listTasks,
  uncompleteTask,
} from '../src/services/tasks.ts';
import { lookups, makeCtx } from './helpers.ts';

const auditOf = (ctx: ReturnType<typeof makeCtx>, entityId: string) =>
  ctx.db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, entityId)).all();

function monthProject(ctx: ReturnType<typeof makeCtx>, title: string, extra: Record<string, unknown> = {}) {
  const { group } = lookups(ctx);
  const p = createProject(ctx, { title, groupIds: [group('Sport').id], successCriterion: 'Fait', ...extra });
  const tasks = [1, 2].map((i) =>
    createTask(ctx, { projectId: p.id, title: `${title} ${i}`, durationMin: 60 }),
  );
  promoteProject(ctx, p.id);
  setProjectMonth(ctx, p.id, '2026-10');
  return { p, tasks };
}

describe('M-02 a recurring task checked, unchecked and checked again', () => {
  it('has one next occurrence, not two', () => {
    const ctx = makeCtx();
    const t = createTask(ctx, {
      title: 'Arroser',
      durationMin: 5,
      dueDate: '2026-10-23',
      recurrenceRule: 'FREQ=WEEKLY',
    });
    completeTask(ctx, t.id);
    uncompleteTask(ctx, t.id);
    completeTask(ctx, t.id);
    const open = ctx.db
      .select()
      .from(schema.task)
      .where(and(eq(schema.task.title, 'Arroser'), eq(schema.task.status, 'todo')))
      .all();
    expect(open.map((x) => x.dueDate)).toEqual(['2026-10-30']);
  });
});

describe('M-04 replan a project whose deadline is past', () => {
  it('without a date, the deadline moves to the end of the current month', () => {
    const ctx = makeCtx(); // 23 Oct 2026
    const { p } = monthProject(ctx, 'Retard', { startDate: '2026-10-01', dueDate: '2026-10-25' });
    ctx.setNow('2026-10-28T08:00:00.000Z');
    expect(replanProject(ctx, p.id)).toMatchObject({ dueDate: '2026-10-31', replannedAt: '2026-10-28' });
  });
});

describe('M-07 a finished project reopened', () => {
  it('leaves its month: not chosen, nowhere inconsistent', () => {
    const ctx = makeCtx();
    const { p } = monthProject(ctx, 'Rouvert');
    completeProject(ctx, p.id);
    expect(updateProject(ctx, p.id, { status: 'ready' })).toMatchObject({ status: 'ready', monthFlag: null });
  });
});

describe('M-09 a renewed recurring project keeps what a copy keeps', () => {
  it('its motive and the links between its tasks', () => {
    const ctx = makeCtx();
    const { p, tasks } = monthProject(ctx, 'Compta', {
      recurrence: 'monthly',
      motive: 'Dormir **tranquille**',
    });
    addTaskDependency(ctx, tasks[0].id, tasks[1].id);
    const next = getProject(ctx, completeProject(ctx, p.id).nextOccurrenceId!);
    expect(next).toMatchObject({ motive: 'Dormir **tranquille**', recurrence: 'monthly', previousId: p.id });
    const copied = listTasks(ctx, { projectId: next.id });
    const links = ctx.db.select().from(schema.taskDependency).all();
    expect(links).toContainEqual(
      expect.objectContaining({ taskId: copied[0].id, dependsOnTaskId: copied[1].id }),
    );
    expect(listProjects(ctx, {}).filter((x) => x.title === 'Compta')).toHaveLength(2);
  });
});

describe('M-11 every change has its line in the journal (RB-15)', () => {
  it('objectives detached from a deleted meta-objective, positions, month flag cleared, report frozen', () => {
    const ctx = makeCtx();
    const m = createMetaObjective(ctx, { title: 'Méta' });
    const a = createObjective(ctx, { title: 'A', deadline: '2026-12-31', metaObjectiveId: m.id });
    const b = createObjective(ctx, { title: 'B', deadline: '2026-12-31', metaObjectiveId: m.id });
    placeObjective(ctx, b.id, { metaObjectiveId: m.id, quarter: '2026-Q4', ids: [b.id, a.id] });
    expect(auditOf(ctx, a.id).some((l) => l.action === 'reorder')).toBe(true);
    deleteMetaObjective(ctx, m.id);
    expect(auditOf(ctx, a.id).some((l) => l.action === 'update')).toBe(true);
    const { p } = monthProject(ctx, 'Prêt planifié');
    updateProject(ctx, p.id, { status: 'ready' });
    ctx.db.update(schema.project).set({ monthFlag: '2026-10' }).where(eq(schema.project.id, p.id)).run();
    ctx.setNow('2026-11-01T08:00:00.000Z');
    rollMonth(ctx, '2026-11');
    expect(auditOf(ctx, p.id).filter((l) => l.action === 'month_end')).toHaveLength(1);
    const r = generateReport(ctx, 'week', '2026-W43').report;
    expect(auditOf(ctx, r.id).map((l) => l.action)).toEqual(['generate']);
  });
});
