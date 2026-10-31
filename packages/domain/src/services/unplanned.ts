import { and, eq, inArray, schema, sql } from '@memento/db';
// D-99: work done « hors planification ». A task checked during a week while it was in neither this week's plan
// nor last week's (a planned task done late) is added to this week's plan as an 'unplanned' item, so the drift
// from the plan can be measured (Ma semaine, weekly / monthly / quarterly reports). Unchecking removes it.
import { audit, type Ctx, ctxNow, newId } from '../context.ts';
import { getSettings } from '../settings.ts';
import { isoWeekOf, parisDate, shiftWeek } from '../time.ts';

const { weekPlan, weekPlanItem } = schema;

export const getPlanRow = (ctx: Ctx, isoWeek: string) =>
  ctx.db.select().from(weekPlan).where(eq(weekPlan.isoWeek, isoWeek)).get();

export function getOrCreatePlan(ctx: Ctx, isoWeek: string) {
  const existing = getPlanRow(ctx, isoWeek);
  if (existing) return existing;
  const id = newId();
  ctx.db
    .insert(weekPlan)
    .values({ id, createdBy: ctx.actor, isoWeek, budgetMin: getSettings(ctx)['budget.weekly_min'] })
    .run();
  const row = getPlanRow(ctx, isoWeek)!;
  audit(ctx, 'week_plan', id, 'create', null, row);
  return row;
}

/** Called right after a task is checked (inside its transaction). Returns true when traced as unplanned. */
export function traceUnplanned(ctx: Ctx, taskId: string): boolean {
  const week = isoWeekOf(parisDate(ctxNow(ctx)));
  const planIds = [week, shiftWeek(week, -1)]
    .map((w) => getPlanRow(ctx, w)?.id)
    .filter((x): x is string => !!x);
  const planned =
    planIds.length > 0 &&
    !!ctx.db
      .select({ id: weekPlanItem.id })
      .from(weekPlanItem)
      .where(and(inArray(weekPlanItem.weekPlanId, planIds), eq(weekPlanItem.taskId, taskId)))
      .get();
  if (planned) return false;
  const plan = getOrCreatePlan(ctx, week);
  const last = ctx.db
    .select({ max: sql<number>`coalesce(max(${weekPlanItem.position}), 0)` })
    .from(weekPlanItem)
    .where(eq(weekPlanItem.weekPlanId, plan.id))
    .get();
  ctx.db
    .insert(weekPlanItem)
    .values({
      id: newId(),
      createdBy: ctx.actor,
      weekPlanId: plan.id,
      taskId,
      kind: 'unplanned',
      source: ctx.actor === 'me' ? 'me' : 'ai',
      why: 'Hors planification',
      position: (last?.max ?? 0) + 1,
    })
    .run();
  audit(ctx, 'week_plan', plan.id, 'unplanned', null, { isoWeek: week, taskId });
  return true;
}

/** Unchecking a task traced as unplanned removes the trace (it was not done after all). */
export function untraceUnplanned(ctx: Ctx, taskId: string) {
  const rows = ctx.db
    .select()
    .from(weekPlanItem)
    .where(and(eq(weekPlanItem.taskId, taskId), eq(weekPlanItem.kind, 'unplanned')))
    .all();
  for (const r of rows) {
    ctx.db.delete(weekPlanItem).where(eq(weekPlanItem.id, r.id)).run();
    audit(ctx, 'week_plan', r.weekPlanId, 'unplanned_removed', { taskId }, null);
  }
}
