import { DomainError } from '../errors.ts';
import { fmtMin, isValidDate, isValidQuarter, quarterEnd, quarterOf } from '../time.ts';

/** RB-05 (DM-12): deadline mandatory and ≤ end of the objective's quarter. Returns the quarter. */
export function checkObjectiveDeadline(deadline: string | null | undefined, quarter?: string | null): string {
  if (!deadline || !isValidDate(deadline)) {
    throw new DomainError('DEADLINE_REQUIRED', 'Un objectif a une deadline (horizon 1 trimestre).');
  }
  const q = quarter ?? quarterOf(deadline);
  if (!isValidQuarter(q)) throw new DomainError('INVALID_QUARTER', 'Trimestre attendu au format 2026-Q4.');
  if (deadline > quarterEnd(q)) {
    throw new DomainError(
      'DEADLINE_AFTER_QUARTER',
      `La deadline doit tomber au plus tard le ${quarterEnd(q)}.`,
    );
  }
  return q;
}

export function checkCriticality(c: number): void {
  if (![1, 2, 3].includes(c)) throw new DomainError('INVALID_CRITICALITY', 'Criticité : 1, 2 ou 3.');
}

/** D-108: where an objective of the quarter stands, to choose what to focus on when time runs short. */
export type ObjectiveFocus = 'critical' | 'finish' | 'at_risk' | 'on_track' | 'can_wait' | 'no_path' | 'done';

export const FOCUS_ORDER: ObjectiveFocus[] = [
  'critical',
  'finish',
  'at_risk',
  'on_track',
  'can_wait',
  'no_path',
  'done',
];

/** D-108: « presque fini » = at most this much work left (or 75 % of the path done and at most twice that). */
export const FINISH_MAX_MIN = 240;
/** D-108: a deadline within this many days is « proche ». */
export const SOON_DAYS = 31;

/**
 * D-108, in this order: deadline passed → critical; little work left → finish (a small effort and it is
 * reached); more work than the capacity until the deadline → at risk; criticality 3 or deadline close with no
 * project this month → critical; a project this month → on track; else it can wait.
 */
export function objectiveFocus(o: {
  criticality: number;
  progressPct: number;
  openProjects: number;
  remainingMin: number;
  covered: boolean;
  daysLeft: number;
  capacityToDeadlineMin: number;
}): { focus: ObjectiveFocus; reason: string } {
  const h = fmtMin(o.remainingMin);
  if (!o.openProjects)
    return o.progressPct >= 100
      ? { focus: 'done', reason: 'Chemin terminé : il reste à clore l’objectif.' }
      : { focus: 'no_path', reason: 'Aucun projet sur le chemin : il ne peut pas avancer.' };
  if (o.daysLeft < 0)
    return { focus: 'critical', reason: 'Échéance dépassée : termine-le ou revois son échéance.' };
  if (o.remainingMin <= FINISH_MAX_MIN || (o.progressPct >= 75 && o.remainingMin <= 2 * FINISH_MAX_MIN))
    return { focus: 'finish', reason: `Presque fini : encore ${h} de travail et il est atteint.` };
  if (o.remainingMin > o.capacityToDeadlineMin)
    return {
      focus: 'at_risk',
      reason: `Encore ${h} de travail pour ${fmtMin(o.capacityToDeadlineMin)} de temps d’ici l’échéance : réduis l’ambition ou décale.`,
    };
  if (!o.covered && (o.criticality >= 3 || o.daysLeft <= SOON_DAYS))
    return {
      focus: 'critical',
      reason:
        o.criticality >= 3
          ? 'Criticité haute et rien ce mois-ci : prends un de ses projets.'
          : `Échéance dans ${o.daysLeft} j et rien ce mois-ci : prends un de ses projets.`,
    };
  if (o.covered) return { focus: 'on_track', reason: `Avance ce mois-ci · encore ${h} de travail.` };
  return {
    focus: 'can_wait',
    reason:
      o.criticality <= 1
        ? 'Criticité basse : c’est lui qui peut attendre si le temps manque.'
        : `Rien ce mois-ci · encore ${h} de travail, échéance dans ${o.daysLeft} j.`,
  };
}
