// memento-experiences: souvenirs, photos, places, people (CE-01 to CE-22, CE-40 to CE-44, D-157 to D-167).
// Fictional data only (public repository): « Chez Lucette » in the town of Valbourg, Alice, Bruno, Chloé.
import { existsSync } from 'node:fs';
import { eq, schema } from '@memento/db';
import exifr from 'exifr';
import { afterEach, describe, expect, it } from 'vitest';
import {
  attachSouvenir,
  completeTask,
  createCapture,
  createPerson,
  createTask,
  deletePhoto,
  deleteSouvenir,
  deleteTask,
  exportData,
  generateReport,
  getExperiencesPage,
  getSouvenir,
  getSuggestions,
  importData,
  listPersons,
  listSouvenirs,
  livingReport,
  logExperience,
  mergeSouvenir,
  normalizeTakenAt,
  onThisDay,
  patchSettings,
  photoFile,
  placesNearby,
  prefillFromPhotos,
  processPhoto,
  purgeData,
  runDataMigrations,
  savePlace,
  saveSouvenir,
  searchPlaces,
  setCover,
  souvenirMap,
  sweepPhotoFiles,
  updateSouvenir,
} from '../src/index.ts';
import { lookups } from './helpers.ts';
import { jpeg, LUCETTE, osmRoutes, resetNetwork, souvenirCtx, stubNetwork } from './souvenirs-helpers.ts';

afterEach(resetNetwork);

const photosOf = async (spec: { at: string; lat?: number; lng?: number }[]) =>
  Promise.all(spec.map(async (s) => ({ buf: await jpeg(s) })));

describe('photos (EX-20, CE-20 to CE-22)', () => {
  it('makes 2560 / 1280 / 480 px WebP files without any metadata, and keeps date and position apart', async () => {
    const p = await processPhoto(await jpeg({ w: 4032, h: 3024, at: '2026-11-15T12:40:05', ...LUCETTE }));
    expect([p.width, p.height]).toEqual([2560, 1920]);
    for (const [size, side] of [
      ['medium', 1280],
      ['thumb', 480],
    ] as const) {
      const meta = await (await import('sharp')).default(p.files[size]).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBe(side);
      expect(meta.format).toBe('webp');
    }
    // CE-22: no GPS (nor any EXIF) left in the stored files.
    await expect(exifr.gps(p.files.full)).rejects.toThrow();
    expect(p.meta.takenAt).toBe('2026-11-15T11:40:05.000Z'); // Paris wall clock → instant
    expect(p.meta.lat).toBeCloseTo(46.5, 4);
  });
  it('refuses what it cannot read (HEIC from a desktop, a text file) with UNSUPPORTED_MEDIA', async () => {
    await expect(processPhoto(Buffer.from('ftypheic not really a picture'))).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA',
    });
  });
  it('reads an offset when the phone gives one, Paris time otherwise', () => {
    expect(normalizeTakenAt('2026:07:14 22:00:00')).toBe('2026-07-14T20:00:00.000Z');
    expect(normalizeTakenAt('2026-07-14T22:00:00+02:00')).toBe('2026-07-14T20:00:00.000Z');
    expect(normalizeTakenAt('2026-07-14T22:00')).toBe('2026-07-14T20:00:00.000Z');
    expect(normalizeTakenAt('n/a')).toBeNull();
  });
});

describe('pre-fill (EX-11)', () => {
  const now = new Date('2026-11-17T10:00:00Z');
  it('dates from the oldest shot, a last day when the photos cover several days (CE-04)', () => {
    const p = prefillFromPhotos(
      [{ takenAt: '2026-11-14T09:00' }, { takenAt: '2026-11-12T15:30' }, { takenAt: '2026-11-13T11:00' }],
      now,
    );
    expect(p.startDate).toBe('2026-11-12');
    expect(p.endDate).toBe('2026-11-14');
  });
  it('the point is the cover photo, else the centre of the biggest group of positions', () => {
    expect(
      prefillFromPhotos(
        [
          { lat: 46.5, lng: 3 },
          { lat: 47, lng: 3 },
        ],
        now,
      ).point,
    ).toEqual({ lat: 46.5, lng: 3 });
    const p = prefillFromPhotos(
      [{}, { lat: 46.5, lng: 3 }, { lat: 46.5002, lng: 3 }, { lat: 47.2, lng: 3.5 }],
      now,
    ).point!;
    expect(p.lat).toBeCloseTo(46.5001, 4);
  });
  it('never in the future, now when no photo has a date', () => {
    expect(prefillFromPhotos([{ takenAt: '2027-01-01T10:00' }], now).doneAt).toEqual(now);
    expect(prefillFromPhotos([{}], now).startDate).toBe('2026-11-17');
  });
});

describe('capture (EX-10, EXA-01)', () => {
  it('CE-01: 4 shared photos give a draft souvenir named after the restaurant, dated and placed', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const files = await photosOf([
      { at: '2026-11-15T12:40:00', ...LUCETTE },
      { at: '2026-11-15T12:55:00', ...LUCETTE },
      { at: '2026-11-15T13:20:00', lat: 46.5003, lng: 3.0004 },
      { at: '2026-11-15T13:40:00' },
    ]);
    const res = await createCapture(ctx, { clientCaptureId: 'capture-0001', photos: [] }, files, 'share');
    expect(res).toMatchObject({
      kind: 'souvenir',
      existing: false,
      editPath: `/souvenirs/${res.id}/verifier`,
    });
    const s = getSouvenir(ctx, res.id);
    expect(s).toMatchObject({
      status: 'draft',
      source: 'share',
      title: 'Chez Lucette',
      startDate: '2026-11-15',
      days: 1,
    });
    expect(s.place).toMatchObject({ name: 'Chez Lucette', category: 'restaurant', city: 'Valbourg' });
    expect(s.photoCount).toBe(4);
    expect(s.coverPhotoId).toBe(s.photos[0].id);
    expect(s.doneAt).toBe('2026-11-15T11:40:00.000Z');
    const { domain } = lookups(ctx);
    expect(s.domainId).toBe(domain('Loisirs & Découverte').id); // nobody yet (D-163)
    for (const ph of s.photos) expect(existsSync(photoFile(ctx.photosDir!, ph.id, 'thumb'))).toBe(true);
    // Counted at once: a captured souvenir is a lived experience.
    expect(getExperiencesPage(ctx).doneThisMonth).toBe(1);
  });

  it('CE-02: the app sends the metadata first (files later): same pre-fill, a second visit needs no network', async () => {
    const ctx = souvenirCtx();
    const calls = stubNetwork(osmRoutes);
    await createCapture(ctx, { photos: [{ takenAt: '2026-11-10T19:00', ...LUCETTE }] });
    const n = calls.length;
    const again = await createCapture(ctx, {
      photos: [{ takenAt: '2026-11-16T12:00', lat: 46.50005, lng: 3.0001 }],
    });
    expect(calls.length).toBe(n); // remembered place within 50 m
    expect(getSouvenir(ctx, again.id).place?.name).toBe('Chez Lucette');
  });

  it('CE-11: the same capture sent twice gives one souvenir', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const a = await createCapture(ctx, { clientCaptureId: 'same-capture-1', photos: [{}] });
    const b = await createCapture(ctx, { clientCaptureId: 'same-capture-1', photos: [{}] });
    expect(b).toMatchObject({ id: a.id, existing: true });
    expect(listSouvenirs(ctx)).toHaveLength(1);
  });

  it('no position: « Sortie du … »; the provider down never blocks (warning)', async () => {
    const ctx = souvenirCtx();
    stubNetwork(() => new Response('down', { status: 503 }));
    const a = await createCapture(ctx, { photos: [{ takenAt: '2026-11-01T10:00' }] });
    expect(getSouvenir(ctx, a.id).title).toBe('Sortie du 1er novembre');
    const b = await createCapture(ctx, { photos: [{ takenAt: '2026-11-02T10:00', lat: 45, lng: 4 }] });
    expect(b.warnings).toEqual(['PLACE_PROVIDER_UNAVAILABLE']);
    expect(getSouvenir(ctx, b.id)).toMatchObject({ title: 'Sortie du 2 novembre', place: null });
  });
});

describe('places (EX-13)', () => {
  it('CE-05: the restaurant first, the café and the shop nearby as alternatives', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const r = await placesNearby(ctx, LUCETTE.lat, LUCETTE.lng);
    expect(r.candidates.map((c) => c.name)).toEqual(['Chez Lucette', 'Tabac de la Place', 'Café du Marché']);
    expect(r.candidates[0]).toMatchObject({
      category: 'restaurant',
      providerRef: 'node/1',
      memorized: false,
    });
    expect(r.candidates[0].distanceM).toBeLessThan(20);
  });
  it('CE-06: « Chez Lucette Valbourg » is found by its name, around the home', async () => {
    const ctx = souvenirCtx();
    patchSettings(ctx, { 'places.home': { lat: 46.49, lng: 3.01, label: 'Maison' } });
    const calls = stubNetwork(osmRoutes);
    const r = await searchPlaces(ctx, 'Chez Lucette Valbourg');
    expect(r.candidates[0]).toMatchObject({ name: 'Chez Lucette', city: 'Valbourg', lat: 46.50008 });
    expect(calls.at(-1)).toContain('lat=46.49&lon=3.01');
  });
  it('nothing named nearby: the address, then the town', async () => {
    const ctx = souvenirCtx();
    stubNetwork((url) => (url.includes('overpass') ? new Response('{"elements":[]}') : undefined), osmRoutes);
    const r = await placesNearby(ctx, 45, 4);
    expect(r.candidates.map((c) => c.category)).toEqual(['address', 'city']);
  });
  it('D-169: Overpass silent, Photon gives the places around the point (no warning)', async () => {
    const ctx = souvenirCtx();
    const calls = stubNetwork(
      (url) => (url.includes('overpass') ? new Response('busy', { status: 504 }) : undefined),
      osmRoutes,
    );
    const r = await placesNearby(ctx, LUCETTE.lat, LUCETTE.lng);
    expect(r.providerError).toBeNull();
    expect(r.candidates[0]).toMatchObject({ name: 'Chez Lucette', category: 'restaurant' });
    expect(calls.some((u) => u.includes('/reverse?lat=46.5'))).toBe(true);
  });
  it('D-169: by name, the answers near the photo come before those far away', async () => {
    const ctx = souvenirCtx();
    const far = {
      geometry: { coordinates: [144.93, -37.76] },
      properties: {
        osm_type: 'N',
        osm_id: 9,
        osm_key: 'amenity',
        osm_value: 'restaurant',
        name: 'Chez Lucette',
      },
    };
    const calls = stubNetwork((url) =>
      url.includes('photon')
        ? new Response(
            JSON.stringify({
              features: [
                far,
                {
                  geometry: { coordinates: [3.00012, 46.50008] },
                  properties: {
                    osm_type: 'N',
                    osm_id: 1,
                    osm_key: 'amenity',
                    osm_value: 'restaurant',
                    name: 'Chez Lucette',
                    city: 'Valbourg',
                  },
                },
              ],
            }),
          )
        : undefined,
    );
    const r = await searchPlaces(ctx, 'Chez Lucette', LUCETTE);
    expect(r.candidates.map((c) => c.city)).toEqual(['Valbourg', '']);
    expect(calls[0]).toContain('location_bias_scale');
  });
  it('D-169: the check screen searches around the photos, even after a far place was chosen', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const files = await photosOf([{ at: '2026-11-15T12:40:00', ...LUCETTE }]);
    const res = await createCapture(ctx, { photos: [] }, files, 'app');
    const far = savePlace(ctx, { name: 'Ailleurs', lat: -37.76, lng: 144.93, provider: 'manual' });
    updateSouvenir(ctx, res.id, { placeId: far.id });
    const sugg = await getSuggestions(ctx, res.id);
    expect(sugg.point).toMatchObject({ lat: expect.closeTo(46.5, 3), lng: expect.closeTo(3, 3) });
  });
  it('off in Configuration: no request at all', async () => {
    const ctx = souvenirCtx();
    patchSettings(ctx, { 'places.provider': 'none' });
    const calls = stubNetwork(osmRoutes);
    expect((await placesNearby(ctx, 45, 4)).candidates).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('check screen and edits (EX-12, EX-14, EX-15)', () => {
  it('CE-03: a tap puts a photo on the cover, the cross removes it (files too)', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const { id } = await createCapture(
      ctx,
      { photos: [] },
      await photosOf([{ at: '2026-11-15T10:00' }, { at: '2026-11-15T11:00' }]),
    );
    const [a, b] = getSouvenir(ctx, id).photos;
    expect(setCover(ctx, id, b.id).coverPhotoId).toBe(b.id);
    const after = deletePhoto(ctx, b.id);
    expect(after.coverPhotoId).toBe(a.id);
    expect(after.photoCount).toBe(1);
    expect(existsSync(photoFile(ctx.photosDir!, b.id, 'full'))).toBe(false);
  });

  it('CE-08, CE-09: a typed name is created « à confirmer » and found again; no rating needed', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const { id } = await createCapture(ctx, { photos: [{}] });
    const s = saveSouvenir(ctx, id, { newPersons: ['Chloé'], phrase: 'Une belle journée' });
    expect(s).toMatchObject({ status: 'saved', rating: null, phrase: 'Une belle journée' });
    expect(listPersons(ctx)).toEqual([expect.objectContaining({ name: 'Chloé', toConfirm: true })]);
    const next = await createCapture(ctx, { photos: [{}] });
    saveSouvenir(ctx, next.id, { newPersons: ['chloé'] });
    expect(listPersons(ctx)).toHaveLength(1);
    expect(getSouvenir(ctx, next.id).persons.map((p) => p.name)).toEqual(['Chloé']);
  });

  it('D-163: the domain follows the people when it was not chosen (family → Famille, friends → Amis & Social)', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const { domain } = lookups(ctx);
    const alice = createPerson(ctx, { name: 'Alice', group: 'family' });
    const bruno = createPerson(ctx, { name: 'Bruno', group: 'friends' });
    const a = await createCapture(ctx, { photos: [{}] });
    expect(saveSouvenir(ctx, a.id, { personIds: [alice.id, bruno.id] }).domainId).toBe(domain('Famille').id);
    const b = await createCapture(ctx, { photos: [{}] });
    expect(saveSouvenir(ctx, b.id, { personIds: [bruno.id] }).domainId).toBe(domain('Amis & Social').id);
    const c = await createCapture(ctx, { photos: [{}] });
    expect(saveSouvenir(ctx, c.id, { personIds: [bruno.id], domainId: domain('Santé').id }).domainId).toBe(
      domain('Santé').id,
    );
  });

  it('CE-04: 12 → 14 counts one experience and three days lived', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const { id } = await createCapture(ctx, {
      photos: [{ takenAt: '2026-11-12T10:00' }, { takenAt: '2026-11-14T18:00' }],
    });
    expect(getSouvenir(ctx, id)).toMatchObject({ startDate: '2026-11-12', endDate: '2026-11-14', days: 3 });
    const page = getExperiencesPage(ctx);
    expect(page.doneThisMonth).toBe(1);
    expect(page.daysThisMonth).toBe(3);
    // Edited: a last day not after the first one means one day.
    expect(updateSouvenir(ctx, id, { endDate: '2026-11-12' })).toMatchObject({ endDate: null, days: 1 });
    expect(updateSouvenir(ctx, id, { startDate: '2026-11-10', endDate: '2026-11-11' })).toMatchObject({
      startDate: '2026-11-10',
      days: 2,
    });
  });

  it('CE-10: photos of the day of a planned experience offer to attach it; accepting makes it lived', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const planned = createTask(ctx, {
      title: 'Visite des grottes',
      isExperience: true,
      dueDate: '2026-11-15',
    });
    createTask(ctx, { title: 'Une autre envie', isExperience: true, dueDate: '2026-12-20' });
    const { id } = await createCapture(ctx, { photos: [{ takenAt: '2026-11-15T15:00' }] });
    const sug = await getSuggestions(ctx, id);
    expect(sug.attach).toEqual([
      expect.objectContaining({ taskId: planned.id, title: 'Visite des grottes', reason: 'date' }),
    ]);
    const draftTask = getSouvenir(ctx, id).taskId;
    const s = attachSouvenir(ctx, id, planned.id);
    expect(s).toMatchObject({
      taskId: planned.id,
      title: 'Visite des grottes',
      startDate: '2026-11-15',
      done: true,
    });
    expect(ctx.db.select().from(schema.task).where(eq(schema.task.id, draftTask)).get()).toBeUndefined();
    expect(getExperiencesPage(ctx).doneThisMonth).toBe(1); // still one experience
  });

  it('a souvenir of the same day at the same place: « Ajouter ces photos au souvenir existant »', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const first = await createCapture(
      ctx,
      { photos: [] },
      await photosOf([{ at: '2026-11-15T12:00', ...LUCETTE }]),
    );
    saveSouvenir(ctx, first.id, {});
    const second = await createCapture(
      ctx,
      { photos: [] },
      await photosOf([{ at: '2026-11-15T14:00', ...LUCETTE }]),
    );
    expect((await getSuggestions(ctx, second.id)).duplicate).toMatchObject({ id: first.id });
    const merged = mergeSouvenir(ctx, second.id, first.id);
    expect(merged.photoCount).toBe(2);
    expect(listSouvenirs(ctx)).toHaveLength(1);
  });

  it('« Annuler » deletes the draft, its task and its files', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const { id } = await createCapture(ctx, { photos: [] }, await photosOf([{ at: '2026-11-15T12:00' }]));
    const ph = getSouvenir(ctx, id).photos[0].id;
    deleteSouvenir(ctx, id);
    expect(listSouvenirs(ctx)).toEqual([]);
    expect(existsSync(photoFile(ctx.photosDir!, ph, 'full'))).toBe(false);
    expect(getExperiencesPage(ctx).doneThisMonth).toBe(0);
  });
});

describe('every lived experience has its souvenir (D-157)', () => {
  it('checking an experience, recording one lived, and the experiences lived before 1.3', () => {
    const ctx = souvenirCtx();
    const t = createTask(ctx, { title: 'Pique-nique', isExperience: true });
    completeTask(ctx, t.id);
    logExperience(ctx, { title: 'Concert', doneAt: '2026-11-16T20:00' });
    expect(
      listSouvenirs(ctx)
        .map((s) => s.title)
        .sort(),
    ).toEqual(['Concert', 'Pique-nique']);
    // A done experience without souvenir (an older database): the data migration gives it one.
    const old = createTask(ctx, { title: 'Ancienne sortie', isExperience: true });
    completeTask(ctx, old.id);
    ctx.db.delete(schema.souvenir).where(eq(schema.souvenir.taskId, old.id)).run();
    ctx.db.delete(schema.setting).where(eq(schema.setting.key, 'migration.d157_souvenirs')).run();
    runDataMigrations(ctx);
    expect(listSouvenirs(ctx).some((s) => s.title === 'Ancienne sortie')).toBe(true);
  });
  it('a deleted task takes its souvenir; orphan files are swept', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const { id } = await createCapture(ctx, { photos: [] }, await photosOf([{ at: '2026-11-15T12:00' }]));
    const s = getSouvenir(ctx, id);
    deleteTask(ctx, s.taskId);
    expect(ctx.db.select().from(schema.photo).all()).toEqual([]);
    expect(existsSync(photoFile(ctx.photosDir!, s.photos[0].id, 'full'))).toBe(true); // files: swept later
    expect(sweepPhotoFiles(ctx, 0)).toBe(3);
    expect(existsSync(photoFile(ctx.photosDir!, s.photos[0].id, 'full'))).toBe(false);
  });
  it('export, import and purge carry the souvenirs (rows; files stay in the data folder)', async () => {
    const ctx = souvenirCtx();
    stubNetwork(osmRoutes);
    const { id } = await createCapture(
      ctx,
      { photos: [] },
      await photosOf([{ at: '2026-11-15T12:00', ...LUCETTE }]),
    );
    saveSouvenir(ctx, id, { newPersons: ['Alice'], rating: 'again' });
    const dump = exportData(ctx);
    expect(dump.tables.souvenir).toHaveLength(1);
    const other = souvenirCtx();
    importData(other, JSON.parse(JSON.stringify(dump)));
    expect(getSouvenir(other, id)).toMatchObject({
      rating: 'again',
      place: { name: 'Chez Lucette' },
      photoCount: 1,
    });
    // An export of 1.2 (no souvenir tables) still imports.
    const old = JSON.parse(JSON.stringify(dump));
    for (const k of ['place', 'person', 'wishList', 'wish', 'souvenir', 'souvenirPerson', 'photo'])
      delete old.tables[k];
    expect(importData(souvenirCtx(), old).ok).toBe(true);
    purgeData(ctx, { history: false });
    expect(listSouvenirs(ctx)).toEqual([]);
    expect(listPersons(ctx)).toHaveLength(1); // people are configuration
  });
});

describe('revivre (EX-50 to EX-52, EX-60)', () => {
  async function journal() {
    const ctx = souvenirCtx('2026-11-17T10:00:00.000Z');
    stubNetwork(osmRoutes);
    const alice = createPerson(ctx, { name: 'Alice', group: 'family' });
    const bruno = createPerson(ctx, { name: 'Bruno', group: 'friends', alertAfterDays: 30 });
    const add = async (
      at: string,
      point: { lat: number; lng: number } | null,
      body: Parameters<typeof saveSouvenir>[2],
    ) => {
      const { id } = await createCapture(ctx, { photos: [{ takenAt: at, ...(point ?? {}) }] });
      return saveSouvenir(ctx, id, body);
    };
    const a = await add('2026-11-15T12:00', LUCETTE, { personIds: [alice.id], rating: 'again' });
    // Same place, the photos elsewhere: still one point (CE-07).
    const b = await add('2026-09-20T12:00', LUCETTE, { personIds: [bruno.id], rating: 'good' });
    await updateSouvenir(ctx, b.id, {});
    const c = await add('2025-11-16T10:00', null, { personIds: [alice.id], title: 'Balade en forêt' });
    return { ctx, alice, bruno, a, b, c };
  }

  it('CE-40: the journal is filtered by person, domain, place, period and rating', async () => {
    const { ctx, alice, a, b, c } = await journal();
    expect(listSouvenirs(ctx).map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    expect(listSouvenirs(ctx, { personId: alice.id }).map((s) => s.id)).toEqual([a.id, c.id]);
    expect(listSouvenirs(ctx, { placeId: a.place!.id })).toHaveLength(2);
    expect(listSouvenirs(ctx, { from: '2026-01-01', to: '2026-10-31' }).map((s) => s.id)).toEqual([b.id]);
    expect(listSouvenirs(ctx, { rating: 'again' }).map((s) => s.id)).toEqual([a.id]);
    expect(listSouvenirs(ctx, { domainId: a.domainId! }).map((s) => s.id)).toEqual([a.id, c.id]);
    expect(listSouvenirs(ctx, { category: 'restaurant' })).toHaveLength(2);
  });

  it('CE-41, CE-07: one point per place with its count', async () => {
    const { ctx, a } = await journal();
    patchSettings(ctx, { 'places.home': { lat: 46.49, lng: 3.01, label: 'Maison' } });
    const m = souvenirMap(ctx);
    expect(m.points).toEqual([
      expect.objectContaining({ placeId: a.place!.id, name: 'Chez Lucette', count: 2 }),
    ]);
    expect(m.lifeRadiusM).toBeGreaterThan(1000);
  });

  it('CE-43: « Il y a un an » shows a souvenir of the same week of a past year, none otherwise', async () => {
    const { ctx, c } = await journal();
    expect(onThisDay(ctx)).toMatchObject({ id: c.id, yearsAgo: 1, sameDay: false });
    ctx.setNow('2026-06-01T10:00:00.000Z');
    expect(onThisDay(ctx)).toBeNull();
  });

  it('CE-44: « Vivre » in the quarter report: people, places, kinds, novelties, to do again, off the track', async () => {
    const { ctx } = await journal();
    const v = livingReport(ctx, '2026-10-01', '2026-12-31');
    expect(v).toMatchObject({ souvenirs: 1, days: 1, places: 1 });
    expect(v.byPerson.map((p) => [p.name, p.souvenirs])).toEqual([
      ['Alice', 1],
      ['Bruno', 0],
    ]);
    expect(v.again.map((s) => s.title)).toEqual(['Chez Lucette']);
    expect(v.novelties).toEqual([]); // the restaurant and the town were already seen in September
    expect(v.offTrack.kindsNeverDone).toContain('Musées');
    expect(v.alerts).toEqual([
      expect.objectContaining({ name: 'Bruno', text: 'Aucun souvenir avec Bruno depuis 58 jours' }),
    ]);
    const q3 = livingReport(ctx, '2026-07-01', '2026-09-30');
    expect(q3.novelties.map((n) => n.what)).toEqual([
      'premier lieu « Restaurants »',
      'première fois à Valbourg',
    ]);
    const { report } = generateReport(ctx, 'quarter', '2026-Q3');
    expect((report.payload as { living: { souvenirs: number } }).living.souvenirs).toBe(1);
  });
});
