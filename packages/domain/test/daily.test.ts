import { describe, expect, it } from 'vitest';
import {
  achievementsSentence,
  composeDailyRecap,
  deadlineLabel,
  deadlineUrgency,
  isOnVacation,
  type RecapFacts,
  type RecapTask,
  recapToTelegramHtml,
  sanitizeTelegramHtml,
  stripTelegramHtml,
  type WeekVolume,
  weekReached,
  weekStreak,
} from '../src/rules/daily.ts';
import {
  addVacation,
  getDailyRecap,
  listVacations,
  removeVacation,
  sendDailyRecap,
  setTelegramToken,
} from '../src/services/daily.ts';
import { runDailyRecapJob } from '../src/services/jobs.ts';
import { getExecution, setWeekItems } from '../src/services/planning.ts';
import { completeProject, createProject, promoteProject, setProjectMonth } from '../src/services/projects.ts';
import { completeTask, createTask } from '../src/services/tasks.ts';
import { patchSettings } from '../src/settings.ts';
import { lookups, makeCtx } from './helpers.ts';

const task = (over: Partial<RecapTask> = {}): RecapTask => ({
  title: 'Courir',
  durationMin: 30,
  isExperience: false,
  domainName: 'Santé',
  projectTitle: null,
  isMonthProject: false,
  objectiveTitle: null,
  objectiveCriticality: null,
  deadline: null,
  postponeCount: 0,
  ...over,
});
const facts = (tasks: RecapTask[], over: Partial<RecapFacts> = {}): RecapFacts => ({
  date: '2026-10-28',
  dayLabel: 'mercredi 28 octobre',
  mode: 'day',
  period: { from: '2026-10-28', to: '2026-10-28' },
  nothingDone: tasks.length === 0,
  done: {
    tasks,
    doneTasks: tasks.length,
    doneMin: tasks.filter((t) => !t.isExperience).reduce((a, t) => a + t.durationMin, 0),
    completedProjects: [],
  },
  last7Days: [],
  avg7: { doneTasks: 0, doneMin: 0 },
  weekStreak: 0,
  weeks: [],
  week: { plannedTasks: 0, doneTasks: 0, remainingTasks: 0, doneMin: 0, budgetMin: 0, daysLeftAfterToday: 4 },
  focus: [],
  projects: { active: 0, month: 0, monthLimit: 3 },
  experiences: { done: 0, target: 2, windowWeeks: 4 },
  ...over,
});

describe('D-76 urgency of « Ma semaine »', () => {
  it('stop when late or due today, warning within 2 days, nothing beyond or without deadline', () => {
    expect(deadlineUrgency('2026-10-27', '2026-10-28')).toBe('late');
    expect(deadlineUrgency('2026-10-28', '2026-10-28')).toBe('today');
    expect(deadlineUrgency('2026-10-29', '2026-10-28')).toBe('soon');
    expect(deadlineUrgency('2026-10-30', '2026-10-28')).toBe('soon');
    expect(deadlineUrgency('2026-10-31', '2026-10-28')).toBeNull();
    expect(deadlineUrgency(null, '2026-10-28')).toBeNull();
  });

  it('execution rows carry the deadline (task, else project end) and the urgency of open tasks', () => {
    const ctx = makeCtx('2026-10-28T08:00:00.000Z'); // Wednesday W44
    const { group } = lookups(ctx);
    const p = createProject(ctx, {
      title: 'Dossier',
      groupIds: [group('Sport').id],
      successCriterion: 'ok',
      startDate: '2026-10-20',
      dueDate: '2026-10-30',
    });
    const a = createTask(ctx, { projectId: p.id, title: 'A', durationMin: 30 });
    const b = createTask(ctx, { projectId: p.id, title: 'B', durationMin: 30, dueDate: '2026-10-28' });
    const c = createTask(ctx, { title: 'C', durationMin: 30 });
    promoteProject(ctx, p.id);
    setWeekItems(ctx, '2026-W44', [
      { taskId: a.id, kind: 'week' },
      { taskId: b.id, kind: 'week' },
      { taskId: c.id, kind: 'week' },
    ]);
    const ex = getExecution(ctx, '2026-W44');
    const by = (id: string) => ex.tasks.find((t) => t.taskId === id)!;
    expect([by(a.id).urgency, by(a.id).daysLeft]).toEqual(['soon', 2]);
    expect(by(b.id).urgency).toBe('today');
    expect(by(c.id).urgency).toBeNull();
    completeTask(ctx, b.id);
    expect(getExecution(ctx, '2026-W44').tasks.find((t) => t.taskId === b.id)!.urgency).toBeNull();
  });
});

describe('D-77 « Bilan du jour »', () => {
  it('a report: one sentence of achievements, the week KPIs (no day streak), then the done tasks', () => {
    const tasks = [
      task({
        title: 'Régler les freins',
        projectTitle: 'Vélo',
        objectiveTitle: 'Bouger',
        objectiveCriticality: 3,
      }),
      task({ title: 'Appeler mamie', isExperience: true, domainName: 'Famille' }),
      task({ title: 'Impôts', postponeCount: 3 }),
    ];
    const f = facts(tasks, {
      weekStreak: 3,
      weeks: [
        { isoWeek: '2026-W42', doneMin: 300, budgetMin: 360, vacation: false },
        { isoWeek: '2026-W43', doneMin: 0, budgetMin: 360, vacation: true },
        { isoWeek: '2026-W44', doneMin: 270, budgetMin: 360, vacation: false },
      ],
    });
    f.done.completedProjects = ['Vélo'];
    f.week = { ...f.week, doneMin: 270, budgetMin: 360 };
    const r = composeDailyRecap(f);
    expect(r.title).toBe('📊 Bilan du mercredi 28 octobre');
    expect(r.summary).toBe(
      'Projet « Vélo » bouclé, expérience « Appeler mamie » vécue, « Impôts » enfin fait et 3 tâches faites (1 h).',
    );
    expect(r.kpis).toEqual([
      { icon: '📈', label: 'Semaine', value: '4 h 30 / 6 h', note: '75 %' },
      { icon: '🗓', label: 'Semaines d’affilée', value: '3', note: '≥ 80 %' },
      { icon: '📦', label: '3 semaines', value: '5 h · 🏖 · 4 h 30' },
    ]);
    const html = recapToTelegramHtml({ ...r, done: ['a < b'] });
    expect(html).toContain('🗓 Semaines d’affilée : <b>3</b> (≥ 80 %)');
    expect(html).toContain('<b>Fait aujourd’hui</b>');
    expect(html).not.toContain('Série');
    expect(html).toContain('a &lt; b');
    expect(html).not.toMatch(/Salut|Bravo/);
    expect(achievementsSentence(facts([task()]))).toBe('1 tâche faite (30 min).');
  });

  it('D-78 nothing done on a weekday: encouragement and leads for the coming days, never a zero', () => {
    const f = facts([], {
      week: {
        plannedTasks: 4,
        doneTasks: 2,
        remainingTasks: 2,
        doneMin: 0,
        budgetMin: 360,
        daysLeftAfterToday: 4,
      },
      focus: [
        { title: 'Devis', projectTitle: 'Cuisine', deadline: '2026-10-30', durationMin: 30 },
        { title: 'Lire', projectTitle: null, deadline: null, durationMin: 15 },
      ],
    });
    const r = composeDailyRecap(f);
    expect(r.title).toBe('🌱 Mercredi 28 octobre');
    expect(r.summary).toBe(
      "Pas de tâche cochée aujourd'hui, ça arrive : la semaine se joue sur plusieurs jours. Déjà 2 tâches faites cette semaine.",
    );
    expect(r.kpis).toEqual([]);
    expect(r.focus).toEqual(['Devis · Cuisine (échéance vendredi)', 'Lire']);
    const html = recapToTelegramHtml(r);
    expect(html).toContain('<b>Ce qui compte ces prochains jours</b>\n→ Devis · Cuisine (échéance vendredi)');
    expect(html).not.toMatch(/\b0\b|demain/);
    const allDone = composeDailyRecap(
      facts([], { week: { ...f.week, remainingTasks: 0 }, focus: [] }),
    ).summary;
    expect(allDone).toContain('Ta semaine est déjà bouclée.');
  });

  it('D-78 Sunday: the weekend, congratulations when done, motivation for the week otherwise', () => {
    const weekend = {
      mode: 'weekend' as const,
      date: '2026-11-01',
      dayLabel: 'dimanche 1er novembre',
      period: { from: '2026-10-31', to: '2026-11-01' },
    };
    const done = composeDailyRecap(facts([task(), task({ title: 'Ranger' })], weekend));
    expect(done.title).toBe('🌿 Bilan du week-end');
    expect(done.summary).toBe('Ce week-end : 2 tâches faites (1 h). Bien joué.');
    expect(recapToTelegramHtml(done)).toContain('<b>Fait ce week-end</b>');
    const rest = composeDailyRecap(
      facts([], {
        ...weekend,
        focus: [{ title: 'Devis', projectTitle: 'Cuisine', deadline: '2026-11-12', durationMin: 30 }],
      }),
    );
    expect(rest.summary).toBe(
      'Week-end de repos. Une nouvelle semaine commence demain, le plan t’attend lundi matin.',
    );
    const html = recapToTelegramHtml(rest);
    expect(html).toContain('<b>En ligne de mire cette semaine</b>\n→ Devis · Cuisine (échéance 12 nov.)');
    expect(html).not.toMatch(/\b0\b|tâche faite/);
  });

  it('D-78 week streak: reached weeks in a row, the current week never breaks it, holidays are neutral', () => {
    const w = (doneMin: number, over: Partial<WeekVolume> = {}): WeekVolume => ({
      isoWeek: 'x',
      doneMin,
      budgetMin: 300,
      vacation: false,
      ...over,
    });
    expect(weekReached(w(240), 80)).toBe(true);
    expect(weekReached(w(239), 80)).toBe(false);
    // newest first: current week not reached yet, then 2 reached, a holiday week, 1 reached, a missed one.
    expect(weekStreak([w(60), w(300), w(250), w(0, { vacation: true }), w(400), w(10), w(300)], 80)).toBe(3);
    expect(weekStreak([w(300), w(0, { budgetMin: 0 }), w(300)], 80)).toBe(2);
    expect(weekStreak([w(0), w(0)], 80)).toBe(0);
    expect(isOnVacation('2026-11-02', [{ from: '2026-10-31', to: '2026-11-08' }])).toBe(true);
    expect(isOnVacation('2026-11-09', [{ from: '2026-10-31', to: '2026-11-08' }])).toBe(false);
    expect(deadlineLabel('2026-10-27', '2026-10-28')).toBe('en retard');
    expect(deadlineLabel('2026-10-28', '2026-10-28')).toBe("échéance aujourd'hui");
    expect(deadlineLabel('2026-11-03', '2026-10-28')).toBe('échéance mardi');
    expect(deadlineLabel('2026-11-04', '2026-10-28')).toBe('échéance 4 nov.');
  });

  it('the AI message is cleaned up for Telegram (known tags only, no <br>/<p>, the rest escaped)', () => {
    expect(
      sanitizeTelegramHtml('<p><b class="x">Bilan</b><br>Score < 50 & <span>ok</span></p><h1>t</h1>'),
    ).toBe('<b>Bilan</b>\nScore &lt; 50 &amp; &lt;span&gt;ok&lt;/span&gt;\n\n&lt;h1&gt;t&lt;/h1&gt;');
    expect(stripTelegramHtml('<b>a</b> &lt; b')).toBe('a < b');
  });

  it('gathers today’s done tasks, the month project, the streak, and the job sends once on Telegram', async () => {
    const ctx = makeCtx('2026-10-27T08:00:00.000Z'); // Tuesday
    const { group } = lookups(ctx);
    const p = createProject(ctx, {
      title: 'Forme',
      groupIds: [group('Sport').id],
      successCriterion: 'ok',
      startDate: '2026-10-20',
      dueDate: '2026-11-15',
    });
    const t1 = createTask(ctx, { projectId: p.id, title: 'Séance 1', durationMin: 60 });
    const t2 = createTask(ctx, { projectId: p.id, title: 'Séance 2', durationMin: 30 });
    promoteProject(ctx, p.id);
    setProjectMonth(ctx, p.id, '2026-10');
    setWeekItems(ctx, '2026-W44', [
      { taskId: t1.id, kind: 'week' },
      { taskId: t2.id, kind: 'week' },
    ]);
    completeTask(ctx, t1.id);
    ctx.setNow('2026-10-28T16:00:00.000Z'); // Wednesday 17:00
    completeTask(ctx, t2.id);
    completeProject(ctx, p.id, true);
    const r = getDailyRecap(ctx);
    expect(r.done).toEqual(['Séance 2 · Forme (30 min)']);
    expect(r.summary).toBe('Projet « Forme » bouclé et 1 tâche faite (30 min).');
    expect(r.facts.last7Days.at(-1)).toEqual({ date: '2026-10-27', doneTasks: 1, doneMin: 60 });
    expect(r.facts.week).toMatchObject({ plannedTasks: 2, doneTasks: 2, doneMin: 90, daysLeftAfterToday: 4 });
    expect(r.facts.weeks.at(-1)).toMatchObject({ isoWeek: '2026-W44', doneMin: 90, budgetMin: 360 });
    expect(r.facts.weekStreak).toBe(0); // 90 min of 6 h: not reached yet, not broken either
    const monday = getDailyRecap(ctx, '2026-10-26');
    expect(monday.nothingDone).toBe(true);
    expect(monday.summary).toContain('ça arrive');

    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }) as typeof fetch;
    try {
      // Not configured yet: waits without recording anything.
      ctx.setNow('2026-10-28T18:31:00.000Z'); // 19:31 Paris
      expect(await runDailyRecapJob(ctx, {})).toBe('skipped');
      setTelegramToken(ctx, '123456:ABC-def');
      patchSettings(ctx, { 'notify.telegram_chat_id': '42' });
      ctx.setNow('2026-10-28T18:00:00.000Z'); // 19:00: too early
      expect(await runDailyRecapJob(ctx, {})).toBe('skipped');
      ctx.setNow('2026-10-28T18:31:00.000Z');
      expect(await runDailyRecapJob(ctx, {})).toBe('done');
      expect(await runDailyRecapJob(ctx, {})).toBe('skipped'); // once a day
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe('https://api.telegram.org/bot123456:ABC-def/sendMessage');
      expect(sent[0].body.chat_id).toBe('42');
      expect(String(sent[0].body.text)).toContain('<b>📊 Bilan du mercredi 28 octobre</b>');
      // With the AI, its message is the whole report (cleaned up), written from the facts.
      let prompt = '';
      const out = await sendDailyRecap(ctx, {
        env: {},
        llm: async (req) => {
          prompt = req.user;
          return { text: '{"message":"<b>Bilan</b><br>Forme bouclé."}', model: 'fake' };
        },
      });
      expect(out.sent && out.ai).toBe(true);
      expect(prompt).toContain('"weekStreak":0');
      expect(prompt).not.toContain('streakDays');
      expect(sent[1].body.text).toBe('<b>Bilan</b>\nForme bouclé.');
      expect(sent[1].body.parse_mode).toBe('HTML');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('D-78 Sunday covers the weekend, nothing on Saturday nor during holidays, leads from the week plan', async () => {
    const ctx = makeCtx('2026-10-26T08:00:00.000Z'); // Monday W44
    const { group } = lookups(ctx);
    const p = createProject(ctx, {
      title: 'Cuisine',
      groupIds: [group('Sport').id],
      successCriterion: 'ok',
      startDate: '2026-10-20',
      dueDate: '2026-12-15',
    });
    const a = createTask(ctx, { projectId: p.id, title: 'Mesurer', durationMin: 60 });
    const b = createTask(ctx, { projectId: p.id, title: 'Devis', durationMin: 30, dueDate: '2026-10-30' });
    const c = createTask(ctx, { projectId: p.id, title: 'Commander', durationMin: 30 });
    promoteProject(ctx, p.id);
    setWeekItems(ctx, '2026-W44', [
      { taskId: a.id, kind: 'week' },
      { taskId: b.id, kind: 'week' },
      { taskId: c.id, kind: 'week' },
    ]);
    // Tuesday, nothing done yet: leads from the plan, the one due this week first.
    const tuesday = getDailyRecap(ctx, '2026-10-27');
    expect(tuesday.nothingDone).toBe(true);
    expect(tuesday.focus[0]).toBe('Devis · Cuisine (échéance vendredi)');
    expect(tuesday.focus).toHaveLength(3);

    ctx.setNow('2026-10-31T10:00:00.000Z'); // Saturday
    completeTask(ctx, a.id);
    ctx.setNow('2026-11-01T10:00:00.000Z'); // Sunday
    const sunday = getDailyRecap(ctx);
    expect(sunday.facts.mode).toBe('weekend');
    expect(sunday.facts.period).toEqual({ from: '2026-10-31', to: '2026-11-01' });
    expect(sunday.done).toEqual(['Mesurer · Cuisine (1 h)']);
    expect(sunday.title).toBe('🌿 Bilan du week-end');

    setTelegramToken(ctx, '123456:ABC-def');
    patchSettings(ctx, {
      'notify.telegram_chat_id': '42',
      'notify.daily_recap': { enabled: true, time: '19:30', ai: false },
    });
    const sent: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(String(JSON.parse(String(init?.body)).text));
      return new Response(JSON.stringify({ ok: true, result: {} }));
    }) as typeof fetch;
    try {
      ctx.setNow('2026-10-31T19:00:00.000Z'); // Saturday 20:00
      expect(await runDailyRecapJob(ctx, {})).toBe('skipped');
      ctx.setNow('2026-11-01T19:00:00.000Z'); // Sunday 20:00
      expect(await runDailyRecapJob(ctx, {})).toBe('done');
      expect(sent[0]).toContain('<b>🌿 Bilan du week-end</b>');
      // Holidays: nothing sent, the period is listed and can be removed.
      expect(addVacation(ctx, { from: '2026-11-02', to: '2026-11-08' }).periods).toHaveLength(1);
      expect(() => addVacation(ctx, { from: '2026-11-10', to: '2026-11-09' })).toThrow(/précède/);
      ctx.setNow('2026-11-04T19:00:00.000Z'); // Wednesday 20:00, on holiday
      expect(listVacations(ctx).onVacation).toBe(true);
      expect(await runDailyRecapJob(ctx, {})).toBe('skipped');
      ctx.setNow('2026-11-09T19:00:00.000Z'); // back on Monday
      expect(await runDailyRecapJob(ctx, {})).toBe('done');
      expect(sent).toHaveLength(2);
      expect(sent[1]).toContain('ça arrive');
      expect(removeVacation(ctx, '2026-11-02').periods).toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
