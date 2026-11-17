// Routes of souvenirs, photos, places and people (EXA-01 to EXA-11; D-171: the envies are experience tasks). Thin adapters
// around @memento/domain, as the rest of the API (F-26). Multipart for the photos (@fastify/multipart).
import { createReadStream, existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as D from '@memento/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

interface Deps {
  ctx: (req: FastifyRequest) => D.Ctx;
  /** Where the map tiles are cached (D-166); no proxy when absent (tests). */
  cacheDir?: string;
}

const tag = (t: string) => ({ tags: [t] });
const photoParams = z.object({ id: D.uuid, size: z.enum(['full', 'medium', 'thumb']) });
const tileParams = z.object({
  z: z.coerce.number().int().min(0).max(19),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});

/** The address the phone opens after a capture: the app address (Configuration), else the one it called. */
function absolute(req: FastifyRequest, ctx: D.Ctx, path: string) {
  const base = D.getSettings(ctx)['notify.app_url'] || `${req.protocol}://${req.host}`;
  return `${base.replace(/\/$/, '')}${path}`;
}

/** The files and the `meta` field (JSON) of a multipart request. */
async function readMultipart(req: FastifyRequest) {
  const files: { buf: Buffer; name: string; mime: string }[] = [];
  let meta: unknown = {};
  for await (const part of req.parts()) {
    if (part.type === 'file')
      files.push({ buf: await part.toBuffer(), name: part.filename, mime: part.mimetype });
    else if (part.fieldname === 'meta' && typeof part.value === 'string' && part.value.trim()) {
      try {
        meta = JSON.parse(part.value);
      } catch {
        throw new D.DomainError('VALIDATION_ERROR', 'Champ « meta » : JSON attendu.');
      }
    }
  }
  return { files, meta };
}

function sendFile(reply: FastifyReply, file: string, type: string) {
  if (!existsSync(file)) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Fichier introuvable' });
  reply.header('content-type', type);
  reply.header('cache-control', 'private, max-age=31536000, immutable');
  reply.header('content-length', statSync(file).size);
  return reply.send(createReadStream(file));
}

export function registerSouvenirRoutes(api: FastifyInstance, deps: Deps) {
  const { ctx } = deps;
  const s = api.withTypeProvider<ZodTypeProvider>();

  // ---------- Capture (EXA-01) ----------
  // JSON { photos: [metadata] } (the app: files sent after), { url } or { lat, lng, name }; or multipart: the
  // photo files and a `meta` field { clientCaptureId?, photos?: [metadata] } (the iPhone Shortcut).
  s.post('/captures', { schema: tag('Souvenirs') }, async (req) => {
    const c = ctx(req);
    let body: unknown = req.body;
    let files: D.CaptureFile[] = [];
    if (req.isMultipart()) {
      const m = await readMultipart(req);
      body = { photos: [], ...(m.meta as object) };
      files = m.files.map((f) => ({ buf: f.buf }));
      if (!files.length && !('url' in (body as object)) && !('lat' in (body as object)))
        throw new D.DomainError('NO_PHOTO', 'Aucune photo reçue.');
    }
    const parsed = D.captureBody.parse(body ?? {});
    const res = await D.createCapture(c, parsed, files, req.principal!.kind === 'token' ? 'share' : 'app');
    return { ...res, editUrl: absolute(req, c, res.editPath) };
  });
  // 03 §4 step 0: what reached the server (sizes, formats, date and position read), nothing written.
  s.post('/captures/test', { schema: tag('Souvenirs') }, async (req) => {
    const m = req.isMultipart() ? await readMultipart(req) : { files: [], meta: req.body ?? {} };
    const files = [];
    for (const f of m.files) {
      const info = await D.processPhoto(f.buf).then(
        (p) => ({
          ok: true,
          width: p.width,
          height: p.height,
          storedBytes: p.files.full.length,
          read: p.meta,
        }),
        (e: Error & { code?: string }) => ({ ok: false, error: e.code ?? e.message }),
      );
      files.push({ name: f.name, mime: f.mime, bytes: f.buf.length, ...info });
    }
    return { received: { files: files.length, meta: m.meta }, files };
  });

  // ---------- Souvenirs (EXA-02 to EXA-04, EX-50 to EX-52) ----------
  s.get('/souvenirs', { schema: { ...tag('Souvenirs'), querystring: D.souvenirListQuery } }, async (req) =>
    D.listSouvenirs(ctx(req), req.query),
  );
  s.get('/souvenirs/on-this-day', { schema: tag('Souvenirs') }, async (req) => ({
    souvenir: D.onThisDay(ctx(req)),
  }));
  s.get('/souvenirs/:id', { schema: { ...tag('Souvenirs'), params: D.idParam } }, async (req) =>
    D.getSouvenir(ctx(req), req.params.id),
  );
  s.patch(
    '/souvenirs/:id',
    { schema: { ...tag('Souvenirs'), params: D.idParam, body: D.souvenirPatch } },
    async (req) => D.updateSouvenir(ctx(req), req.params.id, req.body),
  );
  s.post(
    '/souvenirs/:id/save',
    { schema: { ...tag('Souvenirs'), params: D.idParam, body: D.souvenirSaveBody } },
    async (req) => D.saveSouvenir(ctx(req), req.params.id, req.body),
  );
  s.delete('/souvenirs/:id', { schema: { ...tag('Souvenirs'), params: D.idParam } }, async (req) =>
    D.deleteSouvenir(ctx(req), req.params.id),
  );
  s.get('/souvenirs/:id/suggestions', { schema: { ...tag('Souvenirs'), params: D.idParam } }, async (req) =>
    D.getSuggestions(ctx(req), req.params.id),
  );
  s.post(
    '/souvenirs/:id/attach',
    { schema: { ...tag('Souvenirs'), params: D.idParam, body: D.souvenirAttachBody } },
    async (req) => D.attachSouvenir(ctx(req), req.params.id, req.body.taskId),
  );
  s.post(
    '/souvenirs/:id/merge',
    { schema: { ...tag('Souvenirs'), params: D.idParam, body: D.souvenirMergeBody } },
    async (req) => D.mergeSouvenir(ctx(req), req.params.id, req.body.intoId),
  );
  s.post(
    '/souvenirs/:id/cover',
    { schema: { ...tag('Souvenirs'), params: D.idParam, body: D.coverBody } },
    async (req) => D.setCover(ctx(req), req.params.id, req.body.photoId),
  );
  // One photo per request (multipart: the file and an optional `meta` { takenAt, lat, lng }).
  s.post('/souvenirs/:id/photos', { schema: { ...tag('Souvenirs'), params: D.idParam } }, async (req) => {
    if (!req.isMultipart()) throw new D.DomainError('NO_PHOTO', 'Envoi multipart attendu (champ fichier).');
    const m = await readMultipart(req);
    if (m.files.length !== 1) throw new D.DomainError('NO_PHOTO', 'Une photo par envoi.');
    const meta = D.photoMeta.parse(m.meta ?? {});
    return D.addPhoto(ctx(req), req.params.id, m.files[0].buf, meta);
  });
  s.patch(
    '/photos/:id',
    { schema: { ...tag('Souvenirs'), params: D.idParam, body: D.photoPatch } },
    async (req) => D.movePhoto(ctx(req), req.params.id, req.body.position),
  );
  s.delete('/photos/:id', { schema: { ...tag('Souvenirs'), params: D.idParam } }, async (req) =>
    D.deletePhoto(ctx(req), req.params.id),
  );
  // The files (interface only): private cache, never public.
  s.get('/photos/:id/:size', { schema: { ...tag('Souvenirs'), params: photoParams } }, async (req, reply) => {
    const c = ctx(req);
    D.getPhotoRow(c, req.params.id);
    return sendFile(reply, D.photoFile(D.photosDir(c), req.params.id, req.params.size), 'image/webp');
  });

  // ---------- Revivre: map, life report (EX-51, EX-60) ----------
  s.get(
    '/map/souvenirs',
    { schema: { ...tag('Souvenirs'), querystring: D.souvenirListQuery } },
    async (req) => D.souvenirMap(ctx(req), req.query),
  );
  s.get('/living', { schema: { ...tag('Souvenirs'), querystring: D.livingQuery } }, async (req) =>
    D.livingReport(ctx(req), req.query.from, req.query.to),
  );
  // D-166: the map tiles go through the server (cache 30 days): the page loads images from this server only.
  s.get(
    '/map/tiles/:z/:x/:y',
    { schema: { ...tag('Souvenirs'), params: tileParams } },
    async (req, reply) => {
      const { z: zoom, x, y } = req.params;
      if (x >= 2 ** zoom || y >= 2 ** zoom)
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Tuile hors carte' });
      if (!deps.cacheDir) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Tuiles indisponibles' });
      const file = join(deps.cacheDir, 'tiles', String(zoom), String(x), `${y}.png`);
      const fresh = existsSync(file) && Date.now() - statSync(file).mtimeMs < 30 * 86_400_000;
      if (!fresh) {
        const url = D.getSettings(ctx(req))
          ['map.tiles_url'].replace('{z}', String(zoom))
          .replace('{x}', String(x))
          .replace('{y}', String(y))
          .replace('{s}', 'a');
        const res = await fetch(url, {
          headers: { 'user-agent': `Memento/${D.APP_VERSION} (self-hosted personal app)` },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);
        if (!res?.ok) {
          if (existsSync(file)) return sendFile(reply, file, 'image/png'); // an old tile beats none
          return reply.code(503).send({ code: 'TILES_UNAVAILABLE', message: 'Fond de carte indisponible.' });
        }
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        utimesSync(file, new Date(), new Date()); // dated by the app clock (the age above uses it too)
      }
      reply.header('cache-control', 'private, max-age=604800');
      return sendFile(reply, file, 'image/png');
    },
  );

  // ---------- Places (EX-13, EXA-05) ----------
  s.get('/places', { schema: tag('Lieux') }, async (req) => D.listPlaces(ctx(req)));
  s.get('/places/nearby', { schema: { ...tag('Lieux'), querystring: D.placesNearbyQuery } }, async (req) =>
    D.placesNearby(ctx(req), req.query.lat, req.query.lng, req.query.radius),
  );
  s.get('/places/search', { schema: { ...tag('Lieux'), querystring: D.placesSearchQuery } }, async (req) => {
    const near = req.query.near?.split(',').map(Number);
    return D.searchPlaces(ctx(req), req.query.q, near ? { lat: near[0], lng: near[1] } : null);
  });
  s.post('/places', { schema: { ...tag('Lieux'), body: D.placeInput } }, async (req) =>
    D.savePlace(ctx(req), req.body),
  );
  s.patch(
    '/places/:id',
    { schema: { ...tag('Lieux'), params: D.idParam, body: D.placePatch } },
    async (req) => D.updatePlace(ctx(req), req.params.id, req.body),
  );
  s.delete('/places/:id', { schema: { ...tag('Lieux'), params: D.idParam } }, async (req) =>
    D.deletePlace(ctx(req), req.params.id),
  );

  // ---------- People (EX-30, EXA-06): writes are the configuration (interface only, as domains) ----------
  s.get('/persons', { schema: tag('Personnes') }, async (req) => D.listPersons(ctx(req)));
  s.post('/persons', { schema: { ...tag('Personnes'), body: D.personCreate } }, async (req) =>
    D.createPerson(ctx(req), req.body),
  );
  s.patch(
    '/persons/:id',
    { schema: { ...tag('Personnes'), params: D.idParam, body: D.personPatch } },
    async (req) => D.updatePerson(ctx(req), req.params.id, req.body),
  );
  s.post(
    '/persons/:id/merge',
    { schema: { ...tag('Personnes'), params: D.idParam, body: D.personMergeBody } },
    async (req) => D.mergePerson(ctx(req), req.params.id, req.body.intoId),
  );
  s.delete('/persons/:id', { schema: { ...tag('Personnes'), params: D.idParam } }, async (req) =>
    D.deletePerson(ctx(req), req.params.id),
  );
}
