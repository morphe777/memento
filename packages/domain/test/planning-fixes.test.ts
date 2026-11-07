// Audit v1.0 Lot 1B: H-08 (RB-10), H-09 (RB-06/RB-07), H-10 (proposeWeek keeps what is done).
import { schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { scoreCandidates } from '../src/rules/engine.ts';
import {
  buildEngineInput,
  closeWeek,
  getExecution,
  getPlanningPage,
  proposeWeek,
  setWeekItems,
} from '../src/services/planning.ts';
import { createProject, promoteProject, setProjectMonth, updateProject } from '../src/services/projects.ts';
import { addTaskDependency, completeTask, createTask, listTasks } from '../src/services/tasks.ts';
import { monthOf, parisDate } from '../src/time.ts';
import { lookups, makeCtx } from './helpers.ts';

function monthProject(ctx: ReturnType<typeof makeCtx>, title: string, n = 2) {
  const { group } = lookups(ctx);
  const p = createProject(ctx, { title, groupIds: [group('Sport').id], successCriterion: 'Fait' });
  const tasks = Array.from({ length: n }, (_, i) =>
    createTask(ctx, { projectId: p.id, title: `${title} ${i + 1}`, durationMin: 60 }),
  );
  promoteProject(ctx, p.id);
  setProjectMonth(ctx, p.id, monthOf(parisDate(ctx.now!())));
  return { project: p, tasks };
}

describe('H-08 closeWeek carries only tasks that can still be planned', () => {
  it('a task of a project abandoned during the week is neither carried over nor counted as postponed', () => {
    const ctx = makeCtx('2026-11-09T08:00:00.000Z'); // Monday W46
    const kept = monthProject(ctx, 'Gardé', 1);
    const dropped = monthProject(ctx, 'Abandonné', 1);
    const inbox = createTask(ctx, { title: 'Inbox', durationMin: 30 });
    setWeekItems(ctx, '2026-W46', [
      { taskId: kept.tasks[0].id, kind: 'week' },
      { taskId: dropped.tasks[0].id, kind: 'week' },
      { taskId: inbox.id, kind: 'week' },
    ]);
    updateProject(ctx, dropped.project.id, { status: 'abandoned' });
    ctx.setNow('2026-11-16T06:00:00.000Z');
    expect(closeWeek(ctx, '2026-W46').carried).toBe(2);
    const row = (id: string) =>
      ctx.db
        .select()
        .from(schema.task)
        .all()
        .find((t) => t.id === id)!;
    expect(row(dropped.tasks[0].id).postponeCount).toBe(0);
    expect(row(kept.tasks[0].id).postponeCount).toBe(1);
    expect(row(inbox.id).postponeCount).toBe(1);
    const next = getPlanningPage(ctx, '2026-W47').groups.flatMap((g) => g.cards.flatMap((c) => c.tasks));
    expect(next.find((t) => t.taskId === dropped.tasks[0].id)?.selection ?? null).toBeNull();
  });
});

describe('H-09 a prerequisite in another project unlocks the task once done', () => {
  it('locked while the other project task is to do, still available weeks after it is done', () => {
    const ctx = makeCtx('2026-11-09T08:00:00.000Z'); // Monday W46
    const a = monthProject(ctx, 'A', 1);
    const b = monthProject(ctx, 'B', 1);
    addTaskDependency(ctx, b.tasks[0].id, a.tasks[0].id);
    const locked = () =>
      listTasks(ctx, { projectId: b.project.id }).find((t) => t.id === b.tasks[0].id)!.locked;
    expect(locked()).toBe(true);
    completeTask(ctx, a.tasks[0].id);
    // The next weeks, when A is no longer in the current plan: the done prerequisite still counts.
    ctx.setNow('2026-11-17T08:00:00.000Z'); // Tuesday W47
    expect(locked()).toBe(false);
    expect(() => setWeekItems(ctx, '2026-W47', [{ taskId: b.tasks[0].id, kind: 'week' }])).not.toThrow();
    setWeekItems(ctx, '2026-W47', []);
    expect(scoreCandidates(buildEngineInput(ctx, '2026-W47')).map((c) => c.taskId)).toContain(b.tasks[0].id);
  });
});

describe('H-10 proposeWeek keeps the engine lines already done', () => {
  it('« Fait » is unchanged after a new proposal', () => {
    const ctx = makeCtx('2026-11-09T08:00:00.000Z'); // Monday W46
    const due = createTask(ctx, { title: 'Dossier', durationMin: 30, dueDate: '2026-11-12' });
    proposeWeek(ctx, '2026-W46');
    const line = () =>
      ctx.db
        .select()
        .from(schema.weekPlanItem)
        .all()
        .find((i) => i.taskId === due.id);
    expect(line()).toMatchObject({ source: 'engine', kind: 'week' });
    completeTask(ctx, due.id);
    expect(getExecution(ctx, '2026-W46').doneMin).toBe(30);
    proposeWeek(ctx, '2026-W46');
    expect(getExecution(ctx, '2026-W46').doneMin).toBe(30);
    expect(line()).toMatchObject({ source: 'engine', kind: 'week' });
  });
});
