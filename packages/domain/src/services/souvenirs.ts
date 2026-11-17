// Souvenirs (memento-experiences EX-10 to EX-15, EX-50 to EX-52, D-157 to D-163). A souvenir is attached to a
// lived experience task (1–1): the task keeps the title, the domain, the project and the start (done time); the
// souvenir adds the last day, the place, the people, the phrase, the rating and the photos.
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, schema } from '@memento/db';
import { audit, type Ctx, ctxNow, ctxNowIso, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import type { CaptureBody, PhotoMeta, SouvenirListQuery, SouvenirPatch } from '../schemas-souvenirs.ts';
import { getSettings } from '../settings.ts';
import { addDays, daysBetween, frMonth, isoWeekOf, parisClock, parisDate } from '../time.ts';
import { deleteTask } from './deletion.ts';
import { ideaFromPlace, ideaFromUrl } from './experiences.ts';
import { domainForPeople, personByName } from './persons.ts';
import {
  normalizeTakenAt,
  PHOTO_WARN_COUNT,
  photosDir,
  processPhoto,
  removePhotoFiles,
  writePhotoFiles,
} from './photos.ts';
import { distanceM, getPlace, nearestMemorized, placeFromCandidate, placesNearby } from './places.ts';
import { serializeProjects } from './projects.ts';
import { completeTask, createTask, getTaskRow, listTasks, moveTask, updateTask } from './tasks.ts';

const { souvenir, souvenirPerson, photo, task, person, place, project } = schema;
type SouvenirRow = typeof souvenir.$inferSelect;
type Point = { lat: number; lng: number };

export const getSouvenirRow = (ctx: Ctx, id: string): SouvenirRow =>
  assertFound(ctx.db.select().from(souvenir).where(eq(souvenir.id, id)).get(), 'Souvenir', id);

/** CE-04: days lived, both ends included (one day when there is no last day). */
export const daysLived = (start: string, end: string | null) =>
  end && end > start ? daysBetween(start, end) + 1 : 1;

// ---------- Views ----------
function views(ctx: Ctx, rows: SouvenirRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const tasks = new Map(
    ctx.db
      .select()
      .from(task)
      .where(
        inArray(
          task.id,
          rows.map((r) => r.taskId),
        ),
      )
      .all()
      .map((t) => [t.id, t]),
  );
  const projectIds = [
    ...new Set([...tasks.values()].map((t) => t.projectId).filter((x): x is string => !!x)),
  ];
  const projects = new Map(
    (projectIds.length
      ? serializeProjects(ctx, ctx.db.select().from(project).where(inArray(project.id, projectIds)).all())
      : []
    ).map((p) => [p.id, p]),
  );
  const people = new Map(
    ctx.db
      .select()
      .from(person)
      .all()
      .map((p) => [p.id, p]),
  );
  const links = ctx.db.select().from(souvenirPerson).where(inArray(souvenirPerson.souvenirId, ids)).all();
  const photos = ctx.db
    .select()
    .from(photo)
    .where(inArray(photo.souvenirId, ids))
    .orderBy(asc(photo.position), asc(photo.takenAt))
    .all();
  const placeIds = [...new Set(rows.map((r) => r.placeId).filter((x): x is string => !!x))];
  const places = new Map(
    (placeIds.length ? ctx.db.select().from(place).where(inArray(place.id, placeIds)).all() : []).map((p) => [
      p.id,
      p,
    ]),
  );
  return rows.map((r) => {
    const t = tasks.get(r.taskId)!;
    const p = t.projectId ? projects.get(t.projectId) : null;
    const start = t.doneAt ? parisDate(new Date(t.doneAt)) : parisDate(new Date(t.createdAt));
    const mine = photos.filter((ph) => ph.souvenirId === r.id);
    const pl = r.placeId ? places.get(r.placeId) : null;
    return {
      id: r.id,
      taskId: r.taskId,
      status: r.status,
      source: r.source,
      title: t.title,
      description: t.description,
      done: t.status === 'done' && t.isExperience,
      doneAt: t.doneAt,
      startDate: start,
      endDate: r.endDate,
      days: daysLived(start, r.endDate),
      place: pl
        ? {
            id: pl.id,
            name: pl.name,
            category: pl.category,
            lat: pl.lat,
            lng: pl.lng,
            address: pl.address,
            city: pl.city,
          }
        : null,
      persons: links
        .filter((l) => l.souvenirId === r.id)
        .map((l) => people.get(l.personId)!)
        .filter(Boolean)
        .map((x) => ({ id: x.id, name: x.name, color: x.color, group: x.group }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
      phrase: r.phrase,
      rating: r.rating,
      coverPhotoId: r.coverPhotoId ?? mine[0]?.id ?? null,
      photoCount: mine.length,
      tooManyPhotos: mine.length > PHOTO_WARN_COUNT,
      photos: mine.map((ph) => ({
        id: ph.id,
        takenAt: ph.takenAt,
        lat: ph.lat,
        lng: ph.lng,
        width: ph.width,
        height: ph.height,
        position: ph.position,
      })),
      domainId: p ? (p.domainIds[0] ?? null) : t.domainId,
      projectId: t.projectId,
      projectTitle: p?.title ?? null,
      createdAt: r.createdAt,
    };
  });
}
export type SouvenirView = ReturnType<typeof views>[number];

export function getSouvenir(ctx: Ctx, id: string): SouvenirView {
  return views(ctx, [getSouvenirRow(ctx, id)])[0];
}

/** EX-50: the journal, newest first; only lived experiences (a task unchecked hides its souvenir, kept). */
export function listSouvenirs(ctx: Ctx, q: SouvenirListQuery = {}): SouvenirView[] {
  const all = views(ctx, ctx.db.select().from(souvenir).all()).filter((s) => s.done);
  return all
    .filter(
      (s) =>
        (!q.personId || s.persons.some((p) => p.id === q.personId)) &&
        (!q.domainId || s.domainId === q.domainId) &&
        (!q.placeId || s.place?.id === q.placeId) &&
        (!q.category || s.place?.category === q.category) &&
        (!q.from || (s.endDate ?? s.startDate) >= q.from) &&
        (!q.to || s.startDate <= q.to) &&
        (!q.rating || s.rating === q.rating) &&
        (q.withPhotos === undefined || (q.withPhotos === 'true') === s.photoCount > 0),
    )
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
}

// ---------- Pre-fill (EX-11) ----------
/**
 * The start is the oldest shot (now when no photo has a date, never in the future); photos over several days
 * give the last day. The point is the position of the cover (first) photo, else the centre of the biggest group
 * of positions (within 300 m of each other).
 */
export function prefillFromPhotos(metas: PhotoMeta[], now: Date) {
  const times = metas
    .map((m) => normalizeTakenAt(m.takenAt))
    .filter((t): t is string => !!t)
    .sort();
  const first = times.length ? new Date(Math.min(Date.parse(times[0]), now.getTime())) : now;
  const last = times.length ? new Date(Math.min(Date.parse(times[times.length - 1]), now.getTime())) : now;
  const startDate = parisDate(first);
  const endDay = parisDate(last);
  const pts = metas
    .filter((m) => typeof m.lat === 'number' && typeof m.lng === 'number')
    .map((m) => ({ lat: m.lat!, lng: m.lng! }));
  const cover =
    metas[0] && typeof metas[0].lat === 'number' ? { lat: metas[0].lat!, lng: metas[0].lng! } : null;
  let point: Point | null = cover;
  if (!point && pts.length) {
    const groups = pts.map((p) => pts.filter((q) => distanceM(p, q) <= 300));
    const best = groups.sort((a, b) => b.length - a.length)[0];
    point = {
      lat: best.reduce((a, p) => a + p.lat, 0) / best.length,
      lng: best.reduce((a, p) => a + p.lng, 0) / best.length,
    };
  }
  return { doneAt: first, startDate, endDate: endDay > startDate ? endDay : null, point };
}

/** « Sortie du 15 novembre » (« 1er » for the first day): the title when no place is named. */
export function outingTitle(day: string) {
  const d = Number(day.slice(8, 10));
  return `Sortie du ${d === 1 ? '1er' : d} ${frMonth(day.slice(0, 7))}`;
}

const localOf = (at: Date) => {
  const c = parisClock(at);
  return `${c.date}T${c.time}`;
};

// ---------- Capture (EX-10, EXA-01) ----------
export interface CaptureFile {
  buf: Buffer;
  meta?: PhotoMeta;
}
export interface CaptureResult {
  kind: 'souvenir' | 'idea';
  id: string;
  editPath: string;
  existing: boolean;
  warnings: string[];
}

/**
 * EXA-01: the single entry of every capture (app, share sheet, Shortcut): photos (with or without their files)
 * give a draft souvenir, a URL or a place give an envie (D-171). CE-11: the same photos sent twice give one souvenir.
 * The draft is already a lived experience (counted); « Annuler » on the check screen deletes it.
 */
export async function createCapture(
  ctx: Ctx,
  body: CaptureBody,
  files: CaptureFile[] = [],
  source: 'app' | 'share' = 'app',
): Promise<CaptureResult> {
  const cid = body.clientCaptureId ?? null;
  if (cid) {
    const s = ctx.db.select().from(souvenir).where(eq(souvenir.clientCaptureId, cid)).get();
    if (s)
      return {
        kind: 'souvenir',
        id: s.id,
        editPath: `/souvenirs/${s.id}/verifier`,
        existing: true,
        warnings: [],
      };
  }
  // D-171: a shared page or place is an envie (an experience task of the reserve), opened in its drawer.
  if ('url' in body || 'lat' in body) {
    const r = 'url' in body ? await ideaFromUrl(ctx, body.url) : await ideaFromPlace(ctx, body);
    return {
      kind: 'idea',
      id: r.task.id,
      editPath: `/experiences?onglet=a-vivre&tache=${r.task.id}`,
      existing: false,
      warnings: r.warnings,
    };
  }
  const processed: (Awaited<ReturnType<typeof processPhoto>> & { meta: PhotoMeta })[] = [];
  for (const [i, f] of files.entries()) {
    const p = await processPhoto(f.buf);
    const sent = f.meta ?? body.photos[i] ?? {};
    // What the phone read before compressing wins; the file's own EXIF fills the gaps.
    processed.push({
      ...p,
      meta: {
        takenAt: sent.takenAt ?? p.meta.takenAt ?? null,
        lat: sent.lat ?? p.meta.lat ?? null,
        lng: sent.lng ?? p.meta.lng ?? null,
      },
    });
  }
  const metas = processed.length ? processed.map((p) => p.meta) : body.photos;
  const pre = prefillFromPhotos(metas, ctxNow(ctx));
  const warnings: string[] = [];
  let placeId: string | null = null;
  let placeName: string | null = null;
  if (pre.point) {
    const known = nearestMemorized(ctx, pre.point);
    if (known) {
      placeId = known.id;
      placeName = known.name;
    } else {
      const near = await placesNearby(ctx, pre.point.lat, pre.point.lng);
      if (near.providerError) warnings.push(near.providerError);
      const best = near.candidates[0];
      if (best) {
        const saved = placeFromCandidate(ctx, best);
        placeId = saved.id;
        placeName = ['address', 'city'].includes(saved.category) ? null : saved.name;
      }
    }
  }
  const dir = processed.length ? photosDir(ctx) : null;
  const photoIds = processed.map(() => randomUUID());
  if (dir) for (const [i, p] of processed.entries()) writePhotoFiles(dir, photoIds[i], p.files);
  try {
    const id = tx(ctx, () => {
      const t = createTask(ctx, {
        title: placeName ?? outingTitle(pre.startDate),
        isExperience: true,
        projectId: null,
        domainId: domainForPeople(ctx, []),
      });
      const sid = randomUUID();
      ctx.db
        .insert(souvenir)
        .values({
          id: sid,
          createdBy: ctx.actor,
          taskId: t.id,
          endDate: pre.endDate,
          placeId,
          source,
          status: 'draft',
          clientCaptureId: cid,
          coverPhotoId: photoIds[0] ?? null,
        })
        .run();
      completeTask(ctx, t.id, { doneAt: localOf(pre.doneAt) });
      for (const [i, p] of processed.entries()) {
        ctx.db
          .insert(photo)
          .values({
            id: photoIds[i],
            createdBy: ctx.actor,
            souvenirId: sid,
            takenAt: normalizeTakenAt(p.meta.takenAt),
            lat: p.meta.lat ?? null,
            lng: p.meta.lng ?? null,
            width: p.width,
            height: p.height,
            bytesFull: p.files.full.length,
            position: i,
          })
          .run();
      }
      audit(ctx, 'souvenir', sid, 'create', null, getSouvenirRow(ctx, sid));
      return sid;
    });
    return { kind: 'souvenir', id, editPath: `/souvenirs/${id}/verifier`, existing: false, warnings };
  } catch (e) {
    if (dir) removePhotoFiles(dir, photoIds);
    throw e;
  }
}

// ---------- Edit ----------
function setPersons(ctx: Ctx, id: string, personIds: string[]) {
  ctx.db.delete(souvenirPerson).where(eq(souvenirPerson.souvenirId, id)).run();
  for (const pid of new Set(personIds)) {
    assertFound(ctx.db.select().from(person).where(eq(person.id, pid)).get(), 'Personne', pid);
    ctx.db.insert(souvenirPerson).values({ souvenirId: id, personId: pid }).run();
  }
}

const personIdsOf = (ctx: Ctx, id: string) =>
  ctx.db
    .select()
    .from(souvenirPerson)
    .where(eq(souvenirPerson.souvenirId, id))
    .all()
    .map((l) => l.personId);

/** EX-15: every field, on PC as on the phone. The title, domain, project and start live on the task. */
export function updateSouvenir(ctx: Ctx, id: string, patch: SouvenirPatch) {
  return tx(ctx, () => {
    const before = getSouvenir(ctx, id);
    const row = getSouvenirRow(ctx, id);
    const t = getTaskRow(ctx, row.taskId);
    if (patch.projectId !== undefined && patch.projectId !== t.projectId)
      moveTask(ctx, t.id, patch.projectId);
    const taskPatch: Parameters<typeof updateTask>[2] = {};
    if (patch.title !== undefined) taskPatch.title = patch.title;
    if (patch.description !== undefined) taskPatch.description = patch.description;
    if (patch.domainId !== undefined && !(patch.projectId ?? t.projectId))
      taskPatch.domainId = patch.domainId;
    if (patch.startDate !== undefined && t.doneAt) {
      const time = parisClock(new Date(t.doneAt)).time;
      // Today: the same time, or now when that time is still to come.
      const wanted = `${patch.startDate}T${time}`;
      const now = localOf(ctxNow(ctx));
      taskPatch.doneAt = patch.startDate === now.slice(0, 10) && wanted > now ? now : wanted;
    }
    if (Object.keys(taskPatch).length) updateTask(ctx, t.id, taskPatch);
    const start = parisDate(new Date(getTaskRow(ctx, t.id).doneAt ?? t.createdAt));
    const set: Partial<typeof souvenir.$inferInsert> = { updatedAt: ctxNowIso(ctx) };
    const end = patch.endDate !== undefined ? patch.endDate : row.endDate;
    if (patch.endDate !== undefined || patch.startDate !== undefined)
      set.endDate = end && end > start ? end : null;
    if (patch.placeId !== undefined) {
      if (patch.placeId) getPlace(ctx, patch.placeId);
      set.placeId = patch.placeId;
    }
    if (patch.phrase !== undefined) set.phrase = patch.phrase;
    if (patch.rating !== undefined) set.rating = patch.rating;
    ctx.db.update(souvenir).set(set).where(eq(souvenir.id, id)).run();
    if (patch.personIds !== undefined || patch.newPersons?.length) {
      const typed = (patch.newPersons ?? []).map((n) => personByName(ctx, n).id);
      setPersons(ctx, id, [...(patch.personIds ?? personIdsOf(ctx, id)), ...typed]);
    }
    const after = getSouvenir(ctx, id);
    audit(ctx, 'souvenir', id, 'update', before, after);
    return after;
  });
}

/**
 * EX-12 « Enregistrer »: the draft becomes a souvenir. D-163: when the domain is not given (nor a project), it is
 * deduced from the people (a family member → Famille…).
 */
export function saveSouvenir(ctx: Ctx, id: string, body: SouvenirPatch) {
  return tx(ctx, () => {
    const row = getSouvenirRow(ctx, id);
    const typed = (body.newPersons ?? []).map((n) => personByName(ctx, n).id);
    const personIds = [...(body.personIds ?? personIdsOf(ctx, id)), ...typed];
    const patch: SouvenirPatch = { ...body, personIds, newPersons: [] };
    if (body.domainId === undefined && body.projectId === undefined && row.status === 'draft')
      patch.domainId = domainForPeople(ctx, personIds);
    updateSouvenir(ctx, id, patch);
    ctx.db
      .update(souvenir)
      .set({ status: 'saved', updatedAt: ctxNowIso(ctx) })
      .where(eq(souvenir.id, id))
      .run();
    return getSouvenir(ctx, id);
  });
}

/** Deletes a souvenir with its experience task and its photos (« Annuler » of a fresh capture). */
export function deleteSouvenir(ctx: Ctx, id: string) {
  const row = getSouvenirRow(ctx, id);
  const ids = ctx.db
    .select({ id: photo.id })
    .from(photo)
    .where(eq(photo.souvenirId, id))
    .all()
    .map((p) => p.id);
  deleteTask(ctx, row.taskId);
  if (ids.length && ctx.photosDir) removePhotoFiles(ctx.photosDir, ids);
  return { ok: true as const };
}

// ---------- Suggestions (EX-14, EXA-04) ----------
/** The point of a souvenir: its place, else its photos (cover first, then the biggest group). */
/** D-169: where the photos were taken (the cover first); the chosen place only when they have no position. */
function pointOf(s: SouvenirView): Point | null {
  const cover = s.photos.find((p) => p.id === s.coverPhotoId);
  const fromPhotos = prefillFromPhotos(
    [...(cover ? [cover] : []), ...s.photos.filter((p) => p !== cover)].map((p) => ({
      lat: p.lat,
      lng: p.lng,
    })),
    new Date(),
  ).point;
  return fromPhotos ?? (s.place ? { lat: s.place.lat, lng: s.place.lng } : null);
}

/**
 * CE-10: experiences still to live that this souvenir may be: due within 2 days of its dates, planned the week
 * of its first day.
 */
export function attachCandidates(ctx: Ctx, s: SouvenirView) {
  const from = addDays(s.startDate, -2);
  const to = addDays(s.endDate ?? s.startDate, 2);
  const week = isoWeekOf(s.startDate);
  return listTasks(ctx, { status: 'todo' })
    .filter((t) => t.isExperience && t.id !== s.taskId)
    .map((t) => {
      const reason =
        t.dueDate && t.dueDate >= from && t.dueDate <= to
          ? ('date' as const)
          : t.plannedWeek === week
            ? ('week' as const)
            : null;
      return { taskId: t.id, title: t.title, dueDate: t.dueDate, plannedWeek: t.plannedWeek, reason };
    })
    .filter((c) => c.reason);
}

/** EXA-04: place candidates, planned experiences to attach, and a souvenir of the same day at the same place. */
export async function getSuggestions(ctx: Ctx, id: string) {
  const s = getSouvenir(ctx, id);
  const point = pointOf(s);
  const places = point
    ? await placesNearby(ctx, point.lat, point.lng)
    : { candidates: [], providerError: null };
  const duplicate = s.place
    ? (listSouvenirs(ctx, { placeId: s.place.id }).find(
        (o) => o.id !== s.id && o.status === 'saved' && o.startDate === s.startDate,
      ) ?? null)
    : null;
  const home = getSettings(ctx)['places.home'];
  return {
    point,
    places: places.candidates,
    providerError: places.providerError,
    attach: attachCandidates(ctx, s),
    duplicate: duplicate
      ? { id: duplicate.id, title: duplicate.title, photoCount: duplicate.photoCount }
      : null,
    home: home ? { lat: home.lat, lng: home.lng } : null,
  };
}

/**
 * EX-14 « Rattacher »: the souvenir completes the planned experience instead of its own draft task, which is
 * deleted. The planned task becomes lived at the souvenir's time; its title, domain and project are kept.
 */
export function attachSouvenir(ctx: Ctx, id: string, taskId: string) {
  return tx(ctx, () => {
    const row = getSouvenirRow(ctx, id);
    if (row.taskId === taskId) return getSouvenir(ctx, id);
    const target = getTaskRow(ctx, taskId);
    if (!target.isExperience || target.status !== 'todo')
      throw new DomainError(
        'NOT_PLANNED_EXPERIENCE',
        'Seule une expérience encore à vivre peut être rattachée.',
      );
    if (ctx.db.select().from(souvenir).where(eq(souvenir.taskId, taskId)).get())
      throw new DomainError('SOUVENIR_EXISTS', 'Cette expérience a déjà un souvenir.');
    const own = getTaskRow(ctx, row.taskId);
    const at = localOf(new Date(own.doneAt ?? ctxNowIso(ctx)));
    ctx.db
      .update(souvenir)
      .set({ taskId, updatedAt: ctxNowIso(ctx) })
      .where(eq(souvenir.id, id))
      .run();
    deleteTask(ctx, own.id);
    completeTask(ctx, taskId, { doneAt: at });
    audit(ctx, 'souvenir', id, 'attach', { taskId: own.id }, { taskId });
    return getSouvenir(ctx, id);
  });
}

/** EX-14 « Ajouter ces photos au souvenir existant »: photos and people move, this souvenir and its task go. */
export function mergeSouvenir(ctx: Ctx, id: string, intoId: string) {
  return tx(ctx, () => {
    if (id === intoId) throw new DomainError('SAME_SOUVENIR', 'Choisis un autre souvenir.');
    const row = getSouvenirRow(ctx, id);
    const into = getSouvenirRow(ctx, intoId);
    const offset = ctx.db.select().from(photo).where(eq(photo.souvenirId, intoId)).all().length;
    const mine = ctx.db
      .select()
      .from(photo)
      .where(eq(photo.souvenirId, id))
      .orderBy(asc(photo.position))
      .all();
    for (const [i, p] of mine.entries()) {
      ctx.db
        .update(photo)
        .set({ souvenirId: intoId, position: offset + i })
        .where(eq(photo.id, p.id))
        .run();
    }
    setPersons(ctx, intoId, [...personIdsOf(ctx, intoId), ...personIdsOf(ctx, id)]);
    if (!into.coverPhotoId && mine[0])
      ctx.db.update(souvenir).set({ coverPhotoId: mine[0].id }).where(eq(souvenir.id, intoId)).run();
    deleteTask(ctx, row.taskId);
    audit(ctx, 'souvenir', id, 'merge', null, { mergedInto: intoId, photos: mine.length });
    return getSouvenir(ctx, intoId);
  });
}

// ---------- Photos (EX-15, EX-20, EXA-03) ----------
/** EX-15: a photo added to a souvenir (phone in the background, drag and drop on PC). */
export async function addPhoto(ctx: Ctx, souvenirId: string, buf: Buffer, meta: PhotoMeta = {}) {
  getSouvenirRow(ctx, souvenirId);
  const p = await processPhoto(buf);
  const dir = photosDir(ctx);
  const id = randomUUID();
  writePhotoFiles(dir, id, p.files);
  try {
    return tx(ctx, () => {
      const row = getSouvenirRow(ctx, souvenirId);
      const count = ctx.db.select().from(photo).where(eq(photo.souvenirId, souvenirId)).all().length;
      ctx.db
        .insert(photo)
        .values({
          id,
          createdBy: ctx.actor,
          souvenirId,
          takenAt: normalizeTakenAt(meta.takenAt ?? p.meta.takenAt),
          lat: meta.lat ?? p.meta.lat ?? null,
          lng: meta.lng ?? p.meta.lng ?? null,
          width: p.width,
          height: p.height,
          bytesFull: p.files.full.length,
          position: count,
        })
        .run();
      if (!row.coverPhotoId)
        ctx.db.update(souvenir).set({ coverPhotoId: id }).where(eq(souvenir.id, souvenirId)).run();
      const added = ctx.db.select().from(photo).where(eq(photo.id, id)).get()!;
      audit(ctx, 'photo', id, 'create', null, added);
      return { ...added, warn: count + 1 > PHOTO_WARN_COUNT };
    });
  } catch (e) {
    removePhotoFiles(dir, [id]);
    throw e;
  }
}

export const getPhotoRow = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(photo).where(eq(photo.id, id)).get(), 'Photo', id);

/** CE-03: a tap on a thumbnail puts it on the cover. */
export function setCover(ctx: Ctx, id: string, photoId: string) {
  return tx(ctx, () => {
    if (getPhotoRow(ctx, photoId).souvenirId !== id)
      throw new DomainError('PHOTO_ELSEWHERE', 'Cette photo appartient à un autre souvenir.');
    ctx.db
      .update(souvenir)
      .set({ coverPhotoId: photoId, updatedAt: ctxNowIso(ctx) })
      .where(eq(souvenir.id, id))
      .run();
    audit(ctx, 'souvenir', id, 'cover', null, { coverPhotoId: photoId });
    return getSouvenir(ctx, id);
  });
}

/** Moves a photo to another rank of its souvenir. */
export function movePhoto(ctx: Ctx, photoId: string, position: number) {
  return tx(ctx, () => {
    const p = getPhotoRow(ctx, photoId);
    const list = ctx.db
      .select()
      .from(photo)
      .where(eq(photo.souvenirId, p.souvenirId))
      .orderBy(asc(photo.position))
      .all();
    const rest = list.filter((x) => x.id !== photoId);
    rest.splice(Math.min(position, rest.length), 0, p);
    for (const [i, x] of rest.entries())
      ctx.db.update(photo).set({ position: i }).where(eq(photo.id, x.id)).run();
    return getSouvenir(ctx, p.souvenirId);
  });
}

/** CE-03: the cross removes a photo (and its files); the next one goes on the cover if needed. */
export function deletePhoto(ctx: Ctx, photoId: string) {
  const res = tx(ctx, () => {
    const p = getPhotoRow(ctx, photoId);
    ctx.db.delete(photo).where(eq(photo.id, photoId)).run();
    const row = getSouvenirRow(ctx, p.souvenirId);
    if (row.coverPhotoId === photoId) {
      const next = ctx.db
        .select()
        .from(photo)
        .where(eq(photo.souvenirId, p.souvenirId))
        .orderBy(asc(photo.position))
        .get();
      ctx.db
        .update(souvenir)
        .set({ coverPhotoId: next?.id ?? null })
        .where(eq(souvenir.id, p.souvenirId))
        .run();
    }
    audit(ctx, 'photo', photoId, 'delete', p, null);
    return getSouvenir(ctx, p.souvenirId);
  });
  if (ctx.photosDir) removePhotoFiles(ctx.photosDir, [photoId]);
  return res;
}

// ---------- Revivre: map, on this day (EX-51, EX-52) ----------
/**
 * EX-51 / CE-07: one point per place (a place visited three times shows « 3 »), never the other positions of the
 * photos. The life radius covers 80 % of the souvenirs with a place, around the home.
 */
export function souvenirMap(ctx: Ctx, q: SouvenirListQuery = {}) {
  const list = listSouvenirs(ctx, q).filter((s) => s.place);
  const byPlace = new Map<string, SouvenirView[]>();
  for (const s of list) byPlace.set(s.place!.id, [...(byPlace.get(s.place!.id) ?? []), s]);
  const home = getSettings(ctx)['places.home'];
  const dists = home ? list.map((s) => distanceM(home, s.place!)).sort((a, b) => a - b) : [];
  const radius = dists.length ? dists[Math.max(0, Math.ceil(dists.length * 0.8) - 1)] : null;
  return {
    home,
    lifeRadiusM: radius,
    points: [...byPlace.values()].map((items) => {
      const pl = items[0].place!;
      return {
        placeId: pl.id,
        name: pl.name,
        category: pl.category,
        city: pl.city,
        lat: pl.lat,
        lng: pl.lng,
        count: items.length,
        last: {
          id: items[0].id,
          title: items[0].title,
          startDate: items[0].startDate,
          coverPhotoId: items[0].coverPhotoId,
        },
        souvenirs: items.map((s) => ({
          id: s.id,
          title: s.title,
          startDate: s.startDate,
          endDate: s.endDate,
        })),
      };
    }),
  };
}

/**
 * EX-52 « Il y a un an »: a souvenir of the same day in a past year, else of the same week (3 days around), the
 * most recent year first. Null when there is none (the card does not show).
 */
export function onThisDay(ctx: Ctx) {
  const today = parisDate(ctxNow(ctx));
  const year = Number(today.slice(0, 4));
  const past = listSouvenirs(ctx).filter(
    (s) => s.status === 'saved' && Number(s.startDate.slice(0, 4)) < year,
  );
  const gap = (s: SouvenirView) => {
    const same = `${today.slice(0, 4)}${s.startDate.slice(4)}`;
    return Number.isNaN(Date.parse(same)) ? 99 : Math.abs(daysBetween(today, same));
  };
  const best = past
    .map((s) => ({ s, gap: gap(s) }))
    .filter((x) => x.gap <= 3)
    .sort((a, b) => a.gap - b.gap || b.s.startDate.localeCompare(a.s.startDate))[0];
  if (!best) return null;
  return { ...best.s, yearsAgo: year - Number(best.s.startDate.slice(0, 4)), sameDay: best.gap === 0 };
}
