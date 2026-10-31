import { DomainError } from '../errors.ts';

/** RB-07: adding edge from → to (from depends on to) must not create a cycle. */
export function wouldCreateCycle(edges: { from: string; to: string }[], from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  // Is `from` reachable from `to` following dependencies?
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(next.get(n) ?? []));
  }
  return false;
}

export function assertNoCycle(edges: { from: string; to: string }[], from: string, to: string): void {
  // DM-105: a project never depends on itself (own code, distinct from a loop).
  if (from === to) throw new DomainError('DEPENDENCY_SELF', 'Un élément ne peut pas dépendre de lui-même.');
  if (wouldCreateCycle(edges, from, to)) {
    throw new DomainError('DEPENDENCY_CYCLE', 'Ce prérequis créerait une boucle.');
  }
}
