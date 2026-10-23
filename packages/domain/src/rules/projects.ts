import { DomainError } from '../errors.ts';
import { daysBetween } from '../time.ts';

export const MAX_PROJECT_DAYS = 31;
export const MAX_PROJECT_DOMAINS = 3;

export interface DomainRef {
  id: string;
  priorityRank: number;
}

/**
 * RB-04 (DM-84, DM-91): a project's domains are the distinct domains of its groups, ordered by priority,
 * 3 max. Primary must belong to that list; default = most prioritary. Groups are mandatory (decision D-04).
 */
export function resolveProjectDomains(
  groupDomains: DomainRef[],
  requestedPrimaryId?: string | null,
): { domainIds: string[]; primaryDomainId: string } {
  if (groupDomains.length === 0) throw new DomainError('GROUP_REQUIRED', 'Choisis au moins un groupe.');
  const byId = new Map(groupDomains.map((d) => [d.id, d]));
  const domains = [...byId.values()].sort((a, b) => a.priorityRank - b.priorityRank);
  if (domains.length > MAX_PROJECT_DOMAINS) {
    throw new DomainError('TOO_MANY_DOMAINS', 'Un projet sert 3 domaines au maximum : retire un groupe.');
  }
  const primary = requestedPrimaryId && byId.has(requestedPrimaryId) ? requestedPrimaryId : domains[0].id;
  if (requestedPrimaryId && !byId.has(requestedPrimaryId)) {
    throw new DomainError('PRIMARY_DOMAIN_INVALID', 'Le domaine principal doit venir des groupes du projet.');
  }
  return {
    domainIds: [primary, ...domains.map((d) => d.id).filter((id) => id !== primary)],
    primaryDomainId: primary,
  };
}

export interface PromotionInput {
  successCriterion: string;
  startDate: string | null;
  dueDate: string | null;
  groupCount: number;
  tasks: { durationMin: number | null; status: string }[];
}

export type PromotionGap =
  | 'SUCCESS_CRITERION_MISSING'
  | 'GROUP_MISSING'
  | 'TASK_MISSING'
  | 'TASK_DURATION_MISSING'
  | 'DATES_MISSING'
  | 'DATES_INVERTED'
  | 'PROJECT_TOO_LONG';

export const GAP_LABELS: Record<PromotionGap, string> = {
  SUCCESS_CRITERION_MISSING: 'Critère de succès (oui / non) manquant',
  GROUP_MISSING: 'Au moins un groupe',
  TASK_MISSING: 'Au moins une tâche',
  TASK_DURATION_MISSING: 'Toutes les tâches doivent avoir une durée',
  DATES_MISSING: 'Date de début et date de fin',
  DATES_INVERTED: 'La fin doit être après le début',
  PROJECT_TOO_LONG: 'Projet de plus d’un mois : à découper',
};

/** RB-02 (DM-86, DM-23): what is missing to promote an idea (or to keep a project active). */
export function promotionGaps(p: PromotionInput): PromotionGap[] {
  const gaps: PromotionGap[] = [];
  if (!p.successCriterion.trim()) gaps.push('SUCCESS_CRITERION_MISSING');
  if (p.groupCount < 1) gaps.push('GROUP_MISSING');
  const live = p.tasks.filter((t) => t.status !== 'cancelled');
  if (live.length < 1) gaps.push('TASK_MISSING');
  if (live.some((t) => t.durationMin === null)) gaps.push('TASK_DURATION_MISSING');
  if (!p.startDate || !p.dueDate) gaps.push('DATES_MISSING');
  else if (daysBetween(p.startDate, p.dueDate) < 0) gaps.push('DATES_INVERTED');
  else if (daysBetween(p.startDate, p.dueDate) > MAX_PROJECT_DAYS) gaps.push('PROJECT_TOO_LONG');
  return gaps;
}

export function assertPromotable(p: PromotionInput, code = 'PROMOTION_INCOMPLETE'): void {
  const gaps = promotionGaps(p);
  if (gaps.length) {
    throw new DomainError(
      code,
      `Il manque : ${gaps.map((g) => GAP_LABELS[g]).join(' · ')}`,
      gaps.map((g) => ({ code: g, label: GAP_LABELS[g] })),
    );
  }
}

/** RB-08 (DM-93): "projet du mois" only if the project has tasks, all with a duration. */
export function canFlagMonth(tasks: { durationMin: number | null; status: string }[]): boolean {
  const live = tasks.filter((t) => t.status !== 'cancelled');
  return live.length > 0 && live.every((t) => t.durationMin !== null);
}

export function assertCanFlagMonth(tasks: { durationMin: number | null; status: string }[]): void {
  if (!canFlagMonth(tasks)) {
    throw new DomainError(
      'MONTH_FLAG_REQUIRES_TASKS',
      'Projet du mois : il faut des tâches, toutes avec une durée.',
    );
  }
}

/** RB-12: completing a project requires answering "critère de succès atteint ?". */
export function assertCompletion(success: unknown): asserts success is boolean {
  if (typeof success !== 'boolean') {
    throw new DomainError('SUCCESS_ANSWER_REQUIRED', 'Critère de succès atteint ? Réponds oui ou non.');
  }
}

const TRANSITIONS: Record<string, string[]> = {
  idea: ['abandoned'], // idea → active only through promote (RB-02)
  active: ['paused', 'abandoned'], // → done only through complete (RB-12)
  paused: ['active', 'abandoned'],
  done: ['active'],
  abandoned: ['idea'],
};

/** DM-89 status lifecycle: Idée → Actif → En pause → Terminé / Abandonné. */
export function assertStatusTransition(from: string, to: string): void {
  if (from === to) return;
  if (!TRANSITIONS[from]?.includes(to)) {
    const hint =
      to === 'active' && from === 'idea'
        ? ' Utilise « Promouvoir ».'
        : to === 'done'
          ? ' Utilise « Terminer ».'
          : '';
    throw new DomainError('INVALID_STATUS_TRANSITION', `Passage ${from} → ${to} impossible.${hint}`);
  }
}

/** Objective progress (stored, decision D-05): finished projects ÷ projects on the path. */
export function objectiveProgressPct(projects: { status: string }[]): number {
  const path = projects.filter((p) => p.status !== 'abandoned' && p.status !== 'idea');
  if (!path.length) return 0;
  return Math.round((path.filter((p) => p.status === 'done').length / path.length) * 100);
}
