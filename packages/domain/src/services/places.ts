// EX-13 / D-161: places by their name, never by their coordinates. Memento relays OpenStreetMap (Overpass for
// the named places near a point, Photon for a search by name, Nominatim for the address when nothing is named),
// with a cache and one request per second and per host (Nominatim's rule). A chosen place is saved once and
// reused: one provider reference = one place (souvenirs, the future activity engine).
import { eq, schema } from '@memento/db';
import type { z } from 'zod';
import { audit, type Ctx, ctxNowIso, newId, tx } from '../context.ts';
import { assertFound, DomainError } from '../errors.ts';
import type { placeInput, placePatch } from '../schemas-souvenirs.ts';
import { getSettings } from '../settings.ts';
import { APP_VERSION } from '../version.ts';

const { place, souvenir } = schema;
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
  'home',
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

async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
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
      signal: AbortSignal.timeout(timeoutMs),
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
  // The public Overpass is often slow: 6 s, then Photon answers instead (D-169).
  const json = await getJson<{ elements?: OverpassElement[] }>(
    s['places.overpass_url'],
    {
      method: 'POST',
      body: new URLSearchParams({ data: q }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    },
    6_000,
  );
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
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
/** Letters and digits only: « Bam'Bam », « bam bam » and « BAMBAM » read the same. */
const compact = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');
/**
 * D-172: an answer holds the typed words when each of them is in its name or address (accents, case and
 * punctuation aside). Photon also answers approximately (typos), which gives an answer to anything.
 */
function holdsWords(q: string, p: { name: string; city?: string | null; address?: string | null }) {
  const hay = compact(`${p.name} ${p.city ?? ''} ${p.address ?? ''}`);
  return fold(q)
    .split(/\s+/)
    .map(compact)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/** D-171: the region searched first around the photo (or the home), about 100 km each way. */
const REGION_M = 100_000;

async function photon(ctx: Ctx, q: string, near: { lat: number; lng: number } | null) {
  const s = getSettings(ctx);
  const ask = async (extra: string) =>
    fromPhoton(
      (
        await getJson<{ features?: PhotonFeature[] }>(
          `${s['places.photon_url']}/api/?q=${encodeURIComponent(q)}&limit=15&lang=fr${extra}`,
        )
      ).features ?? [],
    );
  if (!near) return ask('');
  // D-169: a pull towards the point; D-171: the region first (a far exact name ranks before a near one
  // otherwise); D-172: the whole world only when no answer of the region holds the typed words.
  const bias = `&lat=${near.lat}&lon=${near.lng}&zoom=12&location_bias_scale=0.1`;
  const dLat = 0.9;
  const dLng = dLat / Math.max(0.2, Math.cos((near.lat * Math.PI) / 180));
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const box = `&bbox=${r(near.lng - dLng)},${r(near.lat - dLat)},${r(near.lng + dLng)},${r(near.lat + dLat)}`;
  const region = await ask(bias + box);
  if (region.some((p) => holdsWords(q, p))) return region;
  const seen = new Set(region.map((p) => `${p.provider}:${p.providerRef}`));
  return [...region, ...(await ask(bias)).filter((p) => !seen.has(`${p.provider}:${p.providerRef}`))];
}

/** D-169: the places around a point when Overpass does not answer (Photon reverse, 150 m). */
async function photonAround(ctx: Ctx, lat: number, lng: number) {
  const s = getSettings(ctx);
  const json = await getJson<{ features?: PhotonFeature[] }>(
    `${s['places.photon_url']}/reverse?lat=${lat}&lon=${lng}&radius=0.15&limit=15&lang=fr`,
  );
  return fromPhoton(json.features ?? []).filter((p) => p.category !== 'address' && p.category !== 'city');
}

function fromPhoton(features: PhotonFeature[]): PlaceInput[] {
  return features.map((f): PlaceInput => {
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
  for (const r of [...ctx.db.select({ p: souvenir.placeId }).from(souvenir).all()])
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
    // One provider reference = one place; by hand (D-173), the same name at the same point = one place.
    const found = ctx.db
      .select()
      .from(place)
      .all()
      .find((p) =>
        ref
          ? p.provider === provider && p.providerRef === ref
          : provider === 'manual' &&
            p.provider === 'manual' &&
            p.name === input.name &&
            p.lat === input.lat &&
            p.lng === input.lng,
      );
    if (found) return found;
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

/** D-173: a photo taken this close to the home is « at home ». */
export const HOME_M = 100;

/**
 * D-173: « Maison » (the name chosen in Configuration) when the point is within 100 m of the home: the place
 * remembered for this home and this name, else a new one to save. A move or another name gives another place;
 * the souvenirs keep the one of their time.
 */
export function homeCandidate(ctx: Ctx, at: { lat: number; lng: number }): PlaceCandidate | null {
  const home = getSettings(ctx)['places.home'];
  if (!home || distanceM(at, home) > HOME_M) return null;
  const name = home.label || 'Maison';
  const kept = ctx.db
    .select()
    .from(place)
    .all()
    .find((p) => p.provider === 'manual' && p.name === name && p.lat === home.lat && p.lng === home.lng);
  if (kept) return memorizedCandidate(kept, at);
  return {
    name,
    category: 'home',
    lat: home.lat,
    lng: home.lng,
    address: home.address ?? '',
    city: '',
    provider: 'manual',
    providerRef: null,
    distanceM: distanceM(at, home),
    memorized: false,
  };
}

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
 * EX-13 « du point au nom »: the home (D-173), then the named places within 50 m (150 m when there is none),
 * nearest and most likely first (an outing before a shop), remembered ones included; then the address, then the
 * town. Proposed, never chosen for the user (D-173), except the home at the capture.
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
    const near = (list: PlaceInput[]) =>
      list.map((p) => ({ ...p, distanceM: distanceM(at, p), memorized: false }));
    // D-169: named places from Overpass, or from Photon when Overpass does not answer; none: address, then town.
    const named = async () => {
      try {
        for (const r of radius ? [radius] : [50, 150]) {
          const list = await overpassAround(ctx, lat, lng, r);
          if (list.length) return list;
        }
        return [];
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        return photonAround(ctx, lat, lng);
      }
    };
    try {
      found = near(await named()).sort((a, b) => rank(a) - rank(b));
      if (!found.length) found = near(await reverse(ctx, lat, lng));
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      providerError = e.code;
    }
  }
  // D-173: the home first when the point is there.
  const home = homeCandidate(ctx, at);
  const candidates = [
    ...(home ? [home] : []),
    ...memorized.filter((m) => m.id !== home?.id).sort((a, b) => rank(a) - rank(b)),
    ...found.filter((c) => !known.has(`${c.provider}:${c.providerRef}`)),
  ];
  return { point: at, candidates, providerError };
}

/**
 * EX-13 « du nom au lieu »: one knows the name of a place, not its address (« BAM Albi », CE-06), around the
 * photos, or else around the home. D-171, D-172: in the region (~100 km), remembered places and answers holding
 * the typed words first, then the approximate answers; from farther away, only those holding the words.
 */
export async function searchPlaces(ctx: Ctx, q: string, near?: { lat: number; lng: number } | null) {
  const home = getSettings(ctx)['places.home'];
  const center = near ?? (home ? { lat: home.lat, lng: home.lng } : null);
  const memorized = ctx.db
    .select()
    .from(place)
    .all()
    .filter((p) => holdsWords(q, p))
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
  const all = [...memorized, ...found.filter((c) => !known.has(`${c.provider}:${c.providerRef}`))];
  const inRegion = (c: PlaceCandidate) => !center || (c.distanceM ?? Infinity) <= REGION_M;
  const holds = (c: PlaceCandidate) => c.memorized || holdsWords(q, c);
  return {
    candidates: [
      ...all.filter((c) => inRegion(c) && holds(c)),
      ...all.filter((c) => inRegion(c) && !holds(c)),
      ...all.filter((c) => !inRegion(c) && holds(c)),
    ],
    providerError,
  };
}

/** A candidate as a remembered place: the existing one, or saved now. */
export function placeFromCandidate(ctx: Ctx, c: PlaceInput & { id?: string }): PlaceRow {
  return c.id ? getPlace(ctx, c.id) : savePlace(ctx, c);
}
