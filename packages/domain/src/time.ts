// Calendar helpers. Dates are 'YYYY-MM-DD' strings (calendar days, Europe/Paris), timestamps are ISO UTC.
export const TZ = 'Europe/Paris';
const DAY = 86_400_000;

export const nowIso = (): string => new Date().toISOString();

/** Calendar date in Europe/Paris for a given instant. */
export function parisDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

const toUtc = (d: string): number => Date.parse(`${d}T00:00:00Z`);
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number): string => fromUtc(toUtc(d) + n * DAY);
export const daysBetween = (a: string, b: string): number => Math.round((toUtc(b) - toUtc(a)) / DAY);
export const isoDay = (d: string): number => {
  const w = new Date(toUtc(d)).getUTCDay();
  return w === 0 ? 7 : w; // 1 = Monday … 7 = Sunday
};

/** ISO 8601 week key, e.g. 2026-W44. */
export function isoWeekOf(d: string): string {
  const thursday = addDays(d, 4 - isoDay(d));
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function parseIsoWeek(key: string): { year: number; week: number } {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) throw new Error(`Invalid ISO week: ${key}`);
  return { year: Number(m[1]), week: Number(m[2]) };
}

/** Monday of an ISO week. */
export function weekMonday(key: string): string {
  const { year, week } = parseIsoWeek(key);
  const jan4 = `${year}-01-04`;
  const week1Monday = addDays(jan4, 1 - isoDay(jan4));
  return addDays(week1Monday, (week - 1) * 7);
}
export const weekSunday = (key: string): string => addDays(weekMonday(key), 6);
export const shiftWeek = (key: string, n: number): string => isoWeekOf(addDays(weekMonday(key), n * 7));
export const currentWeek = (at: Date = new Date()): string => isoWeekOf(parisDate(at));
export const isValidIsoWeek = (key: string): boolean => {
  try {
    return isoWeekOf(weekMonday(key)) === key;
  } catch {
    return false;
  }
};

export const monthOf = (d: string): string => d.slice(0, 7);
export const monthStart = (m: string): string => `${m}-01`;
export function monthEnd(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return fromUtc(Date.UTC(y, mo, 0));
}
/** Same day n months later, clamped to the end of the month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: string, n: number): string {
  const m = shiftMonth(d.slice(0, 7), n);
  const last = monthEnd(m);
  return `${m}-${d.slice(8, 10)}` > last ? last : `${m}-${d.slice(8, 10)}`;
}
export function shiftMonth(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export const quarterOf = (d: string): string =>
  `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
export function quarterStart(q: string): string {
  const [y, n] = [q.slice(0, 4), Number(q.slice(6))];
  return `${y}-${String((n - 1) * 3 + 1).padStart(2, '0')}-01`;
}
export const quarterEnd = (q: string): string => monthEnd(shiftMonth(monthOf(quarterStart(q)), 2));
export const shiftQuarter = (q: string, n: number): string =>
  quarterOf(`${shiftMonth(monthOf(quarterStart(q)), n * 3)}-01`);
export const isValidQuarter = (q: string): boolean => /^\d{4}-Q[1-4]$/.test(q);
export const isValidDate = (d: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(toUtc(d)) && fromUtc(toUtc(d)) === d;

const FR_MONTHS = [
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
const FR_MONTHS_LONG = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
/** "octobre" for "2026-10" (or a date). */
export const frMonth = (m: string): string => FR_MONTHS_LONG[Number(m.slice(5, 7)) - 1];
const FR_DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const frDay = (d: string): string => FR_DAYS[isoDay(d) - 1];
export const frShort = (d: string): string =>
  `${Number(d.slice(8, 10))} ${FR_MONTHS[Number(d.slice(5, 7)) - 1]}`;
/** "26 oct. – 1 nov." */
export const frWeekRange = (key: string): string =>
  `${frShort(weekMonday(key))} – ${frShort(weekSunday(key))}`;

/** "30 min", "1 h", "1 h 30" (mockups' format). */
export function fmtMin(m: number): string {
  const a = Math.abs(Math.round(m));
  if (a < 60) return `${a} min`;
  return a % 60 ? `${Math.floor(a / 60)} h ${a % 60}` : `${a / 60} h`;
}
