// RB-06 (DM-51): order = implicit prerequisite in sequential projects; "libre" tasks escape the sequence.
// A task is available when every non-free live task placed before it is done or chosen in the current plan,
// and all its explicit prerequisites (RB-07) are done or chosen. Parallel projects: all tasks available.

export interface AvailTask {
  id: string;
  position: number;
  isFree: boolean;
  status: 'todo' | 'done' | 'cancelled';
}

export function availableTaskIds(
  tasks: AvailTask[],
  mode: 'sequential' | 'parallel',
  chosen: ReadonlySet<string> = new Set(),
  deps: { taskId: string; dependsOnTaskId: string }[] = [],
  doneElsewhere: ReadonlySet<string> = new Set(),
): Set<string> {
  const ordered = [...tasks].sort((a, b) => a.position - b.position);
  const status = new Map(ordered.map((t) => [t.id, t.status]));
  const satisfied = (id: string) => status.get(id) === 'done' || chosen.has(id) || doneElsewhere.has(id);
  const depsOk = (id: string) =>
    deps
      .filter((d) => d.taskId === id)
      .every((d) => satisfied(d.dependsOnTaskId) || status.get(d.dependsOnTaskId) === 'cancelled');
  const out = new Set<string>();
  let chainOpen = true;
  for (const t of ordered) {
    if (t.status !== 'todo') continue;
    const orderOk = mode === 'parallel' || t.isFree || chainOpen;
    if (orderOk && depsOk(t.id)) out.add(t.id);
    if (mode === 'sequential' && !t.isFree && !chosen.has(t.id)) chainOpen = false;
  }
  return out;
}

/**
 * DM-100, DM-106: between projects, dependsOn is the only source of truth and it never blocks. A project is
 * « waiting » (blocked: informative only) while one of its prerequisites is neither done nor abandoned.
 * The position in the objective no longer creates an implicit prerequisite.
 */
export function blockedProjectIds(
  projects: { id: string; status: string }[],
  deps: { projectId: string; dependsOnProjectId: string }[],
): Set<string> {
  const status = new Map(projects.map((p) => [p.id, p.status]));
  const blocked = new Set<string>();
  for (const d of deps) {
    const s = status.get(d.dependsOnProjectId);
    if (s && s !== 'done' && s !== 'abandoned') blocked.add(d.projectId);
  }
  return blocked;
}
