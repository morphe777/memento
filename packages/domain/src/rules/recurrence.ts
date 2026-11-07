import rrulePkg from 'rrule';
import { DomainError } from '../errors.ts';
import { addMonths, quarterOf } from '../time.ts';

const { RRule } = rrulePkg as unknown as typeof import('rrule');

const INVALID = () =>
  new DomainError(
    'INVALID_RECURRENCE',
    'Règle de récurrence invalide : FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, puis INTERVAL, BYDAY, BYMONTH, BYMONTHDAY.',
  );
const DAY = /^([+-]?[1-5])?(MO|TU|WE|TH|FR|SA|SU)$/;
const list = (v: string, ok: (x: string) => boolean) => v.split(',').every((x) => x !== '' && ok(x));
const intIn = (x: string, min: number, max: number) =>
  /^[+-]?\d{1,4}$/.test(x) && Number(x) >= min && Number(x) <= max && Number(x) !== 0;
/** C-05: the only keys a task recurrence may use (what the interface and the parser write), with their values. */
const KEYS: Record<string, (v: string) => boolean> = {
  FREQ: (v) => ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(v),
  INTERVAL: (v) => /^[1-9]\d{0,2}$/.test(v), // 1 to 999
  BYDAY: (v) => list(v, (x) => DAY.test(x)),
  BYMONTH: (v) => list(v, (x) => intIn(x, 1, 12)),
  BYMONTHDAY: (v) => list(v, (x) => intIn(x, -31, 31)),
};
/** C-05: a rule without any occurrence in this many years is refused (and the search never goes further). */
const HORIZON_YEARS = 10;

/**
 * C-05 (RB-11): reads a rule after checking every key and value, so that the RRULE library never receives
 * something it could loop on. Throws INVALID_RECURRENCE.
 */
function parseRule(rule: string) {
  const body = rule.replace(/^RRULE:/, '');
  const seen = new Set<string>();
  for (const part of body.split(';')) {
    const [key, value, extra] = part.split('=');
    if (extra !== undefined || !value || !KEYS[key]?.(value) || seen.has(key)) throw INVALID();
    seen.add(key);
  }
  if (!seen.has('FREQ')) throw INVALID();
  return RRule.parseString(body);
}

/** Next occurrence strictly after `referenceDate`, searched over HORIZON_YEARS at most. */
function after(options: ReturnType<typeof parseRule>, referenceDate: string): string | null {
  const dtstart = new Date(`${referenceDate}T12:00:00Z`);
  const until = new Date(
    `${Number(referenceDate.slice(0, 4)) + HORIZON_YEARS}${referenceDate.slice(4)}T12:00:00Z`,
  );
  const next = new RRule({ ...options, dtstart, until }).after(dtstart, false);
  return next ? next.toISOString().slice(0, 10) : null;
}

/** C-05: validates a task recurrence: known keys and values, and at least one occurrence within 10 years. */
export function checkRecurrenceRule(rule: string | null | undefined): void {
  if (!rule) return;
  if (!after(parseRule(rule), '2026-01-01')) throw INVALID();
}

/** RB-11 (DM-41): next occurrence date strictly after the reference date (YYYY-MM-DD). C-05: checked first. */
export function nextOccurrence(rule: string, referenceDate: string): string | null {
  return after(parseRule(rule), referenceDate);
}

/** C-05: true when a stored rule can be read (screens skip the occurrences of an invalid one). */
export function isValidRecurrenceRule(rule: string): boolean {
  try {
    checkRecurrenceRule(rule);
    return true;
  } catch {
    return false;
  }
}

export const OBJECTIVE_RECURRENCE_MONTHS = { quarterly: 3, yearly: 12 } as const;

/**
 * D-65: upcoming occurrences of a recurring objective, to show the load it will bring (map of objectives).
 * Each one is what renewal (D-62) would create: the deadline shifted by the period, chained from the previous
 * occurrence, in the quarter of that deadline. Only occurrences whose quarter is ≤ `lastQuarter` are returned.
 */
export function upcomingObjectiveOccurrences(
  o: { deadline: string; recurrence: keyof typeof OBJECTIVE_RECURRENCE_MONTHS | null },
  lastQuarter: string,
): { quarter: string; deadline: string }[] {
  if (!o.recurrence) return [];
  const out: { quarter: string; deadline: string }[] = [];
  let deadline = o.deadline;
  for (;;) {
    deadline = addMonths(deadline, OBJECTIVE_RECURRENCE_MONTHS[o.recurrence]);
    const quarter = quarterOf(deadline);
    if (quarter > lastQuarter) return out;
    out.push({ quarter, deadline });
  }
}
