// D-76: urgency tag of « Ma semaine ». D-77: the evening report (« Bilan du jour »): a sentence summing up the
// main achievements, the KPIs (streak, week), then the done tasks. Pure functions: the service gathers the data.
import { addDays, fmtMin } from '../time.ts';

export type Urgency = 'late' | 'today' | 'soon' | null;

/**
 * D-76: deadline of the task (else the end of its project) compared with today.
 * `late` passed, `today` due today, `soon` due tomorrow or the day after, null otherwise or without deadline.
 */
export function deadlineUrgency(deadline: string | null | undefined, today: string): Urgency {
  if (!deadline) return null;
  if (deadline < today) return 'late';
  if (deadline === today) return 'today';
  if (deadline <= addDays(today, 2)) return 'soon';
  return null;
}

export interface RecapTask {
  title: string;
  durationMin: number; // actual time if entered, else the estimate
  isExperience: boolean;
  domainName: string;
  projectTitle: string | null;
  isMonthProject: boolean;
  objectiveTitle: string | null;
  objectiveCriticality: number | null; // 1 to 3
  deadline: string | null; // task deadline only
  postponeCount: number;
}

/** The day's facts: what the plain report shows and what the AI receives (D-77). */
export interface RecapFacts {
  date: string;
  dayLabel: string; // e.g. « mercredi 28 octobre »
  today: { tasks: RecapTask[]; doneTasks: number; doneMin: number; completedProjects: string[] };
  /** The 7 days before today, oldest first, and their daily averages. */
  last7Days: { date: string; doneTasks: number; doneMin: number }[];
  avg7: { doneTasks: number; doneMin: number };
  streakDays: number; // consecutive days with at least one done task, today included
  week: {
    plannedTasks: number;
    doneTasks: number;
    remainingTasks: number;
    doneMin: number;
    budgetMin: number;
    daysLeftAfterToday: number;
  };
  projects: { active: number; month: number; monthLimit: number };
  experiences: { done: number; target: number; windowWeeks: number };
}

export interface Kpi {
  icon: string;
  label: string;
  value: string;
  note?: string;
}

export interface Recap {
  date: string;
  empty: boolean;
  title: string;
  summary: string;
  kpis: Kpi[];
  done: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const quoted = (s: string) => `« ${s} »`;

function joinFr(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}`;
}

/** One sentence naming the main achievements, most meaningful first (projects, experiences, objectives…). */
export function achievementsSentence(f: RecapFacts): string {
  const t = f.today.tasks;
  const parts: string[] = [];
  for (const p of f.today.completedProjects) parts.push(`projet ${quoted(p)} bouclé`);
  for (const x of t.filter((x) => x.isExperience)) parts.push(`expérience ${quoted(x.title)} vécue`);
  for (const x of t.filter((x) => x.postponeCount >= 2)) parts.push(`${quoted(x.title)} enfin fait`);
  const objectives = [
    ...new Map(t.filter((x) => x.objectiveTitle).map((x) => [x.objectiveTitle as string, x])).values(),
  ]
    .sort((a, b) => (b.objectiveCriticality ?? 1) - (a.objectiveCriticality ?? 1))
    .slice(0, 3)
    .map((x) => quoted(x.objectiveTitle as string));
  if (objectives.length === 1) parts.push(`l'objectif ${objectives[0]} avance`);
  if (objectives.length > 1) parts.push(`les objectifs ${joinFr(objectives)} avancent`);
  const work = `${plural(f.today.doneTasks, 'tâche faite', 'tâches faites')}${f.today.doneMin ? ` (${fmtMin(f.today.doneMin)})` : ''}`;
  const s = joinFr([...parts.slice(0, 3), work]);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** D-77: the plain report (also the fallback when the AI is off or fails). Empty when nothing was done. */
export function composeDailyRecap(f: RecapFacts): Recap {
  const title = `📊 Bilan du ${f.dayLabel}`;
  if (f.today.doneTasks === 0 && f.today.completedProjects.length === 0)
    return { date: f.date, empty: true, title, summary: '', kpis: [], done: [] };
  const kpis: Kpi[] = [{ icon: '🔥', label: 'Série', value: plural(f.streakDays, 'jour') }];
  if (f.week.budgetMin > 0)
    kpis.push({
      icon: '📈',
      label: 'Semaine',
      value: `${fmtMin(f.week.doneMin)} / ${fmtMin(f.week.budgetMin)}`,
      note: `${Math.round((f.week.doneMin / f.week.budgetMin) * 100)} %`,
    });
  const done = f.today.tasks.map(
    (t) =>
      `${t.title}${t.projectTitle ? ` · ${t.projectTitle}` : ''}${t.durationMin ? ` (${fmtMin(t.durationMin)})` : ''}`,
  );
  return { date: f.date, empty: false, title, summary: achievementsSentence(f), kpis, done };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram message (HTML parse mode) of the plain report. */
export function recapToTelegramHtml(r: Recap): string {
  const lines = [`<b>${escapeHtml(r.title)}</b>`, '', escapeHtml(r.summary), ''];
  for (const k of r.kpis)
    lines.push(
      `${k.icon} ${escapeHtml(k.label)} : <b>${escapeHtml(k.value)}</b>${k.note ? ` (${escapeHtml(k.note)})` : ''}`,
    );
  if (r.done.length) lines.push('', '<b>Fait aujourd’hui</b>', ...r.done.map((d) => `✓ ${escapeHtml(d)}`));
  return lines.join('\n');
}

const TELEGRAM_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'blockquote',
]);
export const TELEGRAM_MAX = 4096;

/**
 * D-77: the AI's message as Telegram accepts it. Telegram's HTML mode knows only a few tags and no <br>/<p>:
 * line breaks become newlines, the known tags are kept (without attributes), anything else is escaped.
 */
export function sanitizeTelegramHtml(text: string): string {
  const out = text
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*/gi, '\n\n')
    .replace(/<p(\s[^>]*)?>/gi, '')
    .split(/(<\/?[a-zA-Z]+[^<>]*>)/)
    .map((part) => {
      const m = /^<(\/?)([a-zA-Z]+)[^<>]*>$/.exec(part);
      if (m && TELEGRAM_TAGS.has(m[2].toLowerCase())) return `<${m[1]}${m[2].toLowerCase()}>`;
      return part
        .replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out.length > TELEGRAM_MAX ? `${out.slice(0, TELEGRAM_MAX - 1)}…` : out;
}

/** Plain-text fallback when Telegram still refuses the HTML (unbalanced tags…). */
export const stripTelegramHtml = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
