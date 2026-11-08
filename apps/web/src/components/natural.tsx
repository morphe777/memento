// D-115: a task typed in plain French. The API reads the text while typing (debounced) and on submit; what it
// recognised is shown as chips under the field, a chip's × gives its words back to the title.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { post } from '../lib/api.ts';
import type { NaturalKind, ParsedTask } from '../lib/types.ts';
import { InfoTip } from './ui.tsx';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** `inbox`: recurrence, #domain and « cette semaine » are read too (DM-41: not for a project task). */
export function useNaturalTask(text: string, inbox: boolean) {
  const [ignore, setIgnore] = useState<NaturalKind[]>([]);
  const typed = useDebounced(text, 200);
  // A new text after a reset (empty field) starts with nothing undone.
  useEffect(() => {
    if (!text.trim()) setIgnore([]);
  }, [text]);
  const q = useQuery({
    queryKey: ['task-parse', typed, inbox, ignore],
    queryFn: () => post<ParsedTask>('/tasks/parse', { text: typed, inbox, ignore }),
    enabled: !!typed.trim(),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const parsed = text.trim() && q.data ? q.data : null;
  return {
    parsed,
    undo: (k: NaturalKind) => setIgnore((l) => (l.includes(k) ? l : [...l, k])),
    /** On submit: the text as it is now, not as it was 200 ms ago. */
    parseNow: () => post<ParsedTask>('/tasks/parse', { text, inbox, ignore }),
  };
}

const KIND_LABEL: Record<NaturalKind, string> = {
  date: 'Deadline',
  recurrence: 'Répète',
  duration: 'Durée',
  domain: 'Domaine',
  week: 'Semaine',
};

/** The « i » and the chips, under a task field. */
export function NaturalBar({
  parsed,
  onUndo,
  inbox,
  hint = false,
}: {
  parsed: ParsedTask | null;
  onUndo: (k: NaturalKind) => void;
  inbox: boolean;
  /** Show a short example while nothing is recognised. */
  hint?: boolean;
}) {
  const parts = parsed?.parts ?? [];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>
      <NaturalHelp inbox={inbox} />
      {parts.length === 0 && hint && (
        <span>{inbox ? 'demain · tous les lundis · 15 min · #maison' : 'demain · le 14 nov. · 30 min'}</span>
      )}
      {parts.map((p) => (
        <span
          key={p.kind}
          className="inline-flex items-center gap-1"
          title={p.warning ? `${p.text} — ${p.warning}` : p.text}
          style={{
            padding: '2px 4px 2px 8px',
            borderRadius: 999,
            background: 'var(--chip)',
            color: 'var(--text-2)',
            border: p.warning ? '1px solid var(--warn)' : '1px solid transparent',
            maxWidth: '100%',
          }}
        >
          <span style={{ color: 'var(--text-faint)' }}>{KIND_LABEL[p.kind]}</span>
          <span className="truncate font-medium">{p.label}</span>
          {p.warning && (
            <span className="truncate" style={{ color: 'var(--warn)' }}>
              · {p.warning}
            </span>
          )}
          <button
            type="button"
            onClick={() => onUndo(p.kind)}
            aria-label={`Annuler : ${p.text} reste dans le titre`}
            title="Annuler : les mots restent dans le titre"
            className="border-0 bg-transparent cursor-pointer flex-none"
            style={{ padding: '0 4px', color: 'var(--text-faint)', fontSize: 14, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

export function NaturalHelp({ inbox }: { inbox: boolean }) {
  const li = (k: string, v: string) => (
    <span className="tip-li">
      <b>{k}</b> {v}
    </span>
  );
  return (
    <InfoTip>
      <span className="tip-p">
        <b>Écris la tâche comme tu la dis.</b> Ce qui est reconnu sort du titre et s'affiche en pastille.
      </span>
      <span className="tip-p">
        {li('Quand', "aujourd'hui, demain, vendredi, le 14, 14 nov., 14/11, dans 3 jours, fin du mois")}
        {inbox &&
          li(
            'Répète',
            'tous les jours, chaque lundi, les mardis et jeudis, chaque mois le 5, chaque année le 14 nov.',
          )}
        {li('Durée', '5 min, 15 min, 1h, 1h30 (arrondie : 5, 15, 30 min, 1 h, 2 h)')}
        {inbox && li('Domaine', '#santé, #maison')}
        {inbox && li('Semaine', '« cette semaine » : dans le plan de la semaine')}
      </span>
      <span className="tip-p">
        Pastille orange : à vérifier (deux dates, durée arrondie, domaine inconnu). Garder tel quel :{' '}
        <b>"entre guillemets"</b>. Le <b>×</b> d'une pastille rend ses mots au titre.
      </span>
    </InfoTip>
  );
}
