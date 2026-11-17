// D-171: the envies (the reserve of experience tasks) filled from a shared page or place (CE-30 to CE-32), and the
// page reader (EXA-08, SSRF guard). Fictional data only: the « Théâtre des Tilleuls » of Valbourg, « Chez Lucette ».
import { afterEach, describe, expect, it } from 'vitest';
import {
  getExperiencesPage,
  getTask,
  ideaFromPlace,
  ideaFromUrl,
  isPrivateAddress,
  parseHtml,
  parseMapsUrl,
  readUrl,
} from '../src/index.ts';
import { lookups } from './helpers.ts';
import { html, LUCETTE, osmRoutes, resetNetwork, souvenirCtx, stubNetwork } from './souvenirs-helpers.ts';

afterEach(resetNetwork);

const EVENT_PAGE = `<!doctype html><html><head>
<title>Le Petit Prince | Théâtre des Tilleuls</title>
<meta property="og:title" content="Le Petit Prince &amp; ses amis">
<meta property="og:image" content="/img/affiche.jpg">
<meta property="og:site_name" content="Théâtre des Tilleuls">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","name":"Théâtre des Tilleuls"},
 {"@type":"TheaterEvent","name":"Le Petit Prince","startDate":"2026-12-12T20:30:00+01:00","endDate":"2026-12-14T17:00:00+01:00",
  "image":["https://theatre.example.org/img/affiche.jpg"],
  "location":{"@type":"Place","name":"Théâtre des Tilleuls","address":{"@type":"PostalAddress","streetAddress":"2 rue des Tilleuls","postalCode":"99000","addressLocality":"Valbourg"},
   "geo":{"@type":"GeoCoordinates","latitude":46.51,"longitude":3.02}},
  "offers":[{"@type":"Offer","price":"12","priceCurrency":"EUR"},{"@type":"Offer","price":8,"priceCurrency":"EUR"}]}
]}</script></head><body>…</body></html>`;

describe('page reader (EXA-08)', () => {
  it('CE-30: an event page gives its title, dates, place, price and image (JSON-LD before Open Graph)', () => {
    const p = parseHtml(
      'https://theatre.example.org/petit-prince',
      'https://theatre.example.org/petit-prince',
      EVENT_PAGE,
    );
    expect(p).toMatchObject({
      kind: 'event',
      readable: true,
      title: 'Le Petit Prince',
      startDate: '2026-12-12',
      endDate: '2026-12-14',
      price: '12 € · 8 €',
      imageUrl: 'https://theatre.example.org/img/affiche.jpg',
      place: { name: 'Théâtre des Tilleuls', lat: 46.51, lng: 3.02, city: 'Valbourg' },
    });
  });
  it('Open Graph alone (a plain page), entities decoded, relative image made absolute', () => {
    const p = parseHtml(
      'https://blog.example.org/a',
      'https://blog.example.org/a',
      `<meta content="Balade &#233;t&eacute;" property="og:title"><meta property="og:image" content="/i.png">`,
    );
    expect(p).toMatchObject({
      kind: 'page',
      title: 'Balade été',
      imageUrl: 'https://blog.example.org/i.png',
    });
  });
  it('Google Maps and Apple Plans links give a name and coordinates', () => {
    expect(
      parseMapsUrl(
        'https://www.google.com/maps/place/Chez+Lucette/@46.5001,3.0001,17z/data=!3d46.50008!4d3.00012',
      ),
    ).toMatchObject({ name: 'Chez Lucette', lat: 46.50008, lng: 3.00012 });
    expect(parseMapsUrl('https://maps.apple.com/?ll=46.5,3.0&q=Chez%20Lucette')).toMatchObject({
      name: 'Chez Lucette',
      lat: 46.5,
      lng: 3,
    });
    expect(parseMapsUrl('https://example.org/maps')).toBeNull();
  });
  it('SSRF: never the homelab network (private address, localhost, .lan), never another scheme', async () => {
    for (const ip of [
      '10.0.0.1',
      '192.168.1.10',
      '127.0.0.1',
      '169.254.1.1',
      '172.20.0.1',
      '::1',
      'fd00::1',
      '::ffff:192.168.0.1',
    ])
      expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    const calls = stubNetwork(() => html(EVENT_PAGE));
    for (const url of [
      'http://intranet.example.org/',
      'http://localhost:4500/api/v1/export',
      'http://nas.lan/',
      'http://192.168.1.1/',
    ])
      expect(await readUrl(url)).toMatchObject({ readable: false, error: 'URL_UNREADABLE' });
    expect(calls).toEqual([]);
  });
  it('SSRF: a redirect towards the local network is refused too', async () => {
    const calls = stubNetwork((url) =>
      url.startsWith('https://short.example.org')
        ? new Response(null, { status: 302, headers: { location: 'http://intranet.example.org/admin' } })
        : html(EVENT_PAGE),
    );
    expect(await readUrl('https://short.example.org/x')).toMatchObject({
      readable: false,
      error: 'URL_UNREADABLE',
    });
    expect(calls).toEqual(['https://short.example.org/x']);
  });
});

describe('envies from a share (D-171)', () => {
  it('CE-30: a shared event page becomes an envie in Famille: title, then text, link, dates, price, place', async () => {
    const ctx = souvenirCtx();
    stubNetwork((url) => (url.startsWith('https://theatre.example.org') ? html(EVENT_PAGE) : undefined));
    const { task, warnings } = await ideaFromUrl(ctx, 'https://theatre.example.org/petit-prince');
    expect(warnings).toEqual([]);
    const t = getTask(ctx, task.id);
    expect(t).toMatchObject({
      title: 'Le Petit Prince',
      isExperience: true,
      projectId: null,
      dueDate: null,
      durationMin: null,
      domainId: lookups(ctx).domain('Famille').id,
    });
    expect(t.description).toContain('https://theatre.example.org/petit-prince');
    expect(t.description).toContain('Dates : 12 décembre 2026 → 14 décembre 2026');
    expect(t.description).toContain('Prix : 12 € · 8 €');
    expect(t.description).toContain('Lieu : Théâtre des Tilleuls');
    expect(getExperiencesPage(ctx).reserve.map((r) => r.title)).toEqual(['Le Petit Prince']);
  });
  it('CE-31: an unreadable page still gives an envie (the link, a title to confirm)', async () => {
    const ctx = souvenirCtx();
    stubNetwork(() => new Response('login required', { status: 403 }));
    const { task, warnings } = await ideaFromUrl(ctx, 'https://www.social.example.com/p/abc');
    expect(warnings).toEqual(['URL_UNREADABLE']);
    expect(getTask(ctx, task.id)).toMatchObject({
      title: 'social.example.com (à confirmer)',
      description: 'https://www.social.example.com/p/abc',
    });
  });
  it('CE-32: a place shared from Plans: its name and a map link; without a name, the named place there', async () => {
    const ctx = souvenirCtx();
    const calls = stubNetwork(osmRoutes);
    const named = await ideaFromPlace(ctx, { lat: 46.50008, lng: 3.00012, name: 'Chez Lucette' });
    expect(getTask(ctx, named.task.id).title).toBe('Chez Lucette');
    expect(getTask(ctx, named.task.id).description).toContain(
      'openstreetmap.org/?mlat=46.50008&mlon=3.00012',
    );
    expect(calls).toEqual([]);
    const found = await ideaFromPlace(ctx, LUCETTE);
    expect(getTask(ctx, found.task.id)).toMatchObject({ title: 'Chez Lucette', isExperience: true });
  });
});
