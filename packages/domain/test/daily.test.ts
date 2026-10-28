import { describe, expect, it } from 'vitest';
import {
  achievementsSentence,
  composeDailyRecap,
  deadlineUrgency,
  type RecapFacts,
  type RecapTask,
  recapToTelegramHtml,
  sanitizeTelegramHtml,
  stripTelegramHtml,
} from '../src/rules/daily.ts';
import { getDailyRecap, sendDailyRecap, setTelegramToken } from '../src/services/daily.ts';
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
  today: {
    tasks,
    doneTasks: tasks.length,
    doneMin: tasks.filter((t) => !t.isExperience).reduce((a, t) => a + t.durationMin, 0),
    completedProjects: [],
  },
  last7Days: [],
  avg7: { doneTasks: 0, doneMin: 0 },
  streakDays: 1,
  week: { plannedTasks: 0, doneTasks: 0, remainingTasks: 0, doneMin: 0, budgetMin: 0, daysLeftAfterToday: 4 },
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
  it('a report: one sentence of achievements, the streak and week KPIs, then the done tasks', () => {
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
    const f = facts(tasks, { streakDays: 4 });
    f.today.completedProjects = ['Vélo'];
    f.week = { ...f.week, doneMin: 270, budgetMin: 360 };
    const r = composeDailyRecap(f);
    expect(r.title).toBe('📊 Bilan du mercredi 28 octobre');
    expect(r.summary).toBe(
      'Projet « Vélo » bouclé, expérience « Appeler mamie » vécue, « Impôts » enfin fait et 3 tâches faites (1 h).',
    );
    expect(r.kpis).toEqual([
      { icon: '🔥', label: 'Série', value: '4 jours' },
      { icon: '📈', label: 'Semaine', value: '4 h 30 / 6 h', note: '75 %' },
    ]);
    const html = recapToTelegramHtml({ ...r, done: ['a < b'] });
    expect(html).toContain('🔥 Série : <b>4 jours</b>');
    expect(html).toContain('a &lt; b');
    expect(html).not.toMatch(/Salut|Bravo/);
    expect(achievementsSentence(facts([task()]))).toBe('1 tâche faite (30 min).');
  });

  it('a day without anything done is empty', () => {
    expect(composeDailyRecap(facts([])).empty).toBe(true);
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
    expect(r.kpis[0].value).toBe('2 jours');
    expect(r.facts.last7Days.at(-1)).toEqual({ date: '2026-10-27', doneTasks: 1, doneMin: 60 });
    expect(r.facts.week).toMatchObject({ plannedTasks: 2, doneTasks: 2, doneMin: 90, daysLeftAfterToday: 4 });
    expect(getDailyRecap(ctx, '2026-10-26').empty).toBe(true);

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
      expect(prompt).toContain('"streakDays":2');
      expect(sent[1].body.text).toBe('<b>Bilan</b>\nForme bouclé.');
      expect(sent[1].body.parse_mode).toBe('HTML');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
