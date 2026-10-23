import rrulePkg from 'rrule';
import { DomainError } from '../errors.ts';

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
