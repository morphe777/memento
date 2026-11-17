// Helpers of the souvenir tests: JPEG pictures with EXIF (date, GPS), a fake network (OSM, pages), a photos folder.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { vi } from 'vitest';
import { clearPlacesCache, setUrlLookup } from '../src/index.ts';
import { makeCtx } from './helpers.ts';

const rational = (deg: number) => {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60 * 10000);
  return `${d}/1 ${m}/1 ${s}/10000`;
};

/** A JPEG as a phone takes it: shot time (Paris wall clock, EXIF style) and position. */
export async function jpeg(
  o: { at?: string; lat?: number; lng?: number; w?: number; h?: number; color?: string } = {},
) {
  const exif: Record<string, Record<string, string>> = { IFD0: { Make: 'Test' } };
  if (o.at) exif.IFD2 = { DateTimeOriginal: o.at.replace('T', ' ').replace(/-/g, ':').slice(0, 19) };
  if (o.lat !== undefined && o.lng !== undefined)
    exif.IFD3 = {
      GPSLatitudeRef: o.lat >= 0 ? 'N' : 'S',
      GPSLatitude: rational(o.lat),
      GPSLongitudeRef: o.lng >= 0 ? 'E' : 'W',
      GPSLongitude: rational(o.lng),
    };
  return sharp({
    create: { width: o.w ?? 1200, height: o.h ?? 900, channels: 3, background: o.color ?? '#B8487A' },
  })
    .jpeg({ quality: 85 })
    .withExif(exif)
    .toBuffer();
}

/** A fictional restaurant (« Chez Lucette », in the fictional town of Valbourg) and its neighbours. */
export const LUCETTE = { lat: 46.5, lng: 3.0 };
export const overpassAroundLucette = {
  elements: [
    { type: 'node', id: 2, lat: 46.50028, lon: 3.00038, tags: { name: 'Café du Marché', amenity: 'cafe' } },
    {
      type: 'node',
      id: 1,
      lat: 46.50008,
      lon: 3.00012,
      tags: {
        name: 'Chez Lucette',
        amenity: 'restaurant',
        'addr:street': 'Place du Marché',
        'addr:city': 'Valbourg',
      },
    },
    // Nearer, but a shop: an outing is preferred at a similar distance (CE-05).
    {
      type: 'node',
      id: 3,
      lat: 46.50005,
      lon: 3.00006,
      tags: { name: 'Tabac de la Place', shop: 'tobacco' },
    },
  ],
};
export const photonLucette = {
  features: [
    {
      geometry: { coordinates: [3.00012, 46.50008] },
      properties: {
        osm_type: 'N',
        osm_id: 1,
        osm_key: 'amenity',
        osm_value: 'restaurant',
        name: 'Chez Lucette',
        city: 'Valbourg',
        street: 'Place du Marché',
      },
    },
  ],
};

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

/** The network of the tests: each call goes to the first route that answers, else 404. DNS: public. */
export function stubNetwork(...routes: Route[]) {
  const calls: string[] = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    for (const r of routes) {
      const res = await r(url, init);
      if (res) return res;
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  setUrlLookup(async (host) => [{ address: host.startsWith('intranet') ? '192.168.1.10' : '93.184.216.34' }]);
  return calls;
}

export const osmRoutes: Route = (url) => {
  if (url.includes('overpass')) return json(overpassAroundLucette);
  if (url.includes('photon')) return json(photonLucette);
  if (url.includes('nominatim'))
    return json({ address: { road: 'Place du Marché', city: 'Valbourg', postcode: '99000' } });
  return undefined;
};

export function resetNetwork() {
  vi.unstubAllGlobals();
  setUrlLookup(null);
  clearPlacesCache();
}

/** A seeded database at a fixed time, with a fresh photos folder. */
export function souvenirCtx(at = '2026-11-17T10:00:00.000Z') {
  const ctx = makeCtx(at);
  ctx.photosDir = mkdtempSync(join(tmpdir(), 'memento-photos-'));
  return ctx;
}
