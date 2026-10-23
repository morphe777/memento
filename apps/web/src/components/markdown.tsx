// Descriptions are Markdown (GFM: lists, tables, task lists, links). Raw HTML is not rendered (react-markdown default).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tabs } from './ui.tsx';

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
}: {
  text: string;
  lines?: number;
  onSave: (text: string, done: () => void) => void;
  saving?: boolean;
  emptyLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs
            value={mode}
            onChange={setMode}
            options={[
              { value: 'write', label: 'Écrire' },
              { value: 'preview', label: 'Aperçu' },
            ]}
          />
          <span className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
            Markdown : ## titre, **gras**, - liste, - [ ] case, [lien](url)
          </span>
        </div>
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
