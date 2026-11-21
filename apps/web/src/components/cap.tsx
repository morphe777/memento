// D-100: the « why » in a few words (motive), keyword in **bold**, and the reminder line of Ma semaine.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { get, post, put } from '../lib/api.ts';
import { toast, useAction, useMe } from '../lib/hooks.ts';
import type { WeekFocus } from '../lib/types.ts';
import { type AiRequest, WithWand } from './ai-fill.tsx';
import { Field, Panel, SAVE_HINT } from './ui.tsx';

/** Renders « Vieillir **debout** » with the keyword in bold; nothing else is interpreted. */
export function MotiveText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <strong key={i} style={{ fontWeight: 700, color: 'var(--text)' }}>
            {p}
          </strong>
        ) : (
          p
        ),
      )}
    </>
  );
}

export const MOTIVE_HELP =
  'Le pourquoi, pas le quoi : quelques mots lus en une fraction de seconde. Le mot qui déclenche entre deux astérisques s’affiche en gras : « Vieillir **debout** » → Vieillir debout (debout en gras). Affiché dans la page Cap ; l’IA s’en sert pour écrire le cap de la semaine.';

/** D-100: the « why » field of the meta-objective, objective and project panels, with its preview. */
export function MotiveField({
  value,
  onChange,
  ai,
}: {
  value: string;
  onChange: (v: string) => void;
  /** D-105: the wand of the field. */
  ai?: AiRequest;
}) {
  return (
    <Field
      label="Pourquoi (Cap)"
      info={MOTIVE_HELP}
      hint={
        value.trim() ? (
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            <MotiveText text={value} />
          </span>
        ) : (
          'ex. Vieillir **debout**'
        )
      }
    >
      {ai ? (
        <WithWand ai={ai} field="motive" value={value} onUse={onChange}>
          <input value={value} maxLength={120} onChange={(e) => onChange(e.target.value)} />
        </WithWand>
      ) : (
        <input value={value} maxLength={120} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

/**
 * D-175: « Cap de la semaine », the 2 aims of the week, under the title of Ma semaine and Planifier › Semaine.
 * Written on Monday morning by the worker, kept; never computed when the page opens. `refresh`: the ↻ that writes
 * them again from the plan as it is now (Planifier). A click on the aims opens the panel to write them by hand.
 */
export function WeekFocusLine({
  week,
  compact = false,
  refresh = false,
}: {
  week: string;
  compact?: boolean;
  refresh?: boolean;
}) {
  const me = useMe();
  const q = useQuery({
    queryKey: ['week-focus', week],
    queryFn: () => get<{ focus: WeekFocus | null }>(`/week-plans/${week}/focus`),
  });
  const [editing, setEditing] = useState(false);
  const redo = useAction(
    () => post<{ focus: WeekFocus; aiError: string | null }>(`/week-plans/${week}/focus/refresh`),
    {
      onSuccess: (r) =>
        toast(
          r.aiError
            ? 'IA indisponible : le cap reprend les 2 projets qui ont le plus de temps prévu.'
            : 'Cap de la semaine mis à jour.',
          r.aiError ? 'error' : undefined,
        ),
    },
  );
  if (!q.data) return null;
  const items = q.data.focus?.items ?? [];
  const canWrite = me.data?.canWrite !== false;
  return (
    <div
      className="flex items-center gap-3 min-w-0"
      style={{ fontSize: compact ? 14 : 15, color: 'var(--text-muted)', minHeight: 28 }}
    >
      <Link to="/cap" className="label-caps hover:no-underline flex-none" style={{ color: 'var(--primary)' }}>
        Cap
      </Link>
      <button
        type="button"
        className="flex-1 min-w-0 text-left border-0 bg-transparent p-0 cursor-pointer"
        style={{ color: 'inherit', fontSize: 'inherit' }}
        onClick={() => canWrite && setEditing(true)}
        title={canWrite ? 'Modifier le cap de la semaine' : undefined}
      >
        {items.length ? (
          <span className="flex flex-wrap" style={{ columnGap: 20, rowGap: 2 }}>
            {items.map((it, i) => (
              <span key={i}>
                <MotiveText text={it.text} />
              </span>
            ))}
          </span>
        ) : (
          <span style={{ color: 'var(--text-faint)' }}>
            {refresh
              ? 'Pas encore de cap : ↻ pour l’écrire d’après le plan'
              : 'Le cap de la semaine s’écrit lundi matin'}
          </span>
        )}
      </button>
      {refresh && canWrite && (
        <button
          type="button"
          className="icon-btn"
          onClick={() => redo.mutate(undefined)}
          disabled={redo.isPending}
          aria-label="Réécrire le cap d’après le plan"
          title="Réécrire le cap d’après le plan actuel"
        >
          <span
            aria-hidden
            className={redo.isPending ? 'spin' : undefined}
            style={{ fontSize: 18, lineHeight: 1 }}
          >
            ↻
          </span>
        </button>
      )}
      {editing && (
        <WeekFocusPanel week={week} items={items.map((i) => i.text)} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

/** D-175, D-40: the 2 aims written by hand (closing saves if changed, Escape cancels). */
function WeekFocusPanel({ week, items, onClose }: { week: string; items: string[]; onClose: () => void }) {
  const [lines, setLines] = useState([items[0] ?? '', items[1] ?? '']);
  const save = useAction((v: string[]) => put(`/week-plans/${week}/focus`, { items: v }), {
    toast: 'Cap de la semaine enregistré.',
  });
  const close = () => {
    if (lines.join('\n') !== [items[0] ?? '', items[1] ?? ''].join('\n')) save.mutate(lines);
    onClose();
  };
  return (
    <Panel open onClose={close} onCancel={onClose} title="Cap de la semaine" hint={SAVE_HINT}>
      <p className="m-0 text-[13px]" style={{ color: 'var(--text-faint)' }}>
        Les 2 grandes actions de la semaine, en quelques mots ; le mot clé entre deux astérisques s’affiche en
        gras. Écrit lundi matin d’après le plan ; ↻ dans Planifier › Semaine pour le réécrire.
      </p>
      {lines.map((v, i) => (
        <Field
          key={i}
          label={i ? 'Deuxième' : 'Première'}
          hint={v.trim() ? <MotiveText text={v} /> : 'ex. Poser le **carrelage**'}
        >
          <input
            value={v}
            maxLength={80}
            autoFocus={!i}
            onChange={(e) => setLines(lines.map((x, j) => (j === i ? e.target.value : x)))}
          />
        </Field>
      ))}
    </Panel>
  );
}
