// Wishes (memento-experiences EX-40, EX-41, D-164, D-165): the reserve of ideas, in typed lists, filled by « + »,
// a shared URL (the page is read) or a shared place. Cycle: wish → planned (a dated experience task, in the week's
// plan) → lived (a souvenir is attached) → reusable (planned again). Archived by hand, or 7 days after the end of
// a dated event (QE-08). D-165: « planned » and « lived » are read from the task, never stored twice.
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { asc, eq, schema } from '@memento/db';
import { audit, type Ctx, ctxNow, ctxNowIso, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import type { WishCreate, WishListQuery, WishPatch } from '../schemas-souvenirs.ts';
import { getSettings } from '../settings.ts';
import { addDays, isoWeekOf, parisDate } from '../time.ts';
import { domainForPeople } from './persons.ts';
import { photosDir, processWishImage, wishImageFile, writeWishImage } from './photos.ts';
import {
  distanceM,
  getPlace,
  nearestMemorized,
  type PlaceInput,
  placeFromCandidate,
  placesNearby,
  savePlace,
  searchPlaces,
} from './places.ts';
import { addTaskToWeek } from './planning.ts';
import { fetchImage, readUrl } from './read-url.ts';
import { createTask } from './tasks.ts';

const { wish, wishList, task, souvenir, place } = schema;
type WishRow = typeof wish.$inferSelect;

/** EX-40 §6.2: the default lists, written once (afterwards they are the user's configuration). */
export const DEFAULT_WISH_LISTS = [
  { name: 'Restaurants', icon: 'tools-kitchen-2' },
  { name: 'Lieux à visiter', icon: 'building-castle' },
  { name: 'Spectacles et événements', icon: 'masks-theater' },
  { name: 'Nature et balades', icon: 'trees' },
  { name: 'Activités et sport', icon: 'bike' },
  { name: 'Week-ends et voyages', icon: 'luggage' },
] as const;

/** Called by the seed: the six lists on a database that never had them. */
export function seedWishLists(ctx: Ctx) {
  const flag = 'seed.wish_lists';
  if (ctx.db.select().from(schema.setting).where(eq(schema.setting.key, flag)).get()) return;
  if (!ctx.db.select().from(wishList).limit(1).get())
    for (const [i, l] of DEFAULT_WISH_LISTS.entries()) {
      ctx.db.insert(wishList).values({ id: randomUUID(), name: l.name, icon: l.icon, position: i }).run();
    }
  ctx.db.insert(schema.setting).values({ key: flag, value: true }).run();
}

// ---------- Lists ----------
export function listWishLists(ctx: Ctx) {
  const counts = new Map<string, number>();
  for (const w of ctx.db.select({ l: wish.listId }).from(wish).all())
    if (w.l) counts.set(w.l, (counts.get(w.l) ?? 0) + 1);
  return ctx.db
    .select()
    .from(wishList)
    .orderBy(asc(wishList.position))
    .all()
    .map((l) => ({ ...l, count: counts.get(l.id) ?? 0 }));
}
const getList = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(wishList).where(eq(wishList.id, id)).get(), 'Liste', id);

export function createWishList(ctx: Ctx, input: { name: string; icon?: string }) {
  return tx(ctx, () => {
    const id = randomUUID();
    const position = ctx.db.select().from(wishList).all().length;
    ctx.db
      .insert(wishList)
      .values({ id, createdBy: ctx.actor, name: input.name, icon: input.icon ?? 'star', position })
      .run();
    audit(ctx, 'wish_list', id, 'create', null, getList(ctx, id));
    return getList(ctx, id);
  });
}
export function updateWishList(
  ctx: Ctx,
  id: string,
  patch: { name?: string; icon?: string; position?: number },
) {
  return tx(ctx, () => {
    const before = getList(ctx, id);
    const { position, ...rest } = patch;
    ctx.db
      .update(wishList)
      .set({ ...rest, updatedAt: ctxNowIso(ctx) })
      .where(eq(wishList.id, id))
      .run();
    if (position !== undefined) {
      const others = ctx.db
        .select()
        .from(wishList)
        .orderBy(asc(wishList.position))
        .all()
        .filter((l) => l.id !== id);
      others.splice(Math.min(position, others.length), 0, before);
      for (const [i, l] of others.entries()) {
        ctx.db.update(wishList).set({ position: i }).where(eq(wishList.id, l.id)).run();
      }
    }
    const after = getList(ctx, id);
    audit(ctx, 'wish_list', id, 'update', before, after);
    return after;
  });
}
/** A list removed: its wishes stay, without a list. */
export function deleteWishList(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getList(ctx, id);
    ctx.db.update(wish).set({ listId: null }).where(eq(wish.listId, id)).run();
    ctx.db.delete(wishList).where(eq(wishList.id, id)).run();
    audit(ctx, 'wish_list', id, 'delete', before, null);
    return { ok: true as const };
  });
}

/** The list a page or a place most likely belongs to, by the default list names (none if renamed). */
function guessList(ctx: Ctx, kind: string | null, category: string | null): string | null {
  const name =
    kind === 'event'
      ? 'Spectacles'
      : category && ['restaurant', 'cafe', 'bar'].includes(category)
        ? 'Restaurants'
        : category && ['park', 'nature', 'cave'].includes(category)
          ? 'Nature'
          : category && ['museum', 'attraction', 'monument', 'city'].includes(category)
            ? 'Lieux'
            : category && ['sport'].includes(category)
              ? 'Activités'
              : category && ['theatre', 'cinema', 'venue'].includes(category)
                ? 'Spectacles'
                : category === 'hotel'
                  ? 'Week-ends'
                  : null;
  return name ? (listWishLists(ctx).find((l) => l.name.startsWith(name))?.id ?? null) : null;
}

// ---------- Views ----------
function views(ctx: Ctx, rows: WishRow[]) {
  const today = parisDate(ctxNow(ctx));
  const tasks = new Map(
    ctx.db
      .select()
      .from(task)
      .all()
      .map((t) => [t.id, t]),
  );
  const lists = new Map(
    ctx.db
      .select()
      .from(wishList)
      .all()
      .map((l) => [l.id, l]),
  );
  const places = new Map(
    ctx.db
      .select()
      .from(place)
      .all()
      .map((p) => [p.id, p]),
  );
  const lived = new Map<string, number>();
  for (const s of ctx.db.select({ w: souvenir.wishId, t: souvenir.taskId }).from(souvenir).all())
    if (s.w && tasks.get(s.t)?.status === 'done') lived.set(s.w, (lived.get(s.w) ?? 0) + 1);
  const home = getSettings(ctx)['places.home'];
  return rows.map((w) => {
    const t = w.taskId ? tasks.get(w.taskId) : null;
    const pl = w.placeId ? places.get(w.placeId) : null;
    // QE-08: a dated event is over a week after its end.
    const expired = !!(w.endDate ?? w.startDate) && addDays((w.endDate ?? w.startDate)!, 7) < today;
    const status =
      w.status === 'archived'
        ? 'archived'
        : t?.status === 'todo'
          ? 'planned'
          : expired
            ? 'archived'
            : (lived.get(w.id) ?? 0) > 0 || t?.status === 'done'
              ? 'lived'
              : 'wish';
    return {
      id: w.id,
      title: w.title,
      listId: w.listId,
      listName: w.listId ? (lists.get(w.listId)?.name ?? null) : null,
      place: pl
        ? {
            id: pl.id,
            name: pl.name,
            category: pl.category,
            lat: pl.lat,
            lng: pl.lng,
            city: pl.city,
            address: pl.address,
          }
        : null,
      distanceKm: pl && home ? Math.round(distanceM(home, pl) / 100) / 10 : null,
      url: w.url,
      hasImage: w.hasImage,
      startDate: w.startDate,
      endDate: w.endDate,
      price: w.price,
      durationMin: w.durationMin,
      dogAllowed: w.dogAllowed,
      indoor: w.indoor,
      season: w.season,
      personIds: w.personIds,
      tags: w.tags,
      note: w.note,
      status,
      archivedByDate: w.status !== 'archived' && status === 'archived',
      livedCount: lived.get(w.id) ?? 0,
      plannedTask: t && t.status === 'todo' ? { id: t.id, dueDate: t.dueDate } : null,
      source: w.source,
      createdAt: w.createdAt,
    };
  });
}
export type WishView = ReturnType<typeof views>[number];

const getRow = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(wish).where(eq(wish.id, id)).get(), 'Envie', id);
export const getWish = (ctx: Ctx, id: string): WishView => views(ctx, [getRow(ctx, id)])[0];

/**
 * EX-41 « Que faire ? » v1: one's own wishes, filtered by list, dog, duration, distance from home, lived or not,
 * season. Without a status filter: the open ones (wish, planned, lived), archived left out.
 */
export function listWishes(ctx: Ctx, q: WishListQuery = {}) {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return views(ctx, ctx.db.select().from(wish).all())
    .filter(
      (w) =>
        (q.status === undefined || q.status === 'open' ? w.status !== 'archived' : w.status === q.status) &&
        (!q.listId || w.listId === q.listId) &&
        (!q.dog || w.dogAllowed === q.dog) &&
        (!q.maxDurationMin || (w.durationMin !== null && w.durationMin <= q.maxDurationMin)) &&
        (!q.maxKm || (w.distanceKm !== null && w.distanceKm <= q.maxKm)) &&
        (q.done === undefined || (q.done === 'true') === w.livedCount > 0) &&
        (!q.season || !w.season || fold(w.season).includes(fold(q.season))) &&
        (!q.q || fold(`${w.title} ${w.note} ${w.tags.join(' ')} ${w.place?.name ?? ''}`).includes(fold(q.q))),
    )
    .sort(
      (a, b) =>
        (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

// ---------- Create, edit ----------
async function storeImage(ctx: Ctx, wishId: string, imageUrl: string | null | undefined): Promise<boolean> {
  if (!imageUrl || !ctx.photosDir) return false;
  const buf = await fetchImage(imageUrl);
  const img = buf ? await processWishImage(buf) : null;
  if (!img) return false; // a page picture that is not one: the wish keeps no image
  writeWishImage(photosDir(ctx), wishId, img);
  return true;
}

function insertWish(
  ctx: Ctx,
  id: string,
  input: WishCreate,
  extra: {
    source: WishRow['source'];
    sourceMeta?: unknown;
    clientCaptureId?: string | null;
    hasImage: boolean;
  },
) {
  return tx(ctx, () => {
    const placeId = input.place ? savePlace(ctx, input.place).id : (input.placeId ?? null);
    if (placeId) getPlace(ctx, placeId);
    if (input.listId) getList(ctx, input.listId);
    ctx.db
      .insert(wish)
      .values({
        id,
        createdBy: ctx.actor,
        title: input.title,
        listId: input.listId ?? null,
        placeId,
        url: input.url ?? null,
        hasImage: extra.hasImage,
        startDate: input.startDate ?? null,
        endDate:
          input.endDate && input.startDate && input.endDate < input.startDate
            ? null
            : (input.endDate ?? null),
        price: input.price ?? null,
        durationMin: input.durationMin ?? null,
        dogAllowed: input.dogAllowed ?? 'unknown',
        indoor: input.indoor ?? 'unknown',
        season: input.season ?? null,
        personIds: input.personIds ?? [],
        tags: input.tags ?? [],
        note: input.note ?? '',
        source: extra.source,
        sourceMeta: extra.sourceMeta ?? null,
        clientCaptureId: extra.clientCaptureId ?? null,
      })
      .run();
    audit(ctx, 'wish', id, 'create', null, getRow(ctx, id));
    return getWish(ctx, id);
  });
}

/** CE-33: « + Envie » works with a title alone. */
export async function createWish(ctx: Ctx, input: WishCreate, source: WishRow['source'] = 'plus') {
  const id = randomUUID();
  const hasImage = await storeImage(ctx, id, input.imageUrl);
  return insertWish(ctx, id, input, { source, hasImage });
}

export async function updateWish(ctx: Ctx, id: string, patch: WishPatch) {
  const before = getRow(ctx, id);
  const { imageUrl, place: newPlace, ...rest } = patch;
  const hasImage =
    imageUrl === undefined
      ? before.hasImage
      : imageUrl === null
        ? false
        : await storeImage(ctx, id, imageUrl);
  return tx(ctx, () => {
    const placeId = newPlace ? savePlace(ctx, newPlace).id : rest.placeId;
    if (placeId) getPlace(ctx, placeId);
    if (rest.listId) getList(ctx, rest.listId);
    ctx.db
      .update(wish)
      .set({ ...rest, ...(placeId !== undefined ? { placeId } : {}), hasImage, updatedAt: ctxNowIso(ctx) })
      .where(eq(wish.id, id))
      .run();
    const after = getRow(ctx, id);
    if (after.endDate && after.startDate && after.endDate < after.startDate)
      ctx.db.update(wish).set({ endDate: null }).where(eq(wish.id, id)).run();
    audit(ctx, 'wish', id, 'update', before, getRow(ctx, id));
    return getWish(ctx, id);
  });
}

export function deleteWish(ctx: Ctx, id: string) {
  const res = tx(ctx, () => {
    const before = getRow(ctx, id);
    ctx.db.update(souvenir).set({ wishId: null }).where(eq(souvenir.wishId, id)).run();
    ctx.db.delete(wish).where(eq(wish.id, id)).run();
    audit(ctx, 'wish', id, 'delete', before, null);
    return { ok: true as const };
  });
  if (ctx.photosDir && existsSync(wishImageFile(ctx.photosDir, id)))
    unlinkSync(wishImageFile(ctx.photosDir, id));
  return res;
}

/**
 * CE-34 « Planifier »: a dated experience task (Inbox, domain from the wish's people) that joins the plan of
 * that week. A wish already planned keeps its task (the date moves).
 */
export function planWish(ctx: Ctx, id: string, date: string) {
  return tx(ctx, () => {
    const w = getWish(ctx, id);
    const today = parisDate(ctxNow(ctx));
    if (date < today) throw new DomainError('DATE_PAST', 'Choisis aujourd’hui ou un jour à venir.');
    const lines = [
      w.place ? `Lieu : ${w.place.name}${w.place.city ? `, ${w.place.city}` : ''}` : '',
      w.url ? `Lien : ${w.url}` : '',
      w.price ? `Tarif : ${w.price}` : '',
      w.note,
    ]
      .filter(Boolean)
      .join('\n\n');
    let taskId = w.plannedTask?.id ?? null;
    if (taskId)
      ctx.db
        .update(task)
        .set({ dueDate: date, updatedAt: ctxNowIso(ctx) })
        .where(eq(task.id, taskId))
        .run();
    else
      taskId = createTask(ctx, {
        title: w.title,
        description: lines,
        isExperience: true,
        durationMin: w.durationMin ?? null,
        dueDate: date,
        projectId: null,
        domainId: domainForPeople(ctx, w.personIds),
      }).id;
    ctx.db
      .update(wish)
      .set({ taskId, status: 'wish', updatedAt: ctxNowIso(ctx) })
      .where(eq(wish.id, id))
      .run();
    addTaskToWeek(ctx, isoWeekOf(date), taskId);
    audit(ctx, 'wish', id, 'plan', null, { taskId, date });
    return getWish(ctx, id);
  });
}

// ---------- From a shared URL or place (EX-40 §6.1) ----------
/** The place of a page: a remembered one within 50 m, else saved (with its coordinates), else searched by name. */
async function placeOfPage(
  ctx: Ctx,
  p: { name: string | null; lat: number | null; lng: number | null; address: string; city: string } | null,
) {
  if (!p) return null;
  if (p.lat !== null && p.lng !== null) {
    const known = nearestMemorized(ctx, { lat: p.lat, lng: p.lng });
    if (known) return known.id;
    return savePlace(ctx, {
      name: p.name ?? (p.address || 'Lieu partagé'),
      category: 'other',
      lat: p.lat,
      lng: p.lng,
      address: p.address,
      city: p.city,
      provider: 'manual',
    }).id;
  }
  if (!p.name) return null;
  const found = await searchPlaces(ctx, [p.name, p.city].filter(Boolean).join(' '));
  return found.candidates[0] ? placeFromCandidate(ctx, found.candidates[0]).id : null;
}

/**
 * CE-30 / CE-31: a shared page becomes a wish, pre-filled with what it says (title, image, dates, place, price).
 * An unreadable page still gives a wish: the URL and a title to confirm (warning URL_UNREADABLE).
 */
export async function createWishFromUrl(
  ctx: Ctx,
  url: string,
  opts: { clientCaptureId?: string | null } = {},
) {
  const page = await readUrl(url);
  const warnings = page.error ? [page.error] : [];
  const host = new URL(page.finalUrl).hostname.replace(/^www\./, '');
  let placeId: string | null = null;
  try {
    placeId = await placeOfPage(ctx, page.place);
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    warnings.push(e.code);
  }
  const category = placeId ? getPlace(ctx, placeId).category : null;
  const id = randomUUID();
  const hasImage = await storeImage(ctx, id, page.imageUrl);
  const w = insertWish(
    ctx,
    id,
    {
      title: page.title ?? `${host} (à confirmer)`,
      url,
      placeId,
      listId: guessList(ctx, page.kind, category),
      startDate: page.startDate,
      endDate: page.endDate,
      price: page.price,
      note: page.description ?? '',
    },
    {
      source: page.kind === 'maps' ? 'share_place' : 'share_url',
      sourceMeta: page.meta,
      clientCaptureId: opts.clientCaptureId,
      hasImage,
    },
  );
  return { wish: w, warnings, page: { kind: page.kind, readable: page.readable } };
}

/** CE-32: a place shared from Plans or Google Maps: the named place there (remembered, found, or as typed). */
export async function createWishFromPlace(
  ctx: Ctx,
  p: { lat: number; lng: number; name?: string },
  opts: { clientCaptureId?: string | null } = {},
) {
  const warnings: string[] = [];
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let chosen: PlaceInput & { id?: string } = {
    name: p.name || 'Lieu partagé',
    lat: p.lat,
    lng: p.lng,
    provider: 'manual',
  };
  const known = nearestMemorized(ctx, p);
  if (known) chosen = { ...known, id: known.id };
  else {
    const near = await placesNearby(ctx, p.lat, p.lng);
    if (near.providerError) warnings.push(near.providerError);
    const named = p.name
      ? near.candidates.find(
          (c) => fold(c.name).includes(fold(p.name!)) || fold(p.name!).includes(fold(c.name)),
        )
      : near.candidates.find((c) => !['address', 'city'].includes(c.category ?? ''));
    if (named) chosen = named;
  }
  const saved = placeFromCandidate(ctx, chosen);
  const w = insertWish(
    ctx,
    randomUUID(),
    { title: saved.name, placeId: saved.id, listId: guessList(ctx, null, saved.category) },
    { source: 'share_place', sourceMeta: p, clientCaptureId: opts.clientCaptureId, hasImage: false },
  );
  return { wish: w, warnings };
}
