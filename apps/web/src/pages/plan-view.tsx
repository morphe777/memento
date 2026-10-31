// Vue Plan (memento-vue-plan/01, V-20 to V-31): node graph of meta-objectives, objectives by quarter and projects.
// The API computes everything that is a rule (GET /plan-graph, POST /plan/preview, POST /plan/apply); this page
// keeps a local draft, lays it out (lib/plan-model.ts) and turns gestures into draft changes.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DomainFilter, ErrorBox, InfoTip, Loading, PageHeader, Panel } from '../components/ui.tsx';
import { ApiError, get, post } from '../lib/api.ts';
import { fmtDate, fmtMin, STATUS_LABEL } from '../lib/format.ts';
import { toast, useDomainLookup, useIsPhone, useMe } from '../lib/hooks.ts';
import {
  type Box,
  chainOf,
  type DObjective,
  type DProject,
  type Draft,
  detach,
  detachObjective,
  diff,
  draftFromGraph,
  isStart,
  L,
  layout,
  link,
  makeStart,
  moveObjective,
  onCanvas,
  placeAfter,
  placeBefore,
  placeFree,
  placeInObjective,
  quarterLabel,
  rebase,
  unlink,
  wouldLoop,
} from '../lib/plan-model.ts';
import type { PlanGraph, PlanPreview, ProjectDetail } from '../lib/types.ts';
import { ApplyBar, type Editing, PlanEditors } from './plan-dialogs.tsx';

// ---------- Per-device memory (V-30: last domain used) ----------

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // private mode: not remembered
  }
};
const coarseMq = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;
/** D-12 / V-31: touch screen (iPad) = big connection dots, detected by pointer type, not by width. */
const useCoarse = () =>
  useSyncExternalStore(
    (cb) => {
      coarseMq?.addEventListener('change', cb);
      return () => coarseMq?.removeEventListener('change', cb);
    },
    () => !!coarseMq?.matches,
  );

const hours = (m: number) => `${Math.round(m / 60)} h`;
/**
 * SVG path through orthogonal points with wide rounded corners (radius ≤ 26): an end segment may be used up to
 * the end (the last one keeps 16 px of straight line for the arrowhead), an inner one is shared by two corners.
 */
function rounded(pts0: { x: number; y: number }[]) {
  const pts = pts0.filter((p, i) => i === 0 || Math.hypot(p.x - pts0[i - 1].x, p.y - pts0[i - 1].y) > 0.5);
  const n = pts.length;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < n - 1; i++) {
    const [p, c, q] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y);
    const l2 = Math.hypot(q.x - c.x, q.y - c.y);
    const r = Math.max(0, Math.min(26, i === 1 ? l1 : l1 / 2, i + 1 === n - 1 ? l2 - 16 : l2 / 2));
    const a = { x: c.x - ((c.x - p.x) / l1) * r, y: c.y - ((c.y - p.y) / l1) * r };
    const b = { x: c.x + ((q.x - c.x) / l2) * r, y: c.y + ((q.y - c.y) / l2) * r };
    const k = 0.55; // cubic approximation of a quarter circle
    d += ` L${a.x},${a.y} C${a.x + (c.x - a.x) * k},${a.y + (c.y - a.y) * k} ${b.x + (c.x - b.x) * k},${b.y + (c.y - b.y) * k} ${b.x},${b.y}`;
  }
  const last = pts[n - 1];
  return `${d} L${last.x},${last.y}`;
}
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function PlanViewPage({ tabs }: { tabs: ReactNode }) {
  const dl = useDomainLookup();
  const [domainIds, setDomainIds] = useState<string[] | null>(() =>
    read<string[] | null>('memento.plan.domains', null),
  );
  // Default (V-30): a single domain, the last one used; the first by priority the very first time.
  useEffect(() => {
    if (domainIds === null && dl.domains.length) setDomainIds([dl.domains[0].id]);
  }, [domainIds, dl.domains]);
  const ids = domainIds ?? [];
  const q = useQuery({
    queryKey: ['plan-graph', ids.join(',')],
    queryFn: () => get<PlanGraph>(`/plan-graph?includeReserve=true&domainIds=${ids.join(',')}`),
    enabled: domainIds !== null,
  });
  const choose = (v: string[]) => {
    setDomainIds(v);
    write('memento.plan.domains', v);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {tabs}
        <PageHeader eyebrow="Trimestres et au-delà · méta-objectifs, objectifs, projets" title="Plan" />
        <DomainFilter value={ids} onChange={choose} />
      </div>
      {q.isError && <ErrorBox error={q.error} />}
      {!q.data && !q.isError && <Loading />}
      {q.data && <PlanEditor key={ids.join(',')} graph={q.data} domainIds={ids} />}
    </div>
  );
}

// ---------- Editor ----------

type Hit =
  | { type: 'project'; id: string; half: 'left' | 'right' }
  | { type: 'free'; objectiveId: string }
  | { type: 'objective'; objectiveId: string }
  | { type: 'meta'; id: string }
  | { type: 'reserve' }
  | { type: 'canvas'; x: number; y: number }
  | null;

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'port'; from: { type: 'project' | 'meta'; id: string }; x: number; y: number; hit: Hit }
  | {
      kind: 'project';
      id: string;
      from: 'canvas' | 'reserve' | 'loose';
      cx: number;
      cy: number;
      moved: boolean;
      hit: Hit;
    }
  | {
      kind: 'objective';
      id: string;
      from: 'canvas' | 'reserve';
      cx: number;
      cy: number;
      moved: boolean;
      target: ObjTarget | null;
      overReserve: boolean;
    };

interface ObjTarget {
  quarter: string;
  bandKey: string;
  metaObjectiveId: string | null;
  metaTitle: string | null;
  index: number;
  y: number;
  x: number;
  w: number;
}

function PlanEditor({ graph, domainIds }: { graph: PlanGraph; domainIds: string[] }) {
  const dl = useDomainLookup();
  const me = useMe();
  const phone = useIsPhone();
  const coarse = useCoarse();
  const readOnly = phone || me.data?.canWrite === false; // V-18: iPhone = read only
  const qc = useQueryClient();
  const fresh = useMemo(() => draftFromGraph(graph), [graph]);
  const [base, setBase] = useState<Draft>(fresh);
  const [draft, setDraft] = useState<Draft>(fresh);
  // D-91: a creation (or any refetch) keeps the draft — the new state with the user's own changes on top.
  if (fresh !== base) {
    setBase(fresh);
    setDraft((d) => rebase(base, d, fresh));
  }
  const [loose, setLoose] = useState<{ id: string; x: number; y: number }[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [applying, setApplying] = useState(false);
  const [drawer, setDrawerState] = useState(() => read('memento.plan.reserve', !coarse));
  const setDrawer = (v: boolean) => {
    setDrawerState(v);
    write('memento.plan.reserve', v);
  };
  // D-97: a click on a meta-objective, an objective header or a project opens its full panel, here.
  const [editing, setEditing] = useState<Editing | null>(null);

  const { ops, changes } = useMemo(() => diff(base, draft), [base, draft]);
  const looseIds = new Set(loose.map((l) => l.id));
  const lay = useMemo(
    () => layout(draft, graph.metas, graph.quarters, (o) => showDone || o.quarter === graph.currentQuarter),
    [draft, graph, showDone],
  );

  // CA-29: capacity and alerts recomputed on the draft, before « Appliquer » (debounced POST /plan/preview).
  const [opsKey, setOpsKey] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setOpsKey(ops.length ? JSON.stringify(ops) : ''), 350);
    return () => clearTimeout(t);
  }, [ops]);
  const preview = useQuery({
    queryKey: ['plan-preview', domainIds.join(','), opsKey],
    queryFn: () =>
      post<PlanPreview>('/plan/preview', { ops: JSON.parse(opsKey), domainIds: domainIds.join(',') }),
    enabled: !!opsKey,
    retry: false,
  });
  const live = opsKey && preview.data ? preview.data : graph;
  const previewError = opsKey && preview.error instanceof ApiError ? preview.error.message : null;

  // Q-05: the draft is not kept on reload: warn before leaving with changes.
  const dirty = ops.length > 0 || loose.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const apply = async () => {
    setApplying(true);
    setError(null);
    try {
      await post('/plan/apply', { ops, baseVersion: graph.version, domainIds: domainIds.join(',') });
      toast(
        `Plan appliqué : ${changes.length || ops.length} changement${(changes.length || ops.length) > 1 ? 's' : ''}.`,
      );
      setLoose([]);
      await qc.invalidateQueries();
    } catch (e) {
      setError({ text: (e as Error).message, conflict: e instanceof ApiError && e.status === 409 });
    } finally {
      setApplying(false);
    }
  };
  const reset = () => {
    setDraft(base);
    setLoose([]);
    setError(null);
  };

  // ---------- Viewport ----------
  const svgRef = useRef<SVGSVGElement>(null);
  const reserveRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 16, y: 8, k: 1 });
  const fit = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const k = Math.max(0.25, Math.min(1, (r.width - 32) / lay.width, (r.height - 16) / lay.height));
    setView({ x: 16, y: 8, k });
  };
  useEffect(() => {
    if (phone) fit();
  }, [phone]);
  const toWorld = (cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };
  const inside = (b: Box, p: { x: number; y: number }, m = 0) =>
    p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m;
  const overEl = (el: Element | null, cx: number, cy: number) => {
    const r = el?.getBoundingClientRect();
    return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };
  const hitAt = (cx: number, cy: number, skip?: string): Hit => {
    if (overEl(reserveRef.current, cx, cy)) return { type: 'reserve' };
    if (!overEl(svgRef.current, cx, cy)) return null;
    const p = toWorld(cx, cy);
    for (const [id, b] of lay.nodes)
      if (id !== skip && inside(b, p, coarse ? 10 : 0))
        return { type: 'project', id, half: p.x > b.x + b.w / 2 ? 'right' : 'left' };
    for (const band of lay.bands)
      if (band.metaBox && band.meta && inside(band.metaBox, p)) return { type: 'meta', id: band.meta.id };
    for (const f of lay.frames) {
      if (f.freeBox && inside(f.freeBox, p)) return { type: 'free', objectiveId: f.objectiveId };
      if (inside(f, p)) return { type: 'objective', objectiveId: f.objectiveId };
    }
    return { type: 'canvas', ...p };
  };
  const objTargetAt = (cx: number, cy: number, id: string): ObjTarget | null => {
    if (!overEl(svgRef.current, cx, cy)) return null;
    const p = toWorld(cx, cy);
    const col = lay.quarters.find(
      (q) => p.x >= q.x - L.quarterGap / 2 && p.x <= q.x + q.w + L.quarterGap / 2,
    );
    if (!col) return null;
    const band =
      lay.bands.find((b) => p.y >= b.y - L.bandGap / 2 && p.y <= b.y + b.h + L.bandGap / 2) ??
      (p.y < (lay.bands[0]?.y ?? 0) ? lay.bands[0] : lay.bands[lay.bands.length - 1]);
    const meta = band?.meta ?? (band ? null : (graph.metas[0] ?? null));
    const cell = lay.frames
      .filter(
        (f) =>
          f.objectiveId !== id &&
          f.bandKey === (band?.key ?? 'none') &&
          draft.objectives[f.objectiveId].quarter === col.quarter,
      )
      .sort((a, b) => a.y - b.y);
    const index = cell.filter((f) => f.y + f.h / 2 < p.y).length;
    const y =
      index < cell.length
        ? cell[index].y - L.frameGap / 2
        : cell.length
          ? cell[cell.length - 1].y + cell[cell.length - 1].h + L.frameGap / 2
          : (band?.y ?? L.top);
    return {
      quarter: col.quarter,
      bandKey: band?.key ?? 'none',
      metaObjectiveId: meta?.id ?? null,
      metaTitle: meta?.title ?? null,
      index,
      y,
      x: col.x,
      w: col.w,
    };
  };

  // ---------- Gestures ----------
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);

  const projectTitle = (id: string) => draft.projects[id]?.title ?? '';
  const objTitle = (id: string) => draft.objectives[id]?.title ?? '';
  const loops = (d: Drag | null): boolean => {
    if (d?.kind !== 'port' || d.from.type !== 'project' || d.hit?.type !== 'project') return false;
    return wouldLoop(draft, d.from.id, d.hit.id);
  };
  const label = (d: Drag | null): string | null => {
    if (!d) return null;
    if (d.kind === 'port') {
      if (d.hit?.type !== 'project')
        return d.from.type === 'meta' ? '→ point de départ : lâche sur un projet' : '→ lâche sur un projet';
      if (loops(d)) return '✕ créerait une boucle';
      return d.from.type === 'meta'
        ? `→ « ${projectTitle(d.hit.id)} » devient un point de départ`
        : `→ « ${projectTitle(d.hit.id)} » attend « ${projectTitle(d.from.id)} »`;
    }
    if (d.kind === 'project') {
      if (!d.moved) return null;
      const h = d.hit;
      if (!h) return null;
      if (h.type === 'project')
        return `→ ${h.half === 'right' ? 'après' : 'avant'} « ${projectTitle(h.id)} »`;
      if (h.type === 'free') return `→ Libres de « ${objTitle(h.objectiveId)} »`;
      if (h.type === 'objective') return `→ dans « ${objTitle(h.objectiveId)} »`;
      if (h.type === 'reserve') return d.from === 'reserve' ? null : '→ réserve (détaché)';
      if (h.type === 'canvas') return d.from === 'canvas' ? null : '→ brouillon, hors objectif';
      return null;
    }
    if (d.kind === 'objective') {
      if (!d.moved) return null;
      if (d.overReserve) return d.from === 'canvas' ? '→ réserve (détaché du méta-objectif)' : null;
      if (!d.target) return null;
      return `→ ${quarterLabel(d.target.quarter)}${d.target.metaTitle ? ` · « ${d.target.metaTitle} »` : ' · sans méta-objectif'}`;
    }
    return null;
  };

  const start = (d: Drag, e: React.PointerEvent) => {
    if (readOnly && d.kind !== 'pan') return;
    e.stopPropagation();
    setDrag(d);
    const move = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      if (cur.kind === 'pan') return;
      if (cur.kind === 'port')
        setDrag({ ...cur, ...toWorld(ev.clientX, ev.clientY), hit: hitAt(ev.clientX, ev.clientY) });
      else if (cur.kind === 'project') {
        const moved = cur.moved || Math.hypot(ev.clientX - cur.cx, ev.clientY - cur.cy) > 4;
        setDrag({
          ...cur,
          cx: ev.clientX,
          cy: ev.clientY,
          moved,
          hit: moved ? hitAt(ev.clientX, ev.clientY, cur.id) : null,
        });
      } else {
        const moved = cur.moved || Math.hypot(ev.clientX - cur.cx, ev.clientY - cur.cy) > 4;
        setDrag({
          ...cur,
          cx: ev.clientX,
          cy: ev.clientY,
          moved,
          overReserve: overEl(reserveRef.current, ev.clientX, ev.clientY),
          target: moved ? objTargetAt(ev.clientX, ev.clientY, cur.id) : null,
        });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const cur = dragRef.current;
      setDrag(null);
      if (cur) drop(cur);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const drop = (d: Drag) => {
    if (d.kind === 'port') {
      const h = d.hit;
      if (h?.type !== 'project') return;
      if (d.from.type === 'project') {
        if (d.from.id === h.id) return;
        if (loops(d)) {
          toast('Refusé : cette flèche créerait une boucle.', 'error');
          return;
        }
        setDraft(link(draft, d.from.id, h.id));
      } else {
        const next = makeStart(draft, h.id, d.from.id);
        if (next) setDraft(next);
        else toast("Ce méta-objectif n'a pas encore d'objectif sur le plan.", 'error');
      }
      return;
    }
    if (d.kind === 'project') {
      if (!d.moved) {
        setEditing({ kind: 'project', id: d.id });
        return;
      }
      const h = d.hit;
      const drop1 = (next: Draft) => {
        setLoose((l) => l.filter((x) => x.id !== d.id));
        setDraft(next);
      };
      if (h?.type === 'project') {
        if (draft.projects[h.id].dependsOn.includes(d.id) && h.half === 'right') return;
        const next = h.half === 'right' ? placeAfter(draft, d.id, h.id) : placeBefore(draft, d.id, h.id);
        if (
          Object.values(next.projects).some((p) => p.dependsOn.some((x) => wouldLoop({ ...next }, x, p.id)))
        ) {
          toast('Refusé : ce placement créerait une boucle.', 'error');
          return;
        }
        drop1(next);
      } else if (h?.type === 'free') drop1(placeFree(draft, d.id, h.objectiveId));
      else if (h?.type === 'objective') drop1(placeInObjective(draft, d.id, h.objectiveId));
      else if (h?.type === 'reserve') {
        setLoose((l) => l.filter((x) => x.id !== d.id));
        if (d.from === 'canvas') setDraft(detach(draft, d.id));
      } else if (h?.type === 'canvas' && d.from !== 'canvas') {
        // V-27: hors de tout cadre = brouillon visuel, non rattaché (Q-05: not kept on reload).
        setLoose((l) => [
          ...l.filter((x) => x.id !== d.id),
          { id: d.id, x: h.x - L.cardW / 2, y: h.y - L.cardH / 2 },
        ]);
      }
      return;
    }
    if (d.kind === 'objective') {
      if (!d.moved) {
        if (d.from === 'canvas') setEditing({ kind: 'objective', id: d.id });
        return;
      }
      if (d.overReserve) {
        if (d.from === 'canvas') setDraft(detachObjective(draft, d.id));
        return;
      }
      if (d.target) setDraft(moveObjective(draft, d.id, d.target));
    }
  };

  // Pan, wheel zoom, pinch.
  const onBgDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y });
    setHover(null);
  };
  const onBgMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const k = Math.max(
        0.25,
        Math.min(2, (pinch.current.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d),
      );
      setView((v) => ({ ...v, k }));
      return;
    }
    const cur = dragRef.current;
    if (cur?.kind === 'pan')
      setView((v) => ({ ...v, x: cur.ox + e.clientX - cur.sx, y: cur.oy + e.clientY - cur.sy }));
  };
  const onBgUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (dragRef.current?.kind === 'pan') setDrag(null);
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      setView((v) => {
        const k = Math.max(0.25, Math.min(2, v.k * Math.exp(-e.deltaY * 0.0015)));
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  }, []);

  /** V-26: a click on an alert centres the canvas on its element. */
  const centreOn = (t: PlanGraph['alerts'][number]['target']) => {
    if (!t) return;
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    let b: Box | undefined;
    if (t.type === 'project') b = lay.nodes.get(t.id);
    if (t.type === 'objective') b = lay.frames.find((f) => f.objectiveId === t.id);
    if (t.type === 'quarter') {
      const q = lay.quarters.find((x) => x.quarter === t.id);
      if (q) b = { x: q.x, y: 0, w: q.w, h: 200 };
    }
    if (!b) return;
    setView((v) => ({
      ...v,
      x: r.width / 2 - (b!.x + b!.w / 2) * v.k,
      y: r.height / 3 - (b!.y + Math.min(b!.h, 200) / 2) * v.k,
    }));
    if (t.type === 'project') setHover(t.id);
  };

  // ---------- Rendering helpers ----------
  const highlight = hover && !drag ? chainOf(draft, hover) : null;
  const dim = (id: string) => (highlight && !highlight.has(id) ? 0.25 : 1);
  const objQuarter = (pid: string) => {
    const p = draft.projects[pid];
    return p?.objectiveId ? draft.objectives[p.objectiveId]?.quarter : undefined;
  };
  const portR = coarse ? 22 : 7;
  const capOf = (q: string) => live.capacity.find((c) => c.quarter === q);
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  };

  // D-96: arrows. Each one picks, among the plain curve and paths through the free lanes (the gaps between card
  // columns, then between rows), the one that passes under no card and crosses the fewest arrows already drawn;
  // corners are wide and the last straight part (the one with the arrowhead) stays long enough to read.
  type Pt = { x: number; y: number };
  const boxes = [...lay.nodes];
  const bezier = (x1: number, y1: number, x2: number, y2: number): Pt[] => {
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return Array.from({ length: 25 }, (_, i) => {
      const t = i / 24;
      const u = 1 - t;
      return {
        x: u * u * u * x1 + 3 * u * u * t * (x1 + dx) + 3 * u * t * t * (x2 - dx) + t * t * t * x2,
        y: u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2,
      };
    });
  };
  const sample = (pts: Pt[]) =>
    pts.slice(1).flatMap((q, i) => {
      const p = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 8));
      return Array.from({ length: n + 1 }, (_, k) => ({
        x: p.x + ((q.x - p.x) * k) / n,
        y: p.y + ((q.y - p.y) * k) / n,
      }));
    });
  const cardHits = (pts: Pt[], skip: string[]) =>
    boxes.filter(([id, b]) => !skip.includes(id) && pts.some((p) => inside(b, p, 2))).length;
  const cross = (p1: Pt, p2: Pt, p3: Pt, p4: Pt) => {
    const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return d(p1, p2, p3) * d(p1, p2, p4) < 0 && d(p3, p4, p1) * d(p3, p4, p2) < 0;
  };
  const drawn: Pt[][] = [];
  const crossings = (line: Pt[]) => {
    let n = 0;
    for (const other of drawn)
      for (let i = 1; i < line.length; i++)
        for (let j = 1; j < other.length; j++)
          if (cross(line[i - 1], line[i], other[j - 1], other[j])) n += 1;
    return n;
  };
  // Vertical lanes: the middle of the gap left of every card column.
  const lanes = [...new Set(boxes.map(([, b]) => b.x - (L.colW - L.cardW) / 2))];
  const ARROW = 42; // horizontal part that carries the arrowhead
  const route = (na: Box, nb: Box, a: string, b: string) => {
    const p1 = { x: na.x + na.w, y: na.y + na.h / 2 };
    const p2 = { x: nb.x, y: nb.y + nb.h / 2 };
    const rowGap = (L.rowH - L.cardH) / 2;
    const options: { line: Pt[]; d: () => string; bonus: number }[] = [
      { line: bezier(p1.x, p1.y, p2.x, p2.y), d: () => curve(p1.x, p1.y, p2.x, p2.y), bonus: -0.5 },
    ];
    const last = p2.x - ARROW;
    for (const x of lanes.filter((x) => x >= p1.x + 24 && x <= last + 4)) {
      const pts = [p1, { x, y: p1.y }, { x, y: p2.y }, p2];
      options.push({ line: pts, d: () => rounded(pts), bonus: 0 });
    }
    for (const hy of [nb.y - rowGap, nb.y + nb.h + rowGap]) {
      const gx = lanes.filter((x) => x >= p1.x + 24).sort((u, v) => u - v)[0] ?? p1.x + 36;
      const pts = [p1, { x: gx, y: p1.y }, { x: gx, y: hy }, { x: last, y: hy }, { x: last, y: p2.y }, p2];
      options.push({ line: pts, d: () => rounded(pts), bonus: 1 });
    }
    const scored = options.map((o) => {
      const line = o.line.length > 6 ? o.line : sample(o.line);
      return { o, line, score: cardHits(line, [a, b]) * 1000 + crossings(o.line) * 10 + o.bonus };
    });
    const best = scored.sort((u, v) => u.score - v.score)[0];
    drawn.push(best.o.line);
    return best.o.d();
  };

  // Start points first (meta → project), then the dependencies, shortest first: the long arrows go around.
  const starts: { meta: string; p: string; d: string; color: string }[] = [];
  for (const band of lay.bands) {
    if (!band.meta || !band.metaBox) continue;
    const mb = band.metaBox;
    // Start arrows go into the objectives of the meta-objective's earliest quarter on the plan (Q-03): the later
    // quarters start from their own prerequisites, an arrow from the meta would cross the frames in between.
    const own = lay.frames.filter((f) => draft.objectives[f.objectiveId].metaObjectiveId === band.meta!.id);
    const firstX = Math.min(...own.map((f) => f.x));
    const firstIds = new Set(own.filter((f) => f.x === firstX).map((f) => f.objectiveId));
    for (const p of Object.values(draft.projects)) {
      if (!p.objectiveId || !firstIds.has(p.objectiveId)) continue;
      const o = p.objectiveId ? draft.objectives[p.objectiveId] : undefined;
      const nb = lay.nodes.get(p.id);
      if (!nb || o?.metaObjectiveId !== band.meta.id || !isStart(draft, p)) continue;
      const [x1, y1, x2, y2] = [mb.x + mb.w, mb.y + mb.h / 2, nb.x, nb.y + nb.h / 2];
      drawn.push(bezier(x1, y1, x2, y2));
      starts.push({
        meta: band.meta.id,
        p: p.id,
        d: curve(x1, y1, x2, y2),
        color: dl.color(band.meta.domainId),
      });
    }
  }
  const pairs: { a: string; b: string; na: Box; nb: Box }[] = [];
  for (const p of Object.values(draft.projects)) {
    const nb = lay.nodes.get(p.id);
    if (!nb) continue;
    for (const a of p.dependsOn) {
      const na = lay.nodes.get(a);
      if (na) pairs.push({ a, b: p.id, na, nb });
    }
  }
  pairs.sort(
    (u, v) => Math.hypot(u.nb.x - u.na.x, u.nb.y - u.na.y) - Math.hypot(v.nb.x - v.na.x, v.nb.y - v.na.y),
  );
  const edges = pairs.map(({ a, b, na, nb }) => {
    const qa = objQuarter(a);
    const qb = objQuarter(b);
    return { a, b, d: route(na, nb, a, b), bad: !!qa && !!qb && qa > qb };
  });
  const dragLine =
    drag?.kind === 'port'
      ? (() => {
          const from =
            drag.from.type === 'project'
              ? lay.nodes.get(drag.from.id)
              : lay.bands.find((b) => b.meta?.id === drag.from.id)?.metaBox;
          if (!from) return null;
          return curve(from.x + from.w, from.y + from.h / 2, drag.x, drag.y);
        })()
      : null;
  const loopNow = loops(drag);
  const hotFrame =
    drag?.kind === 'port' && drag.hit?.type === 'project'
      ? draft.projects[drag.hit.id]?.objectiveId
      : drag?.kind === 'project' && drag.hit && 'objectiveId' in drag.hit
        ? drag.hit.objectiveId
        : drag?.kind === 'project' && drag.hit?.type === 'project'
          ? draft.projects[drag.hit.id]?.objectiveId
          : null;

  const ghost = label(drag);
  const ghostPos =
    drag && (drag.kind === 'project' || drag.kind === 'objective')
      ? { x: drag.cx, y: drag.cy }
      : drag?.kind === 'port'
        ? (() => {
            const r = svgRef.current?.getBoundingClientRect();
            return r ? { x: r.left + view.x + drag.x * view.k, y: r.top + view.y + drag.y * view.k } : null;
          })()
        : null;

  const alerts = live.alerts;
  const levelColor = (l: string) =>
    l === 'error' ? 'var(--status-red)' : l === 'warn' ? 'var(--status-orange)' : 'var(--text-ghost)';

  return (
    <div className="flex flex-col gap-3">
      {/* D-94: one toolbar line, grouped in discreet frames: what is shown, the view, creation. */}
      <div className="flex flex-wrap items-center gap-2.5 text-[14px]">
        <ToolGroup label="Affichage">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Terminés
          </label>
        </ToolGroup>
        {readOnly && phone && (
          <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
            Lecture seule sur téléphone
          </span>
        )}
        <span className="flex-1" />
        <ToolGroup label="Vue">
          {!readOnly && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setDrawer(!drawer)}>
              {drawer ? '« Réserve' : '» Réserve'}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={fit}>
            Tout voir
          </button>
        </ToolGroup>
        {!readOnly && (
          <ToolGroup label="Créer">
            <button
              type="button"
              className="btn btn-sm btn-soft-primary"
              onClick={() => setEditing({ kind: 'newMeta' })}
            >
              + Méta-objectif
            </button>
            <button
              type="button"
              className="btn btn-sm btn-soft-primary"
              onClick={() => setEditing({ kind: 'newObjective' })}
            >
              + Objectif
            </button>
          </ToolGroup>
        )}
      </div>

      <div className="flex gap-3 items-stretch" style={{ minHeight: 0 }}>
        {!readOnly && drawer && (
          <Reserve
            refEl={reserveRef}
            draft={draft}
            graph={graph}
            loose={looseIds}
            domainIds={domainIds}
            onFold={() => setDrawer(false)}
            hot={
              (drag?.kind === 'project' && drag.from !== 'reserve' && drag.hit?.type === 'reserve') ||
              (drag?.kind === 'objective' && drag.from === 'canvas' && drag.overReserve)
            }
            onProject={(id, e) =>
              start(
                {
                  kind: 'project',
                  id,
                  from: 'reserve',
                  cx: e.clientX,
                  cy: e.clientY,
                  moved: false,
                  hit: null,
                },
                e,
              )
            }
            onObjective={(id, e) =>
              start(
                {
                  kind: 'objective',
                  id,
                  from: 'reserve',
                  cx: e.clientX,
                  cy: e.clientY,
                  moved: false,
                  target: null,
                  overReserve: true,
                },
                e,
              )
            }
          />
        )}
        <div className="flex-1 min-w-0 relative">
          <svg
            ref={svgRef}
            role="application"
            aria-label="Graphe du plan"
            className="block w-full rounded-xl"
            style={{
              height: phone ? '58vh' : 'calc(100vh - 330px)',
              minHeight: 460,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              touchAction: 'none',
              cursor: drag?.kind === 'pan' ? 'grabbing' : 'grab',
              userSelect: 'none',
            }}
            onPointerDown={onBgDown}
            onPointerMove={onBgMove}
            onPointerUp={onBgUp}
            onPointerCancel={onBgUp}
          >
            <defs>
              <marker
                id="pv-ar"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)" />
              </marker>
              <marker
                id="pv-ar-bad"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L10,5 L0,10 z" fill="var(--status-red)" />
              </marker>
            </defs>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* Quarter columns and their capacity (V-25). */}
              {lay.quarters.map((q) => {
                const c = capOf(q.quarter);
                const over = !!c && (c.loadMin > c.budgetMin || c.longestPath > c.monthsLeft);
                const hotCol = drag?.kind === 'objective' && drag.target?.quarter === q.quarter;
                return (
                  <g key={q.quarter}>
                    <rect
                      x={q.x - 12}
                      y={6}
                      width={q.w + 24}
                      height={Math.max(lay.height, 400)}
                      rx={14}
                      fill={hotCol ? 'var(--row-week)' : 'transparent'}
                      stroke="var(--divider)"
                      strokeDasharray="4 6"
                    />
                    <text x={q.x} y={28} fontSize={16} fontWeight={600} fill="var(--text)">
                      {quarterLabel(q.quarter)}
                      {q.quarter === graph.currentQuarter ? ' · en cours' : ''}
                    </text>
                    {c && (
                      <text
                        x={q.x}
                        y={48}
                        fontSize={12.5}
                        fill={over ? 'var(--warn)' : 'var(--text-faint)'}
                        className="mono"
                      >
                        {hours(c.loadMin)} / {hours(c.budgetMin)} · chemin {c.longestPath} / {c.monthsLeft}{' '}
                        mois
                      </text>
                    )}
                    {!lay.frames.some((f) => draft.objectives[f.objectiveId].quarter === q.quarter) && (
                      <text
                        x={q.x + q.w / 2}
                        y={(lay.bands[0]?.y ?? L.top) + 60}
                        textAnchor="middle"
                        fontSize={13}
                        fill="var(--text-ghost)"
                      >
                        Déposer un objectif ici
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Meta-objective nodes (V-22 §4.2). */}
              {lay.bands.map((band) =>
                band.meta && band.metaBox ? (
                  <g key={band.key}>
                    <foreignObject
                      x={band.metaBox.x}
                      y={band.metaBox.y}
                      width={band.metaBox.w}
                      height={band.metaBox.h}
                    >
                      <div
                        onClick={() => !readOnly && setEditing({ kind: 'meta', id: band.meta!.id })}
                        title={readOnly ? undefined : 'Clic : modifier le méta-objectif'}
                        style={{
                          cursor: readOnly ? 'default' : 'pointer',
                          height: '100%',
                          borderRadius: 14,
                          padding: '10px 14px',
                          background: dl.color(band.meta.domainId),
                          color: '#fff',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          fontFamily: 'var(--font-sans)',
                        }}
                      >
                        <span className="mono" style={{ fontSize: 11, letterSpacing: 0.6, opacity: 0.9 }}>
                          MÉTA · {dl.name(band.meta.domainId).toUpperCase()}
                        </span>
                        <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.25 }}>
                          {band.meta.title}
                        </span>
                        <span style={{ fontSize: 12, opacity: 0.9 }}>
                          {band.meta.objectiveCount} objectif{band.meta.objectiveCount > 1 ? 's' : ''} ·{' '}
                          {band.meta.projectCount} projet
                          {band.meta.projectCount > 1 ? 's' : ''}
                        </span>
                      </div>
                    </foreignObject>
                    {!readOnly && (
                      <circle
                        cx={band.metaBox.x + band.metaBox.w}
                        cy={band.metaBox.y + band.metaBox.h / 2}
                        r={portR}
                        fill="var(--surface)"
                        stroke={dl.color(band.meta.domainId)}
                        strokeWidth={2}
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={(e) => {
                          const w = toWorld(e.clientX, e.clientY);
                          start(
                            { kind: 'port', from: { type: 'meta', id: band.meta!.id }, ...w, hit: null },
                            e,
                          );
                        }}
                      />
                    )}
                  </g>
                ) : (
                  <text key={band.key} x={0} y={band.y + 24} fontSize={13} fill="var(--text-faint)">
                    Sans méta-objectif
                  </text>
                ),
              )}

              {/* D-91: « + objectif » in each meta-objective × quarter cell, under its last frame. */}
              {!readOnly &&
                lay.bands.flatMap((band) =>
                  lay.quarters.map((q) => (
                    <foreignObject
                      key={`add-${band.key}-${q.quarter}`}
                      x={q.x}
                      y={band.y + band.h + 6}
                      width={130}
                      height={30}
                    >
                      <button
                        type="button"
                        className="pv-add"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() =>
                          setEditing({
                            kind: 'newObjective',
                            quarter: q.quarter,
                            metaObjectiveId: band.meta?.id ?? null,
                          })
                        }
                        title={`Nouvel objectif · ${quarterLabel(q.quarter)}${band.meta ? ` · « ${band.meta.title} »` : ''}`}
                      >
                        + objectif
                      </button>
                    </foreignObject>
                  )),
                )}

              {/* Objective frames (V-22 §4.3). */}
              {lay.frames.map((f) => {
                const o = draft.objectives[f.objectiveId];
                const color = dl.color(o.domainId);
                const red = loopNow && hotFrame === f.objectiveId;
                const hot = hotFrame === f.objectiveId;
                const empty = !Object.values(draft.projects).some(
                  (p) => p.objectiveId === o.id && lay.nodes.has(p.id),
                );
                return (
                  <g
                    key={f.objectiveId}
                    opacity={drag?.kind === 'objective' && drag.id === o.id && drag.moved ? 0.4 : 1}
                  >
                    <rect
                      x={f.x}
                      y={f.y}
                      width={f.w}
                      height={f.h}
                      rx={12}
                      fill={color}
                      fillOpacity={0.07}
                      stroke={red ? 'var(--status-red)' : hot ? color : color}
                      strokeOpacity={red || hot ? 1 : 0.35}
                      strokeWidth={red || hot ? 2 : 1}
                    />
                    <foreignObject x={f.x} y={f.y} width={f.w} height={lay.header}>
                      <div
                        className="pv-handle"
                        onPointerDown={(e) =>
                          start(
                            {
                              kind: 'objective',
                              id: o.id,
                              from: 'canvas',
                              cx: e.clientX,
                              cy: e.clientY,
                              moved: false,
                              target: null,
                              overReserve: false,
                            },
                            e,
                          )
                        }
                        title="Clic : modifier l'objectif · glisser : changer de trimestre ou d'ordre"
                        style={{
                          height: '100%',
                          padding: coarse ? '12px 14px' : '9px 14px',
                          cursor: readOnly ? 'default' : 'move',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                          fontFamily: 'var(--font-sans)',
                          touchAction: 'none',
                        }}
                      >
                        <span
                          className="mono"
                          style={{ fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 8 }}
                        >
                          <span
                            style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                          >
                            {readOnly ? '' : '⋮⋮ '}
                            {quarterLabel(o.quarter)} · deadline {fmtDate(o.deadline)}
                          </span>
                          {o.smart && (
                            <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{o.smart}</span>
                          )}
                        </span>
                        <span
                          title={o.title}
                          style={{
                            fontSize: 15.5,
                            fontWeight: 600,
                            lineHeight: 1.2,
                            color: 'var(--text)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            flex: 'none',
                          }}
                        >
                          {o.title}
                        </span>
                      </div>
                    </foreignObject>
                    {empty && (
                      <text
                        x={f.x + f.w / 2}
                        y={f.mainBox.y + 40}
                        textAnchor="middle"
                        fontSize={13}
                        fill="var(--text-ghost)"
                      >
                        Déposer un projet ici
                      </text>
                    )}
                    {f.freeBox && (
                      <>
                        <line
                          x1={f.x + 10}
                          x2={f.x + f.w - 10}
                          y1={f.freeBox.y}
                          y2={f.freeBox.y}
                          stroke={color}
                          strokeOpacity={0.4}
                          strokeDasharray="4 4"
                        />
                        <text x={f.x + L.pad} y={f.freeBox.y + 18} fontSize={12} fill="var(--text-faint)">
                          Libres, sans ordre
                        </text>
                        {drag?.kind === 'project' &&
                          drag.hit?.type === 'free' &&
                          drag.hit.objectiveId === f.objectiveId && (
                            <rect
                              x={f.x + 4}
                              y={f.freeBox.y + 2}
                              width={f.w - 8}
                              height={f.freeBox.h - 6}
                              rx={8}
                              fill="none"
                              stroke="var(--focus)"
                              strokeWidth={2}
                              strokeDasharray="5 4"
                            />
                          )}
                      </>
                    )}
                  </g>
                );
              })}
              {drag?.kind === 'objective' && drag.moved && drag.target && !drag.overReserve && (
                <line
                  x1={drag.target.x}
                  x2={drag.target.x + drag.target.w}
                  y1={drag.target.y}
                  y2={drag.target.y}
                  stroke="var(--focus)"
                  strokeWidth={3}
                />
              )}

              {/* Start points and dependencies (V-22 §4.5). */}
              {starts.map((s) => (
                <path
                  key={`${s.meta}-${s.p}`}
                  d={s.d}
                  fill="none"
                  stroke={s.color}
                  strokeOpacity={0.5 * dim(s.p)}
                  strokeWidth={2}
                />
              ))}
              {edges.map((e) => (
                <g
                  key={`${e.a}-${e.b}`}
                  opacity={highlight ? (highlight.has(e.a) && highlight.has(e.b) ? 1 : 0.15) : 1}
                >
                  <path
                    d={e.d}
                    fill="none"
                    stroke={e.bad ? 'var(--status-red)' : 'var(--text-muted)'}
                    strokeWidth={1.8}
                    strokeDasharray={e.bad ? '6 4' : undefined}
                    markerEnd={e.bad ? 'url(#pv-ar-bad)' : 'url(#pv-ar)'}
                  />
                  {!readOnly && (
                    <path
                      d={e.d}
                      className="pv-edge-hit"
                      fill="none"
                      stroke="transparent"
                      strokeWidth={coarse ? 22 : 14}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={() => setDraft(unlink(draft, e.a, e.b))}
                    >
                      <title>
                        « {projectTitle(e.b)} » attend « {projectTitle(e.a)} » · clic : supprimer la flèche
                      </title>
                    </path>
                  )}
                </g>
              ))}
              {dragLine && (
                <path
                  d={dragLine}
                  fill="none"
                  stroke={loopNow ? 'var(--status-red)' : 'var(--focus)'}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                />
              )}

              {/* Project nodes (V-22 §4.4). */}
              {[...lay.nodes].map(([id, b]) => (
                <ProjectNode
                  key={id}
                  p={draft.projects[id]}
                  box={b}
                  draft={draft}
                  free={draft.projects[id].isFree}
                  domainIds={domainIds}
                  opacity={dim(id) * (drag?.kind === 'project' && drag.id === id && drag.moved ? 0.4 : 1)}
                  portR={portR}
                  readOnly={readOnly}
                  dropHint={
                    drag?.kind === 'project' && drag.hit?.type === 'project' && drag.hit.id === id
                      ? drag.hit.half
                      : drag?.kind === 'port' && drag.hit?.type === 'project' && drag.hit.id === id
                        ? 'link'
                        : null
                  }
                  onHover={(on) => !drag && setHover(on ? id : null)}
                  onDown={(e) =>
                    start(
                      {
                        kind: 'project',
                        id,
                        from: 'canvas',
                        cx: e.clientX,
                        cy: e.clientY,
                        moved: false,
                        hit: null,
                      },
                      e,
                    )
                  }
                  onTap={() => {
                    setHover(id);
                    setDetail(id);
                  }}
                  onPort={(e) => {
                    const w = toWorld(e.clientX, e.clientY);
                    start({ kind: 'port', from: { type: 'project', id }, ...w, hit: null }, e);
                  }}
                />
              ))}
              {/* Loose draft cards, outside any frame (V-27, Q-05). */}
              {loose.map((l) => {
                const p = draft.projects[l.id];
                if (!p || onCanvas(draft, p)) return null;
                return (
                  <foreignObject key={l.id} x={l.x} y={l.y} width={L.cardW} height={L.cardH}>
                    <div
                      onPointerDown={(e) =>
                        start(
                          {
                            kind: 'project',
                            id: l.id,
                            from: 'loose',
                            cx: e.clientX,
                            cy: e.clientY,
                            moved: false,
                            hit: null,
                          },
                          e,
                        )
                      }
                      style={{
                        height: '100%',
                        borderRadius: 10,
                        border: '2px dashed var(--focus)',
                        background: 'var(--surface)',
                        padding: '8px 12px',
                        cursor: 'move',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        fontFamily: 'var(--font-sans)',
                        touchAction: 'none',
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>{p.title}</span>
                      <span style={{ fontSize: 11, color: 'var(--focus)' }}>✎ Brouillon</span>
                    </div>
                  </foreignObject>
                );
              })}
            </g>
          </svg>
          {ghost && ghostPos && (
            <div
              style={{
                position: 'fixed',
                left: ghostPos.x + 14,
                top: ghostPos.y + 14,
                pointerEvents: 'none',
                zIndex: 50,
                background: 'var(--surface)',
                border: `2px solid ${loopNow ? 'var(--status-red)' : 'var(--focus)'}`,
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: 13,
                maxWidth: 340,
                boxShadow: '0 4px 14px rgba(0,0,0,.12)',
              }}
            >
              {ghost}
            </div>
          )}
        </div>
      </div>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: phone ? '1fr' : 'repeat(auto-fit, minmax(340px, 1fr))' }}
      >
        <section className="card flex flex-col gap-2" style={{ padding: '12px 16px' }}>
          <div className="flex items-center gap-2">
            <h2 className="h2">Alertes du plan</h2>
            {preview.isFetching && (
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                recalcul…
              </span>
            )}
          </div>
          {previewError && (
            <p className="text-[14px] m-0" style={{ color: 'var(--status-red)' }}>
              {previewError}
            </p>
          )}
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {alerts.length === 0 && (
              <li className="flex gap-2.5 text-[14px]">
                <span className="dot" style={{ marginTop: 6, background: 'var(--status-green)' }} />
                Rien à signaler : le plan tient.
              </li>
            )}
            {alerts.map((a, i) => (
              <li key={`${a.code}-${i}`}>
                <button
                  type="button"
                  className="flex gap-2.5 text-[14px] text-left w-full cursor-pointer"
                  style={{ background: 'none', border: 0, padding: 0, color: 'var(--text)' }}
                  onClick={() => centreOn(a.target)}
                >
                  <span
                    className="dot"
                    style={{ marginTop: 6, background: levelColor(a.level), flex: 'none' }}
                  />
                  <span>
                    {a.text}{' '}
                    <span className="mono text-[11px]" style={{ color: 'var(--text-ghost)' }}>
                      {a.code}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Room for the floating bar so it never hides the alerts. */}
      {dirty && !readOnly && <div style={{ height: 90 }} />}
      {dirty && !readOnly && (
        <ApplyBar
          changes={changes}
          looseLabels={loose.map((l) => projectTitle(l.id))}
          canApply={ops.length > 0}
          applying={applying}
          error={error}
          onReset={reset}
          onApply={apply}
          onReload={() => {
            setError(null);
            qc.invalidateQueries({ queryKey: ['plan-graph'] });
          }}
        />
      )}
      <PlanEditors editing={editing} domainIds={domainIds} onClose={() => setEditing(null)} />
      <ProjectDetailPanel id={detail} draft={draft} onClose={() => setDetail(null)} />
    </div>
  );
}

function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-2"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '3px 5px 3px 10px',
        minHeight: 40,
      }}
    >
      <span className="label-caps" style={{ fontSize: 10.5, color: 'var(--text-ghost)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

// ---------- Project node ----------

function ProjectNode({
  p,
  box,
  draft,
  free,
  domainIds,
  opacity,
  portR,
  readOnly,
  dropHint,
  onHover,
  onDown,
  onTap,
  onPort,
}: {
  p: DProject;
  box: Box;
  draft: Draft;
  free: boolean;
  domainIds: string[];
  opacity: number;
  portR: number;
  readOnly: boolean;
  dropHint: 'left' | 'right' | 'link' | null;
  onHover: (on: boolean) => void;
  onDown: (e: React.PointerEvent) => void;
  onTap: () => void;
  onPort: (e: React.PointerEvent) => void;
}) {
  const dl = useDomainLookup();
  const color = dl.color(p.primaryDomainId);
  const waiting = p.dependsOn.filter((id) => {
    const s = draft.projects[id]?.status;
    return s && s !== 'done' && s !== 'abandoned';
  });
  const related = domainIds.length > 0 && !domainIds.includes(p.primaryDomainId ?? '');
  const done = p.status === 'done';
  const muted = done || p.status === 'paused';
  const badge =
    p.status === 'active'
      ? '▶ Du mois'
      : p.status === 'ready'
        ? '◌ Prêt'
        : p.status === 'idea'
          ? `Idée${p.gaps.length ? ' ⚠' : ''}`
          : p.status === 'paused'
            ? '⏸ En pause'
            : done
              ? '✓ Terminé'
              : (STATUS_LABEL[p.status] ?? p.status);
  const border =
    p.status === 'active'
      ? `2px solid ${color}`
      : p.status === 'idea' || free
        ? '1.5px dashed var(--btn-border)'
        : '1px solid var(--btn-border)';
  return (
    <g
      opacity={opacity * (muted ? 0.6 : 1)}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <foreignObject x={box.x} y={box.y} width={box.w} height={box.h}>
        <div
          onPointerDown={readOnly ? undefined : onDown}
          onClick={readOnly ? onTap : undefined}
          title={readOnly ? p.title : `${p.title} · clic : modifier`}
          style={{
            height: '100%',
            boxSizing: 'border-box',
            borderRadius: 10,
            border,
            borderLeft: related ? `5px solid ${color}` : undefined,
            background: p.status === 'idea' ? 'var(--surface-2)' : 'var(--surface)',
            padding: '7px 14px 7px 11px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            cursor: readOnly ? 'pointer' : 'move',
            fontFamily: 'var(--font-sans)',
            touchAction: 'none',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              lineHeight: 1.22,
              color: done ? 'var(--text-faint)' : 'var(--text)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {p.title}
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              display: 'flex',
              gap: 6,
              justifyContent: 'space-between',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.groups.join(', ')}
              {p.remainingMin ? ` · ${fmtMin(p.remainingMin)}` : ''}
            </span>
            <span>
              {waiting.length ? (
                <span
                  style={{ color: 'var(--late-text)' }}
                  title={`Attend ${waiting.map((w) => `« ${draft.projects[w]?.title} »`).join(', ')} (n'empêche rien)`}
                >
                  {waiting.length > 1 ? `Attend ${waiting.length}` : 'Attend'} ·{' '}
                </span>
              ) : free ? (
                '⇄ Libre · '
              ) : null}
              {badge}
            </span>
          </span>
        </div>
      </foreignObject>
      {dropHint === 'left' && (
        <line
          x1={box.x - 6}
          x2={box.x - 6}
          y1={box.y}
          y2={box.y + box.h}
          stroke="var(--focus)"
          strokeWidth={3}
        />
      )}
      {dropHint === 'right' && (
        <line
          x1={box.x + box.w + 6}
          x2={box.x + box.w + 6}
          y1={box.y}
          y2={box.y + box.h}
          stroke="var(--focus)"
          strokeWidth={3}
        />
      )}
      {dropHint === 'link' && (
        <rect
          x={box.x - 3}
          y={box.y - 3}
          width={box.w + 6}
          height={box.h + 6}
          rx={12}
          fill="none"
          stroke="var(--focus)"
          strokeWidth={2}
        />
      )}
      {!readOnly && (
        <circle
          cx={box.x + box.w}
          cy={box.y + box.h / 2}
          r={portR}
          fill="var(--surface)"
          stroke="var(--text-muted)"
          strokeWidth={1.5}
          style={{ cursor: 'crosshair' }}
          onPointerDown={onPort}
        >
          <title>Tirer vers un projet : il dépendra de celui-ci</title>
        </circle>
      )}
    </g>
  );
}

// ---------- Reserve (V-29) ----------

function Reserve({
  refEl,
  draft,
  graph,
  loose,
  domainIds,
  hot,
  onFold,
  onProject,
  onObjective,
}: {
  onFold: () => void;
  refEl: React.RefObject<HTMLDivElement | null>;
  draft: Draft;
  graph: PlanGraph;
  loose: Set<string>;
  domainIds: string[];
  hot: boolean;
  onProject: (id: string, e: React.PointerEvent) => void;
  onObjective: (id: string, e: React.PointerEvent) => void;
}) {
  const dl = useDomainLookup();
  const [tab, setTab] = useState<'projects' | 'objectives'>('projects');
  const [group, setGroup] = useState<string | null>(null);
  const [status, setStatus] = useState<'all' | 'idea' | 'ready'>('all');
  const [related, setRelated] = useState(true);
  const [q, setQ] = useState('');
  const shownMetas = new Set(graph.metas.map((m) => m.id));
  const projects = Object.values(draft.projects).filter(
    (p) =>
      !onCanvas(draft, p) && !loose.has(p.id) && ['idea', 'ready', 'active', 'paused'].includes(p.status),
  );
  const groups = [...new Set(projects.flatMap((p) => p.groups))].sort();
  const isRelated = (p: DProject) =>
    !!p.elsewhereTitle || (domainIds.length > 0 && !domainIds.includes(p.primaryDomainId ?? ''));
  const relatedCount = projects.filter((p) => isRelated(p)).length;
  const list = projects
    .filter(
      (p) =>
        (!group || p.groups.includes(group)) &&
        (status === 'all' || p.status === status || (status === 'ready' && p.status === 'active')),
    )
    .filter((p) => related || !isRelated(p))
    .filter((p) => !q || fold(p.title).includes(fold(q)))
    .sort((a, b) => Number(isRelated(a)) - Number(isRelated(b)) || a.title.localeCompare(b.title));
  const objectives = Object.values(draft.objectives).filter(
    (o) => !o.onCanvas && ['active', 'paused'].includes(o.status),
  );
  const noMeta = objectives.filter((o) => !o.metaObjectiveId || !o.metaTitle);
  const otherMeta = objectives.filter(
    (o) => o.metaObjectiveId && o.metaTitle && !shownMetas.has(o.metaObjectiveId),
  );
  const sameMeta = objectives.filter((o) => o.metaObjectiveId && shownMetas.has(o.metaObjectiveId));
  const chip = (on: boolean) => ({
    minHeight: 28,
    padding: '0 10px',
    borderRadius: 999,
    fontSize: 12.5,
    border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`,
    background: on ? 'var(--bin)' : 'var(--surface)',
    cursor: 'pointer',
  });
  const card = {
    background: 'var(--surface)',
    border: '1px solid var(--btn-border)',
    borderRadius: 8,
    padding: '7px 9px',
    fontSize: 13,
    cursor: 'grab',
    userSelect: 'none' as const,
    touchAction: 'none' as const,
  };
  const objCard = (o: DObjective) => (
    <div
      key={o.id}
      style={{ ...card, background: 'var(--row-week)' }}
      onPointerDown={(e) => onObjective(o.id, e)}
    >
      <div style={{ fontWeight: 600 }}>{o.title}</div>
      <div style={{ fontSize: 11.5, color: o.overdue ? 'var(--late-text)' : 'var(--text-faint)' }}>
        {quarterLabel(o.quarter)}
        {o.overdue ? ' · en retard' : ''}
        {o.metaTitle ? ` · dans « ${o.metaTitle} »` : ''}
      </div>
    </div>
  );
  return (
    <div
      ref={refEl}
      className="flex flex-col gap-2 rounded-xl"
      style={{
        width: 250,
        flex: 'none',
        padding: 10,
        background: 'var(--bin)',
        border: '1px solid var(--border)',
        outline: hot ? '2px dashed var(--focus)' : undefined,
        outlineOffset: -2,
        maxHeight: 'calc(100vh - 330px)',
        minHeight: 460,
        overflow: 'auto',
      }}
    >
      <div className="flex gap-1 items-center">
        <button type="button" style={chip(tab === 'projects')} onClick={() => setTab('projects')}>
          Projets ({projects.length})
        </button>
        <button type="button" style={chip(tab === 'objectives')} onClick={() => setTab('objectives')}>
          Objectifs ({objectives.length})
        </button>
        <span className="flex-1" />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          style={{ minHeight: 28, padding: '0 8px' }}
          onClick={onFold}
          title="Réduire la réserve"
          aria-label="Réduire la réserve"
        >
          «
        </button>
      </div>
      {tab === 'projects' ? (
        <>
          <input
            className="field"
            placeholder="Chercher…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minHeight: 32 }}
          />
          <div className="flex flex-wrap gap-1">
            {(['all', 'idea', 'ready'] as const).map((s) => (
              <button key={s} type="button" style={chip(status === s)} onClick={() => setStatus(s)}>
                {s === 'all' ? 'Tous' : s === 'idea' ? 'Idées' : 'Prêts'}
              </button>
            ))}
          </div>
          {groups.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {groups.map((g) => (
                <button
                  key={g}
                  type="button"
                  style={chip(group === g)}
                  onClick={() => setGroup(group === g ? null : g)}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1">
            <label
              className="flex items-center gap-1.5 text-[12.5px]"
              style={{ color: relatedCount ? 'var(--text-muted)' : 'var(--text-ghost)' }}
            >
              <input
                type="checkbox"
                checked={related}
                disabled={!relatedCount}
                onChange={(e) => setRelated(e.target.checked)}
              />{' '}
              Connexes d'autres domaines ({relatedCount || 'aucun'})
            </label>
            <InfoTip>
              Projets qui touchent aussi le domaine filtré sans en faire leur domaine principal (par exemple
              un projet Carrière qui sert aussi Santé), et projets déjà rangés dans un objectif qui n'est pas
              affiché ici. Décoche pour ne garder que les projets du domaine. Le liseré de chaque carte donne
              la couleur de son domaine principal.
            </InfoTip>
          </div>
          {list.length === 0 && (
            <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              Aucun projet en réserve.
            </span>
          )}
          {list.map((p) => (
            <div
              key={p.id}
              style={{
                ...card,
                borderStyle: p.status === 'idea' ? 'dashed' : 'solid',
                borderLeft: `4px solid ${dl.color(p.primaryDomainId)}`,
              }}
              onPointerDown={(e) => onProject(p.id, e)}
            >
              <div style={{ fontWeight: 600, lineHeight: 1.25 }}>{p.title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
                {STATUS_LABEL[p.status] ?? p.status} · {p.groups.join(', ')}
                {p.remainingMin ? ` · ${fmtMin(p.remainingMin)}` : ''}
                {isRelated(p) && !p.elsewhereTitle ? ` · ${dl.name(p.primaryDomainId)}` : ''}
                {p.elsewhereTitle ? ` · dans « ${p.elsewhereTitle} »` : ''}
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <span className="label-caps">Sans méta-objectif</span>
          {noMeta.length ? (
            noMeta.map(objCard)
          ) : (
            <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              Aucun.
            </span>
          )}
          <span className="label-caps">Dans un autre méta-objectif</span>
          {otherMeta.length ? (
            otherMeta.map(objCard)
          ) : (
            <span className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
              Aucun.
            </span>
          )}
          {sameMeta.length > 0 && (
            <>
              <span className="label-caps">Hors période affichée</span>
              {sameMeta.map(objCard)}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Detail (V-27: clic sur un projet) ----------

function ProjectDetailPanel({
  id,
  draft,
  onClose,
}: {
  id: string | null;
  draft: Draft;
  onClose: () => void;
}) {
  const p = id ? draft.projects[id] : undefined;
  const q = useQuery({
    queryKey: ['project', id],
    queryFn: () => get<ProjectDetail>(`/projects/${id}`),
    enabled: !!id,
  });
  const waits = p?.dependsOn.map((x) => draft.projects[x]).filter(Boolean) ?? [];
  const unblocks = p ? Object.values(draft.projects).filter((x) => x.dependsOn.includes(p.id)) : [];
  const obj = p?.objectiveId ? draft.objectives[p.objectiveId] : undefined;
  return (
    <Panel open={!!p} onClose={onClose} title={p?.title ?? ''} width={480}>
      {p && (
        <div className="flex flex-col gap-3 text-[14px]">
          <div>
            <span className="label-caps">Objectif</span>
            <div>
              {obj ? (
                <Link to="/objectifs/$id" params={{ id: obj.id }}>
                  {obj.title}
                </Link>
              ) : (
                'Réserve (aucun objectif)'
              )}
            </div>
          </div>
          <div>
            <span className="label-caps">Critère de succès</span>
            <div>
              {q.data?.successCriterion || <span style={{ color: 'var(--text-faint)' }}>à définir</span>}
            </div>
          </div>
          <div>
            <span className="label-caps">Attend</span>
            <div>
              {waits.length
                ? waits
                    .map(
                      (w) =>
                        `« ${w!.title} »${w!.status === 'done' ? ' (terminé)' : w!.status === 'paused' ? ' (en pause)' : ''}`,
                    )
                    .join(', ')
                : 'rien'}
            </div>
          </div>
          <div>
            <span className="label-caps">Débloque</span>
            <div>{unblocks.length ? unblocks.map((w) => `« ${w.title} »`).join(', ') : 'rien'}</div>
          </div>
          <div>
            <span className="label-caps">Reste à faire</span>
            <div>
              {fmtMin(p.remainingMin)} · {STATUS_LABEL[p.status] ?? p.status}
              {p.gaps.length ? ' · incomplet' : ''}
            </div>
          </div>
          <p className="m-0 text-[13px]" style={{ color: 'var(--text-faint)' }}>
            Une dépendance n'empêche rien : elle ordonne les propositions et nourrit les alertes.
          </p>
          <Link to="/projets/$id" params={{ id: p.id }} className="btn btn-sm self-start">
            Ouvrir la fiche
          </Link>
        </div>
      )}
    </Panel>
  );
}
