// EX-60 / D-167 « Vivre »: what one lived over a period. Shown in the quarter report (frozen payload) and live
// on the Expériences page (GET /living). Only displays what the API computed.
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Living } from '../lib/souvenirs.ts';
import { Avatar } from './souvenir-ui.tsx';
import { Section } from './ui.tsx';

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div
      className="rounded-[10px] px-3 py-2.5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--divider)' }}
    >
      <div className="mono" style={{ fontSize: 22 }}>
        {value}
      </div>
      <div className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
        {label}
      </div>
    </div>
  );
}

function Bars({ rows }: { rows: { name: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div
          key={r.name}
          className="grid items-center gap-2 text-[13px]"
          style={{ gridTemplateColumns: 'minmax(90px, 160px) 1fr 28px' }}
        >
          <span className="truncate">{r.name}</span>
          <span className="track" style={{ height: 6, background: 'var(--track)', borderRadius: 999 }}>
            <span
              className="block"
              style={{
                height: 6,
                width: `${(r.count / max) * 100}%`,
                background: 'var(--experience)',
                borderRadius: 999,
              }}
            />
          </span>
          <span className="mono text-right" style={{ color: 'var(--text-muted)' }}>
            {r.count}
          </span>
        </div>
      ))}
    </div>
  );
}

const Line = ({ children }: { children: ReactNode }) => <div className="text-[14px]">{children}</div>;
const Faint = ({ children }: { children: ReactNode }) => (
  <div className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
    {children}
  </div>
);

export function LivingView({ v, title = 'Vivre' }: { v: Living; title?: string }) {
  if (!v.souvenirs && !v.alerts.length)
    return (
      <Section title={title}>
        <Faint>Aucun souvenir sur la période.</Faint>
      </Section>
    );
  const off = v.offTrack;
  return (
    <Section
      title={title}
      info="Calculé à partir des souvenirs : lieux, personnes, notes. Les nouveautés sont les premières fois d'un type de lieu ou d'une ville."
    >
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))' }}>
        <Stat value={v.souvenirs} label="souvenirs" />
        <Stat value={v.days} label="jours vécus" />
        <Stat value={v.places} label="lieux distincts" />
        <Stat value={v.medianKm != null ? `${v.medianKm} km` : '—'} label="distance habituelle" />
      </div>
      {v.alerts.length > 0 && (
        <div className="flex flex-col gap-1">
          {v.alerts.map((a) => (
            <div key={a.personId} className="text-[14px]" style={{ color: 'var(--late-text)' }}>
              {a.text}
            </div>
          ))}
        </div>
      )}
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))' }}
      >
        <div className="flex flex-col gap-2">
          <span className="label-caps">Avec qui</span>
          {v.byPerson.filter((p) => p.souvenirs).length ? (
            v.byPerson
              .filter((p) => p.souvenirs)
              .map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-[14px]">
                  <Avatar name={p.name} color={p.color} />
                  <span className="flex-1">{p.name}</span>
                  <span className="mono text-[13px]" style={{ color: 'var(--text-muted)' }}>
                    {p.souvenirs} souv. · {p.days} j
                  </span>
                </div>
              ))
          ) : (
            <Faint>Personne de noté.</Faint>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="label-caps">Où</span>
          {v.categories.length ? <Bars rows={v.categories.slice(0, 6)} /> : <Faint>Aucun lieu noté.</Faint>}
          {v.zones.length > 0 && (
            <Faint>Zones : {v.zones.map((z) => `${z.name} (${z.count})`).join(' · ')}</Faint>
          )}
        </div>
      </div>
      {v.alike && (
        <Line>
          <b>Ce qui se ressemble</b> : {v.alike.count} « {v.alike.label.toLocaleLowerCase('fr')} » sur{' '}
          {v.alike.of} souvenirs.
        </Line>
      )}
      {v.novelties.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label-caps">Nouveautés</span>
          {v.novelties.map((n) => (
            <Line key={`${n.souvenirId}-${n.what}`}>
              <Link to="/souvenirs/$id" params={{ id: n.souvenirId }}>
                {n.title}
              </Link>{' '}
              <span style={{ color: 'var(--text-faint)' }}>· {n.what}</span>
            </Line>
          ))}
        </div>
      )}
      {v.again.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label-caps">À refaire</span>
          {v.again.map((a) => (
            <Line key={a.id}>
              <Link to="/souvenirs/$id" params={{ id: a.id }}>
                {a.title}
              </Link>
              {a.place && <span style={{ color: 'var(--text-faint)' }}> · {a.place}</span>}
            </Line>
          ))}
        </div>
      )}
      {(off.kindsNeverDone.length > 0 || off.zonesNeverVisited.length > 0 || off.rarePeople.length > 0) && (
        <div className="flex flex-col gap-1">
          <span className="label-caps">Sortir des sentiers battus</span>
          {off.kindsNeverDone.length > 0 && (
            <Line>Jamais fait : {off.kindsNeverDone.join(', ').toLocaleLowerCase('fr')}.</Line>
          )}
          {off.zonesNeverVisited.length > 0 && (
            <Line>Jamais visité (dans les envies) : {off.zonesNeverVisited.join(', ')}.</Line>
          )}
          {off.rarePeople.length > 0 && <Line>Peu vus : {off.rarePeople.join(', ')}.</Line>}
        </div>
      )}
    </Section>
  );
}
