// D-182 (user request 24/11/2026): an Inbox task without due date that waits too long is shown (« depuis 5 sem. »),
// then questioned (« Toujours utile ? »); « Garder » starts the count again. Two thresholds in the settings.
// Fictional data only.
import { describe, expect, it } from 'vitest';
import { createTask, getPlanningPage, inboxAge, keepTask, listInbox, patchSettings } from '../src/index.ts';
import { makeCtx } from './helpers.ts';

const TH = { staleDays: 30, questionDays: 60 };
const plain = {
  projectId: null,
  status: 'todo',
  isExperience: false,
  dueDate: null,
  recurring: false,
  since: '2026-09-01',
};

describe('D-182: the age of an Inbox task', () => {
  it('stale after 30 days, questioned after 60, counted from its creation or from « Garder »', () => {
    expect(inboxAge(plain, '2026-09-30', TH)).toBeNull(); // 29 days
    expect(inboxAge(plain, '2026-10-01', TH)).toEqual({ level: 'stale', days: 30 });
    expect(inboxAge(plain, '2026-10-31', TH)).toEqual({ level: 'question', days: 60 });
  });

  it('only the Inbox tasks to do, without due date, not recurring, not envies', () => {
    const late = '2026-12-01';
    expect(inboxAge({ ...plain, dueDate: '2026-12-15' }, late, TH)).toBeNull(); // its due date alerts already
    expect(inboxAge({ ...plain, recurring: true }, late, TH)).toBeNull();
    expect(inboxAge({ ...plain, isExperience: true }, late, TH)).toBeNull();
    expect(inboxAge({ ...plain, projectId: 'p1' }, late, TH)).toBeNull();
    expect(inboxAge({ ...plain, status: 'done' }, late, TH)).toBeNull();
  });

  it('shown in the Inbox and in Planifier (never folded); « Garder » starts again; thresholds in the settings', () => {
    const ctx = makeCtx('2026-09-01T08:00:00.000Z');
    const old = createTask(ctx, { title: 'Liste électorale', durationMin: 15 });
    createTask(ctx, { title: 'Passeport', durationMin: 30, dueDate: '2026-12-15' });
    createTask(ctx, {
      title: 'Filtre',
      durationMin: 15,
      dueDate: '2026-10-12',
      recurrenceRule: 'FREQ=WEEKLY',
    });
    ctx.setNow('2026-10-05T08:00:00.000Z'); // 34 days later
    for (const t of ['Colis', 'Banque', 'Vélo', 'Garage'])
      createTask(ctx, { title: t, durationMin: 5, dueDate: '2026-10-09' });
    const ages = () => Object.fromEntries(listInbox(ctx).open.map((t) => [t.title, t.age?.level ?? null]));
    expect(ages()).toMatchObject({ 'Liste électorale': 'stale', Passeport: null, Filtre: null, Colis: null });
    expect(listInbox(ctx).open.find((t) => t.id === old.id)?.age).toEqual({ level: 'stale', days: 34 });

    // Planifier: 4 tasks due this week come first, the old one would be folded: it stays shown, with its age.
    const card = getPlanningPage(ctx, '2026-W41').groups.find((g) => g.key === 'inbox')!.cards[0];
    expect(card.tasks.find((r) => r.taskId === old.id)?.age).toEqual({ level: 'stale', days: 34 });
    expect(card.hidden.map((h) => h.taskId)).not.toContain(old.id);

    ctx.setNow('2026-11-05T08:00:00.000Z'); // 65 days
    expect(ages()['Liste électorale']).toBe('question');
    keepTask(ctx, old.id);
    expect(ages()['Liste électorale']).toBeNull();
    ctx.setNow('2026-12-06T08:00:00.000Z'); // 31 days after « Garder »
    expect(ages()['Liste électorale']).toBe('stale');

    patchSettings(ctx, { 'inbox.stale_days': 7, 'inbox.question_days': 20 });
    expect(ages()['Liste électorale']).toBe('question');
  });

  it('« Garder » only for a task the rule concerns', () => {
    const ctx = makeCtx('2026-09-01T08:00:00.000Z');
    const due = createTask(ctx, { title: 'Passeport', durationMin: 30, dueDate: '2026-12-15' });
    expect(() => keepTask(ctx, due.id)).toThrow(/Inbox/);
  });
});
