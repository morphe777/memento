import { DomainError } from '../errors.ts';
import { daysBetween } from '../time.ts';

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
  | 'DATES_INVERTED';

export const GAP_LABELS: Record<PromotionGap, string> = {
  SUCCESS_CRITERION_MISSING: 'Critère de succès (oui / non) manquant',
  GROUP_MISSING: 'Au moins un groupe',
  TASK_MISSING: 'Au moins une tâche',
  TASK_DURATION_MISSING: 'Toutes les tâches doivent avoir une durée',
  DATES_INVERTED: 'La fin doit être après le début',
};

/** RB-02 as a checklist shown on the project page: what a project needs before becoming a month project. */
export const READINESS_LABELS: Record<PromotionGap, string> = {
  SUCCESS_CRITERION_MISSING: 'Un critère de succès (oui / non)',
  GROUP_MISSING: 'Au moins un groupe',
  TASK_MISSING: 'Au moins une tâche',
  TASK_DURATION_MISSING: 'Une durée sur chaque tâche',
  DATES_INVERTED: 'La fin après le début (dates facultatives)',
};

export function readiness(p: PromotionInput): { code: PromotionGap; label: string; ok: boolean }[] {
  const gaps = new Set(promotionGaps(p));
  return (Object.keys(READINESS_LABELS) as PromotionGap[])
    .filter((c) => c !== 'DATES_INVERTED' || gaps.has(c))
    .map((code) => ({
      code,
      label: READINESS_LABELS[code],
      // Not ticked by default: « every task has a duration » needs tasks.
      ok: !gaps.has(code) && !(code === 'TASK_DURATION_MISSING' && gaps.has('TASK_MISSING')),
    }));
}

/**
 * RB-02 revised (decision D-42): what a project needs to become « actif » (= projet du mois).
 * Dates are optional: the month is the time box. An idea may go « prêt » without it (flagged as incomplete).
 */
export function promotionGaps(p: PromotionInput): PromotionGap[] {
  const gaps: PromotionGap[] = [];
  if (!p.successCriterion.trim()) gaps.push('SUCCESS_CRITERION_MISSING');
  if (p.groupCount < 1) gaps.push('GROUP_MISSING');
  const live = p.tasks.filter((t) => t.status !== 'cancelled');
  if (live.length < 1) gaps.push('TASK_MISSING');
  if (live.some((t) => t.durationMin === null)) gaps.push('TASK_DURATION_MISSING');
  if (p.startDate && p.dueDate && daysBetween(p.startDate, p.dueDate) < 0) gaps.push('DATES_INVERTED');
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

/** RB-12: completing a project requires answering "critère de succès atteint ?". */
export function assertCompletion(success: unknown): asserts success is boolean {
  if (typeof success !== 'boolean') {
    throw new DomainError('SUCCESS_ANSWER_REQUIRED', 'Critère de succès atteint ? Réponds oui ou non.');
  }
}

// Decision D-42 lifecycle: Idée → Prêt (backlog) → Actif (projet du mois) → Terminé, plus En pause / Abandonné.
// idea → ready only through « Promouvoir »; ready → active only through the month plan; → done only via « Terminer ».
const TRANSITIONS: Record<string, string[]> = {
  idea: ['abandoned'],
  ready: ['idea', 'paused', 'abandoned'],
  active: ['ready', 'paused', 'abandoned'],
  paused: ['ready', 'abandoned'],
  done: ['ready'],
  abandoned: ['idea'],
};

export function assertStatusTransition(from: string, to: string): void {
  if (from === to) return;
  if (!TRANSITIONS[from]?.includes(to)) {
    const hint =
      to === 'ready' && from === 'idea'
        ? ' Utilise « Promouvoir ».'
        : to === 'active'
          ? ' Choisis-le comme projet du mois (Planifier › Mois).'
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
