// Shared pieces of the souvenirs and wishes screens (maquette memento-experiences): people chips, rating
// segments, the place picker (OSM candidates + search by name), the big journal card.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { get, post } from '../lib/api.ts';
import { toast } from '../lib/hooks.ts';
import {
  fmtAddress,
  fmtDistance,
  fmtSpan,
  type Person,
  type PlaceCandidate,
  photoUrl,
  placeLabel,
  RATING_LABEL,
  type Rating,
  type Souvenir,
} from '../lib/souvenirs.ts';

export const usePersons = () =>
  useQuery({ queryKey: ['persons'], queryFn: () => get<Person[]>('/persons'), staleTime: 60_000 });

export function Avatar({ name, color, size = 18 }: { name: string; color: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-grid place-items-center rounded-full flex-none font-semibold"
      style={{
        width: size,
        height: size,
        background: color,
        color: '#fff',
        fontSize: Math.round(size * 0.55),
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function Chip({
  on,
  onClick,
  children,
  dashed,
  small,
  title,
}: {
  on?: boolean;
  onClick?: () => void;
  children: ReactNode;
  dashed?: boolean;
  small?: boolean;
  title?: string;
}) {
  const style = {
    padding: small ? '2px 8px' : '6px 11px',
    fontSize: small ? 12 : 14,
    border: `1px ${dashed ? 'dashed' : 'solid'} ${on ? 'var(--primary)' : 'var(--btn-border)'}`,
    background: on ? 'color-mix(in srgb, var(--primary) 12%, var(--surface))' : 'var(--surface)',
    color: on ? 'var(--text)' : 'var(--text-muted)',
  };
  if (!onClick)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full" style={style} title={title}>
        {children}
      </span>
    );
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full cursor-pointer"
      style={{ ...style, minHeight: small ? undefined : 34 }}
    >
      {children}
    </button>
  );
}

/** EX-12 « Avec qui »: the active people as chips, then « + quelqu'un d'autre » (created « à confirmer »). */
export function PersonPicker({
  value,
  onChange,
  newNames,
  onNewNames,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  newNames?: string[];
  onNewNames?: (names: string[]) => void;
}) {
  const persons = usePersons();
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const list = (persons.data ?? []).filter((p) => p.active || value.includes(p.id));
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const add = () => {
    const name = text.trim();
    setText('');
    setTyping(false);
    if (!name) return;
    const known = (persons.data ?? []).find(
      (p) => p.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'),
    );
    if (known) {
      if (!value.includes(known.id)) onChange([...value, known.id]);
    } else if (onNewNames && !newNames?.includes(name)) onNewNames([...(newNames ?? []), name]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((p) => (
        <Chip
          key={p.id}
          on={value.includes(p.id)}
          onClick={() => toggle(p.id)}
          title={p.toConfirm ? 'À confirmer (Configuration › Souvenirs)' : undefined}
        >
          <Avatar name={p.name} color={p.color} />
          {p.name}
        </Chip>
      ))}
      {(newNames ?? []).map((n) => (
        <Chip
          key={n}
          on
          onClick={() => onNewNames?.(newNames!.filter((x) => x !== n))}
          title="Nouvelle personne, à confirmer"
        >
          <Avatar name={n} color="#8a8a84" />
          {n} ✕
        </Chip>
      ))}
      {onNewNames &&
        (typing ? (
          <input
            autoFocus
            className="rounded-full px-3 text-[14px]"
            style={{
              border: '1px dashed var(--btn-border)',
              minHeight: 34,
              width: 180,
              background: 'var(--surface)',
            }}
            placeholder="Prénom…"
            value={text}
            list="memento-person-names"
            onChange={(e) => setText(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
              if (e.key === 'Escape') {
                setText('');
                setTyping(false);
              }
            }}
          />
        ) : (
          <Chip dashed onClick={() => setTyping(true)}>
            + quelqu'un d'autre
          </Chip>
        ))}
      <datalist id="memento-person-names">
        {(persons.data ?? []).map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
    </div>
  );
}

/** EX-12 « Note »: À refaire / Bien / Bof, a second tap clears it. */
export function RatingPicker({
  value,
  onChange,
}: {
  value: Rating | null;
  onChange: (r: Rating | null) => void;
}) {
  return (
    <div
      className="flex rounded-[10px] overflow-hidden"
      style={{ border: '1px solid var(--btn-border)' }}
      role="group"
      aria-label="Note"
    >
      {(['again', 'good', 'meh'] as Rating[]).map((r) => (
        <button
          key={r}
          type="button"
          aria-pressed={value === r}
          onClick={() => onChange(value === r ? null : r)}
          className="flex-1 border-0 cursor-pointer text-[14px]"
          style={{
            minHeight: 38,
            background: value === r ? 'var(--primary)' : 'var(--surface)',
            color: value === r ? 'var(--primary-text)' : 'var(--text-muted)',
          }}
        >
          {RATING_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

export function RatingTag({ rating }: { rating: Rating | null }) {
  if (!rating) return null;
  const icon = rating === 'again' ? '↻' : rating === 'good' ? '👍' : '·';
  return (
    <span
      className="text-[12px] rounded-full px-2 py-0.5"
      style={{ background: 'rgba(0,0,0,.45)', color: '#fff' }}
    >
      {icon} {RATING_LABEL[rating]}
    </span>
  );
}

/** A photo, or a calm placeholder when there is none (no image of another site, D-164). */
export function Cover({
  photoId,
  size = 'medium',
  height,
  alt,
  children,
  rounded = 0,
}: {
  photoId: string | null;
  size?: 'full' | 'medium' | 'thumb';
  height: number | string;
  alt: string;
  children?: ReactNode;
  rounded?: number;
}) {
  return (
    <div
      className="relative overflow-hidden flex-none"
      style={{
        height,
        borderRadius: rounded,
        background: 'linear-gradient(135deg, var(--chip), var(--bin))',
      }}
    >
      {photoId ? (
        <img
          src={photoUrl(photoId, size)}
          alt={alt}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <span
          className="absolute inset-0 grid place-items-center text-[32px]"
          style={{ color: 'var(--text-ghost)' }}
          aria-hidden
        >
          ✦
        </span>
      )}
      {children}
    </div>
  );
}

/** EX-50: the big card of the journal. */
export function SouvenirCard({ s }: { s: Souvenir }) {
  return (
    <Link
      to="/souvenirs/$id"
      params={{ id: s.id }}
      className="card overflow-hidden flex flex-col no-underline"
      style={{ color: 'inherit', padding: 0 }}
    >
      <Cover photoId={s.coverPhotoId} height={180} alt={s.title}>
        <span className="absolute left-2 right-2 bottom-2 flex justify-between gap-2">
          {s.photoCount > 0 ? (
            <span
              className="text-[12px] rounded-full px-2 py-0.5"
              style={{ background: 'rgba(0,0,0,.45)', color: '#fff' }}
            >
              {s.photoCount} photo{s.photoCount > 1 ? 's' : ''}
            </span>
          ) : (
            <span />
          )}
          <RatingTag rating={s.rating as Rating | null} />
        </span>
        {s.status === 'draft' && (
          <span
            className="absolute left-2 top-2 text-[12px] rounded-full px-2 py-0.5"
            style={{ background: 'var(--warn)', color: '#fff' }}
          >
            À vérifier
          </span>
        )}
      </Cover>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        <div className="text-[15px] font-semibold">{s.title}</div>
        <div className="text-[12px] flex flex-wrap gap-x-3" style={{ color: 'var(--text-muted)' }}>
          <span>{fmtSpan(s.startDate, s.endDate, false)}</span>
          {s.place && <span>{s.place.name}</span>}
        </div>
        {s.persons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {s.persons.map((p) => (
              <Chip key={p.id} small>
                <Avatar name={p.name} color={p.color} size={16} />
                {p.name}
              </Chip>
            ))}
          </div>
        )}
        {s.phrase && (
          <div className="text-[13px] italic" style={{ color: 'var(--text-muted)' }}>
            « {s.phrase} »
          </div>
        )}
      </div>
    </Link>
  );
}

/**
 * EX-13 « Où »: the chosen place, a tap opens the other nearby candidates and a search by name (around the
 * point, else the home). A provider candidate is remembered when chosen (POST /places, D-161).
 */
export function PlacePicker({
  value,
  candidates,
  point,
  providerError,
  onChange,
}: {
  value: { id: string; name: string; category: string | null } | null;
  candidates: PlaceCandidate[];
  point: { lat: number; lng: number } | null;
  providerError?: string | null;
  onChange: (place: { id: string; name: string; category: string | null } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const search = useQuery({
    queryKey: ['places-search', debounced, point?.lat, point?.lng],
    queryFn: () =>
      get<{ candidates: PlaceCandidate[]; providerError: string | null }>(
        `/places/search?q=${encodeURIComponent(debounced)}${point ? `&near=${point.lat},${point.lng}` : ''}`,
      ),
    enabled: open && debounced.length >= 2,
  });
  const choose = async (c: PlaceCandidate) => {
    try {
      const saved = c.id
        ? { id: c.id, name: c.name, category: c.category ?? null }
        : await post<{ id: string; name: string; category: string | null }>('/places', {
            name: c.name,
            category: c.category,
            lat: c.lat,
            lng: c.lng,
            address: c.address,
            city: c.city,
            provider: c.provider,
            providerRef: c.providerRef,
            website: c.website,
            phone: c.phone,
          });
      onChange(saved);
      setOpen(false);
      setQ('');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const current = value ? candidates.find((c) => c.id === value.id) : null;
  const list = debounced.length >= 2 ? (search.data?.candidates ?? []) : candidates;
  const error = debounced.length >= 2 ? search.data?.providerError : providerError;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className="field-box flex items-center gap-2 text-left cursor-pointer"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="flex-1 min-w-0 truncate">
          {value ? placeLabel(value) : <span style={{ color: 'var(--text-ghost)' }}>Aucun lieu</span>}
        </span>
        {current?.distanceM != null && (
          <span className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
            {fmtDistance(current.distanceM)}
          </span>
        )}
        <span aria-hidden style={{ color: 'var(--text-ghost)' }}>
          ▾
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1">
          <input
            className="field-box"
            placeholder="Chercher un lieu par son nom…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {error && (
            <div className="text-[12px]" style={{ color: 'var(--late-text)' }}>
              Service des lieux indisponible : un lieu déjà mémorisé ou le nom tapé à la main.
            </div>
          )}
          {search.isFetching && (
            <div className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
              Recherche…
            </div>
          )}
          {list.map((c) => (
            <button
              key={c.id ?? `${c.provider}:${c.providerRef}:${c.lat}`}
              type="button"
              onClick={() => choose(c)}
              className="flex justify-between gap-2 rounded-lg px-2.5 py-2 text-left cursor-pointer text-[14px]"
              style={{
                border: `1px solid ${value && c.id === value.id ? 'var(--primary)' : 'var(--border)'}`,
                background: 'var(--surface)',
              }}
            >
              <span className="min-w-0">
                {placeLabel(c)}
                {(c.address || c.city) && (
                  <span className="block text-[12px]" style={{ color: 'var(--text-ghost)' }}>
                    {fmtAddress(c)}
                    {c.memorized ? ' · mémorisé' : ''}
                  </span>
                )}
              </span>
              <span className="text-[12px] flex-none" style={{ color: 'var(--text-ghost)' }}>
                {fmtDistance(c.distanceM)}
              </span>
            </button>
          ))}
          {!list.length && debounced.length >= 2 && !search.isFetching && (
            <div className="text-[13px]" style={{ color: 'var(--text-ghost)' }}>
              Rien trouvé.
              {point && (
                <button
                  type="button"
                  className="link-btn ml-1"
                  onClick={() =>
                    choose({
                      name: q.trim(),
                      lat: point.lat,
                      lng: point.lng,
                      provider: 'manual',
                      distanceM: 0,
                      memorized: false,
                    })
                  }
                >
                  Garder « {q.trim()} » ici
                </button>
              )}
            </div>
          )}
          {value && (
            <button type="button" className="link-btn self-start text-[13px]" onClick={() => onChange(null)}>
              Aucun lieu
            </button>
          )}
        </div>
      )}
    </div>
  );
}
