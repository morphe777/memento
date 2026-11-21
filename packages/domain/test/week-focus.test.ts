// D-175: « Cap de la semaine » — the 2 aims of the week, from where the plan puts its time. Fictional data only.
import { describe, expect, it } from 'vitest';
import {
  completeTask,
  createProject,
  createTask,
  getWeekFocus,
  type Llm,
  promoteProject,
  refreshWeekFocus,
  runDueJobs,
  runWeekFocusJob,
  setWeekFocus,
  setWeekItems,
  weekFocusFacts,
} from '../src/index.ts';
import { lookups, makeCtx } from './helpers.ts';

const W = '2026-W44';

/** Salle de bain 3 h, Compta 1 h 30 (one done), Jardin 30 min, an Inbox task 2 h: all in the plan of W44. */
function week(ctx: ReturnType<typeof makeCtx>) {
  const { group } = lookups(ctx);
  const project = (title: string, minutes: number[], motive = '') => {
    const p = createProject(ctx, {
      title,
      groupIds: [group('Travaux').id],
      successCriterion: 'Fait',
      motive,
    });
    const tasks = minutes.map((m, i) =>
      createTask(ctx, { projectId: p.id, title: `${title} ${i + 1}`, durationMin: m as 60, isFree: true }),
    );
    promoteProject(ctx, p.id);
    return { p, tasks };
  };
  const bath = project('Salle de bain', [120, 60], 'Un **cocon**');
  const books = project('Compta', [60, 30]);
  const garden = project('Jardin', [30]);
  const inbox = createTask(ctx, { title: 'Ranger le garage', durationMin: 120 });
  setWeekItems(ctx, W, [
    ...[...bath.tasks, ...books.tasks, ...garden.tasks].map((t) => ({ taskId: t.id, kind: 'week' as const })),
    { taskId: inbox.id, kind: 'week' },
  ]);
  completeTask(ctx, books.tasks[1]!.id);
  return { bath: bath.p, books: books.p, garden: garden.p };
}

const fake =
  (answer: unknown): Llm =>
  async () => ({ text: JSON.stringify(answer), model: 'fake' });

describe('D-175 Cap de la semaine', () => {
  it('the facts: projects of the plan by planned time (done tasks count, Inbox apart), with their why', () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z');
    const { bath, books } = week(ctx);
    const f = weekFocusFacts(ctx, W);
    expect(f.projects.map((p) => [p.title, p.plannedMin, p.motive])).toEqual([
      ['Salle de bain', 180, 'Un **cocon**'],
      ['Compta', 90, ''],
      ['Jardin', 30, ''],
    ]);
    expect(f.projects[0]!.id).toBe(bath.id);
    expect(f.projects[1]!.id).toBe(books.id);
  });

  it('without AI: the 2 projects with the most planned time', async () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z');
    const { bath, books } = week(ctx);
    const r = await refreshWeekFocus(ctx, W, null);
    expect(r.focus.items).toEqual([
      { text: 'Salle de bain', projectId: bath.id },
      { text: 'Compta', projectId: books.id },
    ]);
    expect(r.focus.source).toBe('plain');
    expect(getWeekFocus(ctx, W)).toEqual(r.focus);
  });

  it('with AI: at most 2 aims, an unknown project dropped from the link, kept short', async () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z');
    const { bath } = week(ctx);
    const r = await refreshWeekFocus(
      ctx,
      W,
      fake({
        items: [
          { text: ' Finir la **salle de bain** ', projectId: bath.id },
          { text: 'Boucler la compta', projectId: 'inventé' },
          { text: 'Un troisième', projectId: null },
        ],
      }),
    );
    expect(r.focus).toMatchObject({
      source: 'ai',
      items: [
        { text: 'Finir la **salle de bain**', projectId: bath.id },
        { text: 'Boucler la compta', projectId: null },
      ],
    });
  });

  it('an AI that fails or answers off-format gives the plain aims, and says why', async () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z');
    week(ctx);
    const r = await refreshWeekFocus(ctx, W, async () => {
      throw new Error('AI_UNREACHABLE');
    });
    expect(r.focus.source).toBe('plain');
    expect(r.aiError).toBe('AI_UNREACHABLE');
    const r2 = await refreshWeekFocus(ctx, W, fake({ nope: 1 }));
    expect(r2.focus.source).toBe('plain');
    expect(r2.aiError).toBeTruthy();
  });

  it('written by hand: 2 lines at most, empty ones dropped', () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z');
    week(ctx);
    expect(setWeekFocus(ctx, W, ['  Finir la **salle de bain** ', '', 'Compta', 'Trop'])).toMatchObject({
      source: 'me',
      items: [
        { text: 'Finir la **salle de bain**', projectId: null },
        { text: 'Compta', projectId: null },
      ],
    });
  });

  it('an empty plan gives no aim', async () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z');
    expect((await refreshWeekFocus(ctx, '2026-W45', null)).focus.items).toEqual([]);
  });

  it('the job: on Monday once the plan is proposed, once per week; never before', async () => {
    const ctx = makeCtx('2026-10-26T05:00:00.000Z'); // Monday 06:00 Paris, before the plan (07:00)
    week(ctx);
    expect(await runWeekFocusJob(ctx, {}, null)).toBe('skipped');
    ctx.setNow('2026-10-26T06:30:00.000Z'); // 07:30 Paris
    runDueJobs(ctx);
    expect(await runWeekFocusJob(ctx, {}, null)).toBe('done');
    expect(getWeekFocus(ctx, W)?.source).toBe('plain');
    setWeekFocus(ctx, W, ['À la main']);
    expect(await runWeekFocusJob(ctx, {}, null)).toBe('skipped'); // the one by hand stays
    expect(getWeekFocus(ctx, W)?.items[0]?.text).toBe('À la main');
  });
});
