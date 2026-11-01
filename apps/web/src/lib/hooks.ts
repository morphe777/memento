import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { ApiError, get, patch } from './api.ts';
import type { Domain, Group, Me, Settings } from './types.ts';

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = await get<Me & { authenticated: boolean }>('/auth/me');
      return me.authenticated ? me : null;
    },
    retry: false,
  });
export const useDomains = () =>
  useQuery({ queryKey: ['domains'], queryFn: () => get<Domain[]>('/domains'), staleTime: 60_000 });
export const useGroups = () => useQuery({ queryKey: ['groups'], queryFn: () => get<Group[]>('/groups') });
export const useSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings'), staleTime: 60_000 });

/** Every mutation refreshes all cached views (single user, small data: simplest correct choice). */
export function useAction<TArgs, TRes>(
  fn: (args: TArgs) => Promise<TRes>,
  opts: { onSuccess?: (r: TRes) => void; toast?: string } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      qc.invalidateQueries();
      if (opts.toast) toast(opts.toast);
      opts.onSuccess?.(r);
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Erreur', 'error'),
  });
}

// ---------- Theme (NF-06): auto follows the system, light/dark force ----------
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const subscribeMedia = (cb: () => void) => {
  media?.addEventListener('change', cb);
  return () => media?.removeEventListener('change', cb);
};
export function useResolvedTheme(): 'light' | 'dark' {
  const settings = useSettings();
  const systemDark = useSyncExternalStore(subscribeMedia, () => !!media?.matches);
  const pref = settings.data?.theme ?? 'auto';
  return pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref;
}
export function useSetTheme() {
  return useAction((theme: Settings['theme']) => patch('/settings', { theme }));
}

// ---------- Domain colours (G-08) ----------
export const INBOX = { name: 'Inbox', colorLight: '#7A7A75', colorDark: '#9A9A94' };
export function useDomainLookup() {
  const domains = useDomains();
  const theme = useResolvedTheme();
  const byId = new Map((domains.data ?? []).map((d) => [d.id, d]));
  const colorOf = (d: { colorLight: string; colorDark: string } | undefined | null) =>
    d
      ? theme === 'dark'
        ? d.colorDark
        : d.colorLight
      : theme === 'dark'
        ? INBOX.colorDark
        : INBOX.colorLight;
  return {
    domains: domains.data ?? [],
    get: (id: string | null | undefined) => (id ? byId.get(id) : undefined),
    name: (id: string | null | undefined) => (id ? (byId.get(id)?.name ?? '—') : 'Inbox'),
    color: (id: string | null | undefined) => colorOf(id ? byId.get(id) : null),
    colorOf,
  };
}

// ---------- Toasts ----------
type ToastMsg = { id: number; text: string; kind: 'info' | 'error' };
let toasts: ToastMsg[] = [];
const listeners = new Set<() => void>();
export function toast(text: string, kind: ToastMsg['kind'] = 'info') {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, kind }];
  for (const l of listeners) l();
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id);
      for (const l of listeners) l();
    },
    kind === 'error' ? 6000 : 3000,
  );
}
export const useToasts = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );

/** Narrow viewport (iPhone). */
const phoneMq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)') : null;
export const useIsPhone = () =>
  useSyncExternalStore(
    (cb) => {
      phoneMq?.addEventListener('change', cb);
      return () => phoneMq?.removeEventListener('change', cb);
    },
    () => !!phoneMq?.matches,
  );

const touchMq = typeof window !== 'undefined' ? window.matchMedia('(pointer: coarse)') : null;
/** Touch screen (iPhone, iPad): pages sit closer to the top. */
export const useIsTouch = () =>
  useSyncExternalStore(
    (cb) => {
      touchMq?.addEventListener('change', cb);
      return () => touchMq?.removeEventListener('change', cb);
    },
    () => !!touchMq?.matches,
  );

/**
 * After a delete from a panel (user request 01/11/2026): leave only when the current page is the deleted
 * entity's own page; opened from elsewhere (Planifier, Vue Plan…), the panel closes and you stay there.
 */
export function useLeaveDeleted() {
  const navigate = useNavigate();
  return (ownPage: string, to: string) => {
    if (window.location.pathname === ownPage) navigate({ to });
  };
}
