import rrulePkg from 'rrule';
import { DomainError } from '../errors.ts';
import { addMonths, quarterOf } from '../time.ts';

const { RRule } = rrulePkg as unknown as typeof import('rrule');

/** Validates an iCalendar RRULE (e.g. "FREQ=YEARLY;BYMONTH=5"). */
export function checkRecurrenceRule(rule: string | null | undefined): void {
  if (!rule) return;
  try {
    RRule.parseString(rule.replace(/^RRULE:/, ''));
  } catch {
    throw new DomainError('INVALID_RECURRENCE', 'Règle de récurrence invalide (format iCalendar RRULE).');
  }
}

/** RB-11 (DM-41): next occurrence date strictly after the reference date (YYYY-MM-DD). */
export function nextOccurrence(rule: string, referenceDate: string): string | null {
  const options = RRule.parseString(rule.replace(/^RRULE:/, ''));
  const dtstart = new Date(`${referenceDate}T12:00:00Z`);
  const r = new RRule({ ...options, dtstart });
  const next = r.after(dtstart, false);
  return next ? next.toISOString().slice(0, 10) : null;
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
