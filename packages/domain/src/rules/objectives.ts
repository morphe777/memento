import { DomainError } from '../errors.ts';
import { isValidDate, isValidQuarter, quarterEnd, quarterOf } from '../time.ts';

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
