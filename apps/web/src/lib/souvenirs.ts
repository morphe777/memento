// Souvenirs on the web side (D-158, D-160): the phone reads the date and position of each photo BEFORE
// compressing it (the canvas drops the EXIF), reduces it to 2 560 px, then the files go one by one in the
// background while the check screen is already open. No business rule here: the API decides everything.

import type * as D from '@memento/domain';
import exifr from 'exifr';
import { ApiError, post } from './api.ts';

export type Souvenir = D.SouvenirView;
export type Suggestions = Awaited<ReturnType<typeof D.getSuggestions>>;
export type Person = ReturnType<typeof D.listPersons>[number];
export type Place = ReturnType<typeof D.listPlaces>[number];
export type PlaceCandidate = D.PlaceCandidate;
export type Wish = D.WishView;
export type WishList = ReturnType<typeof D.listWishLists>[number];
export type SouvenirMap = ReturnType<typeof D.souvenirMap>;
export type OnThisDay = NonNullable<ReturnType<typeof D.onThisDay>>;
export type Living = ReturnType<typeof D.livingReport>;
export type Rating = 'again' | 'good' | 'meh';
export type CaptureResult = D.CaptureResult & { editUrl: string };

export const photoUrl = (id: string, size: 'full' | 'medium' | 'thumb' = 'medium') =>
  `/api/v1/photos/${id}/${size}`;
export const wishImageUrl = (id: string) => `/api/v1/wishes/${id}/image`;

export const RATING_LABEL: Record<Rating, string> = { again: 'À refaire', good: 'Bien', meh: 'Bof' };
export const GROUP_LABEL: Record<string, string> = { family: 'Famille', friends: 'Amis', other: 'Autre' };
export const CATEGORY_LABEL: Record<string, string> = {
  restaurant: 'restaurant',
  cafe: 'café',
  bar: 'bar',
  theatre: 'théâtre',
  cinema: 'cinéma',
  museum: 'musée',
  venue: 'salle',
  attraction: 'site',
  park: 'parc',
  nature: 'nature',
  cave: 'grotte',
  sport: 'sport',
  monument: 'monument',
  shop: 'commerce',
  hotel: 'hébergement',
  address: 'adresse',
  city: 'commune',
  other: 'lieu',
};
export const placeLabel = (p: { name: string; category?: string | null }) =>
  p.category && p.category !== 'other' ? `${p.name} · ${CATEGORY_LABEL[p.category] ?? p.category}` : p.name;
/** « 2 place du Marché, Valbourg » without saying the town twice. */
export const fmtAddress = (p: { address?: string | null; city?: string | null }) =>
  p.address && p.city && p.address.includes(p.city)
    ? p.address
    : [p.address, p.city].filter(Boolean).join(', ');
export const fmtDistance = (m: number | null | undefined) =>
  m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;

const day = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', ...opts });
/** « Sam. 15 nov. 2026 » or « 12 → 14 nov. 2026 » (EX-12). */
export function fmtSpan(start: string, end: string | null | undefined, withWeekday = true) {
  if (!end || end === start) {
    const s = day(start, {
      weekday: withWeekday ? 'short' : undefined,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const a = day(
    start,
    sameMonth
      ? { day: 'numeric' }
      : { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' },
  );
  return `${a} → ${day(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
export const monthTitle = (d: string) => {
  const s = day(`${d.slice(0, 7)}-15`, { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// ---------- Photos: metadata first, then compression ----------
export interface PreparedPhoto {
  blob: Blob;
  name: string;
  meta: { takenAt: string | null; lat: number | null; lng: number | null };
  preview: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** EXIF time as written by the camera (local time, no offset): the API reads it as Paris time. */
function exifTime(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime()))
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}T${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  }
  return null;
}

export async function readMeta(file: File): Promise<PreparedPhoto['meta']> {
  try {
    const tags = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'latitude', 'longitude'],
    });
    const gps = await exifr.gps(file).catch(() => null);
    return {
      takenAt: exifTime(tags?.DateTimeOriginal ?? tags?.CreateDate),
      lat: gps?.latitude ?? tags?.latitude ?? null,
      lng: gps?.longitude ?? tags?.longitude ?? null,
    };
  } catch {
    return { takenAt: null, lat: null, lng: null };
  }
}

const MAX_SIDE = 2560;
/** Reduced to 2 560 px (WebP 0.82, JPEG 0.85 if the browser cannot write WebP); a small file is sent as is. */
async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) return file; // the server says whether it can read it (HEIC: UNSUPPORTED_MEDIA)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000 && /jpe?g|webp/.test(file.type)) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const as = (type: string, q: number) =>
    new Promise<Blob | null>((r) => canvas.toBlob((b) => r(b), type, q));
  const webp = await as('image/webp', 0.82);
  if (webp && webp.type === 'image/webp') return webp;
  return (await as('image/jpeg', 0.85)) ?? file;
}

export async function preparePhotos(files: File[]): Promise<PreparedPhoto[]> {
  const out: PreparedPhoto[] = [];
  for (const f of files) {
    const meta = await readMeta(f);
    const blob = await compress(f);
    out.push({ blob, name: f.name, meta, preview: URL.createObjectURL(blob) });
  }
  return out;
}

// ---------- Background upload queue (kept in memory: the page stays open while it sends) ----------
export interface UploadState {
  souvenirId: string;
  total: number;
  sent: number;
  bytes: number;
  failed: { name: string; message: string }[];
  done: boolean;
}
const uploads = new Map<string, UploadState>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
export const subscribeUploads = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
export const uploadState = (souvenirId: string) => uploads.get(souvenirId) ?? null;

export async function uploadPhoto(souvenirId: string, p: { blob: Blob; name: string; meta?: object }) {
  const form = new FormData();
  form.append('meta', JSON.stringify(p.meta ?? {}));
  form.append('file', p.blob, p.name.replace(/\.(heic|heif|png)$/i, '.jpg'));
  const res = await fetch(`/api/v1/souvenirs/${souvenirId}/photos`, {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? res.statusText);
  return data;
}

/** Sends the photos one by one (2 tries each); `onEach` refreshes the check screen as they arrive. */
export function queueUploads(souvenirId: string, photos: PreparedPhoto[], onEach?: () => void) {
  const state: UploadState = { souvenirId, total: photos.length, sent: 0, bytes: 0, failed: [], done: false };
  uploads.set(souvenirId, state);
  emit();
  (async () => {
    for (const p of photos) {
      let error: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await uploadPhoto(souvenirId, p);
          error = null;
          break;
        } catch (e) {
          error = e;
          if (e instanceof ApiError && e.status < 500) break; // refused: no second try
        }
      }
      if (error) state.failed.push({ name: p.name, message: (error as Error).message });
      else {
        state.sent++;
        state.bytes += p.blob.size;
      }
      URL.revokeObjectURL(p.preview);
      emit();
      onEach?.();
    }
    state.done = true;
    emit();
  })();
}

/** « + Souvenir » (EX-10): metadata first (the API pre-fills and creates the draft), then the files. */
export async function captureSouvenir(files: File[]) {
  const photos = await preparePhotos(files);
  const res = await post<CaptureResult>('/captures', {
    clientCaptureId: crypto.randomUUID(),
    photos: photos.map((p) => p.meta),
  });
  queueUploads(res.id, photos);
  return res;
}
