// D-68: quick Inbox capture from anywhere (« + » button on iPhone, sidebar on PC / iPad, ?capturer=1 for an
// iOS Shortcut or a home-screen bookmark). Title first, short duration by default: an idea is caught in 2 taps.
import { useEffect, useRef, useState } from 'react';
import { post } from '../lib/api.ts';
import { useAction, useDomainLookup } from '../lib/hooks.ts';
import { DurationOptions } from './tasks.tsx';
import { Panel } from './ui.tsx';

export function CaptureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dl = useDomainLookup();
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('15');
  const [domainId, setDomainId] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);
  const reset = () => {
    setTitle('');
    setDuration('15');
    setDomainId('');
  };
  const add = useAction(
    () =>
      post('/tasks', {
        title: title.trim(),
        projectId: null,
        durationMin: duration ? Number(duration) : null,
        domainId: domainId || null,
      }),
    {
      toast: 'Ajouté à l’Inbox.',
      onSuccess: () => {
        reset();
        onClose();
      },
    },
  );
  return (
    <Panel open={open} onClose={onClose} title="Capturer dans l’Inbox" side={false} width={520}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && !add.isPending) add.mutate(undefined);
        }}
      >
        <input
          ref={input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Une idée, une chose à faire…"
          aria-label="Titre"
          enterKeyHint="done"
        />
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <select value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Durée">
            <option value="">Durée ?</option>
            <DurationOptions />
          </select>
          <select value={domainId} onChange={(e) => setDomainId(e.target.value)} aria-label="Domaine">
            <option value="">Domaine ?</option>
            {dl.domains.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
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
