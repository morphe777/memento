// Vue Plan rules on project dependencies (memento-vue-plan/02): pure functions shared by the API and the web
// (the web lays out its local draft with the same code the API uses to compute paths).
import { monthOf, quarterStart, shiftMonth } from '../time.ts';

export interface DepEdge {
  projectId: string;
  dependsOnProjectId: string;
}

/**
 * DM-102: stable topological order of a set of projects (prerequisites first; ties by positionInObjective, then
 * the given order). Edges leaving the set are ignored. A cycle (refused at write time, DM-105) cannot loop here:
 * the remaining nodes are appended by position.
 */
export function topoOrder<T extends { id: string; positionInObjective: number }>(
  items: T[],
  deps: DepEdge[],
): T[] {
  const ids = new Set(items.map((i) => i.id));
  const rank = new Map(items.map((p, i) => [p.id, i]));
  const byPos = (a: T, b: T) =>
    a.positionInObjective - b.positionInObjective || rank.get(a.id)! - rank.get(b.id)!;
  const inner = deps.filter((d) => ids.has(d.projectId) && ids.has(d.dependsOnProjectId));
  const waiting = new Map(items.map((p) => [p.id, 0]));
  for (const d of inner) waiting.set(d.projectId, waiting.get(d.projectId)! + 1);
  const out: T[] = [];
  const done = new Set<string>();
  const left = [...items].sort(byPos);
  while (left.length) {
    const i = left.findIndex((p) => waiting.get(p.id) === 0);
    const next = left.splice(i < 0 ? 0 : i, 1)[0];
    out.push(next);
    done.add(next.id);
    for (const d of inner)
      if (d.dependsOnProjectId === next.id && !done.has(d.projectId))
        waiting.set(d.projectId, waiting.get(d.projectId)! - 1);
  }
  return out;
}

/**
 * V-24: column of each project inside its objective = length of its longest chain of prerequisites inside that
 * objective (first column 0). Dependencies on projects of other objectives do not count.
 */
export function projectColumns(ids: string[], deps: DepEdge[]): Map<string, number> {
  const set = new Set(ids);
  const pre = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const d of deps)
    if (set.has(d.projectId) && set.has(d.dependsOnProjectId))
      pre.get(d.projectId)!.push(d.dependsOnProjectId);
  const col = new Map<string, number>();
  const visiting = new Set<string>();
  const of = (id: string): number => {
    const known = col.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle guard (never stored, DM-105)
    visiting.add(id);
    const c = Math.max(-1, ...pre.get(id)!.map(of)) + 1;
    visiting.delete(id);
    col.set(id, c);
    return c;
  };
  for (const id of ids) of(id);
  return col;
}

/**
 * CH-22: path of an objective = number of unfinished projects on its longest chain of internal dependencies
 * (1 project = 1 month, DM-23). Done projects are part of a chain but weigh 0; abandoned ones are left out.
 */
export function objectivePathMonths(projects: { id: string; status: string }[], deps: DepEdge[]): number {
  const live = projects.filter((p) => p.status !== 'abandoned');
  const set = new Set(live.map((p) => p.id));
  const weight = new Map(live.map((p) => [p.id, p.status === 'done' ? 0 : 1]));
  const pre = new Map<string, string[]>(live.map((p) => [p.id, []]));
  for (const d of deps)
    if (set.has(d.projectId) && set.has(d.dependsOnProjectId))
      pre.get(d.projectId)!.push(d.dependsOnProjectId);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const len = (id: string): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const v = weight.get(id)! + Math.max(0, ...pre.get(id)!.map(len));
    visiting.delete(id);
    memo.set(id, v);
    return v;
  };
  return Math.max(0, ...live.map((p) => len(p.id)));
}

/** Q-09: months left in a quarter, current month included (3 for a future quarter, 0 for a past one). */
export function monthsLeftInQuarter(quarter: string, today: string): number {
  const first = monthOf(quarterStart(quarter));
  const current = monthOf(today);
  let n = 0;
  for (let i = 0; i < 3; i++) if (shiftMonth(first, i) >= current) n += 1;
  return n;
}

/**
 * DM-103: the non-free projects of an objective form a single chain A→B→C (or hold at most one project) when
 * every one has at most one prerequisite and one follower among them, and they are all linked.
 */
export function isLinearChain(ids: string[], deps: DepEdge[]): boolean {
  if (ids.length <= 1) return true;
  const set = new Set(ids);
  const inner = deps.filter((d) => set.has(d.projectId) && set.has(d.dependsOnProjectId));
  if (inner.length !== ids.length - 1) return false;
  const ins = new Map<string, number>();
  const outs = new Map<string, number>();
  for (const d of inner) {
    ins.set(d.projectId, (ins.get(d.projectId) ?? 0) + 1);
    outs.set(d.dependsOnProjectId, (outs.get(d.dependsOnProjectId) ?? 0) + 1);
  }
  if ([...ins.values(), ...outs.values()].some((n) => n > 1)) return false;
  // n − 1 edges, degrees ≤ 1 and no cycle (DM-105) ⇒ one path when connected: walk it from its head.
  const head = ids.find((id) => !ins.has(id));
  let cur: string | undefined = head;
  let seen = 0;
  while (cur && seen <= ids.length) {
    seen += 1;
    const c: string = cur;
    cur = inner.find((d) => d.dependsOnProjectId === c)?.projectId;
  }
  return seen === ids.length;
}

/** DM-106: prerequisites of a project that are not finished yet (done = satisfied; abandoned ones are removed). */
export function waitingOnIds(
  projectId: string,
  deps: DepEdge[],
  status: ReadonlyMap<string, string>,
): string[] {
  return deps
    .filter((d) => d.projectId === projectId)
    .map((d) => d.dependsOnProjectId)
    .filter((id) => {
      const s = status.get(id);
      return s !== undefined && s !== 'done' && s !== 'abandoned';
    });
}
