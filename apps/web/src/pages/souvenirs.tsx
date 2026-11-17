// Souvenirs (memento-experiences EX-10 to EX-52): « + Souvenir », the check screen (iPhone first), the
// souvenir sheet (full-screen gallery, mini-map, editing, photos added by drag and drop), the journal by month
// and the map. Every rule is in the API; the screens show what it returns.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Breadcrumb } from '../components/shell.tsx';
import { SouvenirLeaflet } from '../components/souvenir-map.tsx';
import {
  Avatar,
  Chip,
  Cover,
  PersonPicker,
  PlacePicker,
  RatingPicker,
  SouvenirCard,
  usePersons,
} from '../components/souvenir-ui.tsx';
import {
  ConfirmDialog,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageHeader,
  SearchSelect,
  Tabs,
} from '../components/ui.tsx';
import { ApiError, del, get, patch, post } from '../lib/api.ts';
import { STATUS_LABEL } from '../lib/format.ts';
import { toast, useAction, useDomainLookup } from '../lib/hooks.ts';
import {
  CATEGORY_LABEL,
  captureSouvenir,
  fmtAddress,
  fmtSpan,
  monthTitle,
  type OnThisDay,
  photoUrl,
  placeLabel,
  preparePhotos,
  queueUploads,
  RATING_LABEL,
  type Rating,
  type Souvenir,
  type SouvenirMap,
  type Suggestions,
  subscribeUploads,
  uploadState,
} from '../lib/souvenirs.ts';
import type { Project } from '../lib/types.ts';

const useSouvenir = (id: string) =>
  useQuery({ queryKey: ['souvenir', id], queryFn: () => get<Souvenir>(`/souvenirs/${id}`) });

/** EX-10 « + Souvenir »: the photo picker of the phone, several at once; the check screen opens at once. */
export function useCaptureSouvenir() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = () => {
    if (!input.current) {
      const el = document.createElement('input');
      el.type = 'file';
      el.accept = 'image/*';
      el.multiple = true;
      el.onchange = async () => {
        const files = [...(el.files ?? [])];
        el.value = '';
        if (!files.length) return;
        setBusy(true);
        try {
          const res = await captureSouvenir(files);
          navigate({ to: '/souvenirs/$id/verifier', params: { id: res.id } });
        } catch (e) {
          toast(e instanceof ApiError ? e.message : 'Capture impossible', 'error');
        } finally {
          setBusy(false);
        }
      };
      input.current = el;
    }
    input.current.click();
  };
  return { pick, busy };
}

export function CaptureSouvenirButton({ className = 'btn btn-primary' }: { className?: string }) {
  const { pick, busy } = useCaptureSouvenir();
  return (
    <button type="button" className={className} onClick={pick} disabled={busy}>
      {busy ? 'Préparation des photos…' : '+ Souvenir'}
    </button>
  );
}

// ---------- Form shared by the check screen and the sheet ----------
interface FormState {
  title: string;
  startDate: string;
  endDate: string;
  place: { id: string; name: string; category: string | null } | null;
  personIds: string[];
  newPersons: string[];
  phrase: string;
  rating: Rating | null;
  domainId: string;
  projectId: string;
  description: string;
}
const formOf = (s: Souvenir): FormState => ({
  title: s.title,
  startDate: s.startDate,
  endDate: s.endDate ?? '',
  place: s.place ? { id: s.place.id, name: s.place.name, category: s.place.category } : null,
  personIds: s.persons.map((p) => p.id),
  newPersons: [],
  phrase: s.phrase ?? '',
  rating: (s.rating as Rating | null) ?? null,
  // A draft's domain is deduced from the people at « Enregistrer » (D-163) unless one is chosen.
  domainId: s.status === 'draft' ? '' : (s.domainId ?? ''),
  projectId: s.projectId ?? '',
  description: s.description ?? '',
});

function Label({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex justify-between gap-2 text-[12px] mb-1" style={{ color: 'var(--text-faint)' }}>
      <span className="font-medium">{children}</span>
      {aside && <span style={{ color: 'var(--text-ghost)' }}>{aside}</span>}
    </div>
  );
}

function SouvenirFields({
  s,
  f,
  set,
  suggestions,
  touched,
}: {
  s: Souvenir;
  f: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  suggestions?: Suggestions;
  touched: (k: 'domain') => void;
}) {
  const dl = useDomainLookup();
  const [more, setMore] = useState(false);
  const projects = useQuery({
    queryKey: ['projects', 'experience'],
    queryFn: () => get<Project[]>('/projects?status=ready,active,paused,done'),
    enabled: more,
  });
  const point = suggestions?.point ?? null;
  const fromPhotos = s.photos.some((p) => p.takenAt);
  return (
    <>
      <div>
        <Label
          aside={
            s.place && f.place?.id === s.place.id && s.status === 'draft' ? "d'après le lieu" : undefined
          }
        >
          Titre
        </Label>
        <input
          className="w-full"
          value={f.title}
          onChange={(e) => set('title', e.target.value)}
          aria-label="Titre"
        />
      </div>
      <div>
        <Label aside={fromPhotos ? 'date des photos' : undefined}>
          Quand · {fmtSpan(f.startDate, f.endDate || null)}
        </Label>
        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <input
            type="date"
            value={f.startDate}
            onChange={(e) => e.target.value && set('startDate', e.target.value)}
            aria-label="Premier jour"
          />
          <input
            type="date"
            value={f.endDate}
            min={f.startDate}
            onChange={(e) => set('endDate', e.target.value)}
            aria-label="Dernier jour (plusieurs jours)"
            title="Dernier jour, pour un souvenir sur plusieurs jours"
          />
        </div>
      </div>
      <div>
        <Label aside={point ? 'position des photos' : undefined}>Où</Label>
        <PlacePicker
          value={f.place}
          candidates={suggestions?.places ?? []}
          point={point}
          providerError={suggestions?.providerError}
          onChange={(p) => {
            // The title follows the place while it is still the automatic one (EX-11).
            const auto = !f.place || f.title === f.place.name || /^Sortie du /.test(f.title);
            set('place', p);
            if (p && auto && s.status === 'draft' && !['address', 'city'].includes(p.category ?? ''))
              set('title', p.name);
          }}
        />
      </div>
      <div>
        <Label aside="liste en Configuration">Avec qui</Label>
        <PersonPicker
          value={f.personIds}
          onChange={(v) => set('personIds', v)}
          newNames={f.newPersons}
          onNewNames={(v) => set('newPersons', v)}
        />
      </div>
      <div>
        <Label aside="facultatif">Une phrase</Label>
        <input
          className="w-full"
          maxLength={280}
          placeholder="Ce qu'on retiendra…"
          value={f.phrase}
          onChange={(e) => set('phrase', e.target.value)}
          aria-label="Une phrase"
        />
      </div>
      <div>
        <Label aside="facultatif · sert au futur moteur">Note</Label>
        <RatingPicker value={f.rating} onChange={(r) => set('rating', r)} />
      </div>
      <button
        type="button"
        className="flex justify-between items-center border-0 bg-transparent p-0 py-2.5 text-[13px] cursor-pointer"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}
        onClick={() => setMore((m) => !m)}
        aria-expanded={more}
      >
        <span>
          Domaine :{' '}
          {f.projectId
            ? 'celui du projet'
            : f.domainId
              ? dl.name(f.domainId)
              : s.status === 'draft'
                ? "d'après les personnes"
                : 'aucun'}{' '}
          · Projet :{' '}
          {f.projectId
            ? (projects.data?.find((p) => p.id === f.projectId)?.title ?? s.projectTitle ?? '…')
            : 'aucun'}
        </span>
        <span aria-hidden>{more ? '▴' : '▾'}</span>
      </button>
      {more && (
        <div className="flex flex-col gap-3">
          <Field label="Projet" info="Facultatif. Dans un projet, le souvenir prend son domaine.">
            <SearchSelect
              value={f.projectId}
              onChange={(v) => {
                touched('domain');
                set('projectId', v);
              }}
              ariaLabel="Projet"
              emptyLabel="Aucun projet"
              options={(projects.data ?? []).map((p) => ({
                value: p.id,
                label: p.title,
                hint: STATUS_LABEL[p.status],
              }))}
            />
          </Field>
          {!f.projectId && (
            <Field
              label="Domaine"
              info="Sans choix, à l'enregistrement : un membre de la famille → Famille ; seulement des amis → Amis & Social ; sinon Loisirs & Découverte."
            >
              <select
                value={f.domainId}
                onChange={(e) => {
                  touched('domain');
                  set('domainId', e.target.value);
                }}
              >
                <option value="">{s.status === 'draft' ? "D'après les personnes" : 'Aucun'}</option>
                {dl.domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Ce que j'en retiens" info="Facultatif : la description de l'expérience (Markdown).">
            <textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
      )}
    </>
  );
}

/** The body sent to the API: only what changed (the domain only when the user chose it, D-163). */
function bodyOf(s: Souvenir, f: FormState, domainTouched: boolean) {
  const b: Record<string, unknown> = {};
  const was = formOf(s);
  if (f.title.trim() && f.title.trim() !== was.title) b.title = f.title.trim();
  if (f.startDate !== was.startDate) b.startDate = f.startDate;
  if (f.endDate !== was.endDate) b.endDate = f.endDate || null;
  if ((f.place?.id ?? null) !== (was.place?.id ?? null)) b.placeId = f.place?.id ?? null;
  if ([...f.personIds].sort().join() !== [...was.personIds].sort().join()) b.personIds = f.personIds;
  if (f.newPersons.length) b.newPersons = f.newPersons;
  if (f.phrase !== was.phrase) b.phrase = f.phrase;
  if (f.rating !== was.rating) b.rating = f.rating;
  if (f.description !== was.description) b.description = f.description;
  if (domainTouched) {
    if (f.projectId !== was.projectId) b.projectId = f.projectId || null;
    if (!f.projectId && f.domainId !== was.domainId) b.domainId = f.domainId || null;
  }
  return b;
}

// ---------- Photo strip (EX-12: cover star, ×, +) ----------
function useUploads(id: string) {
  const qc = useQueryClient();
  const state = useSyncExternalStore(subscribeUploads, () => uploadState(id));
  const sent = state?.sent ?? 0;
  const failed = state?.failed.length ?? 0;
  useEffect(() => {
    if (!sent && !failed) return;
    qc.invalidateQueries({ queryKey: ['souvenir', id] });
    // D-169: the places are looked for again around the photos that just arrived.
    qc.invalidateQueries({ queryKey: ['souvenir-suggestions', id] });
  }, [sent, failed, id, qc]);
  return state;
}

function PhotoStrip({ s, editable = true }: { s: Souvenir; editable?: boolean }) {
  const qc = useQueryClient();
  const up = useUploads(s.id);
  const refresh = () => qc.invalidateQueries({ queryKey: ['souvenir', s.id] });
  const cover = useAction((photoId: string) => post(`/souvenirs/${s.id}/cover`, { photoId }));
  const remove = useAction((photoId: string) => del(`/photos/${photoId}`));
  const add = async (files: File[]) => {
    if (!files.length) return;
    queueUploads(s.id, await preparePhotos(files), refresh);
  };
  const pending = up && !up.done ? up.total - up.sent - up.failed.length : 0;
  const mb = up ? (up.bytes / 1_000_000).toFixed(1).replace('.', ',') : null;
  return (
    <div>
      <Label
        aside={
          up
            ? `${up.sent} / ${up.total} envoyée${up.sent > 1 ? 's' : ''} · ${mb} Mo`
            : `${s.photoCount} photo${s.photoCount > 1 ? 's' : ''}`
        }
      >
        Photos{editable && s.photoCount > 1 ? ' · touchez pour choisir la une' : ''}
      </Label>
      <div className="photo-strip">
        {s.photos.map((p) => (
          <div key={p.id} className={`photo-tile ${p.id === s.coverPhotoId ? 'cover' : ''}`}>
            <button
              type="button"
              className="w-full h-full border-0 p-0 bg-transparent cursor-pointer"
              onClick={() => editable && cover.mutate(p.id)}
              aria-label={p.id === s.coverPhotoId ? 'Photo à la une' : 'Mettre à la une'}
            >
              <img src={photoUrl(p.id, 'thumb')} alt="" />
            </button>
            {p.id === s.coverPhotoId && (
              <span
                className="absolute left-1 top-1 text-[11px] rounded-full px-1.5"
                style={{ background: 'var(--experience)', color: 'var(--experience-text)' }}
              >
                ★ à la une
              </span>
            )}
            {editable && (
              <button
                type="button"
                className="photo-x"
                aria-label="Retirer la photo"
                onClick={() => remove.mutate(p.id)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {Array.from({ length: Math.max(0, pending) }, (_, i) => (
          <div
            key={`p${i}`}
            className="photo-tile grid place-items-center text-[12px]"
            style={{ color: 'var(--text-ghost)' }}
          >
            envoi…
          </div>
        ))}
        {editable && (
          <label
            className="photo-tile grid place-items-center text-[28px]"
            style={{
              border: '1px dashed var(--btn-border)',
              background: 'var(--surface-2)',
              color: 'var(--text-ghost)',
            }}
          >
            +
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Ajouter des photos"
              onChange={(e) => add([...(e.target.files ?? [])])}
            />
          </label>
        )}
      </div>
      {up?.failed.map((f) => (
        <div key={f.name} className="text-[12px]" style={{ color: 'var(--late-text)' }}>
          {f.name} : {f.message}
        </div>
      ))}
      {s.tooManyPhotos && (
        <div className="text-[12px]" style={{ color: 'var(--late-text)' }}>
          Plus de 30 photos : pense à garder les plus belles.
        </div>
      )}
    </div>
  );
}

// ---------- Check screen (EX-12) ----------
export function SouvenirVerifyPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const q = useSouvenir(id);
  const sugg = useQuery({
    queryKey: ['souvenir-suggestions', id],
    queryFn: () => get<Suggestions>(`/souvenirs/${id}/suggestions`),
    enabled: !!q.data,
    staleTime: 5 * 60_000,
  });
  const [f, setF] = useState<FormState | null>(null);
  const [domainTouched, setDomainTouched] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  useEffect(() => {
    if (q.data && !f) setF(formOf(q.data));
  }, [q.data, f]);
  // The first candidate of OSM becomes the place when the draft has none yet (the capture could not reach it).
  useEffect(() => {
    if (!f || f.place || !q.data || q.data.status !== 'draft') return;
    const c = sugg.data?.places[0];
    if (c?.id) setF({ ...f, place: { id: c.id, name: c.name, category: c.category ?? null } });
  }, [sugg.data, f, q.data]);
  const save = useAction(() => post<Souvenir>(`/souvenirs/${id}/save`, bodyOf(q.data!, f!, domainTouched)), {
    onSuccess: () => navigate({ to: '/souvenirs/$id', params: { id } }),
    toast: 'Souvenir enregistré.',
  });
  const cancel = useAction(() => del(`/souvenirs/${id}`), {
    onSuccess: () => navigate({ to: '/experiences', search: { onglet: 'vecues' } }),
    toast: 'Capture annulée.',
  });
  const attach = useAction((taskId: string) => post<Souvenir>(`/souvenirs/${id}/attach`, { taskId }), {
    onSuccess: (s) => setF(formOf(s)),
    toast: 'Rattaché à l’expérience prévue.',
  });
  const merge = useAction((intoId: string) => post<Souvenir>(`/souvenirs/${id}/merge`, { intoId }), {
    onSuccess: (s) => navigate({ to: '/souvenirs/$id', params: { id: s.id } }),
    toast: 'Photos ajoutées au souvenir existant.',
  });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data || !f) return <Loading />;
  const s = q.data;
  const draft = s.status === 'draft';
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const leave = () => (draft ? setConfirmCancel(true) : navigate({ to: '/souvenirs/$id', params: { id } }));
  return (
    <div className="flex flex-col gap-4 mx-auto w-full" style={{ maxWidth: 560 }}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="link-btn text-[15px]" onClick={leave}>
          Annuler
        </button>
        <span className="text-[16px] font-semibold">
          {draft ? 'Nouveau souvenir' : 'Vérifier le souvenir'}
        </span>
        <span style={{ width: 56 }} />
      </div>
      {s.source === 'share' && (
        <div className="text-[12px] text-center" style={{ color: 'var(--text-ghost)' }}>
          Créé depuis Photos → Partager → Mémento · {s.photoCount} photo{s.photoCount > 1 ? 's' : ''}
        </div>
      )}
      {draft &&
        sugg.data?.attach.map((a) => (
          <Banner key={a.taskId}>
            <span>
              C'est « <b>{a.title}</b> » ?{' '}
              <span style={{ color: 'var(--text-faint)' }}>
                {a.dueDate ? `prévue le ${fmtSpan(a.dueDate, null, false)}` : 'prévue cette semaine'}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={attach.isPending}
              onClick={() => attach.mutate(a.taskId)}
            >
              Rattacher
            </button>
          </Banner>
        ))}
      {draft && sugg.data?.duplicate && (
        <Banner>
          <span>
            Un souvenir existe déjà ce jour-là ici : « <b>{sugg.data.duplicate.title}</b> ». Ajouter ces
            photos au souvenir existant ?
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={merge.isPending}
            onClick={() => merge.mutate(sugg.data!.duplicate!.id)}
          >
            Ajouter
          </button>
        </Banner>
      )}
      <PhotoStrip s={s} />
      <SouvenirFields s={s} f={f} set={set} suggestions={sugg.data} touched={() => setDomainTouched(true)} />
      <button
        type="button"
        className="btn btn-primary w-full"
        style={{ minHeight: 50, fontSize: 16 }}
        disabled={save.isPending || !f.title.trim()}
        onClick={() => save.mutate(undefined)}
      >
        Enregistrer
      </button>
      <div className="text-[12px] text-center" style={{ color: 'var(--text-ghost)' }}>
        Les photos finissent de s'envoyer en arrière-plan.
      </div>
      <ConfirmDialog
        open={confirmCancel}
        title="Annuler la capture ?"
        confirmLabel="Supprimer le brouillon"
        onConfirm={() => cancel.mutate(undefined)}
        onClose={() => setConfirmCancel(false)}
      >
        Le brouillon, son expérience et ses photos sont supprimés.
      </ConfirmDialog>
    </div>
  );
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div
      className="card flex items-center justify-between gap-3 text-[14px]"
      style={{ padding: '10px 12px', borderLeft: '4px solid var(--experience)' }}
    >
      {children}
    </div>
  );
}

// ---------- Full-screen gallery (EX-50: arrows, keyboard) ----------
function Gallery({ s, start, onClose }: { s: Souvenir; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const n = s.photos.length;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % n);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % n);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [n, onClose]);
  const touch = useRef<number | null>(null);
  const p = s.photos[i];
  if (!p) return null;
  return (
    <div
      className="gallery"
      role="dialog"
      aria-modal="true"
      aria-label={`${s.title} · photo ${i + 1} sur ${n}`}
      onTouchStart={(e) => {
        touch.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 40) setI((x) => (x + (dx < 0 ? 1 : -1) + n) % n);
        touch.current = null;
      }}
    >
      <img src={photoUrl(p.id, 'full')} alt={`${s.title} (${i + 1} sur ${n})`} />
      <button
        type="button"
        className="gallery-btn"
        style={{ top: 16, right: 16 }}
        onClick={onClose}
        aria-label="Fermer"
      >
        ✕
      </button>
      {n > 1 && (
        <>
          <button
            type="button"
            className="gallery-btn"
            style={{ left: 16, top: '50%' }}
            onClick={() => setI((i - 1 + n) % n)}
            aria-label="Photo précédente"
          >
            ‹
          </button>
          <button
            type="button"
            className="gallery-btn"
            style={{ right: 16, top: '50%' }}
            onClick={() => setI((i + 1) % n)}
            aria-label="Photo suivante"
          >
            ›
          </button>
        </>
      )}
      <span
        className="absolute bottom-4 left-0 right-0 text-center text-[13px]"
        style={{ color: 'rgba(255,255,255,.8)' }}
      >
        {i + 1} / {n}
        {p.takenAt
          ? ` · ${new Date(p.takenAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short' })}`
          : ''}
      </span>
    </div>
  );
}

// ---------- Souvenir sheet (EX-50, EX-15) ----------
export function SouvenirPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useSouvenir(id);
  const dl = useDomainLookup();
  const [gallery, setGallery] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<FormState | null>(null);
  const [domainTouched, setDomainTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  useUploads(id);
  const sugg = useQuery({
    queryKey: ['souvenir-suggestions', id],
    queryFn: () => get<Suggestions>(`/souvenirs/${id}/suggestions`),
    enabled: editing,
  });
  const save = useAction(() => patch<Souvenir>(`/souvenirs/${id}`, bodyOf(q.data!, f!, domainTouched)), {
    onSuccess: () => setEditing(false),
    toast: 'Souvenir modifié.',
  });
  const remove = useAction(() => del(`/souvenirs/${id}`), {
    onSuccess: () => navigate({ to: '/experiences', search: { onglet: 'vecues' } }),
    toast: 'Souvenir supprimé.',
  });
  const move = useAction(({ photoId, position }: { photoId: string; position: number }) =>
    patch(`/photos/${photoId}`, { position }),
  );
  const cover = useAction((photoId: string) => post(`/souvenirs/${id}/cover`, { photoId }));
  const removePhoto = useAction((photoId: string) => del(`/photos/${photoId}`));
  const route = useMemo(
    () =>
      (q.data?.photos ?? [])
        .filter((p) => p.lat != null && p.lng != null)
        .sort((a, b) => (a.takenAt ?? '').localeCompare(b.takenAt ?? ''))
        .map((p) => ({ lat: p.lat!, lng: p.lng! })),
    [q.data],
  );
  const points = useMemo(
    () =>
      q.data?.place
        ? [
            {
              key: q.data.place.id,
              lat: q.data.place.lat,
              lng: q.data.place.lng,
              title: q.data.place.name,
              label: '★',
            },
          ]
        : route.map((p, i) => ({ key: String(i), ...p, title: `Photo ${i + 1}` })),
    [q.data, route],
  );
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const s = q.data;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files].filter(
      (x) => x.type.startsWith('image/') || /\.(heic|jpe?g|png|webp)$/i.test(x.name),
    );
    if (files.length)
      queueUploads(id, await preparePhotos(files), () =>
        qc.invalidateQueries({ queryKey: ['souvenir', id] }),
      );
  };
  const cover0 = s.coverPhotoId;
  return (
    <div
      className={`flex flex-col gap-5 ${dragOver ? 'drop-zone' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={drop}
    >
      <div>
        <Breadcrumb
          items={[
            { label: 'Expériences', to: '/experiences', search: { onglet: 'vecues' } },
            { label: s.title },
          ]}
        />
        <PageHeader
          eyebrow={`${fmtSpan(s.startDate, s.endDate)}${s.days > 1 ? ` · ${s.days} jours` : ''}${s.place ? ` · ${s.place.name}` : ''}`}
          title={s.title}
          actions={
            <>
              {s.status === 'draft' && (
                <Link to="/souvenirs/$id/verifier" params={{ id }} className="btn btn-primary">
                  Vérifier
                </Link>
              )}
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setF(formOf(s));
                  setDomainTouched(false);
                  setEditing(true);
                }}
              >
                Modifier
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(true)}>
                Supprimer
              </button>
            </>
          }
        />
      </div>
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}
      >
        <div className="flex flex-col gap-3 min-w-0">
          <button
            type="button"
            className="border-0 p-0 bg-transparent cursor-zoom-in text-left"
            onClick={() =>
              s.photos.length &&
              setGallery(
                Math.max(
                  0,
                  s.photos.findIndex((p) => p.id === cover0),
                ),
              )
            }
            aria-label="Voir les photos en grand"
          >
            <Cover photoId={cover0} size="full" height="min(62vh, 620px)" alt={s.title} rounded={14} />
          </button>
          {s.photos.length > 0 && (
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Photos (glisser pour changer l'ordre)"
            >
              {s.photos.map((p, i) => (
                <div
                  key={p.id}
                  className={`photo-tile ${p.id === cover0 ? 'cover' : ''}`}
                  style={{ width: 84, height: 84, opacity: dragged === p.id ? 0.4 : 1 }}
                  draggable
                  onDragStart={(e) => {
                    setDragged(p.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragged(null)}
                  onDragOver={(e) => dragged && e.preventDefault()}
                  onDrop={(e) => {
                    if (!dragged) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragged !== p.id) move.mutate({ photoId: dragged, position: i });
                    setDragged(null);
                  }}
                >
                  <button
                    type="button"
                    className="w-full h-full border-0 p-0 bg-transparent cursor-pointer"
                    onClick={() => setGallery(i)}
                    aria-label={`Photo ${i + 1}`}
                  >
                    <img src={photoUrl(p.id, 'thumb')} alt="" />
                  </button>
                  {p.id !== cover0 && (
                    <button
                      type="button"
                      className="photo-x"
                      style={{ right: 'auto', left: 4 }}
                      title="Mettre à la une"
                      aria-label="Mettre à la une"
                      onClick={() => cover.mutate(p.id)}
                    >
                      ★
                    </button>
                  )}
                  <button
                    type="button"
                    className="photo-x"
                    aria-label="Retirer la photo"
                    onClick={() => removePhoto.mutate(p.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <label
                className="photo-tile grid place-items-center text-[24px]"
                style={{
                  width: 84,
                  height: 84,
                  border: '1px dashed var(--btn-border)',
                  background: 'var(--surface-2)',
                  color: 'var(--text-ghost)',
                }}
                title="Ajouter des photos (ou glisser-déposer sur la page)"
              >
                +
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  aria-label="Ajouter des photos"
                  onChange={async (e) => {
                    const files = [...(e.target.files ?? [])];
                    if (files.length)
                      queueUploads(id, await preparePhotos(files), () =>
                        qc.invalidateQueries({ queryKey: ['souvenir', id] }),
                      );
                  }}
                />
              </label>
            </div>
          )}
          {s.photos.length === 0 && (
            <label className="text-[13px] cursor-pointer" style={{ color: 'var(--text-faint)' }}>
              Glisse des photos sur la page, ou <span className="link-btn">choisis-les</span>.
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  if (files.length)
                    queueUploads(id, await preparePhotos(files), () =>
                      qc.invalidateQueries({ queryKey: ['souvenir', id] }),
                    );
                }}
              />
            </label>
          )}
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          {editing && f ? (
            <div className="card flex flex-col gap-4" style={{ padding: '18px 20px' }}>
              <SouvenirFields
                s={s}
                f={f}
                set={set}
                suggestions={sugg.data}
                touched={() => setDomainTouched(true)}
              />
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn" onClick={() => setEditing(false)}>
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={save.isPending || !f.title.trim()}
                  onClick={() => save.mutate(undefined)}
                >
                  Enregistrer
                </button>
              </div>
            </div>
          ) : (
            <div className="card flex flex-col gap-3" style={{ padding: '18px 20px' }}>
              {s.phrase && (
                <div className="text-[17px] italic" style={{ color: 'var(--text-2)' }}>
                  « {s.phrase} »
                </div>
              )}
              <Info label="Quand">
                {fmtSpan(s.startDate, s.endDate)}
                {s.days > 1 ? ` · ${s.days} jours vécus` : ''}
              </Info>
              <Info label="Où">
                {s.place ? (
                  <>
                    {placeLabel(s.place)}
                    {(s.place.address || s.place.city) && (
                      <span style={{ color: 'var(--text-faint)' }}> · {fmtAddress(s.place)}</span>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-ghost)' }}>aucun lieu</span>
                )}
              </Info>
              <Info label="Avec qui">
                {s.persons.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {s.persons.map((p) => (
                      <Chip key={p.id} small>
                        <Avatar name={p.name} color={p.color} size={16} />
                        {p.name}
                      </Chip>
                    ))}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-ghost)' }}>personne de noté</span>
                )}
              </Info>
              {s.rating && <Info label="Note">{RATING_LABEL[s.rating as Rating]}</Info>}
              <Info label="Domaine">
                <span className="inline-flex items-center gap-1.5">
                  <span className="dot" style={{ background: dl.color(s.domainId) }} />
                  {dl.name(s.domainId)}
                </span>
              </Info>
              {s.projectId && (
                <Info label="Projet">
                  <Link to="/projets/$id" params={{ id: s.projectId }}>
                    {s.projectTitle}
                  </Link>
                </Info>
              )}
              <Info label="Expérience">
                <Link to="/experiences" search={{ tache: s.taskId }}>
                  Ouvrir la tâche
                </Link>
              </Info>
              {s.description.trim() && (
                <div className="text-[14px] whitespace-pre-wrap" style={{ color: 'var(--text-2)' }}>
                  {s.description}
                </div>
              )}
            </div>
          )}
          {points.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="label-caps">{route.length > 1 ? 'Parcours des photos' : 'Sur la carte'}</span>
              <SouvenirLeaflet points={points} route={route} cluster={false} height={260} />
            </div>
          )}
        </div>
      </div>
      {gallery !== null && <Gallery s={s} start={gallery} onClose={() => setGallery(null)} />}
      <ConfirmDialog
        open={confirmDelete}
        title="Supprimer ce souvenir ?"
        confirmLabel="Supprimer"
        onConfirm={() => remove.mutate(undefined)}
        onClose={() => setConfirmDelete(false)}
      >
        Le souvenir, son expérience (elle ne compte plus comme vécue) et ses photos sont supprimés.
      </ConfirmDialog>
    </div>
  );
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 text-[14px]" style={{ gridTemplateColumns: '92px 1fr' }}>
      <span className="text-[12px] pt-0.5" style={{ color: 'var(--text-faint)' }}>
        {label}
      </span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

// ---------- Journal and map (EX-50, EX-51) ----------
export type SouvenirsView = 'journal' | 'carte';
interface Filters {
  personId: string;
  domainId: string;
  category: string;
  rating: string;
  from: string;
  to: string;
  withPhotos: boolean;
}
const NO_FILTER: Filters = {
  personId: '',
  domainId: '',
  category: '',
  rating: '',
  from: '',
  to: '',
  withPhotos: false,
};
const queryOf = (f: Filters) => {
  const p = new URLSearchParams();
  if (f.personId) p.set('personId', f.personId);
  if (f.domainId) p.set('domainId', f.domainId);
  if (f.category) p.set('category', f.category);
  if (f.rating) p.set('rating', f.rating);
  if (f.from) p.set('from', `${f.from}-01`);
  if (f.to) {
    const [y, m] = f.to.split('-').map(Number);
    p.set('to', `${f.to}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`);
  }
  if (f.withPhotos) p.set('withPhotos', 'true');
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** The « Vécues » tab of Expériences: the journal by month, or the map (EX-50, EX-51). */
export function SouvenirsJournal({ vue, onVue }: { vue: SouvenirsView; onVue: (v: SouvenirsView) => void }) {
  const dl = useDomainLookup();
  const persons = usePersons();
  const [f, setF] = useState<Filters>(NO_FILTER);
  const [more, setMore] = useState(false);
  const [radius, setRadius] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const qs = queryOf(f);
  const list = useQuery({ queryKey: ['souvenirs', qs], queryFn: () => get<Souvenir[]>(`/souvenirs${qs}`) });
  const map = useQuery({
    queryKey: ['souvenir-map', qs],
    queryFn: () => get<SouvenirMap>(`/map/souvenirs${qs}`),
    enabled: vue === 'carte',
  });
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const souvenirs = list.data ?? [];
  const byMonth = new Map<string, Souvenir[]>();
  for (const s of souvenirs)
    byMonth.set(s.startDate.slice(0, 7), [...(byMonth.get(s.startDate.slice(0, 7)) ?? []), s]);
  const stats = {
    n: souvenirs.length,
    places: new Set(souvenirs.map((s) => s.place?.id).filter(Boolean)).size,
    days: souvenirs.reduce((a, s) => a + s.days, 0),
  };
  const categories = [...new Set(souvenirs.map((s) => s.place?.category).filter((c): c is string => !!c))];
  const points = useMemo(
    () =>
      (map.data?.points ?? []).map((p) => ({
        key: p.placeId,
        lat: p.lat,
        lng: p.lng,
        label: String(p.count),
        title: `${p.name} · ${p.count} souvenir${p.count > 1 ? 's' : ''}`,
      })),
    [map.data],
  );
  const point = map.data?.points.find((p) => p.placeId === selected);
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTER);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <Tabs
          value={vue}
          options={[
            { value: 'journal', label: 'Journal' },
            { value: 'carte', label: 'Carte' },
          ]}
          onChange={onVue}
        />
        <span className="text-[13px] mono" style={{ color: 'var(--text-faint)' }}>
          {stats.n} souvenir{stats.n > 1 ? 's' : ''} · {stats.places} lieu{stats.places > 1 ? 'x' : ''} ·{' '}
          {stats.days} jour{stats.days > 1 ? 's' : ''} vécu{stats.days > 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        <Chip on={!f.personId} onClick={() => set('personId', '')}>
          Tout le monde
        </Chip>
        {(persons.data ?? [])
          .filter((p) => p.active && !p.toConfirm)
          .map((p) => (
            <Chip
              key={p.id}
              on={f.personId === p.id}
              onClick={() => set('personId', f.personId === p.id ? '' : p.id)}
            >
              <Avatar name={p.name} color={p.color} />
              {p.name}
            </Chip>
          ))}
        <Chip on={more || filtered} onClick={() => setMore((m) => !m)}>
          Domaine, lieu, période, note {more ? '▴' : '▾'}
        </Chip>
        {filtered && (
          <button type="button" className="link-btn text-[13px]" onClick={() => setF(NO_FILTER)}>
            Tout effacer
          </button>
        )}
      </div>
      {more && (
        <div
          className="card grid gap-3"
          style={{ padding: '14px 16px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
        >
          <Field label="Domaine">
            <select value={f.domainId} onChange={(e) => set('domainId', e.target.value)}>
              <option value="">Tous</option>
              {dl.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type de lieu">
            <select value={f.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Tous</option>
              {[...new Set([...categories, f.category].filter(Boolean))].map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c] ?? c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note">
            <select value={f.rating} onChange={(e) => set('rating', e.target.value)}>
              <option value="">Toutes</option>
              {(Object.keys(RATING_LABEL) as Rating[]).map((r) => (
                <option key={r} value={r}>
                  {RATING_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Depuis">
            <input type="month" value={f.from} onChange={(e) => set('from', e.target.value)} />
          </Field>
          <Field label="Jusqu'à">
            <input type="month" value={f.to} onChange={(e) => set('to', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-[14px] self-end" style={{ minHeight: 40 }}>
            <input
              type="checkbox"
              checked={f.withPhotos}
              onChange={(e) => set('withPhotos', e.target.checked)}
            />
            Avec photos
          </label>
        </div>
      )}
      {list.isError && <ErrorBox error={list.error} />}
      {vue === 'journal' &&
        (list.isLoading ? (
          <Loading />
        ) : souvenirs.length === 0 ? (
          <Empty>
            {filtered
              ? 'Aucun souvenir avec ces filtres.'
              : 'Pas encore de souvenir : « + Souvenir » sur le téléphone, juste après une sortie.'}
          </Empty>
        ) : (
          [...byMonth].map(([m, items]) => (
            <div key={m} className="flex flex-col gap-2">
              <div className="mono text-[13px]" style={{ color: 'var(--text-faint)' }}>
                {monthTitle(m)}
              </div>
              <div className="souvenir-grid">
                {items.map((s) => (
                  <SouvenirCard key={s.id} s={s} />
                ))}
              </div>
            </div>
          ))
        ))}
      {vue === 'carte' && (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
        >
          <div className="flex flex-col gap-2 min-w-0" style={{ gridColumn: 'span 2' }}>
            <SouvenirLeaflet
              points={points}
              home={map.data?.home}
              radiusM={radius ? map.data?.lifeRadiusM : null}
              onSelect={setSelected}
            />
            <div
              className="flex flex-wrap justify-between gap-2 text-[12px]"
              style={{ color: 'var(--text-ghost)' }}
            >
              <span>
                Un point par lieu, regroupé quand on dézoome. Le chiffre : le nombre de souvenirs à ce lieu.
              </span>
              {map.data?.home && map.data.lifeRadiusM && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={radius} onChange={(e) => setRadius(e.target.checked)} />
                  Rayon de vie ({Math.round(map.data.lifeRadiusM / 1000)} km, 80 % des souvenirs)
                </label>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 min-w-0">
            {point ? (
              <div className="card overflow-hidden" style={{ padding: 0 }}>
                <Cover photoId={point.last.coverPhotoId} height={170} alt={point.last.title} />
                <div className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="text-[15px] font-semibold">{placeLabel(point)}</div>
                  {point.city && (
                    <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                      {point.city}
                    </div>
                  )}
                  {point.souvenirs.map((x) => (
                    <Link
                      key={x.id}
                      to="/souvenirs/$id"
                      params={{ id: x.id }}
                      className="text-[14px] flex justify-between gap-2"
                    >
                      <span className="truncate">{x.title}</span>
                      <span className="text-[12px] flex-none" style={{ color: 'var(--text-faint)' }}>
                        {fmtSpan(x.startDate, x.endDate, false)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <Empty>Touche un point pour voir ses souvenirs.</Empty>
            )}
            {souvenirs.some((s) => !s.place) && (
              <div className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
                {souvenirs.filter((s) => !s.place).length} souvenir(s) sans lieu ne sont pas sur la carte.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- « Il y a un an » (EX-52), on Ma semaine ----------
export function OnThisDayCard() {
  const q = useQuery({
    queryKey: ['on-this-day'],
    queryFn: () => get<{ souvenir: OnThisDay | null }>('/souvenirs/on-this-day'),
    staleTime: 60 * 60_000,
  });
  const s = q.data?.souvenir;
  if (!s) return null;
  const when = s.sameDay
    ? s.yearsAgo === 1
      ? 'Il y a un an jour pour jour'
      : `Il y a ${s.yearsAgo} ans jour pour jour`
    : s.yearsAgo === 1
      ? 'Il y a un an, cette semaine'
      : `Il y a ${s.yearsAgo} ans, cette semaine`;
  return (
    <Link
      to="/souvenirs/$id"
      params={{ id: s.id }}
      className="card flex items-stretch overflow-hidden no-underline"
      style={{ padding: 0, color: 'inherit' }}
    >
      <div style={{ width: 112, flex: 'none' }}>
        <Cover photoId={s.coverPhotoId} size="thumb" height="100%" alt={s.title} />
      </div>
      <div className="flex flex-col gap-0.5 px-4 py-3 min-w-0">
        <span className="label-caps">{when}</span>
        <span className="text-[15px] font-semibold truncate">{s.title}</span>
        <span className="text-[12px] truncate" style={{ color: 'var(--text-faint)' }}>
          {fmtSpan(s.startDate, s.endDate, false)}
          {s.place ? ` · ${s.place.name}` : ''}
          {s.persons.length ? ` · avec ${s.persons.map((p) => p.name).join(', ')}` : ''}
        </span>
        {s.phrase && (
          <span className="text-[13px] italic truncate" style={{ color: 'var(--text-muted)' }}>
            « {s.phrase} »
          </span>
        )}
      </div>
    </Link>
  );
}
