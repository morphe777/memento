// AppShell (sidebar on PC / iPad, bottom tabs on iPhone), Breadcrumb, SearchPalette (Cmd+K), Toasts.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api.ts';
import {
  useAction,
  useDomainLookup,
  useGroups,
  useIsPhone,
  useMe,
  useResolvedTheme,
  useSetTheme,
  useSettings,
  useToasts,
} from '../lib/hooks.ts';
import type { SearchResult } from '../lib/types.ts';
import { DomainDot } from './ui.tsx';

const NAV: { section: string; items: { to: string; label: string }[] }[] = [
  {
    section: 'Exécuter',
    items: [
      { to: '/semaine', label: 'Ma semaine' },
      { to: '/planifier', label: 'Planifier' },
      { to: '/inbox', label: 'Inbox' },
    ],
  },
  {
    section: 'Piloter',
    items: [
      { to: '/objectifs', label: 'Objectifs' },
      { to: '/projets', label: 'Projets' },
      { to: '/taches', label: 'Tâches' },
      { to: '/domaines', label: 'Domaines' },
      { to: '/idees', label: 'Idées' },
    ],
  },
  {
    section: 'Suivi',
    items: [
      { to: '/rapports', label: 'Rapports' },
      { to: '/journal', label: 'Journal' },
    ],
  },
];

const TABS = [
  { to: '/semaine', label: 'Semaine' },
  { to: '/projets', label: 'Projets' },
  { to: '/idees', label: 'Idées' },
  { to: '/rapports', label: 'Rapports' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const phone = useIsPhone();
  const theme = useResolvedTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const settings = useSettings();
  useEffect(() => {
    const c = settings.data?.['experience.badge_color'];
    if (c) document.documentElement.style.setProperty('--experience', c);
  }, [settings.data]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#121211' : '#F6F6F3');
  }, [theme]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)' }}>
      {!phone && <Sidebar onSearch={() => setSearchOpen(true)} />}
      <div className="flex-1 min-w-0 flex flex-col">
        {phone && (
          <div
            className="flex justify-end px-4 pt-3"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSearchOpen(true)}
                aria-label="Rechercher"
              >
                Rechercher
              </button>
              <SettingsLink active={false} />
            </div>
          </div>
        )}
        <main
          className="flex-1 box-border"
          style={{
            padding: phone ? '12px 12px 96px' : '32px 24px',
            maxWidth: phone ? undefined : 1408,
            width: '100%',
            margin: '0 auto',
          }}
        >
          {children}
        </main>
      </div>
      {phone && <BottomTabs />}
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Toasts />
    </div>
  );
}

function Sidebar({ onSearch }: { onSearch: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const me = useMe();
  const groups = useGroups();
  const dl = useDomainLookup();
  const [allGroups, setAllGroups] = useState(false);
  const shown = (groups.data ?? []).filter((g) => allGroups || g.activeProjectCount > 0);
  const logout = useAction(() => post('/auth/logout'), {
    onSuccess: () => window.dispatchEvent(new Event('memento:unauthenticated')),
  });
  return (
    <nav
      aria-label="Navigation principale"
      className="flex-none flex flex-col gap-5 sticky top-0 h-screen overflow-y-auto box-border"
      style={{
        width: 232,
        padding: '28px 14px 20px',
        borderRight: '1px solid var(--border)',
        background: 'var(--surface-2)',
      }}
    >
      <Link to="/semaine" className="flex items-center gap-2 px-2 hover:no-underline">
        <img src="/icon.svg" alt="" width={26} height={26} />
        <span className="text-[19px] font-bold tracking-tight">Mémento</span>
      </Link>
      <button
        type="button"
        className="btn btn-sm justify-between"
        onClick={onSearch}
        style={{ color: 'var(--text-faint)' }}
      >
        <span>Rechercher</span>
        <span className="mono text-[11px]">⌘K</span>
      </button>
      {NAV.map((s) => (
        <div key={s.section} className="flex flex-col gap-0.5">
          <div
            className="flex items-center gap-2 px-2 pb-1.5 text-[11px] font-bold uppercase"
            style={{ letterSpacing: '0.1em', color: 'var(--text)' }}
          >
            {s.section}
            <span aria-hidden className="flex-1" style={{ height: 1, background: 'var(--border)' }} />
          </div>
          {s.items.map((i) => {
            const active = path === i.to || path.startsWith(`${i.to}/`);
            return (
              <Fragment key={i.to}>
                <Link
                  to={i.to}
                  className="flex items-center justify-between px-2 rounded-md text-[14px] hover:no-underline"
                  style={{
                    minHeight: 36,
                    fontWeight: active ? 600 : 400,
                    background: active ? 'var(--bin)' : undefined,
                    color: active ? 'var(--text)' : 'var(--text-2)',
                  }}
                >
                  {i.label}
                  {i.to === '/journal' && (me.data?.unreviewed ?? 0) > 0 && (
                    <span
                      className="mono text-[11px] rounded-full px-2"
                      style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}
                    >
                      {me.data!.unreviewed}
                    </span>
                  )}
                </Link>
                {i.to === '/projets' && shown.length > 0 && (
                  <div className="flex flex-col pl-3 py-1">
                    {shown.map((g) => (
                      <Link
                        key={g.id}
                        to="/projets"
                        search={{ groupe: g.id }}
                        className="flex items-center gap-2 px-2 rounded-md text-[13px]"
                        style={{ minHeight: 28, color: 'var(--text-muted)' }}
                      >
                        <DomainDot color={dl.color(g.domainId)} size={6} />
                        <span className="truncate">{g.name}</span>
                      </Link>
                    ))}
                    <button
                      type="button"
                      className="text-left text-[12px] px-2 border-0 bg-transparent cursor-pointer"
                      style={{ color: 'var(--text-ghost)', minHeight: 26 }}
                      onClick={() => setAllGroups((v) => !v)}
                    >
                      {allGroups ? 'Groupes actifs' : 'Tous'}
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      ))}
      <div className="mt-auto flex flex-col gap-2.5 px-2">
        <ThemeSwitch />
        <div className="flex items-center gap-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
          <span className="flex-1 min-w-0 truncate font-medium">{me.data?.login}</span>
          <SettingsLink active={path.startsWith('/configuration')} />
          <button
            type="button"
            aria-label="Se déconnecter"
            title="Se déconnecter"
            className="icon-btn"
            onClick={() => logout.mutate(undefined)}
          >
            <LogoutIcon />
          </button>
        </div>
      </div>
    </nav>
  );
}

const THEMES = [
  { value: 'auto', label: 'Auto (suit l’appareil)', icon: <AutoIcon /> },
  { value: 'light', label: 'Clair', icon: <SunIcon /> },
  { value: 'dark', label: 'Sombre', icon: <MoonIcon /> },
] as const;

export function ThemeSwitch() {
  const settings = useSettings();
  const setTheme = useSetTheme();
  const value = settings.data?.theme ?? 'auto';
  return (
    <div
      className="flex rounded-lg p-0.5 gap-0.5"
      style={{ background: 'var(--bin)' }}
      role="radiogroup"
      aria-label="Thème"
    >
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          aria-label={t.label}
          title={t.label}
          onClick={() => setTheme.mutate(t.value)}
          className="flex-1 grid place-items-center border-0 rounded-md cursor-pointer"
          style={{
            minHeight: 30,
            background: value === t.value ? 'var(--surface)' : 'transparent',
            color: value === t.value ? 'var(--text)' : 'var(--text-faint)',
            boxShadow: value === t.value ? '0 1px 2px rgba(0,0,0,0.08)' : undefined,
          }}
        >
          {t.icon}
        </button>
      ))}
    </div>
  );
}

function SettingsLink({ active }: { active: boolean }) {
  return (
    <Link
      to="/configuration/$onglet"
      params={{ onglet: 'budget' }}
      aria-label="Configuration"
      title="Configuration"
      className="icon-btn hover:no-underline"
      style={active ? { background: 'var(--bin)', color: 'var(--text)' } : undefined}
    >
      <CogIcon />
    </Link>
  );
}

const ICON = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function SunIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M13.2 9.9A5.6 5.6 0 0 1 6.1 2.8a5.6 5.6 0 1 0 7.1 7.1Z" />
    </svg>
  );
}
function AutoIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 2.2a5.8 5.8 0 0 1 0 11.6Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CogIcon() {
  return (
    <svg {...ICON} width={17} height={17} aria-hidden>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M6.9 1.6h2.2l.35 1.7 1.2.7 1.65-.55 1.1 1.9-1.3 1.15v1.4l1.3 1.15-1.1 1.9-1.65-.55-1.2.7-.35 1.7H6.9l-.35-1.7-1.2-.7-1.65.55-1.1-1.9 1.3-1.15v-1.4L2.6 5.35l1.1-1.9 1.65.55 1.2-.7Z" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg {...ICON} aria-hidden>
      <path d="M6.5 2.5H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 13.5h2.5M10.5 11l3-3-3-3M13.5 8H6" />
    </svg>
  );
}

function BottomTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed bottom-0 left-0 right-0 z-30 grid"
      style={{
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        padding: '8px 8px calc(env(safe-area-inset-bottom) + 12px)',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {TABS.map((t) => {
        const active = path === t.to || path.startsWith(`${t.to}/`) || (t.to === '/semaine' && path === '/');
        return (
          <Link
            key={t.to}
            to={t.to}
            className="grid place-items-center text-[12px] hover:no-underline"
            style={{
              minHeight: 48,
              fontWeight: active ? 600 : 400,
              color: active ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Breadcrumb (G-12): always shown, every segment is a link. */
export function Breadcrumb({
  items,
}: {
  items: { label: string; to?: string; params?: Record<string, string>; search?: Record<string, string> }[];
}) {
  const settings = useSettings();
  if (!settings.data?.['ui.breadcrumb']) return null;
  return (
    <nav
      aria-label="Fil d'Ariane"
      className="flex flex-wrap items-center gap-1.5 text-[13px] mb-3"
      style={{ color: 'var(--text-faint)' }}
    >
      {items.map((it, i) => (
        <Fragment key={`${it.label}-${i}`}>
          {i > 0 && <span aria-hidden>›</span>}
          {it.to && i < items.length - 1 ? (
            <Link to={it.to} params={it.params as never} search={it.search as never}>
              {it.label}
            </Link>
          ) : (
            <span
              aria-current={i === items.length - 1 ? 'page' : undefined}
              style={{ color: i === items.length - 1 ? 'var(--text-2)' : undefined }}
            >
              {it.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

const SEARCH_GROUPS: { key: keyof SearchResult; label: string }[] = [
  { key: 'objective', label: 'Objectifs' },
  { key: 'project', label: 'Projets' },
  { key: 'idea', label: 'Idées' },
  { key: 'task', label: 'Tâches' },
  { key: 'inbox', label: 'Inbox' },
];

function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 150); // F-01: popup while typing, 150 ms debounce
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);
  const res = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => get<SearchResult>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length > 0,
  });
  const flat = SEARCH_GROUPS.flatMap((g) =>
    ((res.data?.[g.key] ?? []) as { id: string; title: string; projectId?: string | null }[]).map((r) => ({
      ...r,
      type: g.key,
    })),
  );
  const go = (r: (typeof flat)[number]) => {
    onClose();
    if (r.type === 'objective') navigate({ to: '/objectifs/$id', params: { id: r.id } });
    else if (r.type === 'project' || r.type === 'idea')
      navigate({ to: '/projets/$id', params: { id: r.id } });
    else if (r.type === 'task' && r.projectId)
      navigate({ to: '/projets/$id', params: { id: r.projectId }, search: { tache: r.id } });
    else navigate({ to: '/inbox', search: { tache: r.id } });
  };
  if (!open) return null;
  let i = -1;
  return (
    <div className="fixed inset-0 z-50 flex justify-center items-start" style={{ paddingTop: '10vh' }}>
      <button
        type="button"
        aria-label="Fermer la recherche"
        className="absolute inset-0 border-0"
        style={{ background: 'rgba(20,20,18,0.28)' }}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Recherche"
        className="relative card overflow-hidden flex flex-col"
        style={{ width: 'min(640px, calc(100vw - 24px))', maxHeight: '70vh' }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, flat.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === 'Enter' && flat[cursor]) go(flat[cursor]);
          }}
          placeholder="Rechercher un objectif, un projet, une tâche…"
          aria-label="Rechercher"
          className="border-0 rounded-none text-[17px]"
          style={{
            padding: '16px 20px',
            minHeight: 56,
            borderBottom: '1px solid var(--border)',
            outline: 'none',
          }}
        />
        <div className="overflow-y-auto">
          {debounced && res.data && flat.length === 0 && (
            <div className="px-5 py-6 text-[14px]" style={{ color: 'var(--text-faint)' }}>
              Rien trouvé.
            </div>
          )}
          {SEARCH_GROUPS.map((g) => {
            const rows = (res.data?.[g.key] ?? []) as { id: string; title: string }[];
            if (!rows.length) return null;
            return (
              <div key={g.key} className="py-2">
                <div className="label-caps px-5 py-1" style={{ fontSize: 11 }}>
                  {g.label}
                </div>
                {rows.map((r) => {
                  i++;
                  const idx = i;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => go(flat[idx])}
                      className="w-full text-left border-0 px-5 text-[15px] cursor-pointer"
                      style={{ minHeight: 40, background: cursor === idx ? 'var(--bin)' : 'transparent' }}
                    >
                      {r.title}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useToasts();
  return (
    <div
      className="fixed z-[60] flex flex-col gap-2"
      style={{ right: 16, bottom: 'calc(env(safe-area-inset-bottom) + 88px)' }}
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-lg px-4 py-3 text-[14px] shadow-lg"
          style={{
            background: t.kind === 'error' ? 'var(--late-text)' : 'var(--inverse-bg)',
            color: 'var(--inverse-text)',
            maxWidth: 420,
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
