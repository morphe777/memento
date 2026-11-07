import { addDays, isoWeekOf, monthEnd, monthStart, weekMonday } from '../time.ts';

/**
 * D-118: the time available each day, from the week budgets (the plan's, else the default one) less holidays.
 * Without it, every day weighs the same.
 */
export interface PaceCalendar {
  weekBudgets: Record<string, number>; // isoWeek → budget (min) of its plan
  defaultBudgetMin: number;
  vacations: { from: string; to: string }[];
}

export interface DelayInput {
  totalMin: number; // durations of live tasks of the project
  doneMin: number; // durations of done tasks
  startDate: string | null;
  dueDate: string | null;
  /** D-118: a month project without dates runs over its month. */
  monthFlag?: string | null;
  replannedAt: string | null; // RB-16 baseline date
  replanDoneMin: number | null;
  today: string;
  calendar?: PaceCalendar;
}

const dayWeight = (d: string, cal?: PaceCalendar): number => {
  if (!cal) return 1;
  if (cal.vacations.some((v) => v.from <= d && d <= v.to)) return 0;
  return (cal.weekBudgets[isoWeekOf(d)] ?? cal.defaultBudgetMin) / 7;
};

/**
 * R-06 rewritten by D-118 (06/11/2026). The work of the project is spread over its period (start → due,
 * else its month) in proportion to the time available each day (week budget ÷ 7, 0 on holiday), and judged by
 * the week: what is expected is what falls in the weeks already ended. `expectedMin` = expected now,
 * `endOfWeekMin` = expected at the end of the current week. After a replan (RB-16) the baseline is (replannedAt,
 * doneMin at that time): bar back to the centre.
 */
export function pace(i: DelayInput): { expectedMin: number; endOfWeekMin: number } {
  const start = i.startDate ?? (i.monthFlag ? monthStart(i.monthFlag) : null);
  const due = i.dueDate ?? (i.monthFlag ? monthEnd(i.monthFlag) : null);
  const from = i.replannedAt && (!start || i.replannedAt > start) ? i.replannedAt : start;
  if (!due || !from) return { expectedMin: 0, endOfWeekMin: 0 };
  const base = i.replannedAt ? (i.replanDoneMin ?? 0) : 0;
  const rest = Math.max(0, i.totalMin - base);
  if (from > due) return { expectedMin: base + rest, endOfWeekMin: base + rest }; // replanned after the due date
  const monday = weekMonday(isoWeekOf(i.today));
  const sunday = addDays(monday, 6);
  let total = 0;
  let ended = 0;
  let thisWeek = 0;
  let days = 0;
  for (let d = from; d <= due && days < 1000; d = addDays(d, 1), days++) {
    const w = dayWeight(d, i.calendar);
    total += w;
    if (d < monday) ended += w;
    else if (d <= sunday) thisWeek += w;
  }
  // No time available at all over the period (holidays): fall back to calendar days.
  if (total === 0) return pace({ ...i, calendar: undefined });
  return {
    expectedMin: Math.round(base + (rest * ended) / total),
    endOfWeekMin: Math.round(base + (rest * (ended + thisWeek)) / total),
  };
}

/** Expected minutes at `today` (weeks ended). */
export const plannedToDateMin = (i: DelayInput): number => pace(i).expectedMin;

/** Positive = ahead (avance), negative = late (retard), in minutes. */
export function delayMin(i: DelayInput): number {
  return i.doneMin - plannedToDateMin(i);
}

/** D-118: what is left to do this week to be on time on Sunday evening (0 when already there). */
export function weekToDoMin(i: DelayInput): number {
  return Math.max(0, pace(i).endOfWeekMin - i.doneMin);
}
