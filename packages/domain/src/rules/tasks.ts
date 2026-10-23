import { DomainError } from '../errors.ts';

export const ALLOWED_DURATIONS = [30, 60, 120] as const;

/** RB-03 (DM-32): duration ∈ {30, 60, 120}; > 120 must be split. Null allowed (ideas, drafts). */
export function checkTaskDuration(durationMin: number | null | undefined): void {
  if (durationMin === null || durationMin === undefined) return;
  if (durationMin > 120) {
    throw new DomainError(
      'TASK_TOO_LONG',
      'Tâche de plus de 2 h : à découper en tâches de 30 min, 1 h ou 2 h.',
    );
  }
  if (!(ALLOWED_DURATIONS as readonly number[]).includes(durationMin)) {
    throw new DomainError('INVALID_DURATION', 'Durée possible : 30 min, 1 h ou 2 h.');
  }
}

/** RB-09 (CH-12): experiences consume no budget and do not count in "Fait". */
export function budgetMinutes(tasks: { durationMin: number | null; isExperience: boolean }[]): number {
  return tasks.reduce((sum, t) => sum + (t.isExperience ? 0 : (t.durationMin ?? 0)), 0);
}

/** RB-14 (CH-08): overflow never blocks, it is only reported. */
export function budgetStatus(
  plannedMin: number,
  budgetMin: number,
): { overMin: number; remainingMin: number } {
  return { overMin: Math.max(0, plannedMin - budgetMin), remainingMin: Math.max(0, budgetMin - plannedMin) };
}

export type TaskBucket = 'todo' | 'waiting' | 'week' | 'done';

/**
 * Task board columns (Q-11 adapted to tasks, decision D-33): derived from existing state only, no extra status.
 * Done → « Fait » ; in the current week plan → « Cette semaine » ; locked by RB-06 → « En attente » ; else « À faire ».
 */
export function taskBucket(t: { status: string; inPlan: boolean; locked: boolean }): TaskBucket {
  if (t.status === 'done') return 'done';
  if (t.inPlan) return 'week';
  if (t.locked) return 'waiting';
  return 'todo';
}
