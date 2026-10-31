import { describe, expect, it } from 'vitest';
import { computeDiff } from '../src/context.ts';
import type { DomainError } from '../src/errors.ts';
import {
  assertCompletion,
  assertStatusTransition,
  availableTaskIds,
  blockedProjectIds,
  budgetMinutes,
  budgetStatus,
  checkObjectiveDeadline,
  checkRecurrenceRule,
  checkTaskDuration,
  delayLabel,
  delayMin,
  estimationOf,
  focusOf,
  globalIndicator,
  minutesByDomain,
  nextOccurrence,
  objectiveProgressPct,
  plannedToDateMin,
  promotionGaps,
  rankResults,
  relevance,
  resolveProjectDomains,
  rhythmOf,
  wouldCreateCycle,
} from '../src/rules/index.ts';
import { defaultWeight, SEED_DOMAINS } from '../src/seed-data.ts';
import { DEFAULT_SETTINGS, settingsSchema } from '../src/settings.ts';
import { fmtMin, frWeekRange, isoWeekOf, quarterEnd, quarterOf, shiftWeek, weekMonday } from '../src/time.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
};

describe('time helpers', () => {
  it('computes ISO weeks like the mockups (S44 = 26 oct – 1 nov 2026)', () => {
    expect(isoWeekOf('2026-10-26')).toBe('2026-W44');
    expect(isoWeekOf('2026-11-01')).toBe('2026-W44');
    expect(weekMonday('2026-W45')).toBe('2026-11-02');
    expect(frWeekRange('2026-W44')).toBe('26 oct. – 1 nov.');
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
    expect(shiftWeek('2026-W53', 1)).toBe('2027-W01');
  });
  it('quarters', () => {
    expect(quarterOf('2026-11-15')).toBe('2026-Q4');
    expect(quarterEnd('2026-Q4')).toBe('2026-12-31');
    expect(quarterEnd('2026-Q1')).toBe('2026-03-31');
  });
  it('formats durations like the mockups', () => {
    expect(fmtMin(30)).toBe('30 min');
    expect(fmtMin(60)).toBe('1 h');
    expect(fmtMin(90)).toBe('1 h 30');
  });
});

describe('seed & settings (L0)', () => {
  it('has 8 domains in validated order', () => {
    expect(SEED_DOMAINS.map((d) => d.name)).toEqual([
      'Santé',
      'Famille',
      'Carrière',
      'Patrimoine',
      'Sécurité',
      'Maison',
      'Amis & Social',
      'Loisirs & Découverte',
    ]);
    expect(defaultWeight(1)).toBe(1);
    expect(defaultWeight(8)).toBe(0.125);
  });
  it('default settings are valid', () => {
    expect(settingsSchema.parse(DEFAULT_SETTINGS)['budget.weekly_min']).toBe(360);
  });
});

describe('RB-15 audit diff', () => {
  it('keeps only changed fields', () => {
    expect(computeDiff({ a: 1, b: 2, updatedAt: 'x' }, { a: 1, b: 3, updatedAt: 'y' })).toEqual({
      b: [2, 3],
    });
    expect(computeDiff(null, { a: 1 })).toEqual({ a: [null, 1] });
  });
});

describe('RB-02 promotion', () => {
  const ok = {
    successCriterion: 'Contrat signé',
    startDate: '2026-11-01',
    dueDate: '2026-11-30',
    groupCount: 1,
    tasks: [{ durationMin: 60, status: 'todo' }],
  };
  it('accepts a complete project', () => expect(promotionGaps(ok)).toEqual([]));
  it('lists every gap (idea without task → TASK_MISSING)', () => {
    expect(
      promotionGaps({ ...ok, successCriterion: ' ', groupCount: 0, tasks: [], startDate: null }),
    ).toEqual(['SUCCESS_CRITERION_MISSING', 'GROUP_MISSING', 'TASK_MISSING']);
  });
  it('D-42: dates are optional (the month is the time box), but never inverted', () => {
    expect(promotionGaps({ ...ok, startDate: null, dueDate: null })).toEqual([]);
    expect(promotionGaps({ ...ok, dueDate: '2027-03-01' })).toEqual([]);
    expect(promotionGaps({ ...ok, dueDate: '2026-10-01' })).toEqual(['DATES_INVERTED']);
  });
  it('requires durations on all tasks', () => {
    expect(promotionGaps({ ...ok, tasks: [{ durationMin: null, status: 'todo' }] })).toEqual([
      'TASK_DURATION_MISSING',
    ]);
  });
});

describe('RB-03 task duration', () => {
  it('accepts 5/15/30/60/120 and null', () => {
    for (const d of [5, 15, 30, 60, 120, null]) expect(code(() => checkTaskDuration(d))).toBeNull();
  });
  it('refuses > 120 with split message', () =>
    expect(code(() => checkTaskDuration(240))).toBe('TASK_TOO_LONG'));
  it('refuses other values', () => expect(code(() => checkTaskDuration(45))).toBe('INVALID_DURATION'));
});

describe('RB-04 project domains', () => {
  const d = (id: string, priorityRank: number) => ({ id, priorityRank });
  it('deduces distinct domains ordered by priority, default primary = most prioritary', () => {
    expect(resolveProjectDomains([d('maison', 6), d('secu', 5), d('maison', 6)])).toEqual({
      domainIds: ['secu', 'maison'],
      primaryDomainId: 'secu',
    });
  });
  it('honours a chosen primary among deduced domains', () => {
    expect(resolveProjectDomains([d('maison', 6), d('secu', 5)], 'maison').domainIds).toEqual([
      'maison',
      'secu',
    ]);
  });
  it('refuses a primary outside the groups, > 3 domains, and no group', () => {
    expect(code(() => resolveProjectDomains([d('a', 1)], 'b'))).toBe('PRIMARY_DOMAIN_INVALID');
    expect(code(() => resolveProjectDomains([d('a', 1), d('b', 2), d('c', 3), d('e', 4)]))).toBe(
      'TOO_MANY_DOMAINS',
    );
    expect(code(() => resolveProjectDomains([]))).toBe('GROUP_REQUIRED');
  });
});

describe('RB-05 objective deadline', () => {
  it('requires a deadline within the quarter', () => {
    expect(checkObjectiveDeadline('2026-12-15')).toBe('2026-Q4');
    expect(code(() => checkObjectiveDeadline(null))).toBe('DEADLINE_REQUIRED');
    expect(code(() => checkObjectiveDeadline('2027-01-05', '2026-Q4'))).toBe('DEADLINE_AFTER_QUARTER');
  });
});

describe('RB-06 availability', () => {
  const t = (
    id: string,
    position: number,
    extra: Partial<{ isFree: boolean; status: 'todo' | 'done' | 'cancelled' }> = {},
  ) => ({
    id,
    position,
    isFree: false,
    status: 'todo' as const,
    ...extra,
  });
  it('sequential: only the first pending task, plus free tasks', () => {
    const tasks = [t('a', 1, { status: 'done' }), t('b', 2), t('c', 3), t('d', 4, { isFree: true })];
    expect([...availableTaskIds(tasks, 'sequential')].sort()).toEqual(['b', 'd']);
  });
  it('choosing a task in the current plan unlocks the next one', () => {
    const tasks = [t('b', 2), t('c', 3), t('e', 5)];
    expect([...availableTaskIds(tasks, 'sequential', new Set(['b']))].sort()).toEqual(['b', 'c']);
  });
  it('reordering changes availability', () => {
    expect([...availableTaskIds([t('b', 3), t('c', 2)], 'sequential')]).toEqual(['c']);
  });
  it('parallel: all pending tasks', () => {
    expect(availableTaskIds([t('b', 2), t('c', 3)], 'parallel').size).toBe(2);
  });
  it('explicit prerequisites must be done', () => {
    const tasks = [t('b', 2, { isFree: true }), t('c', 3, { isFree: true })];
    expect([
      ...availableTaskIds(tasks, 'parallel', new Set(), [{ taskId: 'c', dependsOnTaskId: 'b' }]),
    ]).toEqual(['b']);
  });
  it('DM-100: position no longer blocks; only unfinished prerequisites make a project wait', () => {
    const p = (id: string, status: string) => ({ id, status });
    const blocked = blockedProjectIds(
      [p('a', 'active'), p('b', 'active'), p('c', 'ready'), p('d', 'ready')],
      [
        { projectId: 'c', dependsOnProjectId: 'a' },
        { projectId: 'd', dependsOnProjectId: 'x' },
      ],
    );
    expect([...blocked]).toEqual(['c']);
  });
});

describe('RB-07 cycles', () => {
  it('detects direct and indirect cycles', () => {
    const edges = [
      { from: 'b', to: 'a' },
      { from: 'c', to: 'b' },
    ];
    expect(wouldCreateCycle(edges, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(edges, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(edges, 'd', 'c')).toBe(false);
  });
});

describe('RB-09 / RB-14 budget', () => {
  it('experiences are out of budget', () => {
    expect(
      budgetMinutes([
        { durationMin: 60, isExperience: false },
        { durationMin: 120, isExperience: true },
      ]),
    ).toBe(60);
  });
  it('overflow is reported, never thrown', () => {
    expect(budgetStatus(420, 360)).toEqual({ overMin: 60, remainingMin: 0 });
  });
});

describe('RB-11 recurrence', () => {
  it('computes the next yearly occurrence', () => {
    expect(nextOccurrence('FREQ=YEARLY', '2026-05-20')).toBe('2027-05-20');
    expect(nextOccurrence('RRULE:FREQ=MONTHLY', '2026-01-31')).toBe('2026-03-31');
  });
  it('validates rules', () => {
    expect(code(() => checkRecurrenceRule('NOT A RULE'))).toBe('INVALID_RECURRENCE');
  });
});

describe('RB-12 completion and DM-89 lifecycle', () => {
  it('requires a yes/no answer', () => {
    expect(code(() => assertCompletion(undefined))).toBe('SUCCESS_ANSWER_REQUIRED');
    expect(code(() => assertCompletion(false))).toBeNull();
  });
  it('D-42: idea → ready only through promotion, → active only through the month plan', () => {
    expect(code(() => assertStatusTransition('idea', 'ready'))).toBe('INVALID_STATUS_TRANSITION');
    expect(code(() => assertStatusTransition('ready', 'active'))).toBe('INVALID_STATUS_TRANSITION');
    expect(code(() => assertStatusTransition('active', 'paused'))).toBeNull();
    expect(code(() => assertStatusTransition('active', 'ready'))).toBeNull();
    expect(code(() => assertStatusTransition('paused', 'ready'))).toBeNull();
  });
  it('objective progress = done projects ÷ path', () => {
    expect(objectiveProgressPct([{ status: 'done' }, { status: 'active' }, { status: 'idea' }])).toBe(50);
  });
});

describe('R-06 / RB-16 delay', () => {
  const base = {
    totalMin: 600,
    doneMin: 0,
    startDate: '2026-11-01',
    dueDate: '2026-11-10',
    replannedAt: null,
    replanDoneMin: null,
    today: '2026-11-05',
  };
  it('prorata of elapsed days', () => {
    expect(plannedToDateMin(base)).toBe(300);
    expect(delayMin({ ...base, doneMin: 120 })).toBe(-180);
  });
  it('replan brings the bar back to the centre', () => {
    expect(delayMin({ ...base, doneMin: 120, replannedAt: '2026-11-05', replanDoneMin: 120 })).toBe(0);
  });
  it('labels', () => {
    expect(delayLabel(-120)).toBe('−2 h');
    expect(delayLabel(60)).toBe('+1 h');
    expect(delayLabel(0)).toBe("à l'heure");
  });
});

describe('D-61 estimation vs time spent', () => {
  const t = (title: string, estimateMin: number, actualMin: number | null, isExperience = false) => ({
    id: title,
    title,
    durationMin: actualMin ?? estimateMin,
    estimateMin,
    measured: actualMin !== null,
    isExperience,
    isBonus: false,
    bucket: 'inbox' as const,
    domainIds: [],
  });
  it('ratio over the done work, biggest overruns, experiences ignored', () => {
    const e = estimationOf([
      t('Câblage', 60, 240),
      t('Mail', 30, 30),
      t('Rangement', 120, 60),
      t('Devis', 60, null),
      t('Concert', 120, 300, true),
    ]);
    expect(e).toMatchObject({
      measuredCount: 3,
      estimatedMin: 270,
      spentMin: 390,
      ratioPct: 144,
      underruns: 1,
    });
    expect(e.overruns).toEqual([{ title: 'Câblage', estimateMin: 60, actualMin: 240 }]);
    expect(estimationOf([t('Devis', 60, null)]).ratioPct).toBeNull();
  });
});

describe('weekly indicators R-01 / R-04 / R-05', () => {
  const dt = (bucket: 'objective' | 'inbox' | 'none', durationMin: number, isExperience = false) => ({
    id: 'x',
    title: 'x',
    durationMin,
    estimateMin: durationMin,
    measured: false,
    isExperience,
    isBonus: false,
    bucket,
    domainIds: ['d1', 'd2'],
  });
  it('focus tiers', () => {
    expect(focusOf([dt('objective', 60), dt('inbox', 30)])).toBe('Cap tenu');
    expect(focusOf([dt('inbox', 60), dt('none', 30)])).toBe('Semaine Inbox');
    expect(focusOf([dt('none', 60), dt('objective', 30)])).toBe('Dispersé');
    expect(focusOf([dt('none', 40), dt('objective', 40), dt('inbox', 40)])).toBe('Mixte');
    expect(focusOf([dt('none', 120, true)])).toBe('Rien de fait');
  });
  it('rhythm tiers', () => {
    expect(rhythmOf(270, 360)).toBe('Sous-productif');
    expect(rhythmOf(330, 360)).toBe('OK');
    expect(rhythmOf(420, 360)).toBe('Surproductif');
  });
  it('hours count for every domain served (DM-84)', () => {
    expect(minutesByDomain([dt('objective', 60)])).toEqual({ d1: 60, d2: 60 });
  });
  it('global light', () => {
    const g = {
      experiencesWindow: 2,
      experienceTarget: 2,
      healthMin: 60,
      familyMin: 60,
      rhythm: 'OK' as const,
      focus: 'Cap tenu' as const,
    };
    expect(globalIndicator(g).light).toBe('green');
    expect(globalIndicator({ ...g, experiencesWindow: 0 }).light).toBe('orange');
    expect(globalIndicator({ ...g, experiencesWindow: 0, healthMin: 0 }).light).toBe('red');
  });
});

describe('search ranking (F-04)', () => {
  const item = (title: string, extra: Partial<{ description: string; labels: string }> = {}) => ({
    type: 'project' as const,
    id: title,
    title,
    description: '',
    labels: '',
    ...extra,
  });
  it('exact > prefix > contains > labels > description', () => {
    expect(relevance('sport', item('Sport'))).toBeGreaterThan(
      relevance('sport', item('Sportif du dimanche')),
    );
    expect(relevance('sport', item('Sportif'))).toBeGreaterThan(
      relevance('sport', item('Trouver un second sport')),
    );
    expect(relevance('sport', item('X', { labels: 'Sport' }))).toBeGreaterThan(
      relevance('sport', item('Y', { description: 'sport' })),
    );
  });
  it('ignores accents and tolerates typos', () => {
    expect(relevance('securite', item('Sécurité réseau'))).toBeGreaterThan(0);
    expect(relevance('photovoltaiqe', item('Panneaux photovoltaïques'))).toBeGreaterThan(0);
  });
  it('groups 5 per type', () => {
    const r = rankResults(
      'a',
      Array.from({ length: 8 }, (_, i) => item(`a${i}`)),
    );
    expect(r.project).toHaveLength(5);
  });
});
