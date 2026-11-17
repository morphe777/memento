// Page « Expériences » (decision D-54): the goal of living more experiences, made visible.
// Target per calendar month (R-02, D-154), memories (done experiences), planned ones (in a plan of this week or a
// week ahead, or with a deadline) and the envies (D-171: the reserve, other experience tasks to do). D-153: a lived experience is
// recorded directly, done.
import { desc, eq, schema } from '@memento/db';
import { type Ctx, ctxNow, tx } from '../context.ts';
import type { ExperienceIdea, ExperienceLived } from '../schemas.ts';
import { getSettings } from '../settings.ts';
import { monthOf, parisDate } from '../time.ts';
import { placesNearby } from './places.ts';
import { serializeProjects } from './projects.ts';
import { readUrl } from './read-url.ts';
import { listDomains } from './referential.ts';
import { daysLived } from './souvenirs.ts';
import { completeTask, createTask, listTasks } from './tasks.ts';

const { task, project } = schema;

export function getExperiencesPage(ctx: Ctx) {
  const s = getSettings(ctx);
  const today = parisDate(ctxNow(ctx));
  const month = monthOf(today);

  const all = ctx.db
    .select()
    .from(task)
    .where(eq(task.isExperience, true))
    .orderBy(desc(task.doneAt), desc(task.createdAt))
    .all();
  const projectIds = [...new Set(all.map((t) => t.projectId).filter((x): x is string => !!x))];
  const projects = new Map(
    serializeProjects(
      ctx,
      projectIds.length
        ? ctx.db
            .select()
            .from(project)
            .all()
            .filter((p) => projectIds.includes(p.id))
        : [],
    ).map((p) => [p.id, p]),
  );
  const plannedWeek = new Map(
    listTasks(ctx, { status: 'todo' })
      .filter((t) => t.isExperience && t.plannedWeek)
      .map((t) => [t.id, t.plannedWeek]),
  );
  // EXA-11: the days lived (a souvenir over several days counts once, its days apart).
  const ends = new Map(
    ctx.db
      .select()
      .from(schema.souvenir)
      .all()
      .map((s) => [s.taskId, s.endDate]),
  );
  const view = (t: (typeof all)[number]) => {
    const p = t.projectId ? projects.get(t.projectId) : null;
    const doneDate = t.doneAt ? parisDate(new Date(t.doneAt)) : null;
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      durationMin: t.durationMin,
      dueDate: t.dueDate,
      doneAt: t.doneAt,
      doneDate,
      days: doneDate ? daysLived(doneDate, ends.get(t.id) ?? null) : 0,
      projectId: t.projectId,
      projectTitle: p?.title ?? null,
      domainId: p ? (p.domainIds[0] ?? null) : t.domainId,
      inPlan: plannedWeek.has(t.id),
      plannedWeek: plannedWeek.get(t.id) ?? null, // D-151
    };
  };
  const lived = all.filter((t) => t.status === 'done').map(view);
  const open = all.filter((t) => t.status === 'todo').map(view);
  const planned = open
    .filter((t) => t.inPlan || !!t.dueDate)
    .sort(
      (a, b) =>
        Number(b.inPlan) - Number(a.inPlan) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
    );
  const reserve = open.filter((t) => !t.inPlan && !t.dueDate);
  const doneThisMonth = lived.filter((t) => t.doneDate?.slice(0, 7) === month).length;
  // Last 12 months, oldest first: how many experiences each month.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (11 - i));
    const m = d.toISOString().slice(0, 7);
    return { month: m, count: lived.filter((t) => t.doneDate?.slice(0, 7) === m).length };
  });
  const year = today.slice(0, 4);
  return {
    target: s['experience.target'],
    month,
    doneThisMonth,
    onTrack: doneThisMonth >= s['experience.target'],
    daysThisMonth: lived.filter((t) => t.doneDate?.slice(0, 7) === month).reduce((a, t) => a + t.days, 0),
    thisYear: lived.filter((t) => t.doneDate?.startsWith(year)).length,
    daysThisYear: lived.filter((t) => t.doneDate?.startsWith(year)).reduce((a, t) => a + t.days, 0),
    months,
    lived,
    planned,
    reserve,
  };
}

/** « + Envie » (D-171): an experience idea is an Inbox task flagged as experience (no date). */
export function addExperienceIdea(ctx: Ctx, input: ExperienceIdea) {
  return createTask(ctx, { ...input, isExperience: true });
}

/** D-171: a shared idea goes to the envies, in Famille like « + Envie » (found by its name, none without it). */
const shareIdea = (ctx: Ctx, title: string, lines: (string | null | undefined)[]) =>
  addExperienceIdea(ctx, {
    title: title.slice(0, 200),
    description: lines.filter(Boolean).join('\n'),
    durationMin: null,
    domainId: listDomains(ctx).find((d) => d.name === 'Famille')?.id ?? null,
  });

/**
 * CE-30, CE-31, D-171: a shared page becomes an envie titled from the page; what it says (text, address, dates,
 * price, place) goes in the description. An unreadable page still gives an envie: the URL, a title to confirm.
 */
export async function ideaFromUrl(ctx: Ctx, url: string) {
  const page = await readUrl(url);
  const host = new URL(page.finalUrl).hostname.replace(/^www\./, '');
  const p = page.place;
  const t = shareIdea(ctx, page.title ?? `${host} (à confirmer)`, [
    page.description,
    url,
    page.startDate &&
      `Dates : ${fmtDay(page.startDate)}${page.endDate && page.endDate !== page.startDate ? ` → ${fmtDay(page.endDate)}` : ''}`,
    page.price && `Prix : ${page.price}`,
    p && (p.name || p.address) && `Lieu : ${[p.name, p.address, p.city].filter(Boolean).join(', ')}`,
  ]);
  return { task: t, warnings: page.error ? [page.error] : [] };
}

/** CE-32, D-171: a place shared from Plans or Google Maps: its name (or the named place there), and a map link. */
export async function ideaFromPlace(ctx: Ctx, p: { lat: number; lng: number; name?: string }) {
  const warnings: string[] = [];
  let name = p.name?.trim() ?? '';
  let where = '';
  if (!name) {
    const near = await placesNearby(ctx, p.lat, p.lng);
    if (near.providerError) warnings.push(near.providerError);
    const named = near.candidates.find((c) => !['address', 'city'].includes(c.category ?? ''));
    name = named?.name ?? 'Lieu partagé';
    where = named ? [named.address, named.city].filter(Boolean).join(', ') : '';
  }
  const t = shareIdea(ctx, name, [
    where && `Lieu : ${where}`,
    `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`,
  ]);
  return { task: t, warnings };
}

const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * D-153: « J'ai vécu une expérience »: an experience recorded already done (Paris time, now by default), traced like
 * any task checked that day. In a project, or else in a domain: Famille when none is given (found by its name, like
 * the guards), none when null.
 */
export function logExperience(ctx: Ctx, input: ExperienceLived) {
  return tx(ctx, () => {
    const { doneAt, projectId, domainId, ...rest } = input;
    const family = listDomains(ctx).find((d) => d.name === 'Famille')?.id ?? null;
    const created = createTask(ctx, {
      ...rest,
      isExperience: true,
      projectId: projectId ?? null,
      domainId: projectId ? null : domainId === undefined ? family : domainId,
    });
    return completeTask(ctx, created.id, { doneAt }).task;
  });
}
