// D-68: quick Inbox capture from anywhere (« + » button on iPhone, sidebar on PC / iPad, ?capturer=1 for an
// iOS Shortcut or a home-screen bookmark). Title first, short duration by default: an idea is caught in 2 taps.
// User request 01/11/2026: from Ma semaine the task can go to the week plan instead (`isoWeek`), and from
// Tâches it can go to a project (`withProject`).
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api.ts';
import { useAction, useDomainLookup, useMe } from '../lib/hooks.ts';
import type { Project, Task } from '../lib/types.ts';
import { NaturalBar, useNaturalTask } from './natural.tsx';
import { DurationOptions } from './tasks.tsx';
import { Panel, Tabs } from './ui.tsx';

type Target = 'inbox' | 'week';

export function CaptureSheet({
  open,
  onClose,
  isoWeek,
  withProject = false,
  onUnplanned,
}: {
  open: boolean;
  onClose: () => void;
  /** Ma semaine: offers « Plan de la semaine » besides the Inbox. */
  isoWeek?: string;
  /** The task may belong to a project (Inbox when none is chosen). */
  withProject?: boolean;
  /** Ma semaine on iPhone (D-107): « Hors plan » opens the « Fait hors plan » panel (D-99) instead. */
  onUnplanned?: () => void;
}) {
  const dl = useDomainLookup();
  const me = useMe();
  const month = me.data?.today.slice(0, 7);
  const [target, setTarget] = useState<Target>(isoWeek ? 'week' : 'inbox');
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('15');
  const [domainId, setDomainId] = useState('');
  const [projectId, setProjectId] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pickProject = withProject || target === 'week';
  // D-115: recurrence, #domain and « cette semaine » for an Inbox task only.
  const inbox = !(pickProject && projectId);
  const nat = useNaturalTask(title, inbox);
  const parsed = nat.parsed;
  const projects = useQuery({
    queryKey: ['projects', 'capture-picker'],
    // The week plan takes ready or active projects only (setWeekItems).
    queryFn: () => get<Project[]>(`/projects?status=active,ready${target === 'week' ? '' : ',paused'}`),
    enabled: open && pickProject,
  });
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);
  const reset = () => {
    setTitle('');
    setDuration('15');
    setDomainId('');
    setProjectId('');
  };
  const add = useAction(
    async () => {
      const p = await nat.parseNow();
      await post<Task>('/tasks', {
        title: p.title || title.trim(),
        projectId: (pickProject && projectId) || null,
        durationMin: p.durationMin ?? (duration ? Number(duration) : null),
        domainId: (!projectId && (p.domainId ?? domainId)) || null,
        dueDate: p.dueDate,
        recurrenceRule: inbox ? p.recurrenceRule : null,
        // H-11: created and added to the week in one call
        isoWeek: (target === 'week' && isoWeek ? isoWeek : p.isoWeek) || undefined,
      });
    },
    {
      toast:
        target === 'week' || parsed?.week
          ? 'Ajouté au plan de la semaine.'
          : projectId
            ? 'Tâche ajoutée.'
            : 'Ajouté à l’Inbox.',
      onSuccess: () => {
        reset();
        onClose();
      },
    },
  );
  // Month projects first: the likeliest home of a new task.
  const choices = [...(projects.data ?? [])].sort(
    (a, b) => Number(b.monthFlag === month) - Number(a.monthFlag === month) || a.title.localeCompare(b.title),
  );
  return (
    <Panel
      open={open}
      onClose={onClose}
      title={isoWeek ? 'Ajouter une tâche' : withProject ? 'Nouvelle tâche' : 'Capturer dans l’Inbox'}
      side={false}
      width={520}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && !add.isPending) add.mutate(undefined);
        }}
      >
        {isoWeek && (
          <Tabs
            value={target}
            onChange={(v: Target | 'done') => {
              if (v !== 'done') return setTarget(v);
              onClose();
              onUnplanned?.();
            }}
            options={[
              { value: 'week', label: 'Plan' },
              { value: 'inbox', label: 'Inbox' },
              ...(onUnplanned ? [{ value: 'done' as const, label: 'Hors plan' }] : []),
            ]}
          />
        )}
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            target === 'week' ? 'Une tâche à faire cette semaine…' : 'Une idée, une chose à faire…'
          }
          aria-label="Titre"
          enterKeyHint="done"
        />
        <NaturalBar parsed={parsed} onUndo={nat.undo} inbox={inbox} hint />
        {pickProject && (
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projet">
            <option value="">Sans projet (Inbox)</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.monthFlag === month ? ' · du mois' : ''}
              </option>
            ))}
          </select>
        )}
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <select
            value={parsed?.durationMin ? String(parsed.durationMin) : duration}
            onChange={(e) => {
              setDuration(e.target.value);
              if (parsed?.durationMin) nat.undo('duration');
            }}
            aria-label="Durée"
          >
            <option value="">Durée ?</option>
            <DurationOptions />
          </select>
          {!projectId && (
            <select
              value={parsed?.domainId ?? domainId}
              onChange={(e) => {
                setDomainId(e.target.value);
                if (parsed?.domainId) nat.undo('domain');
              }}
              aria-label="Domaine"
            >
              <option value="">Domaine ?</option>
              {dl.domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={!title.trim() || add.isPending}>
          Ajouter
        </button>
      </form>
    </Panel>
  );
}

export function PlusIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}
