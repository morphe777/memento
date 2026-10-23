import { daysBetween } from '../time.ts';

export interface DelayInput {
  totalMin: number; // durations of live tasks of the project
  doneMin: number; // durations of done tasks
  startDate: string | null;
  dueDate: string | null;
  replannedAt: string | null; // RB-16 baseline date
  replanDoneMin: number | null;
  today: string;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * R-06: planned minutes at date = prorata of elapsed days (inclusive) between start and due.
 * After a replan (RB-16) the baseline is (replannedAt, doneMin at that time): bar back to center.
 */
export function plannedToDateMin(i: DelayInput): number {
  if (!i.dueDate) return 0;
  const from = i.replannedAt ?? i.startDate;
  if (!from) return 0;
  const base = i.replannedAt ? (i.replanDoneMin ?? 0) : 0;
  const span = daysBetween(from, i.dueDate) + 1;
  const elapsed = daysBetween(from, i.today) + (i.replannedAt ? 0 : 1);
  const frac = span <= 0 ? 1 : clamp01(elapsed / span);
  return Math.round(base + (i.totalMin - base) * frac);
}

/** Positive = ahead (avance), negative = late (retard), in minutes. */
export function delayMin(i: DelayInput): number {
  return i.doneMin - plannedToDateMin(i);
}
