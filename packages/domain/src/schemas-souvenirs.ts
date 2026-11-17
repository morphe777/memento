// Input schemas of souvenirs, photos, people, places and wishes (memento-experiences, EXA-xx). Re-exported by
// schemas.ts: same single source for the API, OpenAPI, the web forms and the MCP tools.
import { z } from 'zod';
import { isValidDate } from './time.ts';

const DATE_MESSAGE = 'Date invalide (AAAA-MM-JJ, jour existant).';
const date = z.string().refine(isValidDate, DATE_MESSAGE);
const uuid = z.string().uuid();
const name = z.string().trim().min(1, 'Nom obligatoire').max(120);
const title = z.string().trim().min(1, 'Titre obligatoire').max(200);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const duration = z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60), z.literal(120)]);

export const RATINGS = ['again', 'good', 'meh'] as const;
export const PERSON_GROUPS = ['family', 'friends', 'other'] as const;
export const rating = z.enum(RATINGS);

// ---------- People (EX-30, EXA-06) ----------
export const personCreate = z.object({
  name,
  group: z.enum(PERSON_GROUPS).optional(),
  color: color.optional(),
  birthDate: date.nullable().optional(),
  active: z.boolean().optional(),
  /** QE-07: « Aucun souvenir avec … depuis N jours » in the reports; null = off. */
  alertAfterDays: z.number().int().min(7).max(3650).nullable().optional(),
});
export const personPatch = personCreate.extend({ toConfirm: z.boolean() }).partial();
export const personMergeBody = z.object({ intoId: uuid });

// ---------- Places (EX-13, EXA-05) ----------
/** A place as found by the provider (or typed by hand): saved once, reused (`provider` + `providerRef`). */
export const placeInput = z.object({
  name,
  category: z.string().trim().min(1).max(40).optional(),
  lat,
  lng,
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  provider: z.enum(['osm', 'google', 'manual']).optional(),
  providerRef: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
});
export const placePatch = placeInput
  .pick({ name: true, category: true, address: true, city: true })
  .partial();
export const placesNearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(10).max(1000).optional(),
});
export const placesSearchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  /** « lat,lng »: around the photo; the home (Configuration) otherwise. */
  near: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .optional(),
});

// ---------- Captures and souvenirs (EX-10 to EX-15, EXA-01 to EXA-04) ----------
/** What the phone read from a photo before compressing it: shot time (instant, or Paris time) and position. */
export const photoMeta = z.object({
  takenAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/)
    .nullable()
    .optional(),
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
});
export type PhotoMeta = z.infer<typeof photoMeta>;
const clientCaptureId = z.string().trim().min(8).max(100);
/** EXA-01: one entry for the app, the iOS share sheet and the Shortcut: photos, a URL or a place. */
export const captureBody = z.union([
  z.object({ clientCaptureId: clientCaptureId.optional(), photos: z.array(photoMeta).max(200) }),
  z.object({ clientCaptureId: clientCaptureId.optional(), url: z.string().trim().url().max(2000) }),
  z.object({
    clientCaptureId: clientCaptureId.optional(),
    lat,
    lng,
    name: z.string().trim().max(200).optional(),
  }),
]);
export type CaptureBody = z.infer<typeof captureBody>;

export const souvenirPatch = z
  .object({
    title,
    /** First day (Paris time): the done time of the experience task moves to that day. */
    startDate: date,
    /** Last day of a souvenir over several days; null, or not after the first day = one day. */
    endDate: date.nullable(),
    placeId: uuid.nullable(),
    personIds: z.array(uuid).max(50),
    /** CE-08: names typed in « + quelqu'un d'autre », created « à confirmer » (or found by name). */
    newPersons: z.array(name).max(20),
    phrase: z.string().trim().max(280),
    rating: rating.nullable(),
    domainId: uuid.nullable(),
    projectId: uuid.nullable(),
    description: z.string().max(20_000),
  })
  .partial();
export type SouvenirPatch = z.infer<typeof souvenirPatch>;
/** « Enregistrer » of the check screen: the draft becomes a souvenir. Domain deduced from the people if absent. */
export const souvenirSaveBody = souvenirPatch;
export const souvenirAttachBody = z.object({ taskId: uuid });
export const souvenirMergeBody = z.object({ intoId: uuid });
export const coverBody = z.object({ photoId: uuid });
export const photoPatch = z.object({ position: z.number().int().min(0).max(10_000) });
export const souvenirListQuery = z.object({
  personId: uuid.optional(),
  domainId: uuid.optional(),
  placeId: uuid.optional(),
  category: z.string().max(40).optional(),
  from: date.optional(),
  to: date.optional(),
  rating: rating.optional(),
  withPhotos: z.enum(['true', 'false']).optional(),
});
export type SouvenirListQuery = z.infer<typeof souvenirListQuery>;
export const livingQuery = z.object({ from: date, to: date });

// ---------- Wishes (EX-40, EX-41, EXA-07, EXA-08) ----------
export const WISH_STATUSES = ['wish', 'planned', 'lived', 'archived'] as const;
const wishFields = {
  title,
  listId: uuid.nullable(),
  placeId: uuid.nullable(),
  url: z.string().trim().url().max(2000).nullable(),
  /** A picture of the page: downloaded and stored here (never shown from the remote site). */
  imageUrl: z.string().trim().url().max(2000).nullable(),
  startDate: date.nullable(),
  endDate: date.nullable(),
  price: z.string().trim().max(120).nullable(),
  durationMin: duration.nullable(),
  dogAllowed: z.enum(['yes', 'no', 'unknown']),
  indoor: z.enum(['yes', 'no', 'mixed', 'unknown']),
  season: z.string().trim().max(60).nullable(),
  personIds: z.array(uuid).max(50),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  note: z.string().max(4000),
};
export const wishCreate = z.object(wishFields).partial().extend({
  title,
  /** A place found by the provider, saved with the wish (instead of an existing placeId). */
  place: placeInput.optional(),
});
export const wishPatch = z
  .object({ ...wishFields, status: z.enum(['wish', 'archived']) })
  .partial()
  .extend({ place: placeInput.optional() });
export type WishCreate = z.infer<typeof wishCreate>;
export type WishPatch = z.infer<typeof wishPatch>;
export const wishPlanBody = z.object({ date });
export const wishParseBody = z.object({ url: z.string().trim().url().max(2000) });
export const wishListQuery = z.object({
  listId: uuid.optional(),
  status: z.enum([...WISH_STATUSES, 'open']).optional(),
  dog: z.enum(['yes', 'no']).optional(),
  maxDurationMin: z.coerce.number().int().min(5).max(1440).optional(),
  maxKm: z.coerce.number().min(1).max(20_000).optional(),
  /** true: already lived at least once; false: never. */
  done: z.enum(['true', 'false']).optional(),
  season: z.string().max(60).optional(),
  q: z.string().max(200).optional(),
});
export type WishListQuery = z.infer<typeof wishListQuery>;
export const wishListCreate = z.object({ name, icon: z.string().trim().min(1).max(40).optional() });
export const wishListPatch = wishListCreate.extend({ position: z.number().int().min(0) }).partial();
