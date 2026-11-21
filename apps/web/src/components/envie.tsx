// D-174, D-176: « + Envie », the one way to add an envie by hand (Expériences, and the iPhone « + » of Ma semaine
// and Idées): what, where, how long, which domain.
import { useState } from 'react';
import { post } from '../lib/api.ts';
import { useAction, useDomainLookup } from '../lib/hooks.ts';
import type { TaskDuration } from '../lib/types.ts';
import { PlacePicker } from './souvenir-ui.tsx';
import { DurationOptions } from './tasks.tsx';
import { Field, Panel } from './ui.tsx';

/** D-174: an envie = a possible experience: what, where (a remembered or found place), how long, which domain. */
export function EnviePanel({ onClose }: { onClose: () => void }) {
  const dl = useDomainLookup();
  const [f, setF] = useState({
    title: '',
    place: null as { id: string; name: string; category: string | null } | null,
    durationMin: 120 as TaskDuration | null,
    domainId: dl.domains.find((d) => d.name === 'Famille')?.id ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useAction(
    () =>
      post('/experiences', {
        title: f.title.trim(),
        durationMin: f.durationMin,
        domainId: f.domainId || null,
        ...(f.place ? { placeId: f.place.id } : {}),
      }),
    { onSuccess: onClose, toast: 'Envie ajoutée.' },
  );
  return (
    <Panel open onClose={onClose} title="Nouvelle envie">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.title.trim()) save.mutate(undefined);
        }}
      >
        <Field label="Quoi">
          <input
            value={f.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="ex. Baptême de plongée"
            autoFocus
          />
        </Field>
        <div className="field">
          <span>Où (facultatif)</span>
          <PlacePicker
            value={f.place}
            candidates={[]}
            point={null}
            onChange={(p) => {
              set('place', p);
              if (p && !f.title.trim() && !['address', 'city'].includes(p.category ?? ''))
                set('title', p.name);
            }}
          />
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Field label="Durée">
            <select
              value={f.durationMin ?? ''}
              onChange={(e) =>
                set('durationMin', e.target.value ? (Number(e.target.value) as TaskDuration) : null)
              }
            >
              <option value="">Durée ?</option>
              <DurationOptions />
            </select>
          </Field>
          <Field label="Domaine">
            <select value={f.domainId} onChange={(e) => set('domainId', e.target.value)}>
              <option value="">Aucun domaine</option>
              {dl.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex gap-2 justify-end">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={!f.title.trim() || save.isPending}>
            Ajouter aux envies
          </button>
        </div>
      </form>
    </Panel>
  );
}
