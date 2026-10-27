// D-70: « Découper avec l'IA » on a project — a short dialogue (the AI may ask questions, the user answers
// or comments), the proposed tasks on the right, each one checkable and editable, then « Ajouter » through
// POST /tasks/batch. The conversation lives here only: closing the panel forgets it.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiError, get, post } from '../lib/api.ts';
import { fmtMin } from '../lib/format.ts';
import { toast, useAction, useSettings } from '../lib/hooks.ts';
import type { AiStatus } from '../lib/types.ts';
import { StarIcon } from './ai.tsx';
import { DurationOptions } from './tasks.tsx';
import { Panel } from './ui.tsx';

interface Msg {
  role: 'ai' | 'user';
  text: string;
}
interface Proposed {
  title: string;
  durationMin: number;
  description: string;
  checked: boolean;
}
interface Answer {
  message: string;
  questions: string[];
  tasks: Omit<Proposed, 'checked'>[];
  model: string;
}

/** Same test as the domain (hasOwnDescription): more than the untouched project template. */
function hasOwnDescription(description: string, template: string) {
  const strip = (t: string) =>
    t
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('')
      .replace(/\s+/g, '');
  return strip(description).length > 0 && strip(description) !== strip(template);
}

export function BreakdownButton({ projectId, description }: { projectId: string; description: string }) {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => get<AiStatus>('/ai/status') });
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const described = hasOwnDescription(description, settings.data?.['templates.project'] ?? '');
  const ready = !!status.data?.configured && described;
  const title = !status.data?.configured
    ? `IA non configurée : ${status.data?.reason ?? ''} (Configuration › IA)`
    : !described
      ? "Écris d'abord la description du projet : l'IA s'en sert pour proposer les tâches."
      : undefined;
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        disabled={!ready}
        title={title}
        onClick={() => setOpen(true)}
      >
        <StarIcon size={16} />
        Découper avec l'IA
      </button>
      {open && <BreakdownPanel projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

function BreakdownPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [tasks, setTasks] = useState<Proposed[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const ask = async (history: Msg[]) => {
    setBusy(true);
    try {
      const a = await post<Answer>('/ai/breakdown', { projectId, messages: history });
      const text = [a.message, ...a.questions.map((q) => `• ${q}`)].filter(Boolean).join('\n');
      setMessages([...history, { role: 'ai', text }]);
      if (a.tasks.length) setTasks(a.tasks.map((t) => ({ ...t, checked: true })));
    } catch (e) {
      setMessages(history);
      toast(e instanceof ApiError ? e.message : "L'IA n'a pas pu répondre.", 'error');
    } finally {
      setBusy(false);
    }
  };
  // First proposal once, when the panel opens (the ref keeps React's strict mode from asking twice).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    ask([]);
  }, []);
  // Braces: recent Chrome returns a Promise from scrollIntoView, which React would take for a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, busy]);
  const send = () => {
    const text = reply.trim();
    if (!text || busy) return;
    setReply('');
    ask([...messages, { role: 'user', text }]);
  };
  const checked = tasks.filter((t) => t.checked);
  const add = useAction(
    () =>
      post('/tasks/batch', {
        projectId,
        tasks: checked.map((t) => ({
          title: t.title.trim(),
          durationMin: t.durationMin,
          description: t.description || undefined,
        })),
      }),
    {
      toast: `${checked.length} tâche${checked.length > 1 ? 's' : ''} ajoutée${checked.length > 1 ? 's' : ''}.`,
      onSuccess: onClose,
    },
  );
  const setTask = (i: number, patch: Partial<Proposed>) =>
    setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const total = checked.reduce((n, t) => n + t.durationMin, 0);
  return (
    <Panel open onClose={onClose} title="Découper avec l'IA" width={1180}>
      <div className="ai-split" style={{ alignItems: 'start' }}>
        <section className="flex flex-col gap-3 min-w-0">
          <div className="label-caps">Échange</div>
          <div className="flex flex-col gap-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {messages.map((m, i) => (
              <div
                key={i}
                className="rounded-lg text-[14px]"
                style={{
                  whiteSpace: 'pre-wrap',
                  padding: '8px 12px',
                  maxWidth: '92%',
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? 'var(--inverse-bg)' : 'var(--surface-2)',
                  color: m.role === 'user' ? 'var(--inverse-text)' : 'var(--text)',
                }}
              >
                {m.text}
              </div>
            ))}
            {busy && (
              <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
                L'IA réfléchit…
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Réponds à ses questions ou fais une remarque (trop détaillé, oublie la partie admin…). Entrée pour envoyer."
              aria-label="Réponse à l'IA"
              style={{ minHeight: 70 }}
              disabled={busy}
            />
            <button type="submit" className="btn btn-sm self-start" disabled={busy || !reply.trim()}>
              Envoyer
            </button>
          </form>
        </section>
        <section className="flex flex-col gap-3 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="label-caps">Tâches proposées</span>
            {tasks.length > 0 && (
              <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {checked.length} / {tasks.length} · {fmtMin(total)}
              </span>
            )}
          </div>
          {tasks.length === 0 ? (
            <span className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
              {busy ? 'En attente de la proposition…' : 'Pas encore de tâches : réponds aux questions.'}
            </span>
          ) : (
            <ol className="m-0 p-0 list-none flex flex-col">
              {tasks.map((t, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2${i < tasks.length - 1 ? ' row-line' : ''}`}
                  style={{ padding: '8px 0', opacity: t.checked ? 1 : 0.5 }}
                >
                  <input
                    type="checkbox"
                    checked={t.checked}
                    onChange={(e) => setTask(i, { checked: e.target.checked })}
                    aria-label={`Garder « ${t.title} »`}
                    style={{ marginTop: 12, minHeight: 0 }}
                  />
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <div className="flex gap-2">
                      <input
                        value={t.title}
                        onChange={(e) => setTask(i, { title: e.target.value })}
                        aria-label="Titre"
                        style={{ flex: '1 1 auto', minWidth: 0 }}
                      />
                      <select
                        value={t.durationMin}
                        onChange={(e) => setTask(i, { durationMin: Number(e.target.value) })}
                        aria-label="Durée"
                        style={{ flex: '0 0 96px' }}
                      >
                        <DurationOptions />
                      </select>
                    </div>
                    {t.description && (
                      <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                        {t.description}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || add.isPending || !checked.length || checked.some((t) => !t.title.trim())}
              onClick={() => add.mutate(undefined)}
            >
              Ajouter {checked.length || ''} tâche{checked.length > 1 ? 's' : ''} au projet
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Fermer
            </button>
          </div>
          <span className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
            Ajoutées à la fin du projet, dans cet ordre. Rien n'est créé avant ce clic.
          </span>
        </section>
      </div>
    </Panel>
  );
}
