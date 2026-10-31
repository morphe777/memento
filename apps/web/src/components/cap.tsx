// D-100: the « why » in a few words (motive), keyword in **bold**, and the reminder line of Ma semaine.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { get } from '../lib/api.ts';
import { useMe } from '../lib/hooks.ts';
import type { Cap } from '../lib/types.ts';
import { type AiRequest, WithWand } from './ai-fill.tsx';
import { Field } from './ui.tsx';

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
  'Le pourquoi, pas le quoi : quelques mots lus en une fraction de seconde. Le mot qui déclenche entre deux astérisques s’affiche en gras : « Vieillir **debout** » → Vieillir debout (debout en gras). Affiché dans Cap et, trois à la fois, dans Ma semaine.';

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

const SHOWN = 3;

/**
 * Ma semaine: up to three « why » at a glance — month projects first, then quarter objectives and
 * meta-objectives. The set turns each day; a click on ↻ shows the next ones.
 */
export function CapLine({ compact = false }: { compact?: boolean }) {
  const me = useMe();
  const q = useQuery({ queryKey: ['cap'], queryFn: () => get<Cap>('/cap') });
  const day = Number((me.data?.today ?? '').replaceAll('-', '')) || 0;
  const [shift, setShift] = useState(0);
  const all = q.data?.reminders ?? [];
  if (!q.data) return null;
  if (!all.length)
    return (
      <Link to="/cap" className="text-[13px]" style={{ color: 'var(--text-faint)' }}>
        Cap : écris en quelques mots le pourquoi de tes objectifs →
      </Link>
    );
  const start = (day + shift * SHOWN) % all.length;
  const shown = Array.from({ length: Math.min(SHOWN, all.length) }, (_, i) => all[(start + i) % all.length]);
  return (
    <div
      className="flex items-center gap-x-5 gap-y-1 flex-wrap"
      style={{ fontSize: compact ? 14 : 15, color: 'var(--text-muted)' }}
    >
      <Link to="/cap" className="label-caps hover:no-underline" style={{ color: 'var(--primary)' }}>
        Cap
      </Link>
      {shown.map((r) => (
        <span key={`${r.type}-${r.id}`} title={r.title}>
          <MotiveText text={r.motive} />
        </span>
      ))}
      {all.length > SHOWN && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Autres rappels"
          title="Autres rappels"
          onClick={() => setShift((s) => s + 1)}
          style={{ width: 28, height: 28, minHeight: 28 }}
        >
          ↻
        </button>
      )}
    </div>
  );
}
