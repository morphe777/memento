// Configuration › Souvenirs (EX-30, EX-40, D-161, D-162, D-165, D-168): people, wish lists, home, places.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog, Empty, Field, InfoTip, Loading, Section } from '../components/ui.tsx';
import { del, get, patch, post } from '../lib/api.ts';
import { toast, useAction, useSettings } from '../lib/hooks.ts';
import type { Settings } from '../lib/types.ts';

interface PersonRow {
  id: string;
  name: string;
  group: 'family' | 'friends' | 'other';
  color: string;
  birthDate: string | null;
  active: boolean;
  alertAfterDays: number | null;
  toConfirm: boolean;
}
interface WishListRow {
  id: string;
  name: string;
  position: number;
  count: number;
}
interface PlaceRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  uses: number;
}
interface PlaceCandidate {
  name: string;
  city?: string | null;
  address?: string | null;
  lat: number;
  lng: number;
}

const GROUPS: [PersonRow['group'], string][] = [
  ['family', 'Famille'],
  ['friends', 'Amis'],
  ['other', 'Autre'],
];

export function SouvenirsConfig() {
  return (
    <div className="flex flex-col gap-8">
      <PersonsConfig />
      <WishListsConfig />
      <HomeConfig />
      <PlacesConfig />
    </div>
  );
}

// ---------- Proches (EX-30) ----------

function PersonsConfig() {
  const persons = useQuery({ queryKey: ['persons'], queryFn: () => get<PersonRow[]>('/persons') });
  const [name, setName] = useState('');
  const [group, setGroup] = useState<PersonRow['group']>('friends');
  const add = useAction(() => post('/persons', { name: name.trim(), group }), {
    onSuccess: () => setName(''),
  });
  return (
    <Section
      title="Proches"
      aside="Avec qui tu vis tes souvenirs"
      info="Les personnes que tu peux associer à un souvenir. L'alerte douce te signale, dans les rapports, qu'aucun souvenir n'a été vécu avec elles depuis N jours. Une personne inactive n'est plus proposée à la saisie mais garde ses souvenirs."
    >
      {!persons.data ? (
        <Loading />
      ) : (
        <div className="card overflow-hidden">
          {persons.data.map((p) => (
            <PersonLine key={p.id} p={p} others={persons.data.filter((o) => o.id !== p.id)} />
          ))}
          {persons.data.length === 0 && <Empty>Aucun proche pour l'instant.</Empty>}
        </div>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(undefined);
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nouveau proche (ex. Alice)"
          style={{ flex: '1 1 200px' }}
        />
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value as PersonRow['group'])}
          aria-label="Groupe"
        >
          {GROUPS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || add.isPending}>
          Ajouter
        </button>
      </form>
    </Section>
  );
}

function PersonLine({ p, others }: { p: PersonRow; others: PersonRow[] }) {
  const [f, setF] = useState(p);
  const [alert, setAlert] = useState(p.alertAfterDays === null ? '' : String(p.alertAfterDays));
  const [mergeId, setMergeId] = useState('');
  const [askDelete, setAskDelete] = useState(false);
  const alertDays = alert.trim() === '' ? null : Number(alert);
  const alertOk = alertDays === null || (Number.isInteger(alertDays) && alertDays >= 7 && alertDays <= 3650);
  const dirty =
    f.name !== p.name ||
    f.group !== p.group ||
    f.color !== p.color ||
    f.birthDate !== p.birthDate ||
    f.active !== p.active ||
    alertDays !== p.alertAfterDays;
  const save = useAction(
    () =>
      patch(`/persons/${p.id}`, {
        name: f.name.trim(),
        group: f.group,
        color: f.color,
        birthDate: f.birthDate || null,
        active: f.active,
        alertAfterDays: alertDays,
      }),
    { toast: 'Proche enregistré.' },
  );
  const confirm = useAction(() => patch(`/persons/${p.id}`, { toConfirm: false }), {
    toast: 'Proche confirmé.',
  });
  const merge = useAction(() => post(`/persons/${p.id}/merge`, { intoId: mergeId }), {
    toast: 'Proches fusionnés.',
    onSuccess: () => setMergeId(''),
  });
  const remove = useAction(() => del(`/persons/${p.id}`), {
    toast: 'Proche supprimé.',
    onSuccess: () => setAskDelete(false),
  });
  const target = others.find((o) => o.id === mergeId);
  return (
    <div
      className="row-line flex flex-col gap-2"
      style={{ padding: '10px 12px', opacity: f.active ? 1 : 0.6 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className="flex items-center justify-center shrink-0 text-[13px] font-semibold"
          style={{ width: 28, height: 28, borderRadius: 14, background: f.color, color: '#fff' }}
        >
          {(f.name.trim()[0] ?? '?').toLocaleUpperCase('fr')}
        </span>
        <input
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          aria-label="Nom"
          style={{ flex: '1 1 160px' }}
        />
        <select
          value={f.group}
          onChange={(e) => setF({ ...f, group: e.target.value as PersonRow['group'] })}
          aria-label="Groupe"
        >
          {GROUPS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          type="color"
          value={f.color}
          onChange={(e) => setF({ ...f, color: e.target.value.toUpperCase() })}
          aria-label="Couleur"
          style={{ width: 44, padding: 2 }}
        />
        {p.toConfirm && (
          <span className="chip" style={{ color: 'var(--text-muted)' }}>
            à confirmer
          </span>
        )}
        {p.toConfirm && (
          <button type="button" className="btn btn-sm" onClick={() => confirm.mutate(undefined)}>
            Confirmer
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        <label className="flex items-center gap-1">
          Naissance
          <input
            type="date"
            value={f.birthDate ?? ''}
            onChange={(e) => setF({ ...f, birthDate: e.target.value || null })}
          />
        </label>
        <label className="flex items-center gap-1">
          Alerte douce après
          <input
            type="number"
            min={7}
            max={3650}
            value={alert}
            placeholder="—"
            onChange={(e) => setAlert(e.target.value)}
            style={{ width: 76 }}
            aria-invalid={!alertOk}
          />
          jours
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={f.active}
            onChange={(e) => setF({ ...f, active: e.target.checked })}
          />
          Actif
        </label>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!dirty || !alertOk || !f.name.trim() || save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          Enregistrer
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={mergeId} onChange={(e) => setMergeId(e.target.value)} aria-label="Fusionner avec">
          <option value="">Fusionner avec…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!mergeId || merge.isPending}
          onClick={() => merge.mutate(undefined)}
        >
          Fusionner
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAskDelete(true)}>
          Supprimer
        </button>
      </div>
      {mergeId && target && (
        <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Les souvenirs de {p.name} passeront à {target.name}, puis {p.name} disparaîtra.
        </span>
      )}
      <ConfirmDialog
        open={askDelete}
        title={`Supprimer ${p.name} ?`}
        onClose={() => setAskDelete(false)}
        onConfirm={() => remove.mutate(undefined)}
        busy={remove.isPending}
      >
        <p>{p.name} ne sera plus associé(e) à aucun souvenir. Les souvenirs eux-mêmes sont conservés.</p>
      </ConfirmDialog>
    </div>
  );
}

// ---------- Listes d'envies (EX-40) ----------

function WishListsConfig() {
  const lists = useQuery({ queryKey: ['wish-lists'], queryFn: () => get<WishListRow[]>('/wish-lists') });
  const [name, setName] = useState('');
  const add = useAction(() => post('/wish-lists', { name: name.trim() }), { onSuccess: () => setName('') });
  const move = useAction(({ id, position }: { id: string; position: number }) =>
    patch(`/wish-lists/${id}`, { position }),
  );
  const rows = lists.data ?? [];
  return (
    <Section
      title="Listes d'envies"
      aside="Restaurants, spectacles, nature…"
      info="Les listes qui rangent tes envies. Le rang ici est l'ordre d'affichage dans l'onglet Envies."
    >
      {!lists.data ? (
        <Loading />
      ) : (
        <div className="card overflow-hidden">
          {rows.map((l, i) => (
            <WishListLine
              key={l.id}
              l={l}
              first={i === 0}
              last={i === rows.length - 1}
              onMove={(delta) => move.mutate({ id: l.id, position: i + delta })}
            />
          ))}
          {rows.length === 0 && <Empty>Aucune liste.</Empty>}
        </div>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(undefined);
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nouvelle liste (ex. Balades)"
          style={{ flex: '1 1 200px' }}
        />
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || add.isPending}>
          Ajouter
        </button>
      </form>
    </Section>
  );
}

function WishListLine({
  l,
  first,
  last,
  onMove,
}: {
  l: WishListRow;
  first: boolean;
  last: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const [name, setName] = useState(l.name);
  const [askDelete, setAskDelete] = useState(false);
  const rename = useAction(() => patch(`/wish-lists/${l.id}`, { name: name.trim() }), {
    toast: 'Liste renommée.',
  });
  const remove = useAction(() => del(`/wish-lists/${l.id}`), {
    toast: 'Liste supprimée.',
    onSuccess: () => setAskDelete(false),
  });
  return (
    <div className="row-line flex flex-wrap items-center gap-2" style={{ padding: '10px 12px' }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Nom de la liste"
        style={{ flex: '1 1 180px' }}
      />
      <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
        {l.count} envie{l.count > 1 ? 's' : ''}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={!name.trim() || name.trim() === l.name || rename.isPending}
        onClick={() => rename.mutate(undefined)}
      >
        Renommer
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={first}
        aria-label="Monter"
        onClick={() => onMove(-1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={last}
        aria-label="Descendre"
        onClick={() => onMove(1)}
      >
        ↓
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAskDelete(true)}>
        Supprimer
      </button>
      <ConfirmDialog
        open={askDelete}
        title={`Supprimer la liste « ${l.name} » ?`}
        onClose={() => setAskDelete(false)}
        onConfirm={() => remove.mutate(undefined)}
        busy={remove.isPending}
      >
        <p>
          {l.count > 0
            ? `Les ${l.count} envie${l.count > 1 ? 's' : ''} de cette liste ne sont pas supprimées : elles restent, sans liste.`
            : 'Cette liste est vide.'}
        </p>
      </ConfirmDialog>
    </div>
  );
}

// ---------- Lieux : domicile et fournisseur (D-161) ----------

function HomeConfig() {
  const settings = useSettings();
  if (!settings.data) return <Loading />;
  return <HomeForm s={settings.data} />;
}

function HomeForm({ s }: { s: Settings }) {
  const home = s['places.home'];
  const [label, setLabel] = useState(home?.label ?? '');
  const [lat, setLat] = useState(home ? String(home.lat) : '');
  const [lng, setLng] = useState(home ? String(home.lng) : '');
  const [provider, setProvider] = useState(s['places.provider']);
  const [photon, setPhoton] = useState(s['places.photon_url']);
  const [overpass, setOverpass] = useState(s['places.overpass_url']);
  const [nominatim, setNominatim] = useState(s['places.nominatim_url']);
  const [tiles, setTiles] = useState(s['map.tiles_url']);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PlaceCandidate[] | null>(null);
  const save = useAction((body: Partial<Settings>) => patch('/settings', body), {
    toast: 'Réglages enregistrés.',
  });
  const search = useAction(() => get<PlaceCandidate[]>(`/places/search?q=${encodeURIComponent(q.trim())}`), {
    onSuccess: setFound,
  });
  const latN = Number(lat);
  const lngN = Number(lng);
  const valid =
    lat.trim() !== '' &&
    lng.trim() !== '' &&
    Number.isFinite(latN) &&
    Number.isFinite(lngN) &&
    Math.abs(latN) <= 90 &&
    Math.abs(lngN) <= 180;
  const empty = lat.trim() === '' && lng.trim() === '' && !label.trim();
  const saveHome = () => {
    if (empty) return save.mutate({ 'places.home': null });
    if (!valid) return toast('Latitude et longitude valides requises.', 'error');
    save.mutate({ 'places.home': { lat: latN, lng: lngN, label: label.trim() } });
  };
  const clearHome = () => {
    setLabel('');
    setLat('');
    setLng('');
    save.mutate({ 'places.home': null });
  };
  return (
    <Section
      title="Lieux"
      aside="Domicile et fournisseur"
      info="Le domicile centre les recherches de lieux, les distances de « Que faire ? » et le rayon de vie de la carte."
    >
      <Field label="Domicile" hint="Nom, latitude et longitude (ex. Maison, 48.8566, 2.3522).">
        <div className="flex flex-wrap gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nom (ex. Maison)"
            style={{ flex: '1 1 180px' }}
          />
          <input
            type="number"
            step="any"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="Latitude"
            aria-label="Latitude"
            style={{ width: 130 }}
          />
          <input
            type="number"
            step="any"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="Longitude"
            aria-label="Longitude"
            style={{ width: 130 }}
          />
        </div>
      </Field>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 2) search.mutate(undefined);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher une adresse"
          aria-label="Chercher une adresse"
          style={{ flex: '1 1 220px' }}
        />
        <button type="submit" className="btn" disabled={q.trim().length < 2 || search.isPending}>
          Chercher une adresse
        </button>
      </form>
      {found && (
        <div className="card overflow-hidden">
          {found.map((c) => (
            <button
              type="button"
              key={`${c.lat},${c.lng},${c.name}`}
              className="row-line w-full text-left flex flex-col"
              style={{ padding: '8px 12px' }}
              onClick={() => {
                setLabel(c.name);
                setLat(String(c.lat));
                setLng(String(c.lng));
                setFound(null);
              }}
            >
              <span className="text-[14px]">{c.name}</span>
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {[c.address, c.city].filter(Boolean).join(', ')}
              </span>
            </button>
          ))}
          {found.length === 0 && <Empty>Aucun résultat.</Empty>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={saveHome}>
          Enregistrer le domicile
        </button>
        <button type="button" className="btn" disabled={!home || save.isPending} onClick={clearHome}>
          Effacer
        </button>
      </div>

      <div className="flex flex-col gap-3 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <Field
          label="Fournisseur de lieux"
          info="D-161 : avec OpenStreetMap, le nom que tu tapes et la position de tes photos sont envoyés (relayés par ton serveur) aux services publics d'OpenStreetMap pour retrouver les lieux. Aucun : lieux saisis à la main uniquement, rien ne sort. Les trois adresses de service (bloc Avancé) peuvent pointer vers tes propres instances."
        >
          <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)}>
            <option value="osm">OpenStreetMap</option>
            <option value="none">Aucun</option>
          </select>
        </Field>
        <details>
          <summary className="label-caps cursor-pointer flex items-center gap-1.5">
            Avancé
            <InfoTip>
              Adresses des services utilisés. Par défaut ce sont les services publics ; remplace-les par tes
              instances auto-hébergées pour que la position de tes photos ne sorte plus de chez toi.
            </InfoTip>
          </summary>
          <div className="flex flex-col gap-3 pt-3">
            <Field label="Recherche de lieux (Photon)">
              <input value={photon} onChange={(e) => setPhoton(e.target.value)} />
            </Field>
            <Field label="Lieux autour d'un point (Overpass)">
              <input value={overpass} onChange={(e) => setOverpass(e.target.value)} />
            </Field>
            <Field label="Adresses (Nominatim)">
              <input value={nominatim} onChange={(e) => setNominatim(e.target.value)} />
            </Field>
            <Field label="Tuiles de la carte" hint="Avec {z}, {x} et {y}.">
              <input value={tiles} onChange={(e) => setTiles(e.target.value)} />
            </Field>
          </div>
        </details>
        <button
          type="button"
          className="btn btn-primary self-start"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              'places.provider': provider,
              'places.photon_url': photon.trim(),
              'places.overpass_url': overpass.trim(),
              'places.nominatim_url': nominatim.trim(),
              'map.tiles_url': tiles.trim(),
            })
          }
        >
          Enregistrer le fournisseur
        </button>
      </div>
    </Section>
  );
}

// ---------- Lieux mémorisés ----------

function PlacesConfig() {
  const places = useQuery({ queryKey: ['places'], queryFn: () => get<PlaceRow[]>('/places') });
  return (
    <Section
      title="Lieux mémorisés"
      aside="Gardés pour être retrouvés sans recherche"
      info="Un lieu est mémorisé la première fois qu'un souvenir ou une envie s'y rattache. « Oublier » est refusé tant qu'un souvenir ou une envie l'utilise."
    >
      {!places.data ? (
        <Loading />
      ) : (
        <div className="card overflow-hidden">
          {places.data.map((p) => (
            <PlaceLine key={p.id} p={p} />
          ))}
          {places.data.length === 0 && <Empty>Aucun lieu mémorisé.</Empty>}
        </div>
      )}
    </Section>
  );
}

function PlaceLine({ p }: { p: PlaceRow }) {
  const [name, setName] = useState(p.name);
  const rename = useAction(() => patch(`/places/${p.id}`, { name: name.trim() }), {
    toast: 'Lieu renommé.',
  });
  const forget = useAction(() => del(`/places/${p.id}`), { toast: 'Lieu oublié.' });
  return (
    <div className="row-line flex flex-wrap items-center gap-2" style={{ padding: '10px 12px' }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Nom du lieu"
        style={{ flex: '1 1 180px' }}
      />
      <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
        {[p.category, p.city].filter(Boolean).join(' · ')}
        {p.category || p.city ? ' · ' : ''}
        {p.uses} usage{p.uses > 1 ? 's' : ''}
      </span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={!name.trim() || name.trim() === p.name || rename.isPending}
        onClick={() => rename.mutate(undefined)}
      >
        Renommer
      </button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => forget.mutate(undefined)}>
        Oublier
      </button>
    </div>
  );
}
