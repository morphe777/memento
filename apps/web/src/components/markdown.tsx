// Descriptions are Markdown (GFM: lists, tables, task lists, links). Raw HTML is not rendered (react-markdown default).
import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ApiError, get, post } from '../lib/api.ts';
import { toast } from '../lib/hooks.ts';
import type { AiDescribeRequest, AiStatus } from '../lib/types.ts';
import { StarIcon } from './ai.tsx';
import { AiDots, Tabs } from './ui.tsx';

/** `plain`: links rendered as text, for Markdown shown inside a link (cards). */
export function Markdown({ text, plain = false }: { text: string; plain?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...props }) =>
            plain ? (
              <span>{props.children}</span>
            ) : (
              <a {...props} target="_blank" rel="noreferrer noopener" />
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const LINE_PX = 24; // .md line-height (15px × 1.6)

/**
 * Description shown in full width under a title: rendered Markdown folded to `lines` lines, « Afficher plus »
 * when longer, and a pencil to edit it in place (Écrire / Aperçu).
 */
export function DescriptionBlock({
  text,
  lines = 6,
  onSave,
  saving,
  emptyLabel = 'Pas encore de description.',
  ai,
}: {
  text: string;
  lines?: number;
  onSave: (text: string, done: () => void) => void;
  saving?: boolean;
  emptyLabel?: string;
  /** D-68: the item, for « Rédiger avec l'IA » in the editor. */
  ai?: AiDescribeRequest;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const aiState = useAiDescribe(ai);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const maxHeight = lines * LINE_PX;
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > maxHeight + 8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight, text, editing]);

  if (editing)
    return (
      <div className="card flex flex-col gap-3" style={{ padding: '14px 16px' }}>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            value={mode}
            onChange={setMode}
            options={[
              { value: 'write', label: 'Écrire' },
              { value: 'preview', label: 'Aperçu' },
            ]}
          />
          {ai && <AiDescribeButton ai={aiState} current={draft} />}
          <span className="text-[12px] ml-auto" style={{ color: 'var(--text-ghost)' }}>
            Markdown : ## titre, **gras**, - liste, - [ ] case, [lien](url)
          </span>
        </div>
        {/* D-68: the AI proposal sits beside the text on wide screens (screens are wider than tall). */}
        <div className={aiState.proposal ? 'ai-split' : 'flex flex-col'}>
          {mode === 'write' ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Escape leaves the description editor only, not the drawer around it.
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  setDraft(text);
                  setEditing(false);
                }
              }}
              aria-label="Description"
              className="mono"
              style={{ minHeight: 280, fontSize: 14, lineHeight: 1.55, fontWeight: 400 }}
              autoFocus
            />
          ) : (
            <div style={{ minHeight: 280 }}>
              {draft.trim() ? <Markdown text={draft} /> : <Empty>{emptyLabel}</Empty>}
            </div>
          )}
          {aiState.proposal && <AiProposal ai={aiState} onUse={setDraft} />}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={() => onSave(draft, () => setEditing(false))}
          >
            Enregistrer
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setDraft(text);
              setEditing(false);
            }}
          >
            Annuler
          </button>
        </div>
      </div>
    );

  return (
    <div className="card relative" style={{ padding: '14px 52px 14px 18px' }}>
      <button
        type="button"
        className="icon-btn absolute"
        style={{ top: 8, right: 8 }}
        aria-label="Modifier la description"
        title="Modifier la description"
        onClick={() => {
          setMode('write');
          setEditing(true);
        }}
      >
        <PencilIcon />
      </button>
      {text.trim() ? (
        <>
          <div
            ref={body}
            style={{
              maxHeight: expanded ? undefined : maxHeight,
              overflow: 'hidden',
              maskImage: !expanded && overflows ? 'linear-gradient(#000 60%, transparent)' : undefined,
            }}
          >
            <Markdown text={text} />
          </div>
          {overflows && (
            <button
              type="button"
              className="mt-2 border-0 bg-transparent p-0 text-[13px] font-semibold cursor-pointer hover:underline"
              style={{ color: 'var(--text-muted)' }}
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? 'Afficher moins' : 'Afficher plus'}
            </button>
          )}
        </>
      ) : (
        <span className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
          {emptyLabel}
        </span>
      )}
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <span className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
      {children}
    </span>
  );
}

export function PencilIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.8 2.7a1.6 1.6 0 0 1 2.3 2.3L5.6 12.5l-3 .8.8-3Z" />
      <path d="M9.6 3.9l2.3 2.3" />
    </svg>
  );
}

/**
 * D-68: « Rédiger avec l'IA » — asks for a description (template, what is written, context), shows it for
 * review; « Utiliser ce texte » puts it in the editor, which still has to be saved. A remark redoes it.
 */
function useAiDescribe(request: AiDescribeRequest | undefined) {
  const status = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => get<AiStatus>('/ai/status'),
    enabled: !!request,
  });
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const run = async (base: string, remark?: string) => {
    if (!request) return;
    setBusy(true);
    try {
      const r = await post<{ text: string }>('/ai/describe', { ...request, current: base, remark });
      setProposal(r.text);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "L'IA n'a pas pu répondre.", 'error');
    } finally {
      setBusy(false);
    }
  };
  return {
    ready: !!status.data?.configured,
    reason: status.data?.reason ?? '',
    busy,
    proposal,
    run,
    clear: () => setProposal(null),
  };
}
type AiState = ReturnType<typeof useAiDescribe>;

function AiDescribeButton({ ai, current }: { ai: AiState; current: string }) {
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={!ai.ready || ai.busy}
      title={ai.ready ? undefined : `IA non configurée : ${ai.reason} (Configuration › IA)`}
      onClick={() => ai.run(current)}
    >
      {ai.busy ? <AiDots /> : <StarIcon size={16} />}
      {ai.busy && !ai.proposal
        ? "L'IA rédige…"
        : ai.proposal
          ? 'Refaire depuis mon texte'
          : "Rédiger avec l'IA"}
    </button>
  );
}

function AiProposal({ ai, onUse }: { ai: AiState; onUse: (text: string) => void }) {
  const [remark, setRemark] = useState('');
  const proposal = ai.proposal ?? '';
  return (
    <div
      className="flex flex-col gap-2 rounded-lg min-w-0"
      style={{ border: '1px solid var(--accent, #6B4FD8)', padding: '10px 12px' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-caps flex items-center gap-1.5">
          <StarIcon size={14} /> Proposition de l'IA
        </span>
        <span className="flex gap-2 ml-auto">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={ai.busy}
            onClick={() => {
              onUse(proposal);
              ai.clear();
            }}
          >
            Utiliser ce texte
          </button>
          <button type="button" className="btn btn-sm" disabled={ai.busy} onClick={ai.clear}>
            Écarter
          </button>
        </span>
      </div>
      <div className="flex-1" style={{ minHeight: 200, maxHeight: 420, overflowY: 'auto' }}>
        <Markdown text={proposal} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (remark.trim()) ai.run(proposal, remark.trim()).then(() => setRemark(''));
        }}
      >
        <input
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="Une remarque ? (plus court, insiste sur…)"
          aria-label="Remarque pour l'IA"
          style={{ flex: '1 1 auto', minWidth: 0 }}
          disabled={ai.busy}
        />
        <button type="submit" className="btn btn-sm" disabled={ai.busy || !remark.trim()}>
          {ai.busy ? <AiDots /> : null}
          {ai.busy ? 'Elle refait…' : 'Refaire'}
        </button>
      </form>
    </div>
  );
}

/** Creation forms: the same button and proposal, above the form's own textarea. */
export function AiDescribe({
  request,
  current,
  onUse,
}: {
  request: AiDescribeRequest;
  current: string;
  onUse: (text: string) => void;
}) {
  const ai = useAiDescribe(request);
  return (
    <>
      <AiDescribeButton ai={ai} current={current} />
      {ai.proposal && <AiProposal ai={ai} onUse={onUse} />}
    </>
  );
}
