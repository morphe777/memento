// D-75: building an objective's path from its page — quick add of projects at the end of the path (title +
// group, Entrée, next one), the group taken from the previous project of the path, and « Proposer un chemin
// avec l'IA » (same dialogue as D-70, one level up: projects instead of tasks).
import { useQuery } from '@tanstack/react-query';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { ApiError, get, post } from '../lib/api.ts';
import { toast, useAction, useDomainLookup, useGroups } from '../lib/hooks.ts';
import type { AiStatus, PathProject, Project } from '../lib/types.ts';
import { StarIcon } from './ai.tsx';
import { Panel } from './ui.tsx';

const LAST_GROUPS = 'memento.lastGroupIds';

/** Per-browser convenience: the groups of the last project created, the default of the next one. */
export function rememberGroups(ids: string[]) {
  try {
    localStorage.setItem(LAST_GROUPS, JSON.stringify(ids));
  } catch {}
}
function lastGroups(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_GROUPS) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Default groups of a new project of a path: those of the last project of the path, else the last used. */
export function pathDefaultGroups(path: PathProject[] | undefined): string[] {
  const last = path?.at(-1);
  return last?.groupIds.length ? last.groupIds : lastGroups();
}

/** One group, chosen in a select grouped by domain (the quick add keeps it short; more on the project page). */
function GroupSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const groups = useGroups();
  const dl = useDomainLookup();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Groupe"
      style={{ flex: '0 1 220px', minWidth: 0 }}
    >
      <option value="">Groupe ?</option>
      {dl.domains.map((d) => {
        const gs = (groups.data ?? []).filter((g) => g.domainId === d.id);
        return gs.length ? (
          <optgroup key={d.id} label={d.name}>
            {gs.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export function PathQuickAdd({
  objectiveId,
  path,
  inputRef,
}: {
  objectiveId: string;
  path: PathProject[] | undefined;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [title, setTitle] = useState('');
  const [groupId, setGroupId] = useState('');
  // Pre-filled once the path is known; then the user's choice stays for the next ones.
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !path) return;
    filled.current = true;
    setGroupId(pathDefaultGroups(path)[0] ?? '');
  }, [path]);
  const add = useAction(
    (t: string) => post<Project>('/projects', { title: t, groupIds: [groupId], objectiveId }),
    {
      onSuccess: () => {
        rememberGroups([groupId]);
        setTitle('');
      },
    },
  );
  return (
    <form
      className="flex flex-wrap gap-2 items-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        if (!groupId) return toast('Choisis un groupe : le domaine du projet s’en déduit.', 'error');
        add.mutate(title.trim());
      }}
    >
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Nouveau projet sur ce chemin… (Entrée)"
        aria-label="Nouveau projet sur ce chemin"
        style={{ flex: '1 1 240px', minWidth: 0 }}
      />
      <GroupSelect value={groupId} onChange={setGroupId} />
    </form>
  );
}

interface Msg {
  role: 'ai' | 'user';
  text: string;
}
interface Proposed {
  title: string;
  successCriterion: string;
  description: string;
  checked: boolean;
}
interface Answer {
  message: string;
  questions: string[];
  projects: Omit<Proposed, 'checked'>[];
  model: string;
}

export function PathAiButton({
  objectiveId,
  path,
}: {
  objectiveId: string;
  path: PathProject[] | undefined;
}) {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => get<AiStatus>('/ai/status') });
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        disabled={!status.data?.configured}
        title={
          status.data?.configured
            ? undefined
            : `IA non configurée : ${status.data?.reason ?? ''} (Configuration › IA)`
        }
        onClick={() => setOpen(true)}
      >
        <StarIcon size={16} />
        Proposer un chemin
      </button>
      {open && <PathAiPanel objectiveId={objectiveId} path={path} onClose={() => setOpen(false)} />}
    </>
  );
}

function PathAiPanel({
  objectiveId,
  path,
  onClose,
}: {
  objectiveId: string;
  path: PathProject[] | undefined;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [projects, setProjects] = useState<Proposed[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [groupId, setGroupId] = useState(() => pathDefaultGroups(path)[0] ?? '');
  const end = useRef<HTMLDivElement>(null);
  const ask = async (history: Msg[]) => {
    setBusy(true);
    try {
      const a = await post<Answer>('/ai/path', { objectiveId, messages: history });
      const text = [a.message, ...a.questions.map((q) => `• ${q}`)].filter(Boolean).join('\n');
      setMessages([...history, { role: 'ai', text }]);
      if (a.projects.length) setProjects(a.projects.map((p) => ({ ...p, checked: true })));
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
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [messages, busy]);
  const send = () => {
    const text = reply.trim();
    if (!text || busy) return;
    setReply('');
    ask([...messages, { role: 'user', text }]);
  };
  const checked = projects.filter((p) => p.checked);
  // One POST per project, in order: each goes at the end of the path (RB-01, same rules as by hand).
  const add = useAction(
    async () => {
      for (const p of checked)
        await post('/projects', {
          title: p.title.trim(),
          groupIds: [groupId],
          objectiveId,
          successCriterion: p.successCriterion.trim() || undefined,
          description: p.description || undefined,
        });
    },
    {
      toast: `${checked.length} projet${checked.length > 1 ? 's' : ''} ajouté${checked.length > 1 ? 's' : ''} au chemin.`,
      onSuccess: () => {
        rememberGroups([groupId]);
        onClose();
      },
    },
  );
  const setProject = (i: number, patch: Partial<Proposed>) =>
    setProjects((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <Panel open onClose={onClose} title="Proposer un chemin avec l'IA" width={1180}>
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
              placeholder="Réponds à ses questions ou fais une remarque (trop de projets, commence par le budget…). Entrée pour envoyer."
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
            <span className="label-caps">Projets proposés</span>
            {projects.length > 0 && (
              <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                {checked.length} / {projects.length}
              </span>
            )}
          </div>
          {projects.length === 0 ? (
            <span className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
              {busy ? 'En attente de la proposition…' : 'Pas encore de projets : réponds aux questions.'}
            </span>
          ) : (
            <ol className="m-0 p-0 list-none flex flex-col">
              {projects.map((p, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2${i < projects.length - 1 ? ' row-line' : ''}`}
                  style={{ padding: '8px 0', opacity: p.checked ? 1 : 0.5 }}
                >
                  <input
                    type="checkbox"
                    checked={p.checked}
                    onChange={(e) => setProject(i, { checked: e.target.checked })}
                    aria-label={`Garder « ${p.title} »`}
                    style={{ marginTop: 12, minHeight: 0 }}
                  />
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <input
                      value={p.title}
                      onChange={(e) => setProject(i, { title: e.target.value })}
                      aria-label="Titre"
                    />
                    <input
                      value={p.successCriterion}
                      onChange={(e) => setProject(i, { successCriterion: e.target.value })}
                      aria-label="Critère de succès"
                      placeholder="Critère de succès"
                      className="text-[13px]"
                    />
                    {p.description && (
                      <span
                        className="text-[13px]"
                        style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}
                      >
                        {p.description}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <GroupSelect value={groupId} onChange={setGroupId} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy || add.isPending || !groupId || !checked.length || checked.some((p) => !p.title.trim())
              }
              onClick={() => add.mutate(undefined)}
            >
              Ajouter {checked.length || ''} projet{checked.length > 1 ? 's' : ''} au chemin
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Fermer
            </button>
          </div>
          <span className="text-[12px]" style={{ color: 'var(--text-ghost)' }}>
            Créés en idées, à la fin du chemin, dans cet ordre, dans le groupe choisi. Rien n'est créé avant
            ce clic.
          </span>
        </section>
      </div>
    </Panel>
  );
}
