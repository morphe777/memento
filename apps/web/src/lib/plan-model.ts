// Vue Plan draft (V-28) and automatic layout (V-24). The draft is a local copy of the plan; the changes sent to
// the API (POST /plan/preview, /plan/apply) are the diff between it and the server state, so a gesture undone
// by another gesture sends nothing. Rules (cycles, capacity, alerts) stay in the API; this file only lays out.
import type { PlanGraph } from './types.ts';

export type GProject = PlanGraph['projects'][number];
export type GObjective = PlanGraph['objectives'][number];
export type GMeta = PlanGraph['metas'][number];
type Reserve = NonNullable<PlanGraph['reserve']>;
export type RObjective = Reserve['objectives']['noMeta'][number];

export interface DProject {
  id: string;
  title: string;
  status: string;
  objectiveId: string | null;
  isFree: boolean;
  dependsOn: string[];
  positionInObjective: number;
  primaryDomainId: string | null;
  domainIds: string[];
  groups: string[];
  remainingMin: number;
  gaps: string[];
  /** Placed in another objective that is not on the canvas (connexe, V-29). */
  elsewhereTitle: string | null;
}
export interface DObjective {
  id: string;
  title: string;
  outcomeTitle: string | null;
  quarter: string;
  deadline: string;
  metaObjectiveId: string | null;
  metaTitle: string | null;
  position: number;
  status: string;
  domainId: string | null;
  smart: string;
  onCanvas: boolean;
  overdue: boolean;
}
export interface Draft {
  projects: Record<string, DProject>;
  objectives: Record<string, DObjective>;
}

const quarterEndDate = (q: string) => {
  const y = Number(q.slice(0, 4));
  const m = Number(q.slice(-1)) * 3;
  return `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
export const quarterLabel = (q: string) => `T${q.slice(-1)} ${q.slice(0, 4)}`;

/** RB-05 as the API applies it (D-48), to show the deadline the move will give (CA-27). */
export function deadlineInQuarter(deadline: string, quarter: string) {
  const y = Number(quarter.slice(0, 4));
  const m0 = (Number(quarter.slice(-1)) - 1) * 3 + 1;
  const start = `${y}-${String(m0).padStart(2, '0')}-01`;
  return deadline >= start && deadline <= quarterEndDate(quarter) ? deadline : quarterEndDate(quarter);
}

export function draftFromGraph(g: PlanGraph): Draft {
  const projects: Record<string, DProject> = {};
  const objTitle = new Map<string, string>();
  for (const o of g.objectives) objTitle.set(o.id, o.title);
  const add = (p: GProject, elsewhere: string | null) => {
    projects[p.id] = {
      id: p.id,
      title: p.title,
      status: p.status,
      objectiveId: p.objectiveId,
      isFree: p.isFree,
      dependsOn: [...p.dependsOn],
      positionInObjective: p.positionInObjective,
      primaryDomainId: p.primaryDomainId,
      domainIds: p.domainIds,
      groups: p.groups,
      remainingMin: p.remainingMin,
      gaps: p.gaps,
      elsewhereTitle: elsewhere,
    };
  };
  for (const p of g.projects) add(p, null);
  for (const p of g.reserve?.projects ?? []) add(p, p.objectiveId ? (p.objectiveTitle ?? '') : null);
  const objectives: Record<string, DObjective> = {};
  const metaTitle = new Map(g.metas.map((m) => [m.id, m.title]));
  for (const o of g.objectives)
    objectives[o.id] = {
      id: o.id,
      title: o.title,
      outcomeTitle: o.outcomeTitle,
      quarter: o.quarter,
      deadline: o.deadline,
      metaObjectiveId: o.metaObjectiveId,
      metaTitle: o.metaObjectiveId ? (metaTitle.get(o.metaObjectiveId) ?? null) : null,
      position: o.position,
      status: o.status,
      domainId: o.domainId,
      smart: o.smartTarget ? `${o.smartCurrent || 0} / ${o.smartTarget}` : '',
      onCanvas: true,
      overdue: false,
    };
  const r = g.reserve?.objectives;
  for (const o of [...(r?.noMeta ?? []), ...(r?.otherMeta ?? [])])
    objectives[o.id] = {
      id: o.id,
      title: o.title,
      outcomeTitle: o.outcomeTitle,
      quarter: o.quarter,
      deadline: o.deadline,
      metaObjectiveId: o.metaObjectiveId,
      metaTitle: o.metaTitle,
      position: 0,
      status: o.status,
      domainId: o.domainId,
      smart: '',
      onCanvas: false,
      overdue: o.overdue,
    };
  return { projects, objectives };
}

// ---------- Queries on a draft ----------

export const onCanvas = (d: Draft, p: DProject) => !!p.objectiveId && !!d.objectives[p.objectiveId]?.onCanvas;
export const isStart = (d: Draft, p: DProject) => onCanvas(d, p) && !p.isFree && p.dependsOn.length === 0;

/** Would « b depends on a » create a loop? (the API refuses it too, DM-105). */
export function wouldLoop(d: Draft, a: string, b: string): boolean {
  if (a === b) return true;
  const stack = [a];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === b) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(d.projects[n]?.dependsOn ?? []));
  }
  return false;
}

/** Upstream and downstream chain of a project (hover, CA-31). */
export function chainOf(d: Draft, id: string): Set<string> {
  const out = new Set([id]);
  const up = [id];
  while (up.length)
    for (const x of d.projects[up.pop()!]?.dependsOn ?? [])
      if (!out.has(x)) {
        out.add(x);
        up.push(x);
      }
  const down = [id];
  const seenDown = new Set([id]);
  while (down.length) {
    const n = down.pop()!;
    for (const p of Object.values(d.projects))
      if (p.dependsOn.includes(n) && !seenDown.has(p.id)) {
        seenDown.add(p.id);
        out.add(p.id);
        down.push(p.id);
      }
  }
  return out;
}

// ---------- Gestures (V-27): each returns a new draft ----------

const clone = (d: Draft): Draft => ({
  projects: Object.fromEntries(
    Object.entries(d.projects).map(([k, v]) => [k, { ...v, dependsOn: [...v.dependsOn] }]),
  ),
  objectives: Object.fromEntries(Object.entries(d.objectives).map(([k, v]) => [k, { ...v }])),
});
const mates = (d: Draft, objectiveId: string | null) =>
  Object.values(d.projects).filter((p) => p.objectiveId === objectiveId);

function unfree(d: Draft, ...ids: string[]) {
  for (const id of ids) if (d.projects[id]) d.projects[id].isFree = false;
}

/** Tirer A → B : B dépend de A. */
export function link(d0: Draft, a: string, b: string): Draft {
  const d = clone(d0);
  const pb = d.projects[b];
  if (!pb.dependsOn.includes(a)) pb.dependsOn.push(a);
  if (d.projects[a]?.objectiveId === pb.objectiveId) unfree(d, a, b);
  return d;
}

export function unlink(d0: Draft, a: string, b: string): Draft {
  const d = clone(d0);
  d.projects[b].dependsOn = d.projects[b].dependsOn.filter((x) => x !== a);
  return d;
}

function stripInside(d: Draft, id: string) {
  const p = d.projects[id];
  const inside = new Set(mates(d, p.objectiveId).map((x) => x.id));
  p.dependsOn = p.dependsOn.filter((x) => !inside.has(x));
  for (const m of mates(d, p.objectiveId)) m.dependsOn = m.dependsOn.filter((x) => x !== id);
}

function attach(d: Draft, id: string, objectiveId: string) {
  const p = d.projects[id];
  if (p.objectiveId !== objectiveId) {
    if (!p.objectiveId || !d.objectives[p.objectiveId]?.onCanvas) p.dependsOn = []; // from the reserve
    p.objectiveId = objectiveId;
    p.elsewhereTitle = null;
    p.positionInObjective = Math.max(0, ...mates(d, objectiveId).map((m) => m.positionInObjective)) + 1;
  }
}

/** Lâcher sur la moitié droite de X : après X. */
export function placeAfter(d0: Draft, id: string, x: string): Draft {
  const d = clone(d0);
  attach(d, id, d.projects[x].objectiveId!);
  d.projects[id].dependsOn = [x];
  unfree(d, id, x);
  return d;
}

/** Lâcher sur la moitié gauche de X : avant X. */
export function placeBefore(d0: Draft, id: string, x: string): Draft {
  const d = clone(d0);
  attach(d, id, d.projects[x].objectiveId!);
  for (const m of Object.values(d.projects))
    if (m.id !== x) m.dependsOn = m.dependsOn.filter((y) => y !== id);
  if (!d.projects[x].dependsOn.includes(id)) d.projects[x].dependsOn.push(id);
  d.projects[id].dependsOn = d.projects[id].dependsOn.filter((y) => y !== x);
  unfree(d, id, x);
  return d;
}

/** Zone « Libres » d'un objectif. */
export function placeFree(d0: Draft, id: string, objectiveId: string): Draft {
  const d = clone(d0);
  attach(d, id, objectiveId);
  stripInside(d, id);
  d.projects[id].isFree = true;
  return d;
}

/** Dans le cadre, hors projet : à la suite du dernier projet (DM-101), ou seul dans un objectif vide. */
export function placeInObjective(d0: Draft, id: string, objectiveId: string): Draft {
  const d = clone(d0);
  const from = d.projects[id].objectiveId;
  attach(d, id, objectiveId);
  if (from !== objectiveId && !d.projects[id].dependsOn.length) {
    const open = layoutObjective(d, objectiveId).main.filter(
      (p) => p.id !== id && !['done', 'abandoned'].includes(p.status),
    );
    const last = open.sort((a, b) => b.col - a.col || b.row - a.row)[0];
    if (last) d.projects[id].dependsOn = [last.id];
  }
  d.projects[id].isFree = false;
  return d;
}

/** Tirer du rond du méta vers P : point de départ (rattaché au premier objectif du méta s'il n'en a pas, Q-03). */
export function makeStart(d0: Draft, id: string, metaId: string): Draft | null {
  const d = clone(d0);
  const p = d.projects[id];
  if (!onCanvas(d, p)) {
    const first = Object.values(d.objectives)
      .filter((o) => o.onCanvas && o.metaObjectiveId === metaId)
      .sort((a, b) => a.quarter.localeCompare(b.quarter) || a.position - b.position)[0];
    if (!first) return null;
    attach(d, id, first.id);
  }
  stripInside(d, id);
  p.dependsOn = [];
  p.isFree = false;
  return d;
}

/** Vers la réserve : détaché de l'objectif, dépendances retirées. */
export function detach(d0: Draft, id: string): Draft {
  const d = clone(d0);
  const p = d.projects[id];
  p.objectiveId = null;
  p.isFree = false;
  p.dependsOn = [];
  for (const m of Object.values(d.projects)) m.dependsOn = m.dependsOn.filter((x) => x !== id);
  return d;
}

/** En-tête d'objectif glissé : trimestre, méta-objectif (bande) et place dans la case. */
export function moveObjective(
  d0: Draft,
  id: string,
  target: { quarter: string; metaObjectiveId: string | null; metaTitle: string | null; index: number },
): Draft {
  const d = clone(d0);
  const o = d.objectives[id];
  o.quarter = target.quarter;
  o.deadline = deadlineInQuarter(o.deadline, target.quarter);
  o.metaObjectiveId = target.metaObjectiveId;
  o.metaTitle = target.metaTitle;
  o.onCanvas = true;
  const cell = Object.values(d.objectives)
    .filter(
      (x) =>
        x.onCanvas &&
        x.id !== id &&
        x.quarter === target.quarter &&
        x.metaObjectiveId === target.metaObjectiveId,
    )
    .sort((a, b) => a.position - b.position);
  cell.splice(Math.max(0, Math.min(target.index, cell.length)), 0, o);
  cell.forEach((x, i) => {
    x.position = i;
  });
  return d;
}

/** En-tête glissé vers la réserve : détaché de son méta-objectif. */
export function detachObjective(d0: Draft, id: string): Draft {
  const d = clone(d0);
  d.objectives[id].metaObjectiveId = null;
  d.objectives[id].metaTitle = null;
  d.objectives[id].onCanvas = false;
  return d;
}

// ---------- Diff → API ops and readable changes ----------

export type PlanOp =
  | { op: 'setDependencies'; projectId: string; dependsOn: string[] }
  | { op: 'attachProject'; projectId: string; objectiveId: string; dependsOn?: string[]; free?: boolean }
  | { op: 'detachProject'; projectId: string }
  | { op: 'setFree'; projectId: string; free: boolean }
  | { op: 'setObjectiveQuarter'; objectiveId: string; quarter: string }
  | { op: 'setObjectiveMeta'; objectiveId: string; metaObjectiveId: string | null }
  | { op: 'reorderObjectives'; quarter: string; ids: string[] };

const same = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function diff(base: Draft, d: Draft): { ops: PlanOp[]; changes: string[] } {
  const ops: PlanOp[] = [];
  const changes: string[] = [];
  const t = (id: string) => d.projects[id]?.title ?? base.projects[id]?.title ?? '?';
  const where = (dd: Draft, oid: string | null) =>
    oid ? `« ${dd.objectives[oid]?.title ?? '?'} »` : 'réserve';
  // Objectives first: quarter, meta-objective, order.
  const reorder = new Set<string>();
  for (const o of Object.values(d.objectives)) {
    const b = base.objectives[o.id];
    if (!b) continue;
    if (o.quarter !== b.quarter) {
      ops.push({ op: 'setObjectiveQuarter', objectiveId: o.id, quarter: o.quarter });
      changes.push(
        `« ${o.title} » : ${quarterLabel(b.quarter)} → ${quarterLabel(o.quarter)} (deadline ${o.deadline.split('-').reverse().join('/')})`,
      );
    }
    if (o.metaObjectiveId !== b.metaObjectiveId) {
      ops.push({ op: 'setObjectiveMeta', objectiveId: o.id, metaObjectiveId: o.metaObjectiveId });
      changes.push(
        b.metaObjectiveId && o.metaObjectiveId
          ? `« ${o.title} » change de méta-objectif : « ${b.metaTitle} » → « ${o.metaTitle} »`
          : o.metaObjectiveId
            ? `« ${o.title} » rattaché à « ${o.metaTitle} »`
            : `« ${o.title} » détaché de « ${b.metaTitle} »`,
      );
    }
    if (o.onCanvas && (o.position !== b.position || o.quarter !== b.quarter)) reorder.add(o.quarter);
  }
  for (const q of reorder) {
    const ids = Object.values(d.objectives)
      .filter((o) => o.onCanvas && o.quarter === q)
      .sort(
        (a, b) => (a.metaObjectiveId ?? '').localeCompare(b.metaObjectiveId ?? '') || a.position - b.position,
      )
      .map((o) => o.id);
    if (ids.length) ops.push({ op: 'reorderObjectives', quarter: q, ids });
  }
  if (reorder.size && !changes.length) changes.push('Ordre des objectifs modifié');
  // Projects: attach / detach, free, then dependencies.
  const touched = new Set<string>();
  for (const p of Object.values(d.projects)) {
    const b = base.projects[p.id];
    if (!b) continue;
    if (p.objectiveId !== b.objectiveId) {
      touched.add(p.id);
      if (!p.objectiveId) ops.push({ op: 'detachProject', projectId: p.id });
      else ops.push({ op: 'attachProject', projectId: p.id, objectiveId: p.objectiveId, free: p.isFree });
      changes.push(`« ${p.title} » : ${where(base, b.objectiveId)} → ${where(d, p.objectiveId)}`);
    } else if (p.isFree !== b.isFree) {
      touched.add(p.id);
      ops.push({ op: 'setFree', projectId: p.id, free: p.isFree });
      if (p.isFree) changes.push(`« ${p.title} » → Libres`);
    }
  }
  // Removals first, then additions: reversing a link never goes through a loop the API would refuse.
  const attached = new Set(ops.flatMap((o) => (o.op === 'attachProject' && !o.free ? [o.projectId] : [])));
  const later: PlanOp[] = [];
  for (const p of Object.values(d.projects)) {
    const b = base.projects[p.id];
    if (!b || attached.has(p.id)) continue;
    const before = b.dependsOn;
    const after = p.dependsOn;
    if (same(before, after)) continue;
    for (const a of after.filter((x) => !before.includes(x)))
      changes.push(`« ${p.title} » attend « ${t(a)} »`);
    for (const a of before.filter((x) => !after.includes(x)))
      if (!touched.has(a)) changes.push(`« ${p.title} » n'attend plus « ${t(a)} »`);
    const kept = before.filter((x) => after.includes(x));
    if (kept.length !== before.length) ops.push({ op: 'setDependencies', projectId: p.id, dependsOn: kept });
    if (kept.length !== after.length)
      later.push({ op: 'setDependencies', projectId: p.id, dependsOn: after });
  }
  // An attached project gets its whole list at the end (from the reserve, the API would apply DM-101 otherwise).
  for (const p of attached) {
    const a = d.projects[p].dependsOn;
    for (const x of a.filter((y) => !base.projects[p].dependsOn.includes(y)))
      changes.push(`« ${d.projects[p].title} » attend « ${t(x)} »`);
    later.push({ op: 'setDependencies', projectId: p, dependsOn: a });
  }
  ops.push(...later);
  return { ops, changes };
}

// ---------- Layout (V-24) ----------

export const L = {
  cardW: 200,
  cardH: 76,
  colW: 280,
  rowH: 104,
  frameGap: 34,
  quarterGap: 58,
  pad: 16,
  header: 82,
  freeLabel: 26,
  metaW: 210,
  metaH: 132,
  metaGap: 70,
  bandGap: 48,
  top: 64,
};

export interface LaidProject {
  id: string;
  status: string;
  col: number;
  row: number;
}

/** Columns and rows of an objective's projects: longest chain inside it, stacked by positionInObjective. */
export function layoutObjective(d: Draft, objectiveId: string) {
  const ps = mates(d, objectiveId).filter((p) => p.status !== 'abandoned');
  const inside = new Set(ps.map((p) => p.id));
  // A project with no link at all inside its objective and flagged free goes to « Libres ».
  const free = ps.filter((p) => p.isFree).sort((a, b) => a.positionInObjective - b.positionInObjective);
  const main = ps.filter((p) => !p.isFree);
  const col = new Map<string, number>();
  const visiting = new Set<string>();
  const of = (id: string): number => {
    const known = col.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const pre = d.projects[id].dependsOn.filter((x) => inside.has(x) && !d.projects[x].isFree);
    const c = Math.max(-1, ...pre.map(of)) + 1;
    visiting.delete(id);
    col.set(id, c);
    return c;
  };
  for (const p of main) of(p.id);
  const byCol = new Map<number, typeof main>();
  for (const p of main) byCol.set(col.get(p.id)!, [...(byCol.get(col.get(p.id)!) ?? []), p]);
  const laid: LaidProject[] = [];
  for (const [c, list] of byCol)
    list
      .sort((a, b) => a.positionInObjective - b.positionInObjective || a.title.localeCompare(b.title))
      .forEach((p, r) => {
        laid.push({ id: p.id, status: p.status, col: c, row: r });
      });
  const cols = Math.max(1, ...laid.map((p) => p.col + 1));
  const rows = Math.max(laid.length ? 1 : 0, ...laid.map((p) => p.row + 1));
  const freePerRow = Math.max(1, cols);
  return {
    main: laid,
    free: free.map((p, i) => ({
      id: p.id,
      status: p.status,
      col: i % freePerRow,
      row: Math.floor(i / freePerRow),
    })),
    cols,
    rows,
    freeRows: free.length ? Math.ceil(free.length / freePerRow) : 0,
  };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Band {
  key: string;
  meta: GMeta | null;
  y: number;
  h: number;
  metaBox: Box | null;
}
export interface FrameBox extends Box {
  objectiveId: string;
  bandKey: string;
  mainBox: Box;
  freeBox: Box | null;
}
export interface Layout {
  bands: Band[];
  quarters: { quarter: string; x: number; w: number }[];
  frames: FrameBox[];
  nodes: Map<string, Box>;
  width: number;
  height: number;
  header: number;
}

/** V-24, V-30: one band per meta-objective shown (+ « Sans méta-objectif »), one column per quarter, no overlap. */
export function layout(
  d: Draft,
  metas: GMeta[],
  quarters: string[],
  showDone: (o: DObjective) => boolean,
  /** Height of the objective headers (taller when AI titles show the Memento title under them). */
  header: number = L.header,
): Layout {
  const objectives = Object.values(d.objectives)
    .filter((o) => o.onCanvas && quarters.includes(o.quarter))
    .sort((a, b) => a.position - b.position || a.deadline.localeCompare(b.deadline));
  const metaIds = new Set(metas.map((m) => m.id));
  const bandKey = (o: DObjective) =>
    o.metaObjectiveId && metaIds.has(o.metaObjectiveId) ? o.metaObjectiveId : 'none';
  const bandDefs: { key: string; meta: GMeta | null }[] = metas.map((m) => ({ key: m.id, meta: m }));
  if (objectives.some((o) => bandKey(o) === 'none')) bandDefs.push({ key: 'none', meta: null });

  const sizes = new Map<string, { w: number; h: number; lay: ReturnType<typeof layoutObjective> }>();
  for (const o of objectives) {
    const lay0 = layoutObjective(d, o.id);
    const keep = (p: LaidProject) => p.status !== 'done' || showDone(o);
    const lay = { ...lay0, main: lay0.main.filter(keep), free: lay0.free.filter(keep) };
    const w = L.pad * 2 + (lay.cols - 1) * L.colW + L.cardW;
    const mainH = Math.max(1, lay.rows) * L.rowH - (L.rowH - L.cardH);
    const freeH = lay.freeRows
      ? L.freeLabel + lay.freeRows * L.rowH - (L.rowH - L.cardH) + L.pad
      : L.freeLabel + 28;
    sizes.set(o.id, { w: Math.max(w, 300), h: header + mainH + L.pad + freeH, lay });
  }
  const qx: { quarter: string; x: number; w: number }[] = [];
  let x = L.metaW + L.metaGap;
  for (const q of quarters) {
    const w = Math.max(220, ...objectives.filter((o) => o.quarter === q).map((o) => sizes.get(o.id)!.w));
    qx.push({ quarter: q, x, w });
    x += w + L.quarterGap;
  }
  const frames: FrameBox[] = [];
  const nodes = new Map<string, Box>();
  const bands: Band[] = [];
  let y = L.top;
  for (const b of bandDefs) {
    let bandH = L.metaH;
    for (const q of qx) {
      let fy = y;
      for (const o of objectives.filter((x) => x.quarter === q.quarter && bandKey(x) === b.key)) {
        const s = sizes.get(o.id)!;
        const mainBox = {
          x: q.x,
          y: fy + header,
          w: q.w,
          h: Math.max(1, s.lay.rows) * L.rowH - (L.rowH - L.cardH) + L.pad,
        };
        const freeTop = mainBox.y + mainBox.h;
        const freeBox = { x: q.x, y: freeTop, w: q.w, h: fy + s.h - freeTop };
        frames.push({ objectiveId: o.id, bandKey: b.key, x: q.x, y: fy, w: q.w, h: s.h, mainBox, freeBox });
        for (const p of s.lay.main)
          nodes.set(p.id, {
            x: q.x + L.pad + p.col * L.colW,
            y: mainBox.y + p.row * L.rowH,
            w: L.cardW,
            h: L.cardH,
          });
        for (const p of s.lay.free)
          nodes.set(p.id, {
            x: q.x + L.pad + p.col * L.colW,
            y: freeTop + L.freeLabel + p.row * L.rowH,
            w: L.cardW,
            h: L.cardH,
          });
        fy += s.h + L.frameGap;
      }
      bandH = Math.max(bandH, fy - y - L.frameGap);
    }
    bands.push({
      key: b.key,
      meta: b.meta,
      y,
      h: bandH,
      metaBox: b.meta ? { x: 0, y: y + 8, w: L.metaW, h: L.metaH } : null,
    });
    y += bandH + L.bandGap;
  }
  return { bands, quarters: qx, frames, nodes, width: x, height: y, header };
}

/**
 * The server state changed under an open draft (an objective created from the view, another tab…): the new
 * state, with the user's own changes (fields where the draft differed from the old state) laid on top.
 */
export function rebase(oldBase: Draft, draft: Draft, newBase: Draft): Draft {
  const out = clone(newBase);
  const lay = <T extends object>(o: T | undefined, d: T | undefined, n: T) => {
    if (!o || !d) return;
    for (const k of Object.keys(d) as (keyof T)[])
      if (JSON.stringify(d[k]) !== JSON.stringify(o[k])) n[k] = structuredClone(d[k]);
  };
  for (const id of Object.keys(out.projects)) lay(oldBase.projects[id], draft.projects[id], out.projects[id]);
  for (const id of Object.keys(out.objectives))
    lay(oldBase.objectives[id], draft.objectives[id], out.objectives[id]);
  return out;
}
