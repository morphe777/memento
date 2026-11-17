// memento-experiences through HTTP: the capture of the iPhone Shortcut (multipart, capture token), the app (JSON
// then the files), the photo files, the envies from a URL (D-171), the map tiles (D-157 to D-168). Fictional data only.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@memento/db';
import { seed, setUrlLookup } from '@memento/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  jpeg,
  LUCETTE,
  osmRoutes,
  resetNetwork,
  stubNetwork,
} from '../../../packages/domain/test/souvenirs-helpers.ts';
import { buildApp } from '../src/app.ts';
import { createToken, setUserPassword } from '../src/auth.ts';

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let iphone: string;
let reader: string;

/** A multipart body by hand (what the Shortcut sends): `meta` then the files. */
function multipart(files: Buffer[], meta?: unknown) {
  const boundary = `----memento${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  if (meta !== undefined)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`,
      ),
    );
  files.forEach((f, i) => {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="IMG_${i}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
      ),
      f,
      Buffer.from('\r\n'),
    );
  });
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

beforeEach(async () => {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  await setUserPassword(db, 'essai', 'mot-de-passe-essai');
  const dir = mkdtempSync(join(tmpdir(), 'memento-api-'));
  app = await buildApp({
    db,
    sqlite,
    cookieSecure: false,
    webDist: '/nonexistent',
    now: () => new Date('2026-11-17T10:00:00Z'),
    photosDir: join(dir, 'photos'),
    cacheDir: join(dir, 'cache'),
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { login: 'essai', password: 'mot-de-passe-essai' },
  });
  cookie = login.headers['set-cookie']!.toString().split(';')[0];
  iphone = createToken(db, 'iphone-raccourci', 'capture').token;
  reader = createToken(db, 'lecteur', 'read').token;
});
afterEach(resetNetwork);

describe('capture over HTTP (EXA-01)', () => {
  it('CE-01: the Shortcut sends 4 photos with its capture token; the answer opens the check screen', async () => {
    stubNetwork(osmRoutes);
    const files = await Promise.all([
      jpeg({ at: '2026-11-15T12:40:00', ...LUCETTE }),
      jpeg({ at: '2026-11-15T12:50:00', ...LUCETTE }),
      jpeg({ at: '2026-11-15T13:00:00' }),
      jpeg({ at: '2026-11-15T13:10:00' }),
    ]);
    const body = multipart(files, { clientCaptureId: 'raccourci-0001' });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/captures',
      payload: body.payload,
      headers: { ...body.headers, authorization: `Bearer ${iphone}`, host: 'memento.example.lan' },
    });
    expect(ok.statusCode).toBe(200);
    const out = ok.json();
    expect(out).toMatchObject({
      kind: 'souvenir',
      editUrl: `http://memento.example.lan/souvenirs/${out.id}/verifier`,
    });
    // CE-11: sent again (the Shortcut retried): the same souvenir.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/captures',
      payload: body.payload,
      headers: { ...body.headers, authorization: `Bearer ${iphone}` },
    });
    expect(again.json()).toMatchObject({ id: out.id, existing: true });
    // The capture token reads nothing (D-168), the user sees the draft.
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/souvenirs/${out.id}`,
      headers: { authorization: `Bearer ${iphone}` },
    });
    expect(denied.json().code).toBe('CAPTURE_ONLY');
    const s = (
      await app.inject({ method: 'GET', url: `/api/v1/souvenirs/${out.id}`, headers: { cookie } })
    ).json();
    expect(s).toMatchObject({ status: 'draft', source: 'share', title: 'Chez Lucette', photoCount: 4 });
    // The photo files: WebP, private cache.
    const thumb = await app.inject({
      method: 'GET',
      url: `/api/v1/photos/${s.coverPhotoId}/thumb`,
      headers: { cookie },
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['cache-control']).toContain('private');
  });

  it('CE-02: the app sends the metadata (JSON), then each file in the background', async () => {
    stubNetwork(osmRoutes);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/captures',
      headers: { cookie },
      payload: {
        clientCaptureId: 'app-capture-1',
        photos: [{ takenAt: '2026-11-16T15:00', ...LUCETTE }, {}],
      },
    });
    const { id } = created.json();
    for (const at of ['2026-11-16T15:00', '2026-11-16T15:30']) {
      const b = multipart([await jpeg({ at })], { takenAt: at, ...LUCETTE });
      const up = await app.inject({
        method: 'POST',
        url: `/api/v1/souvenirs/${id}/photos`,
        payload: b.payload,
        headers: { ...b.headers, cookie },
      });
      expect(up.statusCode).toBe(200);
    }
    const saved = await app.inject({
      method: 'POST',
      url: `/api/v1/souvenirs/${id}/save`,
      headers: { cookie },
      payload: { newPersons: ['Alice'], rating: 'again', phrase: 'Tout était bon' },
    });
    expect(saved.json()).toMatchObject({
      status: 'saved',
      photoCount: 2,
      rating: 'again',
      persons: [{ name: 'Alice' }],
    });
    const journal = (
      await app.inject({ method: 'GET', url: '/api/v1/souvenirs?rating=again', headers: { cookie } })
    ).json();
    expect(journal).toHaveLength(1);
    const exp = (await app.inject({ method: 'GET', url: '/api/v1/experiences', headers: { cookie } })).json();
    expect(exp).toMatchObject({ doneThisMonth: 1, daysThisMonth: 1 });
  });

  it('D-171: a shared URL gives an envie (an experience idea); a picture in HEIC is refused with UNSUPPORTED_MEDIA', async () => {
    stubNetwork((url) =>
      url.startsWith('https://theatre.example.org')
        ? new Response('<meta property="og:title" content="Le Petit Prince">', {
            headers: { 'content-type': 'text/html' },
          })
        : undefined,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/captures',
      headers: { authorization: `Bearer ${iphone}` },
      payload: { url: 'https://theatre.example.org/p' },
    });
    expect(res.json()).toMatchObject({ kind: 'idea' });
    expect(res.json().editUrl).toMatch(/\/experiences\?onglet=a-vivre&tache=/);
    const exp = (await app.inject({ method: 'GET', url: '/api/v1/experiences', headers: { cookie } })).json();
    expect(exp.reserve[0]).toMatchObject({ title: 'Le Petit Prince' });
    expect(exp.reserve[0].description).toContain('https://theatre.example.org/p');
    const heic = multipart([Buffer.from('....ftypheic....')]);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/captures',
      payload: heic.payload,
      headers: { ...heic.headers, authorization: `Bearer ${iphone}` },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('UNSUPPORTED_MEDIA');
  });

  it('step 0 (03 §4): /captures/test tells what arrived (size, date, position) and writes nothing', async () => {
    const b = multipart([await jpeg({ at: '2026-11-15T12:40:00', ...LUCETTE, w: 3000, h: 2000 })], {
      from: 'raccourci',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/captures/test',
      payload: b.payload,
      headers: { ...b.headers, authorization: `Bearer ${iphone}` },
    });
    expect(res.json()).toMatchObject({
      received: { files: 1, meta: { from: 'raccourci' } },
      files: [{ ok: true, width: 2560, height: 1707, read: { takenAt: '2026-11-15T11:40:00.000Z' } }],
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/souvenirs', headers: { cookie } })).json(),
    ).toEqual([]);
  });

  it('CE-51: a read token reads the souvenirs and the envies, never writes', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/souvenirs',
      headers: { authorization: `Bearer ${reader}` },
    });
    expect(list.statusCode).toBe(200);
    const w = await app.inject({
      method: 'POST',
      url: '/api/v1/experiences',
      headers: { authorization: `Bearer ${reader}` },
      payload: { title: 'x' },
    });
    expect(w.json().code).toBe('READ_ONLY_TOKEN');
  });
});

describe('map tiles (D-166)', () => {
  it('fetched once from the tile server, then served from the cache', async () => {
    const fetch = vi.fn(
      async () => new Response(Buffer.from('png-bytes'), { headers: { 'content-type': 'image/png' } }),
    );
    vi.stubGlobal('fetch', fetch);
    setUrlLookup(null);
    const a = await app.inject({ method: 'GET', url: '/api/v1/map/tiles/12/2080/1450', headers: { cookie } });
    const b = await app.inject({ method: 'GET', url: '/api/v1/map/tiles/12/2080/1450', headers: { cookie } });
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(b.body).toBe('png-bytes');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe(
      'https://tile.openstreetmap.org/12/2080/1450.png',
    );
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/map/tiles/2/9/0', headers: { cookie } })).statusCode,
    ).toBe(404);
  });
});
