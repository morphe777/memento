// Monday proposal engine (dossier de dev §6, Specs §4b). Pure and deterministic: same input = same output (Q-25).
import {
  addDays,
  daysBetween,
  fmtMin,
  frDay,
  frMonth,
  frShort,
  monthEnd,
  monthOf,
  weekMonday,
  weekSunday,
} from '../time.ts';
import { availableTaskIds } from './availability.ts';
import { delayMin } from './delay.ts';
import { budgetMinutes, budgetStatus } from './tasks.ts';

/** CH-05 guard-rail domains (by name, see docs/DECISIONS.md D-15). */
export const GUARDED_DOMAIN_NAMES = ['Santé', 'Famille'] as const;

export interface EngineDomain {
  id: string;
  name: string;
  priorityRank: number;
  weight: number;
}

export interface EngineProject {
  id: string;
  title: string;
  status: string;
  objectiveId: string | null;
  objectiveTitle: string | null;
  objectiveCriticality: number | null;
  domainIds: string[]; // primary first
  sequenceMode: 'sequential' | 'parallel';
  monthFlag: string | null;
  startDate: string | null;
  dueDate: string | null;
  replannedAt: string | null;
  replanDoneMin: number | null;
  blocked: boolean;
  importance?: 'low' | 'normal' | 'high';
}

/** D-53: project importance multiplies the value V (a « basse » Santé project can rank below a « haute » Famille one). */
export const IMPORTANCE_FACTOR = { low: 0.5, normal: 1, high: 1.5 } as const;

export interface EngineTask {
  id: string;
  projectId: string | null;
  title: string;
  durationMin: number | null;
  position: number;
  isFree: boolean;
  isExperience: boolean;
  status: 'todo' | 'done' | 'cancelled';
  dueDate: string | null;
  domainId: string | null;
  postponeCount: number;
  doneAt: string | null; // ISO timestamp
}

export interface EngineWeights {
  value: number;
  urgency: number;
  delay: number;
  continuity: number;
  age: number;
}

export interface EngineInput {
  isoWeek: string;
  today: string;
  weights: EngineWeights;
  bonusCount: number;
  considerAlsoCount: number;
  budgetMin: number;
  experienceTarget: number;
  experienceWindowWeeks: number;
  /** Experiences done over the window ending before this week (R-02). */
  experiencesDone: number;
  /** Minutes done per domain id over guards.window_weeks (CH-05). */
  guardDomainMinutes: Record<string, number>;
  domains: EngineDomain[];
  projects: EngineProject[];
  tasks: EngineTask[];
  taskDeps: { taskId: string; dependsOnTaskId: string }[];
}

export type Selection = 'week' | 'bonus';

export interface ScoreParts {
  V: number;
  U: number;
  R: number;
  C: number;
  A: number;
  D: number;
}

export interface ScoredTask {
  taskId: string;
  score: number;
  parts: ScoreParts;
  mandatory: boolean;
  why: string;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

function projectMinutes(tasks: EngineTask[]) {
  const live = tasks.filter((t) => t.status !== 'cancelled');
  return {
    totalMin: live.reduce((s, t) => s + (t.durationMin ?? 0), 0),
    doneMin: live.filter((t) => t.status === 'done').reduce((s, t) => s + (t.durationMin ?? 0), 0),
  };
}

/** R-06 delay (minutes, negative = late) for a month project, at a given date. */
export function projectDelayMin(p: EngineProject, tasks: EngineTask[], today: string): number {
  const { totalMin, doneMin } = projectMinutes(tasks);
  return delayMin({
    totalMin,
    doneMin,
    startDate: p.startDate,
    dueDate: p.dueDate,
    replannedAt: p.replannedAt,
    replanDoneMin: p.replanDoneMin,
    today,
  });
}

interface Prepared {
  input: EngineInput;
  domainById: Map<string, EngineDomain>;
  projectById: Map<string, EngineProject>;
  tasksByProject: Map<string, EngineTask[]>;
  inboxTasks: EngineTask[];
  monday: string;
  sunday: string;
  month: string;
  /** D-79: the month(s) of the week: two when it straddles a month end (both count as month projects). */
  months: string[];
}

const isMonthProject = (P: Prepared, p: EngineProject) => !!p.monthFlag && P.months.includes(p.monthFlag);

function prepare(input: EngineInput): Prepared {
  const tasksByProject = new Map<string, EngineTask[]>();
  const inboxTasks: EngineTask[] = [];
  for (const t of input.tasks) {
    if (t.projectId === null) inboxTasks.push(t);
    else tasksByProject.set(t.projectId, [...(tasksByProject.get(t.projectId) ?? []), t]);
  }
  const monday = weekMonday(input.isoWeek);
  return {
    input,
    domainById: new Map(input.domains.map((d) => [d.id, d])),
    projectById: new Map(input.projects.map((p) => [p.id, p])),
    tasksByProject,
    inboxTasks,
    monday,
    sunday: weekSunday(input.isoWeek),
    month: monthOf(monday),
    months: [...new Set([monthOf(monday), monthOf(weekSunday(input.isoWeek))])],
  };
}

// D-42: month projects (actif) and the backlog (prêt) can feed the week; ideas and paused projects cannot.
const eligibleProject = (p: EngineProject) => (p.status === 'active' || p.status === 'ready') && !p.blocked;

function scoreTask(P: Prepared, t: EngineTask): ScoredTask {
  const { input } = P;
  const project = t.projectId ? P.projectById.get(t.projectId) : undefined;
  // V value: primary weight + 50 % of the others (DM-84), × criticality / 3 (no objective: × 1/3). Capped at 1.
  const domainIds = project ? project.domainIds : t.domainId ? [t.domainId] : [];
  const weights = domainIds.map((id) => P.domainById.get(id)?.weight ?? 0);
  const rawV = weights.length ? weights[0] + 0.5 * weights.slice(1).reduce((a, b) => a + b, 0) : 0.5;
  const crit = project?.objectiveCriticality ?? 1;
  const V = clamp01(rawV) * (crit / 3) * IMPORTANCE_FACTOR[project?.importance ?? 'normal'];
  // U urgency: 1 if deadline ≤ 7 days from Monday, linear down to 0 at 30 days.
  const deadline = t.dueDate ?? project?.dueDate ?? null;
  let U = 0;
  if (deadline) {
    const d = daysBetween(P.monday, deadline);
    U = d <= 7 ? 1 : d >= 30 ? 0 : (30 - d) / 23;
  }
  // R delay: month projects only, (planned − done) ÷ project hours, [0, 1].
  let R = 0;
  let lateMin = 0;
  if (project && isMonthProject(P, project)) {
    const ptasks = P.tasksByProject.get(project.id) ?? [];
    const { totalMin } = projectMinutes(ptasks);
    lateMin = Math.max(0, -projectDelayMin(project, ptasks, P.input.today));
    R = totalMin > 0 ? clamp01(lateMin / totalMin) : 0;
  }
  // C continuity: a task of the project done during the 2 previous weeks.
  let C = 0;
  if (project) {
    const since = addDays(P.monday, -14);
    C = (P.tasksByProject.get(project.id) ?? []).some(
      (x) =>
        x.status === 'done' && x.doneAt && x.doneAt.slice(0, 10) >= since && x.doneAt.slice(0, 10) < P.monday,
    )
      ? 1
      : 0;
  }
  const A = Math.min(1, t.postponeCount / 3);
  const D = (t.durationMin ?? 60) / 60;
  const w = input.weights;
  const parts = { V, U, R, C, A, D };
  const score = round3((w.value * V + w.urgency * U + w.delay * R + w.continuity * C + w.age * A) / D);
  const mandatory = !!t.dueDate && t.dueDate <= P.sunday;

  // Why: one line from the dominant component (step 7).
  let why: string;
  if (mandatory && t.dueDate) {
    why =
      t.dueDate < P.monday
        ? `En retard depuis le ${frShort(t.dueDate)}`
        : `Deadline ${frDay(t.dueDate)} ${frShort(t.dueDate)}`;
  } else if (t.isExperience && input.experiencesDone < input.experienceTarget) {
    why = `Expériences : ${input.experiencesDone} / ${input.experienceTarget} sur ${input.experienceWindowWeeks} semaines`;
  } else {
    const contrib: [string, number][] = [
      ['A', w.age * A],
      ['R', w.delay * R],
      ['U', w.urgency * U],
      ['C', w.continuity * C],
      ['V', w.value * V],
    ];
    const [key, val] = contrib.reduce((best, c) => (c[1] > best[1] ? c : best));
    const primary = domainIds[0] ? P.domainById.get(domainIds[0]) : undefined;
    if (val === 0) why = project ? 'Prochaine étape du projet' : 'À caser quand tu peux';
    else if (key === 'A') why = `Reportée ${t.postponeCount} fois`;
    else if (key === 'R') why = `Projet du mois, ${fmtMin(lateMin)} de retard`;
    else if (key === 'U' && deadline)
      why = t.dueDate ? `Deadline ${frShort(deadline)}` : `Fin du projet le ${frShort(deadline)}`;
    else if (key === 'C') why = 'Suite logique : projet entamé';
    else if (project?.importance === 'high') why = 'Projet d’importance haute';
    else why = primary ? `${primary.name} = priorité n°${primary.priorityRank}` : 'À caser quand tu peux';
  }
  return { taskId: t.id, score, parts, mandatory, why };
}

/** Step 1 + 3: candidates (available todo tasks of active projects, or Inbox) with their scores. */
export function scoreCandidates(input: EngineInput): ScoredTask[] {
  const P = prepare(input);
  const out: ScoredTask[] = [];
  for (const t of P.inboxTasks) if (t.status === 'todo') out.push(scoreTask(P, t));
  for (const p of input.projects) {
    if (!eligibleProject(p)) continue;
    const ptasks = P.tasksByProject.get(p.id) ?? [];
    const avail = availableTaskIds(ptasks, p.sequenceMode, new Set(), input.taskDeps);
    for (const t of ptasks) if (avail.has(t.id)) out.push(scoreTask(P, t));
  }
  return out.sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId));
}

export interface Proposal {
  week: { taskId: string; score: number; why: string }[];
  bonus: { taskId: string; score: number; why: string }[];
}

/**
 * Initial selection (step 6 + 8): only mandatory tasks are pre-checked in "Semaine"; the next best
 * `bonusCount` tasks of the retained projects (month projects first) are pre-placed in "Bonus" (decision D-17).
 */
export function propose(input: EngineInput): Proposal {
  const P = prepare(input);
  const scored = scoreCandidates(input);
  const week = scored.filter((s) => s.mandatory).map(({ taskId, score, why }) => ({ taskId, score, why }));
  const weekIds = new Set(week.map((w) => w.taskId));
  const page = buildPlanningPage(input, new Map(week.map((w) => [w.taskId, 'week' as Selection])));
  const visibleIds = page.groups
    .filter((g) => g.key !== 'inbox')
    .flatMap((g) => g.cards.flatMap((c) => c.tasks.filter((t) => !t.locked).map((t) => t.taskId)));
  const visible = new Set(visibleIds);
  const bonus = scored
    .filter(
      (s) =>
        !weekIds.has(s.taskId) &&
        visible.has(s.taskId) &&
        !P.input.tasks.find((t) => t.id === s.taskId)?.isExperience,
    )
    .slice(0, input.bonusCount)
    .map(({ taskId, score }) => ({ taskId, score, why: 'Bonus suggéré par le moteur' }));
  return { week, bonus };
}

export interface PageTask {
  taskId: string;
  title: string;
  durationMin: number | null;
  isExperience: boolean;
  postponeCount: number;
  score: number;
  why: string;
  mandatory: boolean;
  locked: boolean;
  selection: Selection | null;
}

export interface PageCard {
  projectId: string | null;
  title: string;
  domainId: string | null;
  objectiveId: string | null;
  objectiveTitle: string | null;
  tasks: PageTask[];
  hidden: { taskId: string; title: string; durationMin: number | null }[];
  /** Inbox only: the folded tasks are selectable too (any Inbox task is available). */
  hiddenTasks: PageTask[];
  /** Inbox only: folded tasks whose deadline falls this week or earlier (warning on the fold). */
  hiddenDueCount: number;
}

/** Inbox bin shows this many tasks (closest deadlines first); chosen tasks always stay visible (D-37). */
export const INBOX_VISIBLE = 3;

export interface PageGroup {
  key: 'inbox' | 'month' | 'consider';
  name: string;
  hint: string;
  countLabel: string;
  cards: PageCard[];
}

export interface Alert {
  level: 'warn' | 'ok';
  code: string;
  text: string;
}

export interface PlanningPage {
  groups: PageGroup[];
  /** D-79: the other eligible projects (not shown in a group), for « + Tâche d'un autre projet ». */
  more: PageCard[];
  budget: { budgetMin: number; plannedMin: number; overMin: number; remainingMin: number };
  counts: { week: number; experiences: number; bonus: number };
  alerts: Alert[];
  mix: { domainId: string | null; minutes: number }[];
}

/** Step 5 (V-16): number of visible tasks for a month project, from its weekly share of remaining work. */
function monthVisibleCount(
  P: Prepared,
  p: EngineProject,
  ptasks: EngineTask[],
  ordered: EngineTask[],
): number {
  const remaining = ptasks.filter((t) => t.status === 'todo').reduce((s, t) => s + (t.durationMin ?? 0), 0);
  const end = monthEnd(p.monthFlag ?? P.month);
  const weeksLeft = Math.max(1, Math.ceil((daysBetween(P.monday, end) + 1) / 7));
  const perWeek = remaining / weeksLeft;
  let k = 0;
  let cum = 0;
  for (const t of ordered) {
    cum += t.durationMin ?? 60;
    if (cum > perWeek && k > 0) break;
    k += 1;
  }
  return Math.min(3, Math.max(1, k));
}

/** Builds the "Planifier la semaine" page (ready-to-display endpoint) for the current selection. */
export function buildPlanningPage(input: EngineInput, chosen: Map<string, Selection>): PlanningPage {
  const P = prepare(input);
  const chosenSet = new Set(chosen.keys());
  const scoreOf = new Map<string, ScoredTask>();
  const allScored = (t: EngineTask) => {
    let s = scoreOf.get(t.id);
    if (!s) {
      s = scoreTask(P, t);
      scoreOf.set(t.id, s);
    }
    return s;
  };
  const row = (t: EngineTask, locked: boolean): PageTask => {
    const s = allScored(t);
    return {
      taskId: t.id,
      title: t.title,
      durationMin: t.durationMin,
      isExperience: t.isExperience,
      postponeCount: t.postponeCount,
      score: s.score,
      why: locked ? 'Après la tâche précédente' : s.why,
      mandatory: s.mandatory,
      locked,
      selection: locked ? null : (chosen.get(t.id) ?? null),
    };
  };

  // Inbox: candidates sorted by deadline then score; the first INBOX_VISIBLE (plus chosen ones) are shown.
  const inboxSorted = P.inboxTasks
    .filter((t) => t.status === 'todo')
    .sort(
      (a, b) =>
        (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') ||
        allScored(b).score - allScored(a).score ||
        a.id.localeCompare(b.id),
    );
  const inboxRows = inboxSorted.map((t) => row(t, false));
  const inboxShown = inboxRows.filter((r, i) => i < INBOX_VISIBLE || r.selection);
  const inboxFolded = inboxRows.filter((r, i) => !(i < INBOX_VISIBLE || r.selection));
  const dueById = new Map(inboxSorted.map((t) => [t.id, t.dueDate]));

  const card = (p: EngineProject, visibleBase: number): { card: PageCard; best: number } => {
    const ptasks = P.tasksByProject.get(p.id) ?? [];
    const pending = ptasks
      .filter((t) => t.status === 'todo')
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const avail = availableTaskIds(ptasks, p.sequenceMode, chosenSet, input.taskDeps);
    let k = Math.min(visibleBase, pending.length);
    // Chosen tasks always stay visible; next task appears when all visible ones are chosen.
    while (k < pending.length && pending.slice(0, k).every((t) => chosenSet.has(t.id))) k += 1;
    while (k < pending.length && pending.slice(k).some((t) => chosenSet.has(t.id))) k += 1;
    const visible = pending.slice(0, k);
    const best = Math.max(
      0,
      ...pending.filter((t) => avail.has(t.id) || chosenSet.has(t.id)).map((t) => allScored(t).score),
    );
    return {
      best,
      card: {
        projectId: p.id,
        title: p.title,
        domainId: p.domainIds[0] ?? null,
        objectiveId: p.objectiveId,
        objectiveTitle: p.objectiveTitle,
        tasks: visible.map((t) => row(t, !avail.has(t.id) && !chosenSet.has(t.id))),
        hidden: pending.slice(k).map((t) => ({ taskId: t.id, title: t.title, durationMin: t.durationMin })),
        hiddenTasks: [],
        hiddenDueCount: 0,
      },
    };
  };

  const eligible = input.projects.filter(
    (p) => eligibleProject(p) && (P.tasksByProject.get(p.id) ?? []).some((t) => t.status === 'todo'),
  );
  const monthCards = eligible
    .filter((p) => isMonthProject(P, p))
    .map((p) => {
      const ptasks = P.tasksByProject.get(p.id) ?? [];
      const ordered = ptasks.filter((t) => t.status === 'todo').sort((a, b) => a.position - b.position);
      return card(p, monthVisibleCount(P, p, ptasks, ordered));
    })
    .sort((a, b) => b.best - a.best || a.card.title.localeCompare(b.card.title));

  // "À considérer aussi": other active projects, top N by best score; CH-05 guard-rails first; chosen kept.
  const guarded = new Set(
    input.domains
      .filter(
        (d) =>
          (GUARDED_DOMAIN_NAMES as readonly string[]).includes(d.name) &&
          !(input.guardDomainMinutes[d.id] > 0),
      )
      .map((d) => d.id),
  );
  const others = eligible
    .filter((p) => !isMonthProject(P, p))
    .map((p) => ({ p, ...card(p, 1), guard: p.domainIds.some((id) => guarded.has(id)) }))
    .filter((x) => x.card.tasks.some((t) => !t.locked || t.selection));
  others.sort(
    (a, b) =>
      Number(b.guard) - Number(a.guard) || b.best - a.best || a.card.title.localeCompare(b.card.title),
  );
  const considered = others.filter(
    (x, i) => i < input.considerAlsoCount || x.guard || x.card.tasks.some((t) => t.selection),
  );
  // D-79: « + Tâche d'un autre projet »: every other eligible project, all its pending tasks, by title.
  const consideredIds = new Set(considered.map((x) => x.p.id));
  const more = others
    .filter((x) => !consideredIds.has(x.p.id))
    .map((x) => card(x.p, Number.POSITIVE_INFINITY).card)
    .sort((a, b) => a.title.localeCompare(b.title));

  const groups: PageGroup[] = [
    {
      key: 'inbox',
      name: 'Inbox',
      hint: '',
      countLabel: `${inboxRows.length} tâche${inboxRows.length > 1 ? 's' : ''}`,
      cards: inboxRows.length
        ? [
            {
              projectId: null,
              title: 'Inbox',
              domainId: null,
              objectiveId: null,
              objectiveTitle: null,
              tasks: inboxShown,
              hidden: inboxFolded.map((r) => ({
                taskId: r.taskId,
                title: r.title,
                durationMin: r.durationMin,
              })),
              hiddenTasks: inboxFolded,
              hiddenDueCount: inboxFolded.filter((r) => {
                const due = dueById.get(r.taskId);
                return !!due && due <= P.sunday;
              }).length,
            },
          ]
        : [],
    },
    {
      key: 'month',
      name: 'Projets du mois',
      hint: P.months.length > 1 ? `semaine à cheval : ${P.months.map(frMonth).join(' et ')}` : '',
      countLabel: `${monthCards.length} projet${monthCards.length > 1 ? 's' : ''}`,
      cards: monthCards.map((c) => c.card),
    },
    {
      key: 'consider',
      name: 'À considérer aussi',
      hint: 'suggérés par le moteur, hors projets du mois',
      countLabel: `${considered.length} projet${considered.length > 1 ? 's' : ''}`,
      cards: considered.map((c) => c.card),
    },
  ];

  return { groups, more, ...summarize(input, chosen) };
}

/** Live summary of a selection: budget (RB-09, RB-14), counts, alerts (§6), planned mix by primary domain. */
export function summarize(
  input: EngineInput,
  chosen: Map<string, Selection>,
): Omit<PlanningPage, 'groups' | 'more'> {
  const P = prepare(input);
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const weekTasks = [...chosen]
    .filter(([, k]) => k === 'week')
    .map(([id]) => taskById.get(id))
    .filter((t): t is EngineTask => !!t);
  const plannedMin = budgetMinutes(weekTasks);
  const { overMin, remainingMin } = budgetStatus(plannedMin, input.budgetMin);
  const domainOfTask = (t: EngineTask): string | null =>
    t.projectId ? (P.projectById.get(t.projectId)?.domainIds[0] ?? null) : t.domainId;
  const mixMap = new Map<string | null, number>();
  for (const t of weekTasks)
    mixMap.set(domainOfTask(t), (mixMap.get(domainOfTask(t)) ?? 0) + (t.durationMin ?? 0));
  const orderedDomains = [...input.domains].sort((a, b) => a.priorityRank - b.priorityRank);
  const mix = [
    ...orderedDomains.map((d) => ({ domainId: d.id as string | null, minutes: mixMap.get(d.id) ?? 0 })),
    { domainId: null, minutes: mixMap.get(null) ?? 0 },
  ];
  const experiences = weekTasks.filter((t) => t.isExperience).length;

  const alerts: Alert[] = [];
  if (overMin > 0) {
    alerts.push({
      level: 'warn',
      code: 'BUDGET_OVER',
      text: `Dépassement de ${fmtMin(overMin)} au-delà de ${fmtMin(input.budgetMin)}. Tu peux valider quand même.`,
    });
  }
  for (const name of GUARDED_DOMAIN_NAMES) {
    const d = input.domains.find((x) => x.name === name);
    if (d && !(mixMap.get(d.id) ?? 0)) {
      alerts.push({
        level: 'warn',
        code: `EMPTY_${name === 'Santé' ? 'HEALTH' : 'FAMILY'}`,
        text:
          d.priorityRank === 1
            ? `${name}, ta priorité n°1 : rien de prévu cette semaine.`
            : `${name} : rien de prévu cette semaine.`,
      });
    }
  }
  if (experiences === 0) {
    alerts.push({
      level: 'warn',
      code: 'NO_EXPERIENCE',
      text: `Aucune expérience prévue (${input.experiencesDone} / ${input.experienceTarget} sur ${input.experienceWindowWeeks} semaines).`,
    });
  }
  const avoided = weekTasks.filter((t) => t.postponeCount >= 3);
  for (const t of avoided)
    alerts.push({
      level: 'warn',
      code: 'AVOIDANCE',
      text: `« ${t.title} » reportée ${t.postponeCount} fois.`,
    });
  if (alerts.length === 0)
    alerts.push({ level: 'ok', code: 'OK', text: 'Rien à signaler : semaine équilibrée.' });

  return {
    budget: { budgetMin: input.budgetMin, plannedMin, overMin, remainingMin },
    counts: {
      week: weekTasks.length,
      experiences,
      bonus: [...chosen.values()].filter((k) => k === 'bonus').length,
    },
    alerts,
    mix,
  };
}
