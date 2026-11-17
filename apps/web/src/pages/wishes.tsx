// Envies (EX-40, EX-41): the reserve of ideas in typed lists, « + Envie » (a title, a list), a shared or pasted
// link read by the server (D-164), « Que faire ? » filters over one's own wishes, Planifier and Archiver. The
// status (envie, planifiée, vécue, archivée) is computed by the API (D-165).
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Breadcrumb, usePageFab } from '../components/shell.tsx';
import { Avatar, Chip, PersonPicker, PlacePicker, usePersons } from '../components/souvenir-ui.tsx';
import { DurationOptions } from '../components/tasks.tsx';
import { ConfirmDialog, Empty, ErrorBox, Field, Loading, PageHeader, Panel } from '../components/ui.tsx';
import { del, get, patch, post } from '../lib/api.ts';
import { fmtMin } from '../lib/format.ts';
import { useAction } from '../lib/hooks.ts';
import {
  type CaptureResult,
  fmtAddress,
  fmtSpan,
  placeLabel,
  type Wish,
  type WishList,
  wishImageUrl,
} from '../lib/souvenirs.ts';
import type { TaskDuration } from '../lib/types.ts';

const useWishLists = () =>
  useQuery({ queryKey: ['wish-lists'], queryFn: () => get<WishList[]>('/wish-lists'), staleTime: 60_000 });

const STATUS: Record<string, { label: string; color: string }> = {
  wish: { label: 'Envie', color: 'var(--text-faint)' },
  planned: { label: 'Planifiée', color: 'var(--ahead-text)' },
  lived: { label: 'Vécue', color: 'var(--ok)' },
  archived: { label: 'Archivée', color: 'var(--text-ghost)' },
};
const todayParis = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

function StatusTag({ w }: { w: Wish }) {
  const s = STATUS[w.status];
  return (
    <span
      className="text-[12px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap"
      style={{ background: 'var(--bin)', color: s.color }}
    >
      {s.label}
      {w.status === 'planned' && w.plannedTask?.dueDate
        ? ` · ${fmtSpan(w.plannedTask.dueDate, null, false)}`
        : ''}
      {w.livedCount > 0 && w.status !== 'lived' ? ` · vécue ${w.livedCount}×` : ''}
    </span>
  );
}

/** « Planifier »: a date (today or later); the API creates the dated experience in that week's plan. */
function PlanButton({ w, small = true }: { w: Wish; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(w.plannedTask?.dueDate ?? todayParis());
  const plan = useAction(() => post(`/wishes/${w.id}/plan`, { date }), {
    onSuccess: () => setOpen(false),
    toast: 'Planifiée : ajoutée au plan de sa semaine.',
  });
  return (
    <>
      <button type="button" className={`btn ${small ? 'btn-sm' : ''}`} onClick={() => setOpen(true)}>
        {w.status === 'planned' ? 'Replanifier' : 'Planifier'}
      </button>
      <Panel
        open={open}
        onClose={() => setOpen(false)}
        title={`Planifier « ${w.title} »`}
        side={false}
        width={420}
      >
        <Field label="Quel jour ?" hint="Une expérience datée est créée et rejoint le plan de cette semaine.">
          <input type="date" value={date} min={todayParis()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!date || plan.isPending}
            onClick={() => plan.mutate(undefined)}
          >
            Planifier
          </button>
        </div>
      </Panel>
    </>
  );
}

function WishCard({ w }: { w: Wish }) {
  const archive = useAction(() =>
    patch(`/wishes/${w.id}`, { status: w.status === 'archived' ? 'wish' : 'archived' }),
  );
  const persons = usePersons();
  const who = (persons.data ?? []).filter((p) => w.personIds.includes(p.id));
  return (
    <div className="card overflow-hidden flex flex-col" style={{ padding: 0 }}>
      <Link
        to="/envies/$id"
        params={{ id: w.id }}
        className="no-underline flex flex-col"
        style={{ color: 'inherit' }}
      >
        {w.hasImage && (
          <div style={{ height: 140, background: 'var(--chip)' }}>
            <img src={wishImageUrl(w.id)} alt="" loading="lazy" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="flex flex-col gap-1 px-3 pt-2.5">
          <div className="flex justify-between gap-2 items-start">
            <span className="text-[15px] font-semibold">{w.title}</span>
            <StatusTag w={w} />
          </div>
          <div className="text-[12px] flex flex-wrap gap-x-3" style={{ color: 'var(--text-muted)' }}>
            {w.listName && <span>{w.listName}</span>}
            {w.place && (
              <span>
                {w.place.name}
                {w.distanceKm != null ? ` · ${w.distanceKm} km` : ''}
              </span>
            )}
            {w.startDate && <span>{fmtSpan(w.startDate, w.endDate, false)}</span>}
            {w.price && <span>{w.price}</span>}
            {w.durationMin && <span>{fmtMin(w.durationMin)}</span>}
            {w.dogAllowed === 'yes' && <span>chien accepté</span>}
          </div>
          {who.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {who.map((p) => (
                <Chip key={p.id} small>
                  <Avatar name={p.name} color={p.color} size={16} />
                  {p.name}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </Link>
      <div className="flex gap-2 px-3 py-2.5 mt-auto">
        {w.status !== 'archived' && <PlanButton w={w} />}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => archive.mutate(undefined)}>
          {w.status === 'archived' ? 'Désarchiver' : 'Archiver'}
        </button>
      </div>
    </div>
  );
}

/** « + Envie » (CE-33): a title and a list in two gestures; or a link (page, event, place) read by the server. */
function NewWishPanel({ onClose, listId: initialList }: { onClose: () => void; listId: string }) {
  const navigate = useNavigate();
  const lists = useWishLists();
  const [title, setTitle] = useState('');
  const [listId, setListId] = useState(initialList);
  const [url, setUrl] = useState('');
  const create = useAction(() => post<Wish>('/wishes', { title: title.trim(), listId: listId || null }), {
    onSuccess: onClose,
    toast: 'Envie ajoutée.',
  });
  const fromUrl = useAction(
    () => post<CaptureResult>('/captures', { url: url.trim(), clientCaptureId: crypto.randomUUID() }),
    {
      onSuccess: (r) => {
        onClose();
        navigate({ to: '/envies/$id', params: { id: r.id } });
      },
      toast: 'Envie créée depuis le lien.',
    },
  );
  const isUrl = /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <Panel open onClose={onClose} title="Nouvelle envie">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate(undefined);
        }}
      >
        <Field label="Quoi">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ex. Baptême de plongée"
          />
        </Field>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Liste">
          {(lists.data ?? []).map((l) => (
            <Chip key={l.id} on={listId === l.id} onClick={() => setListId(listId === l.id ? '' : l.id)}>
              {l.name}
            </Chip>
          ))}
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary" disabled={!title.trim() || create.isPending}>
            Ajouter aux envies
          </button>
        </div>
      </form>
      <div style={{ borderTop: '1px solid var(--border)' }} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (isUrl) fromUrl.mutate(undefined);
        }}
      >
        <Field
          label="Ou coller un lien"
          info="Une page (événement, restaurant, lieu), un lien Google Maps ou Plans. Mémento lit le titre, l'image, les dates, le lieu et le tarif quand la page les donne ; une page illisible garde le lien et un titre à confirmer."
        >
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
          />
        </Field>
        <div className="flex justify-end">
          <button type="submit" className="btn" disabled={!isUrl || fromUrl.isPending}>
            {fromUrl.isPending ? 'Lecture de la page…' : 'Créer depuis le lien'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

// ---------- List page with « Que faire ? » (EX-41) ----------
interface Filters {
  listId: string;
  status: string;
  dog: string;
  maxDurationMin: string;
  maxKm: string;
  done: string;
  season: string;
  q: string;
}
const NO_FILTER: Filters = {
  listId: '',
  status: '',
  dog: '',
  maxDurationMin: '',
  maxKm: '',
  done: '',
  season: '',
  q: '',
};

export function WishesPage() {
  const lists = useWishLists();
  const [f, setF] = useState<Filters>(NO_FILTER);
  const [adding, setAdding] = useState(false);
  const [more, setMore] = useState(false);
  usePageFab('Nouvelle envie', () => setAdding(true));
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const wishes = useQuery({
    queryKey: ['wishes', qs],
    queryFn: () => get<Wish[]>(`/wishes${qs ? `?${qs}` : ''}`),
  });
  const filtered = JSON.stringify({ ...f, listId: '' }) !== JSON.stringify(NO_FILTER);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Breadcrumb items={[{ label: 'Souvenirs', to: '/souvenirs' }, { label: 'Envies' }]} />
        <PageHeader
          eyebrow="Ne plus perdre une idée · que faire ?"
          title="Envies"
          actions={
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              + Envie
            </button>
          }
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Listes">
        <Chip on={!f.listId} onClick={() => set('listId', '')}>
          Toutes
        </Chip>
        {(lists.data ?? []).map((l) => (
          <Chip
            key={l.id}
            on={f.listId === l.id}
            onClick={() => set('listId', f.listId === l.id ? '' : l.id)}
          >
            {l.name}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="label-caps mr-1">Que faire ?</span>
        <Chip on={f.dog === 'yes'} onClick={() => set('dog', f.dog === 'yes' ? '' : 'yes')}>
          Avec le chien
        </Chip>
        <Chip
          on={f.maxDurationMin === '120'}
          onClick={() => set('maxDurationMin', f.maxDurationMin === '120' ? '' : '120')}
        >
          2 h au plus
        </Chip>
        <Chip on={f.maxKm === '30'} onClick={() => set('maxKm', f.maxKm === '30' ? '' : '30')}>
          À moins de 30 km
        </Chip>
        <Chip on={f.done === 'false'} onClick={() => set('done', f.done === 'false' ? '' : 'false')}>
          Jamais fait
        </Chip>
        <Chip on={f.done === 'true'} onClick={() => set('done', f.done === 'true' ? '' : 'true')}>
          Déjà vécu
        </Chip>
        <Chip on={more} onClick={() => setMore((m) => !m)}>
          Plus de filtres {more ? '▴' : '▾'}
        </Chip>
        {filtered && (
          <button
            type="button"
            className="link-btn text-[13px]"
            onClick={() => setF({ ...NO_FILTER, listId: f.listId })}
          >
            Tout effacer
          </button>
        )}
      </div>
      {more && (
        <div
          className="card grid gap-3"
          style={{ padding: '14px 16px', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}
        >
          <Field label="Chercher">
            <input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="titre, tag, note…" />
          </Field>
          <Field label="État">
            <select value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="">À faire (hors archivées)</option>
              <option value="wish">Envies seulement</option>
              <option value="planned">Planifiées</option>
              <option value="lived">Vécues</option>
              <option value="archived">Archivées</option>
            </select>
          </Field>
          <Field label="Durée au plus">
            <select value={f.maxDurationMin} onChange={(e) => set('maxDurationMin', e.target.value)}>
              <option value="">Toutes</option>
              <option value="30">30 min</option>
              <option value="60">1 h</option>
              <option value="120">2 h</option>
            </select>
          </Field>
          <Field label="Distance au plus (km)" info="Depuis le domicile (Configuration › Souvenirs).">
            <input type="number" min={1} value={f.maxKm} onChange={(e) => set('maxKm', e.target.value)} />
          </Field>
          <Field label="Saison">
            <input value={f.season} onChange={(e) => set('season', e.target.value)} placeholder="ex. été" />
          </Field>
        </div>
      )}
      {wishes.isError && <ErrorBox error={wishes.error} />}
      {wishes.isLoading ? (
        <Loading />
      ) : (wishes.data ?? []).length === 0 ? (
        <Empty>
          {filtered || f.listId
            ? 'Aucune envie avec ces filtres.'
            : 'Pas encore d’envie : « + Envie », ou partage un lien vers Mémento.'}
        </Empty>
      ) : (
        <div className="souvenir-grid">
          {(wishes.data ?? []).map((w) => (
            <WishCard key={w.id} w={w} />
          ))}
        </div>
      )}
      {adding && <NewWishPanel onClose={() => setAdding(false)} listId={f.listId} />}
    </div>
  );
}

// ---------- One wish ----------
export function WishPage({ id }: { id: string }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['wish', id], queryFn: () => get<Wish>(`/wishes/${id}`) });
  const lists = useWishLists();
  const [f, setF] = useState<Wish | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [tags, setTags] = useState('');
  useEffect(() => {
    if (q.data) {
      setF(q.data);
      setTags(q.data.tags.join(', '));
    }
  }, [q.data]);
  const save = useAction(
    () => {
      const w = f!;
      return patch(`/wishes/${id}`, {
        title: w.title.trim() || q.data!.title,
        listId: w.listId,
        url: w.url?.trim() || null,
        startDate: w.startDate || null,
        endDate: w.endDate || null,
        price: w.price?.trim() || null,
        durationMin: w.durationMin,
        dogAllowed: w.dogAllowed,
        indoor: w.indoor,
        season: w.season?.trim() || null,
        personIds: w.personIds,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        note: w.note,
      });
    },
    { toast: 'Envie enregistrée.' },
  );
  const setPlace = useAction((placeId: string | null) => patch(`/wishes/${id}`, { placeId }));
  const archive = useAction(() =>
    patch(`/wishes/${id}`, { status: q.data?.status === 'archived' ? 'wish' : 'archived' }),
  );
  const remove = useAction(() => del(`/wishes/${id}`), {
    onSuccess: () => navigate({ to: '/envies' }),
    toast: 'Envie supprimée.',
  });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data || !f) return <Loading />;
  const w = q.data;
  const set = <K extends keyof Wish>(k: K, v: Wish[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const dirty = JSON.stringify(f) !== JSON.stringify(w) || tags !== w.tags.join(', ');
  return (
    <div className="flex flex-col gap-5 mx-auto w-full" style={{ maxWidth: 760 }}>
      <div>
        <Breadcrumb items={[{ label: 'Envies', to: '/envies' }, { label: w.title }]} />
        <PageHeader
          eyebrow={<StatusTag w={w} />}
          title={w.title}
          actions={
            <>
              {w.status !== 'archived' && <PlanButton w={w} small={false} />}
              <button type="button" className="btn" onClick={() => archive.mutate(undefined)}>
                {w.status === 'archived' ? 'Désarchiver' : 'Archiver'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
                Supprimer
              </button>
            </>
          }
        />
      </div>
      {w.hasImage && (
        <img
          src={wishImageUrl(w.id)}
          alt=""
          className="w-full rounded-[14px] object-cover"
          style={{ maxHeight: 360 }}
        />
      )}
      {w.archivedByDate && (
        <div className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
          Archivée d'office : l'événement est fini depuis plus de 7 jours.
        </div>
      )}
      {w.plannedTask && (
        <div className="text-[13px]">
          Planifiée le {fmtSpan(w.plannedTask.dueDate ?? '', null)} ·{' '}
          <Link to="/experiences" search={{ tache: w.plannedTask.id }}>
            ouvrir l'expérience
          </Link>
        </div>
      )}
      <div className="card flex flex-col gap-4" style={{ padding: '18px 20px' }}>
        <Field label="Titre">
          <input value={f.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Liste">
          {(lists.data ?? []).map((l) => (
            <Chip
              key={l.id}
              on={f.listId === l.id}
              onClick={() => set('listId', f.listId === l.id ? null : l.id)}
            >
              {l.name}
            </Chip>
          ))}
        </div>
        <div>
          <div className="text-[13px] font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Où{w.distanceKm != null ? ` · ${w.distanceKm} km du domicile` : ''}
          </div>
          <PlacePicker
            value={w.place ? { id: w.place.id, name: w.place.name, category: w.place.category } : null}
            candidates={[]}
            point={w.place ? { lat: w.place.lat, lng: w.place.lng } : null}
            onChange={(p) => setPlace.mutate(p?.id ?? null)}
          />
          {w.place && (w.place.address || w.place.city) && (
            <div className="text-[12px] mt-1" style={{ color: 'var(--text-ghost)' }}>
              {placeLabel(w.place)} · {fmtAddress(w.place)}
            </div>
          )}
        </div>
        <Field label="Lien">
          <input
            type="url"
            value={f.url ?? ''}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://…"
          />
        </Field>
        {w.url && (
          <a href={w.url} target="_blank" rel="noreferrer noopener" className="text-[13px] -mt-2 truncate">
            Ouvrir la page ↗
          </a>
        )}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Field label="Du (événement)">
            <input
              type="date"
              value={f.startDate ?? ''}
              onChange={(e) => set('startDate', e.target.value || null)}
            />
          </Field>
          <Field label="Au">
            <input
              type="date"
              value={f.endDate ?? ''}
              min={f.startDate ?? undefined}
              onChange={(e) => set('endDate', e.target.value || null)}
            />
          </Field>
          <Field label="Tarif">
            <input
              value={f.price ?? ''}
              onChange={(e) => set('price', e.target.value)}
              placeholder="ex. 12 € · 8 €"
            />
          </Field>
          <Field label="Durée">
            <select
              value={f.durationMin ?? ''}
              onChange={(e) =>
                set('durationMin', e.target.value ? (Number(e.target.value) as TaskDuration) : null)
              }
            >
              <option value="">Inconnue</option>
              <DurationOptions />
            </select>
          </Field>
          <Field label="Chien">
            <select
              value={f.dogAllowed}
              onChange={(e) => set('dogAllowed', e.target.value as Wish['dogAllowed'])}
            >
              <option value="unknown">Inconnu</option>
              <option value="yes">Accepté</option>
              <option value="no">Non</option>
            </select>
          </Field>
          <Field label="Intérieur ou extérieur">
            <select value={f.indoor} onChange={(e) => set('indoor', e.target.value as Wish['indoor'])}>
              <option value="unknown">Inconnu</option>
              <option value="yes">Intérieur</option>
              <option value="no">Extérieur</option>
              <option value="mixed">Les deux</option>
            </select>
          </Field>
          <Field label="Saison">
            <input
              value={f.season ?? ''}
              onChange={(e) => set('season', e.target.value)}
              placeholder="ex. été"
            />
          </Field>
        </div>
        <div>
          <div className="text-[13px] font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Avec qui
          </div>
          <PersonPicker value={f.personIds} onChange={(v) => set('personIds', v)} />
        </div>
        <Field label="Tags" hint="Séparés par des virgules.">
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="intérieur, pluie…" />
        </Field>
        <Field label="Note">
          <textarea rows={3} value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn"
            disabled={!dirty}
            onClick={() => {
              setF(w);
              setTags(w.tags.join(', '));
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            Enregistrer
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        title="Supprimer cette envie ?"
        onConfirm={() => remove.mutate(undefined)}
        onClose={() => setConfirm(false)}
      >
        Les souvenirs déjà vécus restent ; ils ne pointent plus vers cette envie.
      </ConfirmDialog>
    </div>
  );
}
