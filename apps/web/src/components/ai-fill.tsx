// D-97: « Compléter avec l'IA » in the panel of a meta-objective, an objective or a project. The AI proposes 3
// alternative titles and a value for each field (description, SMART measure, success criterion); the user picks
// what replaces what in the form, which still has to be saved. Nothing is written by the AI.
import { type ReactNode, useState } from 'react';
import { ApiError, post } from '../lib/api.ts';
import { toast } from '../lib/hooks.ts';
import { StarIcon } from './ai.tsx';
import { AiDots, AiWait, ErrorBox } from './ui.tsx';

export type FillField = 'description' | 'smartIndicator' | 'smartTarget' | 'successCriterion' | 'motive';
export interface FillValues {
  title: string;
  description?: string;
  smartIndicator?: string;
  smartTarget?: string;
  successCriterion?: string;
  motive?: string;
}
interface FillAnswer {
  titles: string[];
  fields: Partial<Record<FillField, string>>;
  comment: string | null;
}

const LABEL: Record<FillField, string> = {
  description: 'Description',
  smartIndicator: 'Indicateur (SMART)',
  smartTarget: 'Cible',
  successCriterion: 'Critère de succès',
  motive: 'Pourquoi (Cap)',
};

export function AiFill({
  kind,
  id,
  parentId,
  values,
  template,
  onUse,
}: {
  kind: 'meta_objective' | 'objective' | 'project';
  id?: string;
  parentId?: string;
  values: FillValues;
  /** The description template: a description equal to it counts as empty. */
  template?: string;
  onUse: (field: 'title' | FillField, value: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<FillAnswer | null>(null);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<unknown>(null);
  const run = async (withRemark?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<FillAnswer>('/ai/fill', {
        kind,
        id,
        parentId: parentId || undefined,
        values: {
          title: values.title,
          description: values.description ?? '',
          smartIndicator: values.smartIndicator ?? '',
          smartTarget: values.smartTarget ?? '',
          successCriterion: values.successCriterion ?? '',
          motive: values.motive ?? '',
        },
        remark: withRemark || undefined,
      });
      setAnswer(r);
      setUsed(new Set());
      setRemark('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const use = (field: 'title' | FillField, value: string, key = field) => {
    onUse(field, value);
    setUsed((u) => new Set(u).add(key));
  };
  const isEmpty = (f: FillField) => {
    const v = (values[f] ?? '').trim();
    return !v || (f === 'description' && !!template && v === template.trim());
  };
  const fields = answer ? (Object.entries(answer.fields) as [FillField, string][]) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-sm btn-soft-primary"
          disabled={busy || !values.title.trim()}
          title={values.title.trim() ? undefined : 'Donne d’abord un titre'}
          onClick={() => run()}
        >
          <StarIcon size={16} />
          {answer ? 'Refaire' : 'Compléter avec l’IA'}
        </button>
        {busy && <AiWait label="L’IA complète la fiche…" />}
        {!busy && !answer && (
          <span className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
            Titres alternatifs et champs proposés, à choisir un par un.
          </span>
        )}
      </div>
      {error != null && <ErrorBox error={error} />}
      {answer && !busy && (
        <div
          className="flex flex-col gap-3 text-[14px]"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid color-mix(in srgb, var(--primary) 30%, var(--border))',
            borderRadius: 10,
            padding: '10px 12px',
          }}
        >
          {answer.comment && (
            <p className="m-0" style={{ color: 'var(--text-muted)' }}>
              {answer.comment}
            </p>
          )}
          {answer.titles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="label-caps">Titres proposés · un clic remplace le titre</span>
              <div className="flex flex-wrap gap-1.5">
                {answer.titles.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="btn btn-sm"
                    style={
                      used.has(`title:${t}`) ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : {}
                    }
                    onClick={() => use('title', t, `title:${t}` as 'title')}
                  >
                    {used.has(`title:${t}`) ? '✓ ' : ''}
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
          {fields.map(([f, v]) => (
            <div key={f} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="label-caps">{LABEL[f]}</span>
                {!isEmpty(f) && !used.has(f) && (
                  <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    remplacera le texte actuel
                  </span>
                )}
                <span className="flex-1" />
                <button type="button" className="btn btn-sm" disabled={used.has(f)} onClick={() => use(f, v)}>
                  {used.has(f) ? '✓ Utilisé' : 'Utiliser'}
                </button>
              </div>
              <div
                className={f === 'description' ? 'mono text-[12.5px]' : ''}
                style={{
                  whiteSpace: 'pre-wrap',
                  maxHeight: f === 'description' ? 180 : undefined,
                  overflow: 'auto',
                  color: 'var(--text-2)',
                }}
              >
                {v}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 items-center">
            {fields.some(([f]) => isEmpty(f) && !used.has(f)) && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  for (const [f, v] of fields) if (isEmpty(f) && !used.has(f)) use(f, v);
                }}
              >
                Remplir les champs vides
              </button>
            )}
            <form
              className="flex gap-2 flex-1"
              style={{ minWidth: 220 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (remark.trim()) run(remark.trim());
              }}
            >
              <input
                className="flex-1"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Une remarque ? (plus ambitieux, mesure en heures…)"
                style={{
                  minHeight: 32,
                  padding: '0 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              />
              <button type="submit" className="btn btn-sm" disabled={!remark.trim()}>
                Refaire
              </button>
            </form>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAnswer(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** What a panel sends to the AI about the item it edits (same as AiFill). */
export interface AiRequest {
  kind: 'meta_objective' | 'objective' | 'project';
  id?: string;
  parentId?: string;
  values: FillValues;
}

const WAND_TITLE: Record<'title' | FillField, string> = {
  title: 'Proposer un autre titre avec l’IA',
  description: 'Réécrire la description avec l’IA',
  smartIndicator: 'Proposer un autre indicateur avec l’IA',
  smartTarget: 'Proposer une autre cible avec l’IA',
  successCriterion: 'Proposer un autre critère de succès avec l’IA',
  motive: 'Proposer un autre pourquoi avec l’IA',
};

/**
 * D-105: the magic wand at the end of a field: the AI proposes again this field only and the value replaces the
 * current one (↶ brings the previous one back). Nothing is saved until the panel is.
 */
export function AiWand({
  ai,
  field,
  value,
  onUse,
}: {
  ai: AiRequest;
  field: 'title' | FillField;
  value: string;
  onUse: (v: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [previous, setPrevious] = useState<string | null>(null);
  const run = async () => {
    if (!ai.values.title.trim()) return toast('Donne d’abord un titre : l’IA en a besoin.', 'error');
    setBusy(true);
    try {
      const v = ai.values;
      const r = await post<FillAnswer>('/ai/fill', {
        kind: ai.kind,
        id: ai.id,
        parentId: ai.parentId || undefined,
        only: field,
        values: {
          title: v.title,
          description: v.description ?? '',
          smartIndicator: v.smartIndicator ?? '',
          smartTarget: v.smartTarget ?? '',
          successCriterion: v.successCriterion ?? '',
          motive: v.motive ?? '',
        },
      });
      const next = field === 'title' ? r.titles[0] : r.fields[field];
      if (!next) return toast('L’IA n’a rien proposé pour ce champ.', 'error');
      setPrevious(value);
      onUse(next);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Erreur', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-0.5 flex-none">
      {previous !== null && !busy && previous !== value && (
        <button
          type="button"
          className="icon-btn ai-wand"
          title="Revenir à la valeur précédente"
          aria-label="Revenir à la valeur précédente"
          onClick={() => {
            onUse(previous);
            setPrevious(null);
          }}
        >
          ↶
        </button>
      )}
      <button
        type="button"
        className="icon-btn ai-wand"
        title={WAND_TITLE[field]}
        aria-label={WAND_TITLE[field]}
        disabled={busy}
        onClick={run}
      >
        {busy ? <AiDots /> : <WandIcon />}
      </button>
    </span>
  );
}

/** A field input with its wand at the end. */
export function WithWand({ children, ...wand }: Parameters<typeof AiWand>[0] & { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex-1 min-w-0 flex flex-col">{children}</span>
      <AiWand {...wand} />
    </span>
  );
}

export function WandIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m2.5 13.5 8-8 2 2-8 8z" />
      <path d="m9 7 2 2" />
      <path d="M12 1.5v2M11 2.5h2M14.5 5v1.5M13.75 5.75h1.5M6 1.5v1.5M5.25 2.25h1.5" />
    </svg>
  );
}
