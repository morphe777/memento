// memento-experiences: wishes (CE-30 to CE-35, QE-08, D-164, D-165) and the page reader (SSRF guard).
// Fictional data only: the « Théâtre des Tilleuls » of Valbourg, « Chez Lucette ».
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeTask,
  createPerson,
  createWish,
  createWishFromPlace,
  createWishFromUrl,
  getWish,
  isPrivateAddress,
  listWishes,
  listWishLists,
  parseHtml,
  parseMapsUrl,
  patchSettings,
  planWish,
  readUrl,
  updateWish,
} from '../src/index.ts';
import { getPlanningPage } from '../src/services/planning.ts';
import { lookups } from './helpers.ts';
import {
  html,
  jpeg,
  LUCETTE,
  osmRoutes,
  resetNetwork,
  souvenirCtx,
  stubNetwork,
} from './souvenirs-helpers.ts';

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

describe('wishes (EX-40, EX-41)', () => {
  it('six default lists, once', () => {
    const ctx = souvenirCtx();
    expect(listWishLists(ctx).map((l) => l.name)).toEqual([
      'Restaurants',
      'Lieux à visiter',
      'Spectacles et événements',
      'Nature et balades',
      'Activités et sport',
      'Week-ends et voyages',
    ]);
  });

  it('CE-33: « + Envie » with a title alone', async () => {
    const ctx = souvenirCtx();
    const w = await createWish(ctx, { title: 'Baptême de plongée' });
    expect(w).toMatchObject({
      title: 'Baptême de plongée',
      status: 'wish',
      listId: null,
      dogAllowed: 'unknown',
    });
  });

  it('CE-30: a shared event page becomes a wish, in « Spectacles », with its image stored here', async () => {
    const ctx = souvenirCtx();
    const image = await jpeg({ w: 1600, h: 900 });
    stubNetwork(
      (url) =>
        url.endsWith('affiche.jpg')
          ? new Response(image, { headers: { 'content-type': 'image/jpeg' } })
          : undefined,
      (url) => (url.startsWith('https://theatre.example.org') ? html(EVENT_PAGE) : undefined),
    );
    const { wish: w, warnings } = await createWishFromUrl(ctx, 'https://theatre.example.org/petit-prince');
    expect(warnings).toEqual([]);
    expect(w).toMatchObject({
      title: 'Le Petit Prince',
      listName: 'Spectacles et événements',
      startDate: '2026-12-12',
      endDate: '2026-12-14',
      price: '12 € · 8 €',
      hasImage: true,
      source: 'share_url',
      url: 'https://theatre.example.org/petit-prince',
      place: { name: 'Théâtre des Tilleuls', city: 'Valbourg' },
    });
  });

  it('CE-31: an unreadable page still gives a wish (URL and a title to confirm)', async () => {
    const ctx = souvenirCtx();
    stubNetwork(() => new Response('login required', { status: 403 }));
    const { wish: w, warnings } = await createWishFromUrl(ctx, 'https://www.social.example.com/p/abc');
    expect(warnings).toEqual(['URL_UNREADABLE']);
    expect(w).toMatchObject({
      title: 'social.example.com (à confirmer)',
      url: 'https://www.social.example.com/p/abc',
    });
  });

  it('CE-32: a place shared from Plans gives a wish with the named place, in « Restaurants »', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const { wish: w } = await createWishFromPlace(ctx, { lat: 46.50008, lng: 3.00012, name: 'Chez Lucette' });
    expect(w).toMatchObject({
      title: 'Chez Lucette',
      listName: 'Restaurants',
      source: 'share_place',
      place: { name: 'Chez Lucette', category: 'restaurant' },
    });
  });

  it("CE-34: « Planifier » creates a dated experience in that week's plan; checking it makes the wish lived", async () => {
    const ctx = souvenirCtx();
    const { domain } = lookups(ctx);
    const alice = createPerson(ctx, { name: 'Alice', group: 'family' });
    const w = await createWish(ctx, { title: 'Le Petit Prince', durationMin: 120, personIds: [alice.id] });
    const planned = planWish(ctx, w.id, '2026-11-20');
    expect(planned).toMatchObject({ status: 'planned', plannedTask: { dueDate: '2026-11-20' } });
    const page = getPlanningPage(ctx, '2026-W47');
    const item = page.items.find((i: { taskId: string }) => i.taskId === planned.plannedTask!.id);
    expect(item).toBeTruthy();
    const t = completeTask(ctx, planned.plannedTask!.id).task;
    expect(t.domainId).toBe(domain('Famille').id);
    expect(getWish(ctx, w.id)).toMatchObject({ status: 'lived', livedCount: 1 });
    // Reusable: planned again later.
    expect(planWish(ctx, w.id, '2026-12-05').status).toBe('planned');
    expect(() => planWish(ctx, w.id, '2026-11-01')).toThrow(/aujourd’hui/);
  });

  it('CE-35: « Que faire ? » filters by list, dog, duration, distance and lived or not', async () => {
    const ctx = souvenirCtx();
    patchSettings(ctx, { 'places.home': { lat: 46.49, lng: 3.01, label: 'Maison' } });
    const [restos] = listWishLists(ctx);
    const near = await createWish(ctx, {
      title: 'Chez Lucette',
      listId: restos.id,
      dogAllowed: 'yes',
      durationMin: 120,
      place: { name: 'Chez Lucette', ...LUCETTE, category: 'restaurant' },
    });
    const far = await createWish(ctx, {
      title: 'Grande ville',
      dogAllowed: 'no',
      durationMin: 60,
      place: { name: 'Ailleurs', lat: 48.85, lng: 2.35 },
    });
    const ids = (q: Parameters<typeof listWishes>[1]) => listWishes(ctx, q).map((w) => w.id);
    expect(ids({ listId: restos.id })).toEqual([near.id]);
    expect(ids({ dog: 'yes' })).toEqual([near.id]);
    expect(ids({ maxDurationMin: 60 })).toEqual([far.id]);
    expect(ids({ maxKm: 20 })).toEqual([near.id]);
    expect(ids({ done: 'false' }).sort()).toEqual([near.id, far.id].sort());
    expect(ids({ done: 'true' })).toEqual([]);
    await updateWish(ctx, far.id, { status: 'archived' });
    expect(ids({})).toEqual([near.id]);
    expect(ids({ status: 'archived' })).toEqual([far.id]);
  });

  it('QE-08: a dated event is archived 7 days after its end', async () => {
    const ctx = souvenirCtx('2026-11-17T10:00:00.000Z');
    const w = await createWish(ctx, {
      title: 'Marché de Noël',
      startDate: '2026-11-01',
      endDate: '2026-11-09',
    });
    expect(getWish(ctx, w.id)).toMatchObject({ status: 'archived', archivedByDate: true });
    const v = await createWish(ctx, { title: 'Fête', startDate: '2026-11-10', endDate: '2026-11-11' });
    expect(getWish(ctx, v.id).status).toBe('wish');
  });
});
