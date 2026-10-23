// Planifier › Trimestre (decision D-48): choose the objectives of a quarter against the time available.
// Ready-to-display page: capacity of the quarter, its objectives with the remaining work of their path,
// open objectives of other quarters (to pull in), meta-objective coverage and alerts.
import { asc, eq, schema } from '@memento/db';
import { audit, type Ctx, ctxNow, ctxNowIso, tx } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getSettings } from '../settings.ts';
import { isValidQuarter, parisDate, quarterEnd, quarterOf, quarterStart, shiftQuarter } from '../time.ts';
import { capacityBetween, workDoneBetween } from './month.ts';
import { getObjectivePath } from './projects.ts';
import { getObjective, refreshObjectiveProgress } from './referential.ts';

const { objective, metaObjective } = schema;
const OPEN = new Set(['active', 'paused']);

export function getQuarterPlanningPage(ctx: Ctx, quarter: string) {
  if (!isValidQuarter(quarter)) throw new DomainError('INVALID_QUARTER', `Trimestre invalide : ${quarter}`);
  const s = getSettings(ctx);
  const today = parisDate(ctxNow(ctx));
  const current = quarterOf(today);
  const first = quarterStart(quarter);
  const last = quarterEnd(quarter);
  const { capacityMin } = capacityBetween(ctx, first, last);
  const spentMin = quarter <= current ? workDoneBetween(ctx, first, last < today ? last : today) : 0;

  const metas = ctx.db.select().from(metaObjective).orderBy(asc(metaObjective.createdAt)).all();
  const view = (o: typeof objective.$inferSelect) => {
    const path = getObjectivePath(ctx, o.id).filter((p) => p.status !== 'abandoned');
    const open = path.filter((p) => p.status !== 'done');
    return {
      id: o.id,
      title: o.title,
      quarter: o.quarter,
      deadline: o.deadline,
      status: o.status,
      criticality: o.criticality,
      progressPct: o.progressPct,
      metaObjectiveId: o.metaObjectiveId,
      metaTitle: metas.find((m) => m.id === o.metaObjectiveId)?.title ?? null,
      projects: {
        total: path.length,
        done: path.filter((p) => p.status === 'done').length,
        active: path.filter((p) => p.status === 'active').length,
        ready: path.filter((p) => p.status === 'ready').length,
        ideas: path.filter((p) => p.status === 'idea').length,
      },
      remainingMin: open.reduce((a, p) => a + (p.taskStats.totalMin - p.taskStats.doneMin), 0),
      /** Projects whose size is unknown (no task, or tasks without duration): the estimate is a floor. */
      unknownSize: open.filter((p) => p.taskStats.todo === 0 || p.taskStats.withoutDuration > 0).length,
      domainId: path[0]?.domainIds[0] ?? null,
    };
  };
  const all = ctx.db.select().from(objective).orderBy(asc(objective.deadline)).all();
  const chosen = all.filter((o) => o.quarter === quarter).map(view);
  const candidates = all
    .filter((o) => o.quarter !== quarter && OPEN.has(o.status))
    .map((o) => ({ ...view(o), overdue: o.quarter < current }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.deadline.localeCompare(b.deadline));

  const openChosen = chosen.filter((o) => OPEN.has(o.status));
  const neededMin = openChosen.reduce((a, o) => a + o.remainingMin, 0);
  const availableMin = capacityMin - spentMin;
  const metaRows = metas
    .filter((m) => m.status === 'active')
    .map((m) => ({
      id: m.id,
      title: m.title,
      horizonDate: m.horizonDate,
      objectives: chosen.filter((o) => o.metaObjectiveId === m.id).length,
    }));

  const alerts: { level: 'warn' | 'ok'; code: string; text: string }[] = [];
  if (openChosen.length > s['quarter.max_objectives'])
    alerts.push({
      level: 'warn',
      code: 'TOO_MANY_OBJECTIVES',
      text: `${openChosen.length} objectifs ce trimestre (limite ${s['quarter.max_objectives']}) : risque de dispersion.`,
    });
  if (neededMin > availableMin)
    alerts.push({
      level: 'warn',
      code: 'QUARTER_OVER',
      text: `Plus de travail prévu que de temps disponible : ${Math.round((neededMin - availableMin) / 60)} h de trop.`,
    });
  const unknown = openChosen.reduce((a, o) => a + o.unknownSize, 0);
  if (unknown)
    alerts.push({
      level: 'warn',
      code: 'UNKNOWN_SIZE',
      text: `${unknown} projet${unknown > 1 ? 's' : ''} sans tâches chiffrées : la charge réelle sera plus élevée.`,
    });
  const overdue = candidates.filter((o) => o.overdue).length;
  if (overdue)
    alerts.push({
      level: 'warn',
      code: 'OVERDUE',
      text: `${overdue} objectif${overdue > 1 ? 's' : ''} d'un trimestre passé encore ouvert${overdue > 1 ? 's' : ''} : à reprendre ou clore.`,
    });
  if (!alerts.length) alerts.push({ level: 'ok', code: 'NOTHING', text: 'Rien à signaler.' });

  return {
    quarter,
    isCurrent: quarter === current,
    isPast: quarter < current,
    period: { from: first, to: last },
    budget: {
      capacityMin,
      spentMin,
      availableMin,
      neededMin,
      overMin: Math.max(0, neededMin - availableMin),
    },
    chosen,
    candidates,
    metas: metaRows,
    alerts,
    navigation: { previous: shiftQuarter(quarter, -1), next: shiftQuarter(quarter, 1) },
  };
}

/**
 * D-48: move an objective into a quarter (« + Ce trimestre », « Reporter »). RB-05: its deadline is kept when it
 * falls inside the quarter, otherwise set to the last day of the quarter.
 */
export function setObjectiveQuarter(ctx: Ctx, id: string, quarter: string) {
  if (!isValidQuarter(quarter)) throw new DomainError('INVALID_QUARTER', `Trimestre invalide : ${quarter}`);
  return tx(ctx, () => {
    const before = getObjective(ctx, id);
    const inside = before.deadline >= quarterStart(quarter) && before.deadline <= quarterEnd(quarter);
    ctx.db
      .update(objective)
      .set({ quarter, deadline: inside ? before.deadline : quarterEnd(quarter), updatedAt: ctxNowIso(ctx) })
      .where(eq(objective.id, id))
      .run();
    const after = getObjective(ctx, id);
    audit(ctx, 'objective', id, 'quarter', before, after);
    refreshObjectiveProgress(ctx, id);
    return after;
  });
}
