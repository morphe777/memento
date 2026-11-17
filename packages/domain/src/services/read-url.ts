// EXA-08 / D-164: reads a shared page to pre-fill an envie (D-171): Open Graph, JSON-LD (schema.org Event, Place,
// Restaurant…), and the links of Google Maps and Apple Plans. The server fetches what the user shared, so the
// address is checked first (SSRF): http(s) only, a public address only (never the homelab network), at most 4
// redirects (each one checked), 8 s, 3 MB of HTML. An unreadable page never blocks: the envie keeps the URL.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { DomainError } from '../errors.ts';
import { parisDate } from '../time.ts';
import { APP_VERSION } from '../version.ts';

type Lookup = (host: string) => Promise<{ address: string }[]>;
const deps: { lookup: Lookup } = {
  lookup: (host) => dnsLookup(host, { all: true }),
};
/** Tests: a fake resolver (no DNS). */
export function setUrlLookup(fn: Lookup | null) {
  deps.lookup = fn ?? ((host) => dnsLookup(host, { all: true }));
}

const unreadable = (why: string) => new DomainError('URL_UNREADABLE', `Page illisible : ${why}.`);

/** Private, loopback, link-local, CGNAT, multicast… addresses: never fetched from the server. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  return (
    v === '::' ||
    v === '::1' ||
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('fe8') ||
    v.startsWith('ff')
  );
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw unreadable('adresse non web');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal'))
    throw unreadable('adresse du réseau local');
  const addresses = isIP(host) ? [{ address: host }] : await deps.lookup(host).catch(() => []);
  if (!addresses.length) throw unreadable('site introuvable');
  if (addresses.some((a) => isPrivateAddress(a.address))) throw unreadable('adresse du réseau local');
}

/** Fetches a public URL (redirects followed by hand, each checked), with a size cap. */
export async function safeFetch(
  raw: string,
  opts: { maxBytes: number; accept: string },
): Promise<{ finalUrl: string; contentType: string; body: Buffer }> {
  let url = new URL(raw);
  for (let hop = 0; hop <= 4; hop++) {
    await assertPublic(url);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        headers: {
          'user-agent': `Mozilla/5.0 (compatible; Memento/${APP_VERSION}; personal app)`,
          accept: opts.accept,
          'accept-language': 'fr-FR,fr;q=0.9,en;q=0.5',
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw unreadable('site injoignable');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (!res.ok) throw unreadable(`réponse ${res.status}`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > opts.maxBytes) {
        await reader.cancel();
        throw unreadable('page trop lourde');
      }
      chunks.push(value);
    }
    return {
      finalUrl: url.toString(),
      contentType: res.headers.get('content-type') ?? '',
      body: Buffer.concat(chunks),
    };
  }
  throw unreadable('trop de redirections');
}

// ---------- HTML ----------
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  icirc: 'î',
  iuml: 'ï',
  ocirc: 'ô',
  ugrave: 'ù',
  ucirc: 'û',
  oelig: 'œ',
  Eacute: 'É',
  rsquo: '’',
  lsquo: '‘',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  euro: '€',
  deg: '°',
};
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
      );
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });

function metaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (n: string) =>
      tag
        .match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
        ?.slice(2)
        .find((x) => x !== undefined);
    const k = (attr('property') ?? attr('name') ?? '').toLowerCase();
    const v = attr('content');
    if (k && v !== undefined && !(k in out)) out[k] = decodeEntities(v).trim();
  }
  return out;
}

type Json = Record<string, unknown>;
function jsonLdNodes(html: string): Json[] {
  const nodes: Json[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      const o = x as Json;
      if (Array.isArray(o['@graph'])) walk(o['@graph']);
      if (o['@type']) nodes.push(o);
    }
  };
  for (const m of html.matchAll(
    /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // A broken JSON-LD block is skipped: the Open Graph tags still pre-fill the envie (CE-31).
    }
  }
  return nodes;
}

const types = (n: Json) => [n['@type']].flat().map(String);
const isEvent = (n: Json) => types(n).some((t) => /Event$|Festival/.test(t));
const NOT_PLACE =
  /^(Organization|WebSite|WebPage|BreadcrumbList|Person|ImageObject|SearchAction|ItemList|Offer|Product|Article|NewsArticle|BlogPosting)$/;
const isPlace = (n: Json) =>
  !isEvent(n) && !types(n).every((t) => NOT_PLACE.test(t)) && (!!n.geo || !!n.address);
const str = (x: unknown): string | null =>
  typeof x === 'string' && x.trim() ? decodeEntities(x.trim()) : null;
const imageOf = (x: unknown): string | null =>
  str(x) ?? (Array.isArray(x) ? imageOf(x[0]) : x && typeof x === 'object' ? str((x as Json).url) : null);

/** A day from a schema.org date (« 2026-12-12T20:30:00+01:00 » or « 2026-12-12 »), Paris time. */
function dayOf(x: unknown): string | null {
  const s = str(x);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : parisDate(new Date(t));
}

export interface ParsedPlace {
  name: string | null;
  lat: number | null;
  lng: number | null;
  address: string;
  city: string;
}
function placeOf(x: unknown): ParsedPlace | null {
  if (!x) return null;
  if (typeof x === 'string') return { name: str(x), lat: null, lng: null, address: '', city: '' };
  const o = (Array.isArray(x) ? x[0] : x) as Json;
  const a = o.address;
  const addr = typeof a === 'string' ? { streetAddress: a } : ((a as Json | undefined) ?? {});
  const city = str(addr.addressLocality) ?? '';
  const geo = (o.geo ?? {}) as Json;
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
  const lat = num(geo.latitude);
  const lng = num(geo.longitude);
  return {
    name: str(o.name),
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lng: lng !== null && Number.isFinite(lng) ? lng : null,
    address: [str(addr.streetAddress), str(addr.postalCode), city].filter(Boolean).join(', '),
    city,
  };
}
function priceOf(x: unknown): string | null {
  const offers = [x].flat().filter(Boolean) as Json[];
  const parts = offers
    .map((o) => {
      const p = o.price ?? o.lowPrice;
      if (p === undefined || p === null || p === '') return null;
      const cur = str(o.priceCurrency) ?? 'EUR';
      const n = String(p).replace('.', ',');
      return cur === 'EUR' ? `${n} €` : `${n} ${cur}`;
    })
    .filter(Boolean);
  return parts.length ? [...new Set(parts)].join(' · ') : null;
}

export interface ParsedPage {
  url: string;
  finalUrl: string;
  kind: 'event' | 'place' | 'page' | 'maps';
  readable: boolean;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  price: string | null;
  place: ParsedPlace | null;
  /** What was read (Open Graph and schema.org nodes), (what was understood). */
  meta: Json;
}

/** Google Maps and Apple Plans links: a name and coordinates from the address itself (no page to read). */
export function parseMapsUrl(raw: string): ParsedPlace | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  const num = (s: string | undefined | null) => (s && Number.isFinite(Number(s)) ? Number(s) : null);
  const pair = (s: string | null) => {
    const m = s?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
  };
  if (
    /^(maps\.)?google\.[a-z.]+$/.test(host) &&
    (u.pathname.startsWith('/maps') || host.startsWith('maps.'))
  ) {
    const path = decodeURIComponent(u.pathname);
    const name = path.match(/\/place\/([^/]+)/)?.[1]?.replace(/\+/g, ' ') ?? null;
    const precise = path.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const at = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    const q = u.searchParams.get('q') ?? u.searchParams.get('query');
    const qPair = pair(q);
    const lat = num(precise?.[1]) ?? qPair?.lat ?? num(at?.[1]);
    const lng = num(precise?.[2]) ?? qPair?.lng ?? num(at?.[2]);
    const label = name ?? (q && !qPair ? q : null);
    if (lat === null && !label) return null;
    return { name: label, lat, lng, address: '', city: '' };
  }
  if (host === 'maps.apple.com' || host === 'maps.apple') {
    const p = u.searchParams;
    const c = pair(p.get('coordinate')) ?? pair(p.get('ll')) ?? pair(p.get('sll'));
    const name = p.get('name') ?? p.get('q') ?? null;
    if (!c && !name) return null;
    return { name, lat: c?.lat ?? null, lng: c?.lng ?? null, address: p.get('address') ?? '', city: '' };
  }
  return null;
}

export function parseHtml(url: string, finalUrl: string, html: string): ParsedPage {
  const og = metaTags(html);
  const nodes = jsonLdNodes(html);
  const event = nodes.find(isEvent);
  const placeNode = nodes.find(isPlace);
  const titleTag = str(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' '));
  const node = event ?? placeNode;
  const title = str(node?.name) ?? og['og:title'] ?? og['twitter:title'] ?? titleTag;
  const place = event ? placeOf(event.location) : placeNode ? placeOf(placeNode) : null;
  let imageUrl: string | null =
    imageOf(node?.image) ?? og['og:image'] ?? og['og:image:url'] ?? og['twitter:image'] ?? null;
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, finalUrl).toString();
    } catch {
      imageUrl = null;
    }
  }
  return {
    url,
    finalUrl,
    kind: event ? 'event' : placeNode ? 'place' : 'page',
    readable: !!title,
    title: title ? title.slice(0, 200) : null,
    description:
      (str(node?.description) ?? og['og:description'] ?? og.description ?? null)?.slice(0, 1000) ?? null,
    siteName: og['og:site_name'] ?? new URL(finalUrl).hostname.replace(/^www\./, ''),
    imageUrl,
    startDate: event ? dayOf(event.startDate) : null,
    endDate: event ? dayOf(event.endDate) : null,
    price: event ? priceOf(event.offers) : (str(placeNode?.priceRange) ?? null),
    place,
    meta: { og, jsonLd: nodes.slice(0, 10) },
  };
}

/** EXA-08: a shared URL, read. Never throws for an unreadable page: `readable` is false and the URL stays. */
export async function readUrl(url: string): Promise<ParsedPage & { error: string | null }> {
  const maps = parseMapsUrl(url);
  const empty = (finalUrl: string, error: string | null): ParsedPage & { error: string | null } => ({
    url,
    finalUrl,
    kind: maps ? 'maps' : 'page',
    readable: !!maps?.name,
    title: maps?.name ?? null,
    description: null,
    siteName: new URL(finalUrl).hostname.replace(/^www\./, ''),
    imageUrl: null,
    startDate: null,
    endDate: null,
    price: null,
    place: maps,
    meta: {},
    error,
  });
  if (maps) return empty(url, null);
  try {
    const res = await safeFetch(url, {
      maxBytes: 3 * 1024 * 1024,
      accept: 'text/html,application/xhtml+xml',
    });
    // A short link of Google Maps or Plans lands on the real address: read it.
    const landed = parseMapsUrl(res.finalUrl);
    if (landed)
      return {
        ...empty(res.finalUrl, null),
        place: landed,
        title: landed.name,
        readable: !!landed.name,
        kind: 'maps',
      };
    if (!/html|xml/i.test(res.contentType) && res.contentType) return empty(res.finalUrl, 'URL_UNREADABLE');
    return { ...parseHtml(url, res.finalUrl, res.body.toString('utf8')), error: null };
  } catch (e) {
    if (e instanceof DomainError && e.code === 'URL_UNREADABLE') return empty(url, e.code);
    throw e;
  }
}
