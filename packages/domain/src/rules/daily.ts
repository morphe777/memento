// D-76: urgency tag of « Ma semaine ». D-77 / D-78: the evening report (« Bilan du jour »): a sentence summing up
// the main achievements, the week KPIs, then the done tasks; encouragement and leads when nothing was done; the
// weekend on Sunday. Pure functions: the service gathers the data.
import { addDays, fmtMin, frDay, frShort } from '../time.ts';

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

/** D-78: the volume of an ISO week (done time vs its budget), for the week streak and the 4-week trend. */
export interface WeekVolume {
  isoWeek: string;
  doneMin: number;
  budgetMin: number;
  vacation: boolean; // at least one holiday day in the week
}

/** D-78: a lead for the coming days, when nothing was done (the engine's ranking). */
export interface FocusItem {
  title: string;
  projectTitle: string | null;
  deadline: string | null; // task deadline, else the project's end
  durationMin: number | null;
}

/** The day's facts: what the plain report shows and what the AI receives (D-77, D-78). */
export interface RecapFacts {
  date: string;
  dayLabel: string; // e.g. « mercredi 28 octobre »
  /** D-78: `weekend` on Sunday, the report then covers Saturday and Sunday. */
  mode: 'day' | 'weekend';
  period: { from: string; to: string };
  nothingDone: boolean;
  done: { tasks: RecapTask[]; doneTasks: number; doneMin: number; completedProjects: string[] };
  /** The 7 days before today, oldest first, and their daily averages. */
  last7Days: { date: string; doneTasks: number; doneMin: number }[];
  avg7: { doneTasks: number; doneMin: number };
  /** D-78: consecutive weeks at ≥ report.rhythm_low_pct of their budget (the current one counts once reached). */
  weekStreak: number;
  /** D-78: the last 4 weeks, oldest first, the current one last. */
  weeks: WeekVolume[];
  week: {
    plannedTasks: number;
    doneTasks: number;
    remainingTasks: number;
    doneMin: number;
    budgetMin: number;
    daysLeftAfterToday: number;
  };
  /** D-78: what matters in the coming days (this week; next week on Sunday). Filled when nothing was done. */
  focus: FocusItem[];
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
  mode: 'day' | 'weekend';
  nothingDone: boolean;
  title: string;
  summary: string;
  kpis: Kpi[];
  done: string[];
  focus: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const quoted = (s: string) => `« ${s} »`;
const capitalize = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

function joinFr(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}`;
}

/** D-78: is this day inside a holiday period (both ends included)? */
export const isOnVacation = (date: string, periods: { from: string; to: string }[]): boolean =>
  periods.some((p) => p.from <= date && date <= p.to);

/** D-78: a week « counts » when its done time reaches lowPct % of its budget. */
export const weekReached = (w: WeekVolume, lowPct: number): boolean =>
  w.budgetMin > 0 && w.doneMin * 100 >= lowPct * w.budgetMin;

/**
 * D-78: consecutive weeks reached, newest first (`weeks[0]` is the current week). The current week adds one
 * once reached and never breaks the streak before it ends; a holiday week or a week with a zero budget is
 * neutral (neither counts nor breaks).
 */
export function weekStreak(weeks: WeekVolume[], lowPct: number): number {
  let n = 0;
  for (const [i, w] of weeks.entries()) {
    if (weekReached(w, lowPct)) n++;
    else if (i > 0 && !w.vacation && w.budgetMin > 0) break;
  }
  return n;
}

/** One sentence naming the main achievements, most meaningful first (projects, experiences, objectives…). */
export function achievementsSentence(f: RecapFacts): string {
  const t = f.done.tasks;
  const parts: string[] = [];
  for (const p of f.done.completedProjects) parts.push(`projet ${quoted(p)} bouclé`);
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
  const work = `${plural(f.done.doneTasks, 'tâche faite', 'tâches faites')}${f.done.doneMin ? ` (${fmtMin(f.done.doneMin)})` : ''}`;
  return `${capitalize(joinFr([...parts.slice(0, 3), work]))}.`;
}

/** D-78: « échéance vendredi » within a week, « échéance 4 nov. » beyond, « en retard » when passed. */
export function deadlineLabel(deadline: string, today: string): string {
  if (deadline < today) return 'en retard';
  if (deadline === today) return "échéance aujourd'hui";
  return `échéance ${deadline <= addDays(today, 6) ? frDay(deadline) : frShort(deadline)}`;
}

const pct = (doneMin: number, budgetMin: number) => `${Math.round((doneMin / budgetMin) * 100)} %`;

/**
 * D-77 / D-78: the plain report (also the fallback when the AI is off or fails). Something done: the
 * achievements, the week KPIs, the done tasks. Nothing done: encouragement and what matters in the coming days,
 * never a zero. On Sunday it covers the weekend.
 */
export function composeDailyRecap(f: RecapFacts, lowPct = 80): Recap {
  const weekend = f.mode === 'weekend';
  const title = weekend
    ? '🌿 Bilan du week-end'
    : f.nothingDone
      ? `🌱 ${capitalize(f.dayLabel)}`
      : `📊 Bilan du ${f.dayLabel}`;
  const kpis: Kpi[] = [];
  if (f.week.budgetMin > 0 && f.week.doneMin > 0)
    kpis.push({
      icon: '📈',
      label: 'Semaine',
      value: `${fmtMin(f.week.doneMin)} / ${fmtMin(f.week.budgetMin)}`,
      note: pct(f.week.doneMin, f.week.budgetMin),
    });
  if (f.weekStreak > 0)
    kpis.push({ icon: '🗓', label: 'Semaines d’affilée', value: String(f.weekStreak), note: `≥ ${lowPct} %` });
  if (!f.nothingDone && f.weeks.length > 1)
    kpis.push({
      icon: '📦',
      label: `${f.weeks.length} semaines`,
      value: f.weeks.map((w) => (w.vacation && !w.doneMin ? '🏖' : fmtMin(w.doneMin))).join(' · '),
    });
  const done = f.done.tasks.map(
    (t) =>
      `${t.title}${t.projectTitle ? ` · ${t.projectTitle}` : ''}${t.durationMin ? ` (${fmtMin(t.durationMin)})` : ''}`,
  );
  const focus = f.nothingDone
    ? f.focus.map(
        (x) =>
          `${x.title}${x.projectTitle ? ` · ${x.projectTitle}` : ''}${x.deadline ? ` (${deadlineLabel(x.deadline, f.date)})` : ''}`,
      )
    : [];
  let summary: string;
  if (!f.nothingDone) {
    const s = achievementsSentence(f);
    summary = weekend ? `Ce week-end : ${s.charAt(0).toLowerCase()}${s.slice(1)} Bien joué.` : s;
  } else if (weekend)
    summary = focus.length
      ? 'Week-end de repos. Une nouvelle semaine commence demain, le plan t’attend lundi matin.'
      : 'Week-end de repos. Une nouvelle semaine commence demain, le plan t’attend lundi matin : rien d’urgent en vue.';
  else {
    const already = f.week.doneTasks
      ? ` Déjà ${plural(f.week.doneTasks, 'tâche faite', 'tâches faites')} cette semaine.`
      : '';
    const rest =
      f.week.plannedTasks > 0 && f.week.remainingTasks === 0
        ? ' Ta semaine est déjà bouclée.'
        : focus.length
          ? ''
          : ' Rien d’urgent en vue : avance à ton rythme.';
    summary = `Pas de tâche cochée aujourd'hui, ça arrive : la semaine se joue sur plusieurs jours.${already}${rest}`;
  }
  return { date: f.date, mode: f.mode, nothingDone: f.nothingDone, title, summary, kpis, done, focus };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Telegram message (HTML parse mode) of the plain report. */
export function recapToTelegramHtml(r: Recap): string {
  const lines = [`<b>${escapeHtml(r.title)}</b>`, '', escapeHtml(r.summary)];
  if (r.kpis.length) lines.push('');
  for (const k of r.kpis)
    lines.push(
      `${k.icon} ${escapeHtml(k.label)} : <b>${escapeHtml(k.value)}</b>${k.note ? ` (${escapeHtml(k.note)})` : ''}`,
    );
  const weekend = r.mode === 'weekend';
  if (r.done.length)
    lines.push(
      '',
      `<b>${weekend ? 'Fait ce week-end' : 'Fait aujourd’hui'}</b>`,
      ...r.done.map((d) => `✓ ${escapeHtml(d)}`),
    );
  if (r.focus.length)
    lines.push(
      '',
      `<b>${weekend ? 'En ligne de mire cette semaine' : 'Ce qui compte ces prochains jours'}</b>`,
      ...r.focus.map((d) => `→ ${escapeHtml(d)}`),
    );
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
