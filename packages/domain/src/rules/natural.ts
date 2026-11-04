// D-115 (user request 04/11/2026): a task typed in plain French — « Appeler le garage demain 15 min #maison »,
// « Sortir les poubelles tous les mardis ». Deterministic (no AI: instant, works offline, always the same
// answer). What is recognised is taken out of the title and shown as chips the user can undo; text between
// quotes is never read. Recurrence, domain and « cette semaine » are for Inbox tasks only (DM-41).
import { addDays, addMonths, isoDay, isoWeekOf, monthEnd, monthOf, weekMonday, weekSunday } from '../time.ts';
import { nextOccurrence } from './recurrence.ts';

export type NaturalKind = 'date' | 'recurrence' | 'duration' | 'domain' | 'week';
export const NATURAL_KINDS = ['date', 'recurrence', 'duration', 'domain', 'week'] as const;

export interface NaturalPart {
  kind: NaturalKind;
  /** The words as typed. */
  text: string;
  /** What they were read as, in French. */
  label: string;
  /** Something to check: a conflict, a rounding, an unknown domain. */
  warning?: string;
}

export interface NaturalTask {
  title: string;
  dueDate: string | null;
  recurrenceRule: string | null;
  durationMin: number | null;
  domainId: string | null;
  /** « cette semaine »: the task goes to the plan of the current week, not to a deadline. */
  week: boolean;
  parts: NaturalPart[];
}

export interface NaturalOptions {
  /** Today in Paris (YYYY-MM-DD). */
  today: string;
  domains?: { id: string; name: string }[];
  /** Inbox task: recurrence, domain and week are read (false for a project task). */
  inbox?: boolean;
  /** Kinds the user undid: their words stay in the title. */
  ignore?: readonly NaturalKind[];
}

const B = '(?<![a-z0-9])';
const E = '(?![a-z0-9])';
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const WD = `(${WEEKDAYS.join('|')})`;
const MONTHS: [string, number][] = [
  ['janvier', 1],
  ['janv', 1],
  ['fevrier', 2],
  ['fevr', 2],
  ['fev', 2],
  ['mars', 3],
  ['avril', 4],
  ['avr', 4],
  ['mai', 5],
  ['juin', 6],
  ['juillet', 7],
  ['juil', 7],
  ['aout', 8],
  ['septembre', 9],
  ['sept', 9],
  ['octobre', 10],
  ['oct', 10],
  ['novembre', 11],
  ['nov', 11],
  ['decembre', 12],
  ['dec', 12],
];
const MON = `(${MONTHS.map((m) => m[0]).join('|')})\\.?`;
const WORDS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
};
const NUM = `(\\d{1,3}|${Object.keys(WORDS).join('|')})`;
const DAYNUM = '(1er|premier|\\d{1,2})';
const PRE = "(?:(?:pour|avant|d'ici|au plus tard|a partir d[eu]|jusqu'au|jusqu'a)\\s+)?";
const MONTH_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
const DAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
/** RB-03 (D-67): the allowed durations. */
const DURATIONS = [5, 15, 30, 60, 120];

const num = (s: string) => WORDS[s] ?? Number(s);
const dayNum = (s: string) => (s === '1er' || s === 'premier' ? 1 : Number(s));
const monthNum = (s: string) => MONTHS.find((m) => m[0] === s.replace('.', ''))![1];
const wdIndex = (s: string) => WEEKDAYS.indexOf(s.replace(/s$/, '')); // 0 = Monday
const pad = (n: number) => String(n).padStart(2, '0');

/** « ven. 14 nov. » (+ the year when it is not the current one). */
export function naturalDateLabel(d: string, today: string): string {
  const [y, m, day] = d.split('-').map(Number);
  const base = `${DAY_SHORT[isoDay(d) - 1]} ${day} ${MONTH_SHORT[m - 1]}`;
  return y === Number(today.slice(0, 4)) ? base : `${base} ${y}`;
}

/** Lower case, no accents, typographic apostrophes as ', one char for one char (offsets are kept). */
function normalize(text: string): string {
  let out = '';
  for (const c of text) {
    if (c === '’' || c === 'ʼ') out += "'";
    else {
      const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      out += n.length === c.length ? n : c.toLowerCase().length === c.length ? c.toLowerCase() : c;
    }
  }
  return out;
}

/** The next day (strictly after today) with the given day of week (0 = Monday). */
function nextWeekday(today: string, wd: number): string {
  const diff = (wd + 1 - isoDay(today) + 7) % 7 || 7;
  return addDays(today, diff);
}

/** A day / month without a year: this year, or next year once it is past. */
function upcoming(today: string, month: number, day: number, year?: number): string | null {
  const y = year ?? Number(today.slice(0, 4));
  const d = `${y}-${pad(month)}-${pad(day)}`;
  if (Number.isNaN(Date.parse(`${d}T00:00:00Z`)) || new Date(`${d}T00:00:00Z`).getUTCDate() !== day)
    return null;
  if (year === undefined && d < today) return upcoming(today, month, day, y + 1);
  return d;
}

/** « le 14 »: this month if still to come, else next month. */
function upcomingDayOfMonth(today: string, day: number): string | null {
  for (let i = 0; i < 3; i++) {
    const m = monthOf(addMonths(`${today.slice(0, 7)}-01`, i));
    const d = `${m}-${pad(day)}`;
    if (day <= Number(monthEnd(m).slice(8)) && d >= today) return d;
  }
  return null;
}

function weekdayList(first: string, rest: string): number[] {
  const all = [first, ...(rest.match(new RegExp(WD, 'g')) ?? [])].map(wdIndex);
  return [...new Set(all)].sort();
}

function dayListLabel(days: number[]): string {
  const names = days.map((d) => WEEKDAYS[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`;
}

interface Rule {
  kind: NaturalKind;
  re: RegExp;
  read: (m: RegExpExecArray, today: string) => Reading | null;
}
interface Reading {
  label: string;
  date?: string;
  rule?: string;
  /** A date written out (« 14 novembre », « 14/11 »): it wins over « demain », « lundi »… */
  explicit?: boolean;
  minutes?: number;
}

const rx = (s: string) => new RegExp(`${B}(?:${s})${E}`, 'g');

const RECURRENCE: Rule[] = [
  {
    kind: 'recurrence',
    re: rx(
      '(?:tous les jours (?:de (?:la )?semaine|ouvres?|ouvrables?)|du lundi au vendredi|les jours ouvres?|en semaine)',
    ),
    read: () => ({ label: 'chaque jour de semaine', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }),
  },
  {
    kind: 'recurrence',
    re: rx(`(?:tous les|toutes les) ${NUM} jours`),
    read: (m) => {
      const n = num(m[1]);
      return n >= 1 ? { label: `tous les ${n} jours`, rule: `FREQ=DAILY;INTERVAL=${n}` } : null;
    },
  },
  {
    kind: 'recurrence',
    re: rx('(?:tous les jours|chaque jour|quotidiennement|quotidien(?:ne)?)'),
    read: () => ({ label: 'chaque jour', rule: 'FREQ=DAILY' }),
  },
  {
    kind: 'recurrence',
    re: rx(`(?:toutes les) ${NUM} semaines(?: (?:le |les )?${WD}s?)?`),
    read: (m) => {
      const n = num(m[1]);
      if (n < 1) return null;
      const by = m[2] ? `;BYDAY=${BYDAY[wdIndex(m[2])]}` : '';
      return {
        label: `toutes les ${n} semaines${m[2] ? ` le ${m[2]}` : ''}`,
        rule: `FREQ=WEEKLY;INTERVAL=${n}${by}`,
      };
    },
  },
  {
    kind: 'recurrence',
    re: rx(`(?:(?:tous les|chaque) ${WD}s?|les ${WD}s)((?:\\s*(?:,|et)\\s*(?:le |les )?${WD}s?)*)`),
    read: (m) => {
      const days = weekdayList(m[1] ?? m[2], m[3] ?? '');
      return {
        label: `chaque ${dayListLabel(days)}`,
        rule: `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d]).join(',')}`,
      };
    },
  },
  {
    kind: 'recurrence',
    re: rx(
      `(?:toutes les semaines|chaque semaine|hebdomadaire(?:ment)?|une fois par semaine)(?: (?:le )?${WD})?`,
    ),
    read: (m) =>
      m[1]
        ? { label: `chaque ${m[1]}`, rule: `FREQ=WEEKLY;BYDAY=${BYDAY[wdIndex(m[1])]}` }
        : { label: 'chaque semaine', rule: 'FREQ=WEEKLY' },
  },
  {
    kind: 'recurrence',
    re: rx(`(?:tous les|chaque) (?:trimestres?)|trimestriel(?:le)?(?:ment)?`),
    read: () => ({ label: 'chaque trimestre', rule: 'FREQ=MONTHLY;INTERVAL=3' }),
  },
  {
    kind: 'recurrence',
    re: rx(`tous les ${NUM} mois(?: le ${DAYNUM})?`),
    read: (m) => {
      const n = num(m[1]);
      if (n < 1) return null;
      const by = m[2] ? `;BYMONTHDAY=${dayNum(m[2])}` : '';
      return {
        label: `tous les ${n} mois${m[2] ? ` le ${dayNum(m[2])}` : ''}`,
        rule: `FREQ=MONTHLY;INTERVAL=${n}${by}`,
      };
    },
  },
  {
    kind: 'recurrence',
    re: rx(
      `(?:(?:tous les mois|chaque mois|mensuel(?:le)?(?:ment)?|une fois par mois)(?: le ${DAYNUM})?|(?:le |tous les )?${DAYNUM} (?:de chaque mois|du mois|de tous les mois))`,
    ),
    read: (m) => {
      const d = m[1] ?? m[2];
      if (d && (dayNum(d) < 1 || dayNum(d) > 31)) return null;
      return d
        ? { label: `chaque mois le ${dayNum(d)}`, rule: `FREQ=MONTHLY;BYMONTHDAY=${dayNum(d)}` }
        : { label: 'chaque mois', rule: 'FREQ=MONTHLY' };
    },
  },
  {
    kind: 'recurrence',
    re: rx(
      `(?:(?:tous les ans|chaque annee|chaque an|annuel(?:le)?(?:ment)?|une fois par an)(?: le ${DAYNUM} ${MON})?|(?:chaque|tous les) ${DAYNUM} ${MON})`,
    ),
    read: (m, today) => {
      const d = m[1] ?? m[3];
      const mo = m[2] ?? m[4];
      if (!d) return { label: 'chaque année', rule: 'FREQ=YEARLY' };
      if (!upcoming(today, monthNum(mo), dayNum(d))) return null;
      return {
        label: `chaque année le ${dayNum(d)} ${MONTH_SHORT[monthNum(mo) - 1]}`,
        rule: `FREQ=YEARLY;BYMONTH=${monthNum(mo)};BYMONTHDAY=${dayNum(d)}`,
      };
    },
  },
];

const WEEK: Rule[] = [
  {
    kind: 'week',
    re: rx("(?:pour |d'ici la fin de |dans )?cette semaine"),
    read: () => ({ label: 'plan de cette semaine' }),
  },
];

const DATE_EXPLICIT: Rule[] = [
  {
    kind: 'date',
    re: rx(`${PRE}(?:(?:le|ce) )?(?:${WD} )?${DAYNUM}(?: ${MON}(?: (\\d{4}))?)?`),
    read: (m, today) => {
      const [all, wd, d, mo, y] = m;
      // A lone number is a date only with « le » or a weekday before it (« 3 pommes » is not).
      if (!mo && !wd && !/(?:^|\s)le\s/.test(` ${all}`)) return null;
      const day = dayNum(d);
      const date = mo
        ? upcoming(today, monthNum(mo), day, y ? Number(y) : undefined)
        : upcomingDayOfMonth(today, day);
      if (!date) return null;
      const r: Reading = { label: naturalDateLabel(date, today), date, explicit: true };
      return r;
    },
  },
  {
    kind: 'date',
    re: rx(`${PRE}(?:le )?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?`),
    read: (m, today) => {
      const y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined;
      const date = upcoming(today, Number(m[2]), Number(m[1]), y);
      return date ? { label: naturalDateLabel(date, today), date, explicit: true } : null;
    },
  },
];

const DATE_RELATIVE: Rule[] = [
  {
    kind: 'date',
    re: rx(`${PRE}(?:aujourd'hui|aujourdhui|ce soir|ce matin|ce midi|cet apres-midi|cet aprem)`),
    read: (_m, today) => ({ label: "aujourd'hui", date: today }),
  },
  {
    kind: 'date',
    re: rx(`${PRE}apres[- ]demain`),
    read: (_m, today) => ({ label: naturalDateLabel(addDays(today, 2), today), date: addDays(today, 2) }),
  },
  {
    kind: 'date',
    re: rx(`${PRE}demain(?: (?:matin|soir|midi|apres-midi))?`),
    read: (_m, today) => ({
      label: `demain, ${naturalDateLabel(addDays(today, 1), today)}`,
      date: addDays(today, 1),
    }),
  },
  {
    kind: 'date',
    re: rx(`${PRE}dans ${NUM} (jours?|semaines?|mois)`),
    read: (m, today) => {
      const n = num(m[1]);
      const date = m[2].startsWith('jour')
        ? addDays(today, n)
        : m[2].startsWith('semaine')
          ? addDays(today, 7 * n)
          : addMonths(today, n);
      return { label: naturalDateLabel(date, today), date };
    },
  },
  {
    kind: 'date',
    re: rx(`${PRE}(?:la )?semaine prochaine`),
    read: (_m, today) => {
      const date = weekSunday(isoWeekOf(addDays(today, 7)));
      return { label: `fin de semaine prochaine, ${naturalDateLabel(date, today)}`, date };
    },
  },
  {
    kind: 'date',
    re: rx(`${PRE}(?:ce |le )week-?end`),
    read: (_m, today) => {
      const date = isoDay(today) >= 6 ? today : addDays(weekMonday(isoWeekOf(today)), 5);
      return { label: `ce week-end, ${naturalDateLabel(date, today)}`, date };
    },
  },
  {
    kind: 'date',
    re: rx(`${PRE}(?:a la |en )?fin (?:du mois|de ce mois|de mois|de (?:la )?semaine|de l'annee|d'annee)`),
    read: (m, today) => {
      const date = /mois/.test(m[0])
        ? monthEnd(monthOf(today))
        : /semaine/.test(m[0])
          ? weekSunday(isoWeekOf(today))
          : `${today.slice(0, 4)}-12-31`;
      return { label: naturalDateLabel(date, today), date };
    },
  },
  {
    kind: 'date',
    // User choice 04/11/2026: « lundi » said on a Monday is next Monday.
    re: rx(`${PRE}(?:ce |le )?${WD}(?: prochain| qui vient)?`),
    read: (m, today) => {
      const date = nextWeekday(today, wdIndex(m[1]));
      return { label: naturalDateLabel(date, today), date };
    },
  },
];

const NOT_TIME = "(?<!(?:a|vers|avant|apres|de|des|jusqu'a|entre|et) )";
const DURATION: Rule[] = [
  {
    kind: 'duration',
    re: rx(`(?:en |pendant |~ ?)?${NOT_TIME}(\\d{1,2}) ?h ?(\\d{2})?(?:min)?`),
    read: (m) => ({ label: '', minutes: Number(m[1]) * 60 + Number(m[2] ?? 0) }),
  },
  {
    kind: 'duration',
    re: rx(`(?:en |pendant |~ ?)?(?:(\\d{1,2}|une|un) heures?|(une )?demi[- ]heure|un quart d'heure)`),
    read: (m) => ({ label: '', minutes: m[1] ? num(m[1]) * 60 : /quart/.test(m[0]) ? 15 : 30 }),
  },
  {
    kind: 'duration',
    re: rx(`(?:en |pendant |~ ?)?(\\d{1,3}) ?(?:minutes?|mins?|mn)`),
    read: (m) => ({ label: '', minutes: Number(m[1]) }),
  },
];

const fmtDuration = (min: number) => (min < 60 ? `${min} min` : `${min / 60} h`);

/** RB-03: the closest allowed duration (the longer one on a tie). */
export function roundDuration(min: number): number {
  return DURATIONS.reduce((best, d) => (Math.abs(d - min) <= Math.abs(best - min) ? d : best), DURATIONS[0]);
}

const key = (s: string) => normalize(s).replace(/[^a-z0-9]/g, '');

export function parseTaskText(text: string, opts: NaturalOptions): NaturalTask {
  const { today } = opts;
  const inbox = opts.inbox ?? true;
  const ignore = new Set(opts.ignore ?? []);
  const norm = normalize(text);
  // Quoted text is never read, its quotes are dropped from the title.
  const used = new Array<boolean>(text.length).fill(false);
  const drop = new Array<boolean>(text.length).fill(false);
  for (const q of norm.matchAll(/"[^"]*"|«[^»]*»/g)) {
    for (let i = q.index; i < q.index + q[0].length; i++) used[i] = true;
    drop[q.index] = true;
    drop[q.index + q[0].length - 1] = true;
  }
  const masked = () => [...norm].map((c, i) => (used[i] ? '\u0000' : c)).join('');
  const take = (start: number, len: number) => {
    for (let i = start; i < start + len; i++) used[i] = drop[i] = true;
  };
  const found: { kind: NaturalKind; text: string; at: number; r: Reading }[] = [];
  const run = (rules: Rule[]) => {
    for (const rule of rules) {
      const s = masked();
      for (const m of s.matchAll(rule.re)) {
        if (m[0].includes('\u0000')) continue;
        const r = rule.read(m as unknown as RegExpExecArray, today);
        if (!r) continue;
        // Undone by the user: the words stay in the title and are not read as anything else.
        if (ignore.has(rule.kind)) {
          for (let i = m.index; i < m.index + m[0].length; i++) used[i] = true;
          continue;
        }
        take(m.index, m[0].length);
        found.push({
          kind: rule.kind,
          text: text.slice(m.index, m.index + m[0].length).trim(),
          at: m.index,
          r,
        });
      }
    }
  };
  if (inbox) run(RECURRENCE);
  if (inbox) run(WEEK);
  run(DATE_EXPLICIT);
  run(DATE_RELATIVE);
  run(DURATION);

  const parts: NaturalPart[] = [];
  const first = (k: NaturalKind) => found.filter((f) => f.kind === k).sort((a, b) => a.at - b.at);

  // Dates: an explicit one wins over « demain », « lundi »… (user choice 04/11/2026), the gap is flagged.
  const dates = first('date').sort((a, b) => Number(!!b.r.explicit) - Number(!!a.r.explicit));
  let dueDate: string | null = dates[0]?.r.date ?? null;
  if (dates[0]) {
    const other = dates.slice(1).filter((d) => d.r.date !== dueDate);
    parts.push({
      kind: 'date',
      text: dates.map((d) => d.text).join(' · '),
      label: dates[0].r.label,
      ...(other.length ? { warning: `« ${other.map((d) => d.text).join(', ')} » ignoré` } : {}),
    });
  }

  const recs = first('recurrence');
  let recurrenceRule: string | null = null;
  if (recs[0]) {
    recurrenceRule = recs[0].r.rule!;
    // RB-11: a recurring task has a first occurrence: the date written, else the first one from today.
    if (!dueDate)
      dueDate = /BYDAY|BYMONTHDAY/.test(recurrenceRule)
        ? (nextOccurrence(recurrenceRule, addDays(today, -1)) ?? today)
        : today;
    parts.push({
      kind: 'recurrence',
      text: recs.map((r) => r.text).join(' · '),
      label: `${recs[0].r.label}, dès ${dueDate === today ? "aujourd'hui" : naturalDateLabel(dueDate, today)}`,
      ...(recs.length > 1 ? { warning: 'la 1re seulement' } : {}),
    });
  }

  const week = first('week').length > 0;
  if (week) parts.push({ kind: 'week', text: first('week')[0].text, label: 'plan de cette semaine' });

  const durs = first('duration');
  let durationMin: number | null = null;
  if (durs[0]) {
    const asked = durs[0].r.minutes!;
    durationMin = roundDuration(asked);
    parts.push({
      kind: 'duration',
      text: durs[0].text,
      label: fmtDuration(durationMin),
      ...(asked !== durationMin
        ? {
            warning:
              asked > 120
                ? '2 h max, à découper'
                : `arrondi (${asked >= 60 ? `${Math.floor(asked / 60)} h ${pad(asked % 60)}` : `${asked} min`})`,
          }
        : {}),
    });
  }

  let domainId: string | null = null;
  if (inbox && !ignore.has('domain')) {
    const s = masked();
    const tag = /(?<![^\s(])#([a-z0-9][a-z0-9_&-]*)/g.exec(s);
    if (tag) {
      const k = key(tag[1]);
      const list = (opts.domains ?? []).map((d) => ({ ...d, k: key(d.name) }));
      const hit = list.find((d) => d.k === k) ?? list.find((d) => d.k.startsWith(k));
      const typed = text.slice(tag.index, tag.index + tag[0].length);
      if (hit) {
        domainId = hit.id;
        take(tag.index, tag[0].length);
        parts.push({ kind: 'domain', text: typed, label: hit.name });
      } else
        parts.push({
          kind: 'domain',
          text: typed,
          label: typed,
          warning: 'inconnu',
        });
    }
  }

  return { title: cleanTitle(text, drop), dueDate, recurrenceRule, durationMin, domainId, week, parts };
}

const DANGLING = /(?:^|\s)(?:pour|avant|le|la|les|a|à|au|aux|de|du|d'|et|ou|dès|des|en|,|;|:|-|–|—)$/i;
const LEADING = /^(?:,|;|:|-|–|—|et)(?:\s|$)/i;

function cleanTitle(text: string, drop: boolean[]): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += drop[i] ? ' ' : text[i];
  let t = out
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.!?])/g, '$1')
    .trim();
  for (let i = 0; i < 5; i++) {
    const before = t;
    t = t
      .replace(DANGLING, '')
      .replace(LEADING, '')
      .replace(/[\s,;:]+$/, '')
      .trim();
    if (t === before) break;
  }
  const typed = text.trimStart()[0];
  if (t && typed && typed !== typed.toLowerCase() && t[0] === t[0].toLowerCase())
    t = t[0].toUpperCase() + t.slice(1);
  return t;
}
