// D-117: the notices sent (evening recap, report ready), read in full. The push opens /notifications/{id}.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { ErrorBox, Loading, PageHeader } from '../components/ui.tsx';
import { get, post } from '../lib/api.ts';
import { fmtDateTime } from '../lib/format.ts';
import { useAction } from '../lib/hooks.ts';

export interface NotificationRow {
  id: string;
  kind: 'daily' | 'report' | 'job';
  title: string;
  html: string;
  url: string | null;
  createdAt: string;
  readAt: string | null;
}
export interface NotificationList {
  unread: number;
  items: NotificationRow[];
}

export const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => get<NotificationList>('/notifications'),
    refetchInterval: 60_000,
  });

const TAGS: Record<string, string> = {
  b: 'b',
  strong: 'b',
  i: 'i',
  em: 'i',
  u: 'u',
  ins: 'u',
  s: 's',
  strike: 's',
  del: 's',
  code: 'code',
  pre: 'pre',
  blockquote: 'blockquote',
};
const decode = (t: string) =>
  t
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** The Telegram HTML subset as React elements (no raw HTML is ever injected). */
function TelegramText({ html }: { html: string }) {
  type Node = { tag: string; children: ReactNode[] };
  const root: Node = { tag: 'div', children: [] };
  const stack: Node[] = [root];
  let k = 0;
  for (const part of html.split(/(<\/?[a-z]+>)/i)) {
    const m = /^<(\/?)([a-z]+)>$/i.exec(part);
    const tag = m ? TAGS[m[2].toLowerCase()] : undefined;
    if (m && tag) {
      if (!m[1]) stack.push({ tag, children: [] });
      else if (stack.length > 1) {
        const n = stack.pop() as Node;
        const El = n.tag as 'b';
        stack[stack.length - 1].children.push(<El key={k++}>{n.children}</El>);
      }
    } else if (part) stack[stack.length - 1].children.push(decode(part));
  }
  while (stack.length > 1) {
    const n = stack.pop() as Node;
    const El = n.tag as 'b';
    stack[stack.length - 1].children.push(<El key={k++}>{n.children}</El>);
  }
  return (
    <div className="text-[15px]" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
      {root.children}
    </div>
  );
}

export function NotificationsPage({ id }: { id?: string }) {
  const list = useNotifications();
  const navigate = useNavigate();
  const readAll = useAction(() => post<NotificationList>('/notifications/read-all'));
  if (list.isError) return <ErrorBox error={list.error} />;
  if (!list.data) return <Loading />;
  const { items, unread } = list.data;
  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 760 }}>
      <PageHeader
        eyebrow="Reçues sur Telegram et sur tes appareils, gardées 90 jours"
        title="Notifications"
        actions={
          unread > 0 ? (
            <button type="button" className="btn" onClick={() => readAll.mutate(undefined)}>
              Tout marquer comme lu
            </button>
          ) : undefined
        }
      />
      {items.length === 0 && (
        <div className="text-[14px]" style={{ color: 'var(--text-faint)' }}>
          Aucune notification pour l’instant.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {items.map((n) =>
          n.id === id ? (
            <OpenNotification key={n.id} id={n.id} onClose={() => navigate({ to: '/notifications' })} />
          ) : (
            <Link
              key={n.id}
              to="/notifications/$id"
              params={{ id: n.id }}
              className="flex items-center gap-3 hover:no-underline"
              style={{
                padding: '10px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                color: 'var(--text)',
              }}
            >
              <span
                aria-hidden
                className="flex-none rounded-full"
                style={{ width: 8, height: 8, background: n.readAt ? 'transparent' : 'var(--primary)' }}
              />
              <span
                className="flex-1 min-w-0 truncate text-[14px]"
                style={{ fontWeight: n.readAt ? 400 : 600 }}
              >
                {n.title}
              </span>
              <span className="flex-none text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {fmtDateTime(n.createdAt)}
              </span>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

function OpenNotification({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notification', id],
    queryFn: () => get<NotificationRow>(`/notifications/${id}`),
  });
  const read = !!q.data;
  useEffect(() => {
    if (read) void qc.invalidateQueries({ queryKey: ['notifications'] });
  }, [read, qc]);
  return (
    <article
      className="flex flex-col gap-3"
      style={{
        padding: '14px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      <div className="flex items-center gap-3">
        <span className="flex-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {q.data ? fmtDateTime(q.data.createdAt) : ''}
        </span>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      {q.isError && <ErrorBox error={q.error} />}
      {q.data && <TelegramText html={q.data.html} />}
      {q.data?.url && (
        <Link to={q.data.url as never} className="text-[14px] font-medium">
          Ouvrir le rapport →
        </Link>
      )}
    </article>
  );
}

/** D-119: a plain dot (no number) when something new arrived. */
export function NewDot() {
  return (
    <span
      aria-hidden
      className="absolute rounded-full"
      style={{
        top: -2,
        right: -3,
        width: 8,
        height: 8,
        background: 'var(--late-bar)',
        boxShadow: '0 0 0 2px var(--surface-2)',
      }}
    />
  );
}

/** The bell, next to Configuration and logout (D-119), with a dot when there are unread notices. */
export function NotifyBell({ onClick }: { onClick?: () => void }) {
  const q = useNotifications();
  const unread = (q.data?.unread ?? 0) > 0;
  return (
    <Link
      to="/notifications"
      aria-label={unread ? 'Notifications, nouvelles non lues' : 'Notifications'}
      title="Notifications"
      onClick={onClick}
      className="icon-btn hover:no-underline"
    >
      <span className="relative grid place-items-center">
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1.5H3z" />
          <path d="M6.5 14.5a1.6 1.6 0 0 0 3 0" />
        </svg>
        {unread && <NewDot />}
      </span>
    </Link>
  );
}
