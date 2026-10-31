import { asc, eq, inArray, schema } from '@memento/db';
// D-100: « Cap », the cheat sheet of what I am running after this quarter and this month: meta-objectives,
// objectives of the quarter and month projects, each with its « why » in a few words (motive, keyword in
// **bold**). Its reminders feed the line of Ma semaine. Read only; the motives are edited on each entity.
import { type Ctx, ctxNow } from '../context.ts';
import { monthOf, parisDate, quarterOf, shiftMonth } from '../time.ts';
import { serializeProjects } from './projects.ts';

const { metaObjective, objective, project } = schema;

export function getCap(ctx: Ctx, at?: { month?: string }) {
  const today = parisDate(ctxNow(ctx));
  const month = at?.month ?? monthOf(today);
  const quarter = quarterOf(`${month}-01`);
  const objectives = ctx.db
    .select()
    .from(objective)
    .where(eq(objective.quarter, quarter))
    .orderBy(asc(objective.position), asc(objective.deadline))
    .all()
    .filter((o) => ['active', 'paused', 'achieved'].includes(o.status));
  const metaIds = [...new Set(objectives.map((o) => o.metaObjectiveId).filter((x): x is string => !!x))];
  const metas = metaIds.length
    ? ctx.db
        .select()
        .from(metaObjective)
        .where(inArray(metaObjective.id, metaIds))
        .orderBy(asc(metaObjective.position))
        .all()
    : [];
  const monthProjects = serializeProjects(
    ctx,
    ctx.db
      .select()
      .from(project)
      .where(eq(project.monthFlag, month))
      .all()
      .filter((p) => ['active', 'paused', 'done'].includes(p.status)),
  );
  const nextMonth = shiftMonth(month, 1);
  const objectiveById = new Map(objectives.map((o) => [o.id, o]));
  const projectView = (p: (typeof monthProjects)[number]) => ({
    id: p.id,
    title: p.title,
    motive: p.motive,
    status: p.status,
    domainId: p.domainIds[0] ?? null,
    objectiveId: p.objectiveId,
  });
  const objectiveView = (o: (typeof objectives)[number]) => {
    const mine = monthProjects.filter((p) => p.objectiveId === o.id);
    return {
      id: o.id,
      title: o.title,
      motive: o.motive,
      status: o.status,
      deadline: o.deadline,
      progressPct: o.progressPct,
      smart: o.smartTarget ? `${o.smartCurrent || 0} / ${o.smartTarget}` : '',
      domainId: mine[0]?.domainIds[0] ?? null,
      monthProjects: mine.map(projectView),
    };
  };
  const groups = [
    ...metas.map((m) => ({
      meta: { id: m.id, title: m.title, motive: m.motive, domainId: m.primaryDomainId },
      objectives: objectives.filter((o) => o.metaObjectiveId === m.id).map(objectiveView),
    })),
    {
      meta: null,
      objectives: objectives
        .filter((o) => !o.metaObjectiveId || !metaIds.includes(o.metaObjectiveId))
        .map(objectiveView),
    },
  ].filter((g) => g.objectives.length > 0);
  const outside = monthProjects.filter((p) => !p.objectiveId || !objectiveById.has(p.objectiveId));
  // Reminders of Ma semaine: what this month serves first, then the quarter, then the long run.
  const reminders = [
    ...monthProjects
      .filter((p) => p.status !== 'done')
      .map((p) => ({ type: 'project', id: p.id, motive: p.motive, title: p.title })),
    ...objectives
      .filter((o) => o.status === 'active')
      .map((o) => ({ type: 'objective', id: o.id, motive: o.motive, title: o.title })),
    ...metas.map((m) => ({ type: 'meta', id: m.id, motive: m.motive, title: m.title })),
  ].filter((r) => r.motive.trim());
  return {
    month,
    quarter,
    nextMonth,
    groups,
    outsideProjects: outside.map(projectView),
    reminders: reminders as {
      type: 'project' | 'objective' | 'meta';
      id: string;
      motive: string;
      title: string;
    }[],
    missing: {
      metas: metas.filter((m) => !m.motive.trim()).length,
      objectives: objectives.filter((o) => !o.motive.trim()).length,
      projects: monthProjects.filter((p) => !p.motive.trim()).length,
    },
  };
}
