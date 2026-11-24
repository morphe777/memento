import { daysBetween, parisDate } from '../time.ts';

/**
 * D-182 (user request 24/11/2026): an Inbox task with no urgency (no due date: its due date alerts already; not
 * recurring; not an envie) that waits too long. After `staleDays` it is shown (« depuis 5 sem. »), after
 * `questionDays` questioned (« Toujours utile ? »). Counted from its creation, or from « Garder » (`since`).
 */
export interface InboxAgeInput {
  projectId: string | null;
  status: string;
  isExperience: boolean;
  dueDate: string | null;
  recurring: boolean;
  /** Paris day from which the age counts: creation, or the last « Garder ». */
  since: string;
}

export type InboxAge = { level: 'stale' | 'question'; days: number } | null;

export interface InboxAgeThresholds {
  staleDays: number;
  questionDays: number;
}

/** True for the tasks the rule concerns (and that « Garder » applies to). */
export const ageable = (t: Omit<InboxAgeInput, 'since'>) =>
  t.projectId === null && t.status === 'todo' && !t.isExperience && !t.dueDate && !t.recurring;

export function inboxAge(t: InboxAgeInput, today: string, th: InboxAgeThresholds): InboxAge {
  if (!ageable(t)) return null;
  const days = daysBetween(t.since, today);
  if (days >= th.questionDays) return { level: 'question', days };
  if (days >= th.staleDays) return { level: 'stale', days };
  return null;
}

/** D-182: the day the age of a task counts from: its last « Garder », else its creation (Paris day). */
export const ageSince = (t: { createdAt: string; keptAt: string | null }) =>
  parisDate(new Date(t.keptAt ?? t.createdAt));
