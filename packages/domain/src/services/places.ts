// EX-13 / D-161: places by their name, never by their coordinates. Memento relays OpenStreetMap (Overpass for
// the named places near a point, Photon for a search by name, Nominatim for the address when nothing is named),
// with a cache and one request per second and per host (Nominatim's rule). A chosen place is saved once and
// reused: one provider reference = one place (souvenirs, wishes, the future activity engine).
import { eq, schema } from '@memento/db';
import type { z } from 'zod';
import { audit, type Ctx, ctxNowIso, newId, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import type { placeInput, placePatch } from '../schemas-souvenirs.ts';
import { getSettings } from '../settings.ts';
import { APP_VERSION } from '../version.ts';

const { place, souvenir, wish } = schema;
export type PlaceInput = z.infer<typeof placeInput>;
export type PlaceRow = typeof place.$inferSelect;

/** The provider did not answer (network, quota): never blocking, the place can be typed by hand. → 503 */
export class ProviderError extends DomainError {}
const unavailable = () =>
  new ProviderError(
    'PLACE_PROVIDER_UNAVAILABLE',
    'Recherche de lieux indisponible pour le moment : choisis un lieu mémorisé ou tape son nom.',
  );

/** Distance in metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

// ---------- Categories ----------
/** Our categories (French label in the interface), from the OpenStreetMap tags. */
export const PLACE_CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'theatre',
  'cinema',
  'museum',
  'venue',
  'attraction',
  'park',
  'nature',
  'cave',
  'sport',
  'monument',
  'shop',
  'hotel',
  'address',
  'city',
  'other',
] as const;
/** The ones an outing usually is: preferred over a shop or an address at the same distance. */
const OUTING = new Set([
  'restaurant',
  'cafe',
  'bar',
  'theatre',
  'cinema',
  'museum',
  'venue',
  'attraction',
  'park',
  'nature',
  'cave',
  'sport',
  'monument',
]);

export function categoryOf(key: string, value: string): string {
  const v = value.toLowerCase();
  if (key === 'amenity') {
    if (['restaurant', 'fast_food', 'food_court', 'ice_cream', 'biergarten'].includes(v)) return 'restaurant';
    if (v === 'cafe') return 'cafe';
    if (['bar', 'pub', 'nightclub'].includes(v)) return 'bar';
    if (v === 'theatre') return 'theatre';
    if (v === 'cinema') return 'cinema';
    if (['arts_centre', 'events_venue', 'concert_hall', 'community_centre', 'exhibition_centre'].includes(v))
      return 'venue';
    if (v === 'place_of_worship') return 'monument';
    return 'other';
  }
  if (key === 'tourism') {
    if (['museum', 'gallery'].includes(v)) return 'museum';
    if (['attraction', 'viewpoint', 'zoo', 'theme_park', 'aquarium'].includes(v)) return 'attraction';
    if (['hotel', 'guest_house', 'hostel', 'camp_site', 'chalet'].includes(v)) return 'hotel';
    return 'attraction';
  }
  if (key === 'leisure') {
    if (['park', 'garden', 'nature_reserve', 'playground'].includes(v)) return 'park';
    if (
      ['sports_centre', 'swimming_pool', 'stadium', 'pitch', 'ice_rink', 'golf_course', 'marina'].includes(v)
    )
      return 'sport';
    return 'attraction';
  }
  if (key === 'natural') return v === 'cave_entrance' ? 'cave' : 'nature';
  if (key === 'historic') return 'monument';
  if (key === 'sport') return 'sport';
  if (key === 'shop') return 'shop';
  if (key === 'boundary' || key === 'place') return 'city';
  if (key === 'highway' || key === 'building') return 'address';
  return 'other';
}

// ---------- Outgoing requests: cache, throttle ----------
const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_MS = 24 * 3_600_000;
const lastCall = new Map<string, Promise<void>>();

/** Clears the provider cache (tests). */
export const clearPlacesCache = () => {
  cache.clear();
  lastCall.clear();
};

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const key = `${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const host = new URL(url).host;
  // One request per second and per host, in order.
  const previous = lastCall.get(host) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  lastCall.set(
    host,
    previous.then(() => mine),
  );
  await previous;
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'user-agent': `Memento/${APP_VERSION} (self-hosted personal app)`,
        accept: 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw unavailable();
    const value = (await res.json()) as T;
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return value;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw unavailable();
  } finally {
    setTimeout(release, 1100);
  }
}

/** A place proposed by the provider (not saved yet), or a remembered one (`id`). */
export interface PlaceCandidate extends PlaceInput {
  id?: string;
  distanceM: number | null;
  memorized: boolean;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
const TAG_KEYS = ['amenity', 'tourism', 'leisure', 'natural', 'historic', 'sport', 'shop'];

function fromOverpass(e: OverpassElement): PlaceInput | null {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  if (!t.name || lat === undefined || lng === undefined) return null;
  const key = TAG_KEYS.find((k) => t[k]) ?? 'other';
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return {
    name: t.name,
    category: categoryOf(key, t[key] ?? ''),
    lat,
    lng,
    address: [street, t['addr:postcode'], t['addr:city']].filter(Boolean).join(', '),
    city: t['addr:city'] ?? '',
    provider: 'osm',
    providerRef: `${e.type}/${e.id}`,
    website: t.website ?? t['contact:website'] ?? null,
    phone: t.phone ?? t['contact:phone'] ?? null,
  };
}

async function overpassAround(ctx: Ctx, lat: number, lng: number, radius: number): Promise<PlaceInput[]> {
  const s = getSettings(ctx);
  const around = `(around:${radius},${lat},${lng})`;
  const q = `[out:json][timeout:8];(${TAG_KEYS.map((k) => `nwr${around}["name"]["${k}"];`).join('')});out center tags 40;`;
  const json = await getJson<{ elements?: OverpassElement[] }>(s['places.overpass_url'], {
    method: 'POST',
    body: new URLSearchParams({ data: q }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  return (json.elements ?? []).map(fromOverpass).filter((p): p is PlaceInput => !!p);
}

interface NominatimReverse {
  osm_type?: string;
  osm_id?: number;
  name?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: Record<string, string>;
}
async function reverse(ctx: Ctx, lat: number, lng: number): Promise<PlaceInput[]> {
  const s = getSettings(ctx);
  const url = `${s['places.nominatim_url']}/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`;
  const r = await getJson<NominatimReverse>(url);
  if (!r?.address) return [];
  const a = r.address;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? '';
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const out: PlaceInput[] = [];
  if (street)
    out.push({
      name: [street, city].filter(Boolean).join(', '),
      category: 'address',
      lat: Number(r.lat ?? lat),
      lng: Number(r.lon ?? lng),
      address: [street, a.postcode, city].filter(Boolean).join(', '),
      city,
      provider: 'osm',
      providerRef: r.osm_type && r.osm_id ? `${r.osm_type}/${r.osm_id}` : null,
    });
  if (city)
    out.push({
      name: city,
      category: 'city',
      lat,
      lng,
      address: [a.postcode, city].filter(Boolean).join(' '),
      city,
      provider: 'osm',
      providerRef: `city/${city.toLowerCase()}`,
    });
  return out;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | number | undefined>;
}
async function photon(ctx: Ctx, q: string, near: { lat: number; lng: number } | null) {
  const s = getSettings(ctx);
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '';
  const json = await getJson<{ features?: PhotonFeature[] }>(
    `${s['places.photon_url']}/api/?q=${encodeURIComponent(q)}&limit=10&lang=fr${bias}`,
  );
  return (json.features ?? []).map((f): PlaceInput => {
    const p = f.properties;
    const str = (k: string) => (p[k] === undefined ? '' : String(p[k]));
    const street = [str('housenumber'), str('street')].filter(Boolean).join(' ');
    const type = { N: 'node', W: 'way', R: 'relation' }[str('osm_type')] ?? str('osm_type');
    return {
      name: str('name') || street || str('city'),
      category: categoryOf(str('osm_key'), str('osm_value')),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      address: [street, str('postcode'), str('city')].filter(Boolean).join(', '),
      city: str('city'),
      provider: 'osm',
      providerRef: p.osm_id !== undefined ? `${type}/${p.osm_id}` : null,
    };
  });
}

// ---------- Remembered places ----------
export function listPlaces(ctx: Ctx) {
  const rows = ctx.db.select().from(place).all();
  const used = new Map<string, number>();
  for (const r of [
    ...ctx.db.select({ p: souvenir.placeId }).from(souvenir).all(),
    ...ctx.db.select({ p: wish.placeId }).from(wish).all(),
  ])
    if (r.p) used.set(r.p, (used.get(r.p) ?? 0) + 1);
  return rows
    .map((p) => ({ ...p, uses: used.get(p.id) ?? 0 }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name, 'fr'));
}

export const getPlace = (ctx: Ctx, id: string) =>
  assertFound(ctx.db.select().from(place).where(eq(place.id, id)).get(), 'Lieu', id);

/** Saves a place once: the same provider reference gives back the place already remembered. */
export function savePlace(ctx: Ctx, input: PlaceInput): PlaceRow {
  return tx(ctx, () => {
    const provider = input.provider ?? 'manual';
    const ref = provider === 'manual' ? null : (input.providerRef ?? null);
    if (ref) {
      const found = ctx.db
        .select()
        .from(place)
        .all()
        .find((p) => p.provider === provider && p.providerRef === ref);
      if (found) return found;
    }
    const id = newId();
    ctx.db
      .insert(place)
      .values({
        id,
        createdBy: ctx.actor,
        name: input.name,
        category: input.category ?? 'other',
        lat: input.lat,
        lng: input.lng,
        address: input.address ?? '',
        city: input.city ?? '',
        provider,
        providerRef: ref,
        website: input.website ?? null,
        phone: input.phone ?? null,
      })
      .run();
    const row = getPlace(ctx, id);
    audit(ctx, 'place', id, 'create', null, row);
    return row;
  });
}

export function updatePlace(ctx: Ctx, id: string, patch: z.infer<typeof placePatch>) {
  return tx(ctx, () => {
    const before = getPlace(ctx, id);
    ctx.db
      .update(place)
      .set({ ...patch, updatedAt: ctxNowIso(ctx) })
      .where(eq(place.id, id))
      .run();
    const after = getPlace(ctx, id);
    audit(ctx, 'place', id, 'update', before, after);
    return after;
  });
}

/** A remembered place nobody uses any more can be forgotten. */
export function deletePlace(ctx: Ctx, id: string) {
  return tx(ctx, () => {
    const before = getPlace(ctx, id);
    if (listPlaces(ctx).find((p) => p.id === id)!.uses)
      throw new DomainError('PLACE_IN_USE', 'Ce lieu sert encore à un souvenir ou une envie.');
    ctx.db.delete(place).where(eq(place.id, id)).run();
    audit(ctx, 'place', id, 'delete', before, null);
    return { ok: true as const };
  });
}

const memorizedCandidate = (p: PlaceRow, from: { lat: number; lng: number } | null): PlaceCandidate => ({
  id: p.id,
  name: p.name,
  category: p.category,
  lat: p.lat,
  lng: p.lng,
  address: p.address,
  city: p.city,
  provider: p.provider,
  providerRef: p.providerRef,
  website: p.website,
  phone: p.phone,
  distanceM: from ? distanceM(from, p) : null,
  memorized: true,
});

/** The remembered place nearest to a point, within `radius` metres (a second visit needs no network). */
export function nearestMemorized(ctx: Ctx, at: { lat: number; lng: number }, radius = 50) {
  return (
    ctx.db
      .select()
      .from(place)
      .all()
      .map((p) => ({ p, d: distanceM(at, p) }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d)[0]?.p ?? null
  );
}

const rank = (c: PlaceCandidate) => (c.distanceM ?? 0) * (OUTING.has(c.category ?? 'other') ? 1 : 3);

/**
 * EX-13 « du point au nom »: the named places within 50 m (150 m when there is none), nearest and most likely
 * first (an outing before a shop), remembered ones included; then the address, then the town. The first one is
 * the default choice (CE-05).
 */
export async function placesNearby(ctx: Ctx, lat: number, lng: number, radius?: number) {
  const at = { lat, lng };
  const memorized = ctx.db
    .select()
    .from(place)
    .all()
    .map((p) => memorizedCandidate(p, at))
    .filter((c) => (c.distanceM ?? 0) <= (radius ?? 150));
  const known = new Set(memorized.map((m) => `${m.provider}:${m.providerRef}`));
  let found: PlaceCandidate[] = [];
  let providerError: string | null = null;
  if (getSettings(ctx)['places.provider'] === 'osm') {
    try {
      for (const r of radius ? [radius] : [50, 150]) {
        const named = await overpassAround(ctx, lat, lng, r);
        found = named.map((p) => ({ ...p, distanceM: distanceM(at, p), memorized: false }));
        if (found.length) break;
      }
      found.sort((a, b) => rank(a) - rank(b));
      if (!found.length)
        found = (await reverse(ctx, lat, lng)).map((p) => ({
          ...p,
          distanceM: distanceM(at, p),
          memorized: false,
        }));
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      providerError = e.code;
    }
  }
  const candidates = [
    ...memorized.sort((a, b) => rank(a) - rank(b)),
    ...found.filter((c) => !known.has(`${c.provider}:${c.providerRef}`)),
  ];
  return { point: at, candidates, providerError };
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * EX-13 « du nom au lieu »: one knows the name of a place, not its address (« BAM Albi », CE-06). Remembered
 * places whose name matches first, then the provider's answers around the photo, or else around the home.
 */
export async function searchPlaces(ctx: Ctx, q: string, near?: { lat: number; lng: number } | null) {
  const home = getSettings(ctx)['places.home'];
  const center = near ?? (home ? { lat: home.lat, lng: home.lng } : null);
  const words = fold(q).split(/\s+/).filter(Boolean);
  const memorized = ctx.db
    .select()
    .from(place)
    .all()
    .filter((p) => {
      const hay = fold(`${p.name} ${p.city} ${p.address}`);
      return words.every((w) => hay.includes(w));
    })
    .map((p) => memorizedCandidate(p, center));
  const known = new Set(memorized.map((m) => `${m.provider}:${m.providerRef}`));
  let found: PlaceCandidate[] = [];
  let providerError: string | null = null;
  if (getSettings(ctx)['places.provider'] === 'osm') {
    try {
      found = (await photon(ctx, q, center)).map((p) => ({
        ...p,
        distanceM: center ? distanceM(center, p) : null,
        memorized: false,
      }));
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      providerError = e.code;
    }
  }
  return {
    candidates: [...memorized, ...found.filter((c) => !known.has(`${c.provider}:${c.providerRef}`))],
    providerError,
  };
}

/** A candidate as a remembered place: the existing one, or saved now. */
export function placeFromCandidate(ctx: Ctx, c: PlaceInput & { id?: string }): PlaceRow {
  return c.id ? getPlace(ctx, c.id) : savePlace(ctx, c);
}
