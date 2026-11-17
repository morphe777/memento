// EX-20 / D-160: photos of the souvenirs. The phone sends a picture already reduced to 2 560 px (with the date and
// the position it read before), the server makes three WebP files without any metadata (CE-20 to CE-22):
// full 2 560 px (quality 82), medium 1 280 px (grid), thumb 480 px (lists, map, iPhone). The database keeps the
// date and the position; the files live in the photos folder (backed up with the data folder), named by photo id.
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { schema } from '@memento/db';
import exifr from 'exifr';
import sharp from 'sharp';
import type { Ctx } from '../context.ts';
import { DomainError } from '../errors.ts';
import type { PhotoMeta } from '../schemas-souvenirs.ts';
import { parisInstant } from '../time.ts';

export const PHOTO_SIZES = { full: 2560, medium: 1280, thumb: 480 } as const;
export type PhotoSize = keyof typeof PHOTO_SIZES;
const QUALITY: Record<PhotoSize, number> = { full: 82, medium: 80, thumb: 75 };
/** A picture bigger than this is refused (the phone reduces to 2 560 px first: about 1 to 3 MB). */
export const PHOTO_MAX_BYTES = 40 * 1024 * 1024;
/** Above this many photos a souvenir shows a warning (no hard limit, EX-20). */
export const PHOTO_WARN_COUNT = 30;

/** The photos folder: MEMENTO_PHOTOS_DIR, or `photos` beside the database (same backup). */
export function photosDir(ctx: Pick<Ctx, 'photosDir'>): string {
  if (!ctx.photosDir) throw new DomainError('PHOTOS_DISABLED', 'Dossier des photos non configuré.');
  return ctx.photosDir;
}

export function photoFile(dir: string, id: string, size: PhotoSize): string {
  return join(dir, id.slice(0, 2), `${id}-${size}.webp`);
}
export const wishImageFile = (dir: string, wishId: string) => join(dir, 'wishes', `${wishId}.webp`);

/** EXIF « 2026:11:15 12:40:05 » (+ offset) or ISO: an instant. Without an offset, the time is Paris time. */
export function normalizeTakenAt(raw: string | null | undefined, offset?: string | null): string | null {
  if (!raw) return null;
  const m = raw
    .trim()
    .match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', tz] = m;
  const zone = tz ?? offset ?? null;
  if (zone) {
    const z = zone === 'Z' ? 'Z' : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${z}`);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const day = `${y}-${mo}-${d}`;
  if (Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return null;
  return new Date(parisInstant(day, `${h}:${mi}`).getTime() + Number(s) * 1000).toISOString();
}

/** Date and position written in the picture (fallback when the phone did not send them). */
export async function readExif(buf: Buffer): Promise<PhotoMeta> {
  const [tags, gps] = await Promise.all([
    exifr
      .parse(buf, { reviveValues: false, pick: ['DateTimeOriginal', 'OffsetTimeOriginal', 'CreateDate'] })
      .catch(() => null) as Promise<Record<string, string> | null>,
    exifr.gps(buf).catch(() => null) as Promise<{ latitude?: number; longitude?: number } | null>,
  ]);
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
  return {
    takenAt: normalizeTakenAt(tags?.DateTimeOriginal ?? tags?.CreateDate, tags?.OffsetTimeOriginal),
    lat: ok(gps?.latitude) && ok(gps?.longitude) ? gps!.latitude! : null,
    lng: ok(gps?.latitude) && ok(gps?.longitude) ? gps!.longitude! : null,
  };
}

export interface ProcessedPhoto {
  files: Record<PhotoSize, Buffer>;
  width: number;
  height: number;
  meta: PhotoMeta;
}

/**
 * Turns an uploaded picture into the three WebP files (upright, no metadata). HEIC is refused: the phone converts
 * it (iOS does when it hands a photo to a web page or to the Shortcut), the prebuilt image library cannot read it.
 */
export async function processPhoto(buf: Buffer): Promise<ProcessedPhoto> {
  if (buf.length > PHOTO_MAX_BYTES)
    throw new DomainError('PHOTO_TOO_LARGE', 'Photo trop lourde (40 Mo au plus) : réduis-la avant l’envoi.');
  let format: string | undefined;
  try {
    format = (await sharp(buf).metadata()).format;
  } catch {
    format = undefined;
  }
  if (!format || !['jpeg', 'png', 'webp', 'tiff', 'gif', 'avif'].includes(format))
    throw new DomainError(
      'UNSUPPORTED_MEDIA',
      'Format non pris en charge : envoie la photo en JPEG, PNG ou WebP (le HEIC est converti par l’iPhone).',
    );
  const meta = await readExif(buf);
  const files = {} as Record<PhotoSize, Buffer>;
  let width = 0;
  let height = 0;
  for (const size of Object.keys(PHOTO_SIZES) as PhotoSize[]) {
    const out = await sharp(buf, { animated: false })
      .rotate() // upright from the EXIF orientation, which is then dropped with the rest
      .resize(PHOTO_SIZES[size], PHOTO_SIZES[size], { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY[size] })
      .toBuffer({ resolveWithObject: true });
    files[size] = out.data;
    if (size === 'full') {
      width = out.info.width;
      height = out.info.height;
    }
  }
  return { files, width, height, meta };
}

export function writePhotoFiles(dir: string, id: string, files: Record<PhotoSize, Buffer>) {
  mkdirSync(join(dir, id.slice(0, 2)), { recursive: true });
  for (const size of Object.keys(files) as PhotoSize[]) writeFileSync(photoFile(dir, id, size), files[size]);
}

export function removePhotoFiles(dir: string, ids: string[]) {
  for (const id of ids)
    for (const size of Object.keys(PHOTO_SIZES) as PhotoSize[]) {
      const f = photoFile(dir, id, size);
      if (existsSync(f)) unlinkSync(f);
    }
}

/**
 * Files whose photo (or wish) is gone, older than an hour (an upload writes its files just before its row):
 * removed. Run at API start, after deletions that go through tasks or projects.
 */
export function sweepPhotoFiles(ctx: Ctx, olderThanMs = 3_600_000): number {
  const dir = ctx.photosDir;
  if (!dir || !existsSync(dir)) return 0;
  const photos = new Set(
    ctx.db
      .select({ id: schema.photo.id })
      .from(schema.photo)
      .all()
      .map((p) => p.id),
  );
  const wishes = new Set(
    ctx.db
      .select({ id: schema.wish.id, img: schema.wish.hasImage })
      .from(schema.wish)
      .all()
      .filter((w) => w.img)
      .map((w) => w.id),
  );
  const limit = Date.now() - olderThanMs;
  let removed = 0;
  for (const sub of readdirSync(dir)) {
    const folder = join(dir, sub);
    if (!statSync(folder).isDirectory()) continue;
    for (const f of readdirSync(folder)) {
      const id = f.replace(/(-(full|medium|thumb))?\.webp$/, '');
      const known = sub === 'wishes' ? wishes.has(id) : photos.has(id);
      const file = join(folder, f);
      if (!known && statSync(file).mtimeMs < limit) {
        unlinkSync(file);
        removed++;
      }
    }
  }
  return removed;
}

/** A remote picture (wish page): one 1 280 px WebP, no metadata; null when it is not a picture. */
export async function processWishImage(buf: Buffer): Promise<Buffer | null> {
  const readable = await sharp(buf)
    .metadata()
    .then((m) => !!m.format)
    .catch(() => false);
  if (!readable) return null;
  return sharp(buf, { animated: false })
    .rotate()
    .resize(PHOTO_SIZES.medium, PHOTO_SIZES.medium, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

export function writeWishImage(dir: string, wishId: string, data: Buffer) {
  mkdirSync(join(dir, 'wishes'), { recursive: true });
  writeFileSync(wishImageFile(dir, wishId), data);
}
