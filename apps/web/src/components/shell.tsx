// AppShell (sidebar on PC / iPad, bottom tabs on iPhone), Breadcrumb, SearchPalette (Cmd+K), Toasts.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api.ts';
import {
  useAction,
  useDomainLookup,
  useIsPhone,
  useMe,
  useResolvedTheme,
  useSetTheme,
  useSettings,
  useToasts,
} from '../lib/hooks.ts';
import type { Project, SearchResult } from '../lib/types.ts';
import { CaptureSheet, PlusIcon } from './capture.tsx';
import { DomainDot } from './ui.tsx';

interface NavItem {
  to: string;
  label: string;
  search?: Record<string, string>;
  /** Folded-rail icon (defaults to `to`). */
  icon?: string;
  active?: (path: string, vue?: string) => boolean;
}
const under = (path: string, to: string) => path === to || path.startsWith(`${to}/`);
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Exécuter',
    items: [
      { to: '/semaine', label: 'Ma semaine' },
      { to: '/cap', label: 'Cap' }, // D-100
      {
        to: '/planifier',
        label: 'Planifier',
        active: (path, vue) => path === '/planifier' && vue !== 'trimestre',
      },
      { to: '/inbox', label: 'Inbox' },
    ],
  },
  {
    section: 'Piloter',
    items: [
      // D-104: « Objectifs » opens the Vue Plan; the list stays reachable from it (and /objectifs).
      {
        to: '/planifier',
        search: { vue: 'trimestre' },
        label: 'Objectifs',
        icon: '/objectifs',
        active: (path, vue) =>
          under(path, '/objectifs') ||
          under(path, '/meta-objectifs') ||
          (path === '/planifier' && vue === 'trimestre'),
      },
      { to: '/projets', label: 'Projets' },
      { to: '/taches', label: 'Tâches' },
      { to: '/domaines', label: 'Domaines' },
      { to: '/idees', label: 'Idées' },
      { to: '/experiences', label: 'Expériences' },
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

const vueOf = (search: unknown) => (search as { vue?: string } | undefined)?.vue;
const isActive = (i: NavItem, path: string, vue?: string) =>
  i.active ? i.active(path, vue) : under(path, i.to);

export function AppShell({ children }: { children: ReactNode }) {
  const phone = useIsPhone();
  const theme = useResolvedTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  // D-68: ?capturer=1 (iOS Shortcut, home-screen bookmark) opens the capture sheet on any page.
  const [captureOpen, setCaptureOpen] = useState(
    () => new URLSearchParams(window.location.search).get('capturer') === '1',
  );
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

  // User request 31/10/2026: the sidebar folds into a thin rail to give the width to the page (remembered).
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem('memento.sidebar.folded') === '1';
    } catch {
      return false;
    }
  });
  const fold = (v: boolean) => {
    setFolded(v);
    try {
      localStorage.setItem('memento.sidebar.folded', v ? '1' : '0');
    } catch {
      // private mode: not remembered
    }
  };
  const location = useRouterState({ select: (s) => s.location });
  // D-104 (replaces D-95): every page, Planifier included, keeps 1 408 px at most; the Vue Plan has its own
  // « Plein écran ». Folding the menu only gives its width back.
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)' }}>
      {!phone &&
        (folded ? (
          <nav
            aria-label="Navigation principale (réduite)"
            className="flex-none flex flex-col items-center gap-1.5 sticky top-0 h-screen box-border"
            style={{
              width: 52,
              padding: '24px 6px',
              zIndex: 30,
              borderRight: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}
          >
            <Link to="/semaine" aria-label="Mémento" className="hover:no-underline">
              <img src="/icon.svg" alt="" width={26} height={26} />
            </Link>
            <button
              type="button"
              className="icon-btn rail-item"
              aria-label="Déplier le menu"
              data-label="Déplier le menu"
              onClick={() => fold(false)}
            >
              »
            </button>
            <button
              type="button"
              className="icon-btn rail-item"
              aria-label="Rechercher"
              data-label="Rechercher (⌘K)"
              onClick={() => setSearchOpen(true)}
            >
              <NavIcon name="search" />
            </button>
            <button
              type="button"
              className="icon-btn rail-item"
              aria-label="Capturer dans l’Inbox"
              data-label="Capturer dans l’Inbox"
              onClick={() => setCaptureOpen(true)}
            >
              <NavIcon name="plus" />
            </button>
            {NAV.map((s) => (
              <div key={s.section} className="flex flex-col items-center gap-1 w-full">
                <span
                  aria-hidden
                  style={{ height: 1, width: 24, background: 'var(--border)', margin: '4px 0' }}
                />
                {s.items.map((i) => {
                  const active = isActive(i, location.pathname, vueOf(location.search));
                  return (
                    <Link
                      key={i.label}
                      to={i.to}
                      search={i.search as never}
                      aria-label={i.label}
                      data-label={i.label}
                      className="icon-btn rail-item hover:no-underline"
                      style={
                        active
                          ? { background: 'var(--bin)', color: 'var(--text)' }
                          : { color: 'var(--text-2)' }
                      }
                    >
                      <NavIcon name={i.icon ?? i.to} />
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        ) : (
          <Sidebar
            onSearch={() => setSearchOpen(true)}
            onCapture={() => setCaptureOpen(true)}
            onFold={() => fold(true)}
          />
        ))}
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
      {phone && (
        <button
          type="button"
          className="fixed z-30 grid place-items-center rounded-full border-0 shadow-lg"
          aria-label="Capturer dans l’Inbox"
          onClick={() => setCaptureOpen(true)}
          style={{
            right: 16,
            bottom: 'calc(env(safe-area-inset-bottom) + 84px)',
            width: 56,
            height: 56,
            background: 'var(--inverse-bg)',
            color: 'var(--inverse-text)',
          }}
        >
          <PlusIcon />
        </button>
      )}
      <CaptureSheet open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Toasts />
    </div>
  );
}

function Sidebar({
  onSearch,
  onCapture,
  onFold,
}: {
  onSearch: () => void;
  onCapture: () => void;
  onFold: () => void;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const vue = useRouterState({ select: (s) => vueOf(s.location.search) });
  const me = useMe();
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
      <div className="flex items-center gap-2">
        <Link to="/semaine" className="flex items-center gap-2 px-2 hover:no-underline flex-1">
          <img src="/icon.svg" alt="" width={26} height={26} />
          <span className="text-[19px] font-bold tracking-tight">Mémento</span>
        </Link>
        <button
          type="button"
          className="icon-btn"
          aria-label="Réduire le menu"
          title="Réduire le menu"
          onClick={onFold}
        >
          «
        </button>
      </div>
      <button
        type="button"
        className="btn btn-sm justify-between"
        onClick={onSearch}
        style={{ color: 'var(--text-faint)' }}
      >
        <span>Rechercher</span>
        <span className="mono text-[11px]">⌘K</span>
      </button>
      <button type="button" className="btn btn-sm justify-start gap-1.5" onClick={onCapture}>
        <span aria-hidden>+</span> Capturer dans l’Inbox
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
            const active = isActive(i, path, vue);
            return (
              <Fragment key={i.label}>
                <Link
                  to={i.to}
                  search={i.search as never}
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
                {i.to === '/projets' && <SidebarProjects />}
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
        <AppVersion />
      </div>
    </nav>
  );
}

/**
 * D-102: under « Projets », the shortcuts that matter: the projects of this month and of next month, then
 * « Tous ». The list folds (remembered on this device).
 */
function SidebarProjects() {
  const me = useMe();
  const dl = useDomainLookup();
  const month = me.data?.today.slice(0, 7);
  const next = month ? nextMonthOf(month) : undefined;
  const [open, setOpenState] = useState(() => {
    try {
      return localStorage.getItem('memento.sidebar.projects') !== '0';
    } catch {
      return true;
    }
  });
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try {
      localStorage.setItem('memento.sidebar.projects', v ? '1' : '0');
    } catch {
      // private mode: not remembered
    }
  };
  const query = (m?: string) => ({
    queryKey: ['projects', 'sidebar', m],
    queryFn: () => get<Project[]>(`/projects?month=${m}&status=active,paused,ready`),
    enabled: !!m && open,
  });
  const now = useQuery(query(month));
  const later = useQuery(query(next));
  const list = (title: string, rows: Project[] | undefined) =>
    rows && rows.length > 0 ? (
      <>
        <span className="px-2 pt-1 text-[11px]" style={{ color: 'var(--text-ghost)' }}>
          {title}
        </span>
        {rows.map((p) => (
          <Link
            key={p.id}
            to="/projets/$id"
            params={{ id: p.id }}
            className="flex items-center gap-2 px-2 rounded-md text-[13px]"
            style={{ minHeight: 28, color: 'var(--text-muted)' }}
          >
            <DomainDot color={dl.color(p.domainIds[0])} size={6} />
            <span className="truncate">{p.title}</span>
          </Link>
        ))}
      </>
    ) : null;
  return (
    <div className="flex flex-col pl-3 py-1">
      <button
        type="button"
        className="flex items-center gap-1.5 text-left text-[12px] px-2 border-0 bg-transparent cursor-pointer"
        style={{ color: 'var(--text-ghost)', minHeight: 24 }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={open ? 'Masquer les projets du mois' : 'Afficher les projets du mois'}
      >
        <svg
          aria-hidden="true"
          width={10}
          height={10}
          viewBox="0 0 14 14"
          style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: 'transform 0.15s' }}
        >
          <path d="M5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        {open ? 'Projets du mois' : 'Afficher les projets du mois'}
      </button>
      {open && (
        <>
          {list('Ce mois', now.data)}
          {list('Mois prochain', later.data)}
          {now.data?.length === 0 && later.data?.length === 0 && (
            <span className="px-2 text-[12px]" style={{ color: 'var(--text-ghost)' }}>
              Aucun projet du mois.
            </span>
          )}
          <Link
            to="/projets"
            className="px-2 text-[12px]"
            style={{ color: 'var(--text-ghost)', minHeight: 26, display: 'flex', alignItems: 'center' }}
          >
            Tous
          </Link>
        </>
      )}
    </div>
  );
}

const nextMonthOf = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/** Version of the running server (root package.json), shown under the account. */
function AppVersion() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => get<{ version: string }>('/health'),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (!health.data) return null;
  return (
    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
      Mémento v{health.data.version}
    </span>
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

// Each kind of result has its own colour and badge, so that the blocks are told apart at a glance.
const SEARCH_GROUPS: { key: keyof SearchResult; label: string; badge: string; color: string }[] = [
  { key: 'objective', label: 'Objectifs', badge: 'Objectif', color: '#6B4FD8' },
  { key: 'project', label: 'Projets', badge: 'Projet', color: '#2F6FDB' },
  { key: 'idea', label: 'Idées', badge: 'Idée', color: '#C98A12' },
  { key: 'task', label: 'Tâches', badge: 'Tâche', color: '#2F8F62' },
  { key: 'inbox', label: 'Inbox', badge: 'Inbox', color: '#7A7A75' },
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
          className="text-[17px]"
          style={{
            // Inline on purpose: the global input style (border, radius) would win over utility classes.
            padding: '16px 20px',
            minHeight: 56,
            borderWidth: '0 0 1px 0',
            borderStyle: 'solid',
            borderColor: 'var(--border)',
            borderRadius: 0,
            background: 'transparent',
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
              <div key={g.key} className="py-2" style={{ borderTop: '1px solid var(--divider)' }}>
                <div
                  className="label-caps px-5 py-1 flex items-center gap-2"
                  style={{ fontSize: 11, color: g.color }}
                >
                  <span className="dot" style={{ background: g.color }} />
                  {g.label} · {rows.length}
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
                      className="w-full flex items-center gap-3 text-left border-0 px-5 text-[15px] cursor-pointer"
                      style={{
                        minHeight: 40,
                        background: cursor === idx ? 'var(--bin)' : 'transparent',
                        boxShadow: cursor === idx ? `inset 3px 0 0 ${g.color}` : undefined,
                      }}
                    >
                      <span
                        className="text-[11px] font-semibold rounded-full flex-none"
                        style={{
                          color: g.color,
                          border: `1px solid ${g.color}`,
                          padding: '1px 8px',
                          minWidth: 64,
                          textAlign: 'center',
                        }}
                      >
                        {g.badge}
                      </span>
                      <span className="min-w-0 truncate">{r.title}</span>
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
  const phone = useIsPhone();
  return (
    <div
      className="fixed z-[60] flex flex-col gap-2"
      style={{ right: 16, bottom: `calc(env(safe-area-inset-bottom) + ${phone ? 152 : 88}px)` }}
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

/** Icons of the folded rail (user request 31/10/2026): one per page, the name shows on hover. */
const ICON_PATHS: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  '/semaine': (
    <>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
    </>
  ),
  '/planifier': (
    <>
      <path d="M2 4h7M2 8h5M2 12h8" />
      <path d="m11 3 1.5 1.5L15 2" />
    </>
  ),
  '/cap': (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="m10.5 5.5-1.6 3.4-3.4 1.6 1.6-3.4z" />
    </>
  ),
  '/inbox': (
    <>
      <path d="M2 9.5 4 3h8l2 6.5V13H2z" />
      <path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" />
    </>
  ),
  '/objectifs': (
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="3" />
      <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    </>
  ),
  '/projets': <path d="M1.5 4.5V13h13V5.5H7.5L6 3.5H1.5z" />,
  '/taches': (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="m5 8 2 2 4-4" />
    </>
  ),
  '/domaines': (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  '/idees': (
    <>
      <path d="M5.5 10.5C4 9.5 3.5 8 3.5 6.5a4.5 4.5 0 0 1 9 0c0 1.5-.5 3-2 4V12h-5z" />
      <path d="M6 14.5h4" />
    </>
  ),
  '/experiences': (
    <>
      <path d="M6 1.5h4M6.5 1.5v4.5L2.5 13a1 1 0 0 0 .9 1.5h9.2a1 1 0 0 0 .9-1.5L9.5 6V1.5" />
      <path d="M4.5 10h7" />
    </>
  ),
  '/rapports': <path d="M2 14h12M4 14V9M8 14V4M12 14V7" />,
  '/journal': (
    <>
      <path d="M3 2h8.5L13 3.5V14H3z" />
      <path d="M5.5 6h5M5.5 9h5M5.5 12h3" />
    </>
  ),
};

function NavIcon({ name }: { name: string }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
