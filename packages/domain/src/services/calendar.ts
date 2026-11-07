// D-113 (user request 02/11/2026): every task on a calendar (week, month, quarter), filtered on the page by
// domain, Inbox / project and recurring. A task sits on its deadline while to do, on the day it was done once
// done; a recurring task also shows its next occurrences (RB-11, computed, not stored). Tasks planned for a week
// without a day in it are listed apart, per ISO week.
import { and, eq, gte, inArray, isNull, lt, lte, ne, or, schema, sql } from '@memento/db';
import { type Ctx, ctxNow } from '../context.ts';
import { DomainError } from '../errors.ts';
import { isValidRecurrenceRule, nextOccurrence } from '../rules/recurrence.ts';
import { addDays, daysBetween, isoWeekOf, parisDate, weekMonday, weekSunday } from '../time.ts';

const { task, project, weekPlan, weekPlanItem } = schema;

/** A range is at most a quarter seen as weeks (with the days of the grid around it). */
export const CALENDAR_MAX_DAYS = 120;
const MAX_OCCURRENCES = 60;

export type CalendarKind = 'due' | 'done' | 'occurrence';

export interface CalendarTask {
  taskId: string;
  title: string;
  status: 'todo' | 'done';
  durationMin: number | null;
  isExperience: boolean;
  projectId: string | null;
  projectTitle: string | null;
  domainId: string | null;
  recurring: boolean;
}

export interface CalendarEntry extends CalendarTask {
  date: string;
  kind: CalendarKind;
  /** To do with a deadline before today. */
  late: boolean;
}

export function getCalendar(ctx: Ctx, from: string, to: string) {
  if (to < from || daysBetween(from, to) > CALENDAR_MAX_DAYS)
    throw new DomainError(
      'INVALID_RANGE',
      `Période de 1 à ${CALENDAR_MAX_DAYS + 1} jours, « from » avant « to ».`,
    );
  const today = parisDate(ctxNow(ctx));
  // A done task is looked up one day around the range: its timestamp is UTC, its day is in Paris.
  const rows = ctx.db
    .select({
      id: task.id,
      title: task.title,
      status: task.status,
      durationMin: task.durationMin,
      isExperience: task.isExperience,
      dueDate: task.dueDate,
      doneAt: task.doneAt,
      recurrenceRule: task.recurrenceRule,
      taskDomainId: task.domainId,
      projectId: task.projectId,
      projectTitle: project.title,
      projectDomainId: project.primaryDomainId,
      projectRecurrence: project.recurrence,
    })
    .from(task)
    .leftJoin(project, eq(project.id, task.projectId))
    .where(
      and(
        ne(task.status, 'cancelled'),
        or(isNull(task.projectId), ne(project.status, 'abandoned')),
        or(
          // To do: due in the range, or recurring and due before its end (its next occurrences may fall in it).
          and(
            eq(task.status, 'todo'),
            lte(task.dueDate, to),
            or(gte(task.dueDate, from), sql`${task.recurrenceRule} is not null`),
          ),
          and(eq(task.status, 'done'), gte(task.doneAt, addDays(from, -1)), lt(task.doneAt, addDays(to, 2))),
        ),
      ),
    )
    .all();
  const base = (r: (typeof rows)[number]): CalendarTask => ({
    taskId: r.id,
    title: r.title,
    status: r.status as 'todo' | 'done',
    durationMin: r.durationMin,
    isExperience: r.isExperience,
    projectId: r.projectId,
    projectTitle: r.projectTitle ?? null,
    domainId: r.projectId ? (r.projectDomainId ?? null) : r.taskDomainId,
    recurring: !!r.recurrenceRule || !!r.projectRecurrence,
  });
  const inRange = (d: string) => d >= from && d <= to;
  const entries: CalendarEntry[] = [];
  for (const r of rows) {
    if (r.status === 'done') {
      const day = parisDate(new Date(r.doneAt!));
      if (inRange(day)) entries.push({ ...base(r), date: day, kind: 'done', late: false });
      continue;
    }
    const due = r.dueDate!;
    if (inRange(due)) entries.push({ ...base(r), date: due, kind: 'due', late: due < today });
    // RB-11: the next occurrences, created only when this one is done.
    // C-05: an invalid stored rule shows the task, without occurrences, instead of breaking the page.
    if (r.recurrenceRule && isValidRecurrenceRule(r.recurrenceRule)) {
      let d: string | null = due;
      for (let i = 0; i < MAX_OCCURRENCES && d && d <= to; i++) {
        d = nextOccurrence(r.recurrenceRule, d);
        if (d && inRange(d)) entries.push({ ...base(r), date: d, kind: 'occurrence', late: false });
      }
    }
  }
  entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(a.status === 'done') - Number(b.status === 'done') ||
      a.title.localeCompare(b.title),
  );

  // Planned for the week (week / bonus), without a day in that week: listed apart.
  const weeks: string[] = [];
  for (let d = addDays(from, 0); d <= to; d = addDays(d, 7)) weeks.push(isoWeekOf(d));
  if (!weeks.includes(isoWeekOf(to))) weeks.push(isoWeekOf(to));
  const plannedRows = ctx.db
    .select({
      isoWeek: weekPlan.isoWeek,
      kind: weekPlanItem.kind,
      id: task.id,
      title: task.title,
      status: task.status,
      durationMin: task.durationMin,
      isExperience: task.isExperience,
      dueDate: task.dueDate,
      doneAt: task.doneAt,
      recurrenceRule: task.recurrenceRule,
      taskDomainId: task.domainId,
      projectId: task.projectId,
      projectTitle: project.title,
      projectDomainId: project.primaryDomainId,
      projectRecurrence: project.recurrence,
    })
    .from(weekPlanItem)
    .innerJoin(weekPlan, eq(weekPlan.id, weekPlanItem.weekPlanId))
    .innerJoin(task, eq(task.id, weekPlanItem.taskId))
    .leftJoin(project, eq(project.id, task.projectId))
    .where(
      and(
        inArray(weekPlan.isoWeek, weeks),
        inArray(weekPlanItem.kind, ['week', 'bonus']),
        ne(task.status, 'cancelled'),
      ),
    )
    .all();
  const planned = weeks.map((isoWeek) => {
    const mon = weekMonday(isoWeek);
    const sun = weekSunday(isoWeek);
    const inWeek = (d: string | null) => !!d && d >= mon && d <= sun;
    return {
      isoWeek,
      tasks: plannedRows
        .filter((r) => r.isoWeek === isoWeek)
        .filter((r) => (r.status === 'done' ? !inWeek(parisDate(new Date(r.doneAt!))) : !inWeek(r.dueDate)))
        .map((r) => ({ ...base(r), kind: r.kind as 'week' | 'bonus' })),
    };
  });
  return { from, to, today, entries, planned };
}
