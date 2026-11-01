// Web Push (user request 01/11/2026): this device receives the evening recap and « report ready » as native
// notifications. On iPhone / iPad, only from Mémento opened from the home screen (iOS 16.4+).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, get, post } from '../lib/api.ts';
import { fmtDate } from '../lib/format.ts';
import { toast } from '../lib/hooks.ts';

interface Devices {
  devices: { endpoint: string; label: string; createdAt: string }[];
}

const supported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;
const ios = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

function deviceLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/.test(ua))) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Navigateur';
}

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function PushConfig() {
  const qc = useQueryClient();
  const devices = useQuery({
    queryKey: ['push-devices'],
    queryFn: () => get<Devices>('/notify/push/devices'),
  });
  const mine = useQuery({
    queryKey: ['push-mine'],
    queryFn: async () => (supported() ? ((await currentSubscription())?.endpoint ?? null) : null),
  });
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : (e as Error).message || 'Erreur', 'error');
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ['push-devices'] });
      await qc.invalidateQueries({ queryKey: ['push-mine'] });
      await qc.invalidateQueries({ queryKey: ['notify-status'] });
    }
  };
  const enable = () =>
    run(async () => {
      // Asked first, inside the tap: iOS only shows the prompt from a user gesture.
      const perm = await Notification.requestPermission();
      if (perm !== 'granted')
        throw new Error('Notifications refusées : autorise-les dans Réglages › Notifications › Mémento.');
      const { publicKey } = await get<{ publicKey: string }>('/notify/push/key');
      const reg =
        (await navigator.serviceWorker.getRegistration()) ??
        (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        }));
      await post('/notify/push/subscribe', { ...sub.toJSON(), label: deviceLabel() });
      toast('Notifications activées sur cet appareil.');
    });
  const disable = (endpoint: string) =>
    run(async () => {
      if (endpoint === mine.data) await (await currentSubscription())?.unsubscribe();
      await post('/notify/push/unsubscribe', { endpoint });
      toast('Appareil retiré.');
    });
  const test = () =>
    run(async () => {
      const r = await post<{ sent: number; failed: number; removed: number }>('/notify/push/test');
      toast(
        r.sent
          ? `Notification envoyée à ${r.sent} appareil${r.sent > 1 ? 's' : ''}.`
          : 'Aucun appareil n’a reçu la notification.',
        r.sent ? undefined : 'error',
      );
    });

  const list = devices.data?.devices ?? [];
  const here = !!mine.data && list.some((d) => d.endpoint === mine.data);
  const blocker = !supported()
    ? ios() && !standalone()
      ? 'Sur iPhone et iPad : ouvre Mémento depuis l’écran d’accueil (Safari › Partager › Sur l’écran d’accueil), puis reviens ici.'
      : 'Ce navigateur ne gère pas les notifications push.'
    : null;
  return (
    <div className="flex flex-col gap-3 pt-2" style={{ borderTop: '1px solid var(--divider)' }}>
      <h3 className="h2 m-0">Notifications sur cet appareil</h3>
      <p className="m-0 text-[13px]" style={{ color: 'var(--text-muted)' }}>
        Le bilan du soir et « rapport prêt » arrivent aussi en notification, comme une app : un toucher ouvre
        la page. Mêmes réglages que Telegram ci-dessous (heure, vacances, case « Prévenir quand un rapport est
        prêt ») ; Telegram n’est pas nécessaire.
      </p>
      {blocker ? (
        <div className="text-[13px]" style={{ color: 'var(--late-text)' }}>
          {blocker}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {here ? (
            <span className="text-[13px]" style={{ color: 'var(--ok)' }}>
              ✓ Activées sur cet appareil
            </span>
          ) : (
            <button type="button" className="btn btn-primary" onClick={enable} disabled={busy}>
              Activer sur cet appareil
            </button>
          )}
          {list.length > 0 && (
            <button type="button" className="btn" onClick={test} disabled={busy}>
              Envoyer un test
            </button>
          )}
        </div>
      )}
      {list.length > 0 && (
        <div className="card overflow-hidden">
          {list.map((d) => (
            <div
              key={d.endpoint}
              className="row-line flex items-center gap-3 text-[14px]"
              style={{ padding: '8px 14px' }}
            >
              <span className="flex-1 min-w-0 truncate">
                {d.label}
                {d.endpoint === mine.data ? ' (cet appareil)' : ''}
              </span>
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                depuis le {fmtDate(d.createdAt.slice(0, 10))}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => disable(d.endpoint)}
                disabled={busy}
              >
                Retirer
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
