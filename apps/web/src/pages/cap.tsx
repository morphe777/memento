// D-100: « Cap », the cheat sheet of what I am running after — this quarter's objectives (by meta-objective)
// and this month's projects, each with its « why » in a few words. A glance, not a reading: the keyword is in
// bold. Each « why » is edited in place (PATCH on its meta-objective, objective or project).
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { MotiveText } from '../components/cap.tsx';
import { Breadcrumb } from '../components/shell.tsx';
import { ErrorBox, InfoTip, Loading, PageHeader } from '../components/ui.tsx';
import { get, patch } from '../lib/api.ts';
import { useAction, useDomainLookup, useMe } from '../lib/hooks.ts';
import type { Cap } from '../lib/types.ts';

type Kind = 'meta' | 'objective' | 'project';
const PATH: Record<Kind, string> = {
  meta: '/meta-objectives',
  objective: '/objectives',
  project: '/projects',
};

const monthLabel = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function CapPage() {
  const q = useQuery({ queryKey: ['cap'], queryFn: () => get<Cap>('/cap') });
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const cap = q.data;
  const missing = cap.missing.metas + cap.missing.objectives + cap.missing.projects;
  const monthProjects = [
    ...cap.groups.flatMap((g) => g.objectives.flatMap((o) => o.monthProjects)),
    ...cap.outsideProjects,
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: 'Cap' }]} />
        <PageHeader eyebrow={`${cap.quarter.replace('-', ' ')} · ${monthLabel(cap.month)}`} title="Cap" />
        <p className="m-0 mt-1 text-[15px] flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          Ce après quoi je cours, et pourquoi — en quelques mots.
          <InfoTip>
            Pour chaque méta-objectif, objectif du trimestre et projet du mois : une phrase très courte, le
            mot qui déclenche entre deux astérisques (par exemple « Vieillir **debout** »). Clique sur une
            phrase pour la modifier. Ma semaine en affiche trois, qui tournent chaque jour.
          </InfoTip>
        </p>
        {missing > 0 && (
          <p className="m-0 mt-1 text-[13px]" style={{ color: 'var(--text-faint)' }}>
            {missing} pourquoi à écrire.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-6 items-start">
        <section className="flex flex-col gap-4 min-w-0" style={{ flex: '3 1 520px' }}>
          <h2 className="h2">Ce trimestre</h2>
          {cap.groups.length === 0 && (
            <p className="m-0 text-[14px]" style={{ color: 'var(--text-faint)' }}>
              Aucun objectif sur ce trimestre.
            </p>
          )}
          {cap.groups.map((g) => (
            <div
              key={g.meta?.id ?? 'none'}
              className="card flex flex-col"
              style={{ padding: '16px 20px', gap: 14 }}
            >
              {g.meta ? <MetaHead meta={g.meta} /> : <span className="label-caps">Sans méta-objectif</span>}
              {g.objectives.map((o) => (
                <div
                  key={o.id}
                  className="flex flex-col gap-1"
                  style={{ paddingLeft: 12, borderLeft: '2px solid var(--divider)' }}
                >
                  {o.motive.trim() && <Motive kind="objective" id={o.id} value={o.motive} size={19} />}
                  <span className="text-[13px] flex flex-wrap gap-x-2" style={{ color: 'var(--text-faint)' }}>
                    <Link to="/objectifs/$id" params={{ id: o.id }} style={{ color: 'var(--text-muted)' }}>
                      {o.title}
                    </Link>
                    <span>· {o.progressPct} %</span>
                    {o.smart && <span>· {o.smart}</span>}
                    {o.status !== 'active' && (
                      <span>· {o.status === 'achieved' ? 'atteint' : 'en pause'}</span>
                    )}
                  </span>
                  {!o.motive.trim() && <Motive kind="objective" id={o.id} value="" size={19} />}
                </div>
              ))}
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-4 min-w-0" style={{ flex: '2 1 360px' }}>
          <h2 className="h2">Ce mois-ci</h2>
          <div className="card flex flex-col" style={{ padding: '16px 20px', gap: 14 }}>
            {monthProjects.length === 0 && (
              <p className="m-0 text-[14px]" style={{ color: 'var(--text-faint)' }}>
                Aucun projet du mois.{' '}
                <Link to="/planifier" search={{ vue: 'mois' }}>
                  Planifier le mois
                </Link>
              </p>
            )}
            {monthProjects.map((p) => (
              <ProjectLine key={p.id} p={p} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetaHead({ meta }: { meta: NonNullable<Cap['groups'][number]['meta']> }) {
  const dl = useDomainLookup();
  return (
    <div className="flex flex-col gap-1">
      <span
        className="flex items-center gap-2 text-[12px] font-semibold uppercase"
        style={{ letterSpacing: '0.08em', color: dl.color(meta.domainId) }}
      >
        <span className="dot" style={{ background: dl.color(meta.domainId) }} />
        <Link to="/meta-objectifs/$id" params={{ id: meta.id }} style={{ color: 'inherit' }}>
          {meta.title}
        </Link>
      </span>
      <Motive kind="meta" id={meta.id} value={meta.motive} size={22} />
    </div>
  );
}

function ProjectLine({ p }: { p: Cap['outsideProjects'][number] }) {
  const dl = useDomainLookup();
  return (
    <div className="flex gap-2.5 items-start" style={{ opacity: p.status === 'done' ? 0.55 : 1 }}>
      <span className="dot" style={{ background: dl.color(p.domainId), marginTop: 9 }} />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {p.motive.trim() && <Motive kind="project" id={p.id} value={p.motive} size={17} />}
        <Link
          to="/projets/$id"
          params={{ id: p.id }}
          className="text-[13px]"
          style={{ color: 'var(--text-faint)' }}
        >
          {p.title}
          {p.status === 'done' ? ' · terminé' : ''}
        </Link>
        {!p.motive.trim() && <Motive kind="project" id={p.id} value="" size={17} />}
      </div>
    </div>
  );
}

/** A « why », clicked to edit; empty = a discreet invitation to write it. */
function Motive({ kind, id, value, size }: { kind: Kind; id: string; value: string; size: number }) {
  const me = useMe();
  const [draft, setDraft] = useState<string | null>(null);
  const save = useAction((motive: string) => patch(`${PATH[kind]}/${id}`, { motive }), {
    onSuccess: () => setDraft(null),
  });
  const canWrite = me.data?.canWrite !== false;
  if (draft !== null)
    return (
      <form
        className="flex gap-2 items-center"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(draft.trim());
        }}
      >
        <input
          autoFocus
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setDraft(null)}
          placeholder="Quelques mots, le mot-clé entre **astérisques**"
          aria-label="Pourquoi"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button type="submit" className="btn btn-sm btn-primary" disabled={save.isPending}>
          OK
        </button>
      </form>
    );
  if (!value.trim())
    return canWrite ? (
      <button
        type="button"
        className="self-start border-0 bg-transparent p-0 cursor-pointer text-[14px]"
        style={{ color: 'var(--text-ghost)' }}
        onClick={() => setDraft('')}
      >
        + écrire le pourquoi
      </button>
    ) : null;
  return (
    <button
      type="button"
      className="self-start text-left border-0 bg-transparent p-0"
      style={{
        fontSize: size,
        lineHeight: 1.3,
        color: 'var(--text-2)',
        cursor: canWrite ? 'text' : 'default',
      }}
      title={canWrite ? 'Clic : modifier' : undefined}
      onClick={() => canWrite && setDraft(value)}
    >
      <MotiveText text={value} />
    </button>
  );
}
