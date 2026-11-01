// Web Push (user request 01/11/2026): native notifications on the iPhone (PWA on the home screen, iOS 16.4+)
// and on any browser that subscribed. Same events as Telegram: evening recap and « report ready ».
// The VAPID key pair is generated on first use and kept in a `secret.` row (never exported, never read back);
// subscriptions are `secret.` too (their keys let anyone push to the device).
import { eq, schema } from '@memento/db';
import webpush from 'web-push';
import { z } from 'zod';
import { SECRET_SETTING_PREFIX } from '../ai/providers.ts';
import { audit, type Ctx, ctxNow, tx } from '../context.ts';
import { NotFoundError } from '../errors.ts';

const VAPID_ROW = `${SECRET_SETTING_PREFIX}push.vapid`;
const SUBS_ROW = `${SECRET_SETTING_PREFIX}push.subscriptions`;
// Contact sent to the push services in the VAPID token (Apple refuses `localhost` addresses).
const VAPID_SUBJECT = 'https://github.com/morphe777/memento';

export const pushSubscriptionBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  label: z.string().trim().max(80).optional(),
});
export const pushUnsubscribeBody = z.object({ endpoint: z.string().max(1000) });

type PushSub = z.infer<typeof pushSubscriptionBody> & { label: string; createdAt: string };
export interface PushMessage {
  title: string;
  body: string;
  /** Page opened by a tap on the notification (path of the app, e.g. /rapports/abc). */
  url: string;
}
/** Sends one notification; replaced in tests. Rejects with `statusCode` like web-push. */
export type PushSender = (
  sub: PushSub,
  payload: string,
  keys: { publicKey: string; privateKey: string },
) => Promise<unknown>;

const readRow = (ctx: Pick<Ctx, 'db'>, key: string) =>
  ctx.db.select().from(schema.setting).where(eq(schema.setting.key, key)).get()?.value;
function writeRow(ctx: Pick<Ctx, 'db'>, key: string, value: unknown) {
  ctx.db
    .insert(schema.setting)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value, updatedAt: new Date().toISOString() } })
    .run();
}

function vapidKeys(ctx: Ctx): { publicKey: string; privateKey: string } {
  const row = readRow(ctx, VAPID_ROW) as { publicKey?: string; privateKey?: string } | undefined;
  if (row?.publicKey && row.privateKey) return { publicKey: row.publicKey, privateKey: row.privateKey };
  const keys = webpush.generateVAPIDKeys();
  writeRow(ctx, VAPID_ROW, keys);
  return keys;
}

const subscriptions = (ctx: Pick<Ctx, 'db'>): PushSub[] => {
  const v = readRow(ctx, SUBS_ROW);
  return Array.isArray(v) ? (v as PushSub[]) : [];
};

/** The public key the browser needs to subscribe (generated on first call). */
export const pushPublicKey = (ctx: Ctx) => ({ publicKey: vapidKeys(ctx).publicKey });

/** Subscribed devices, without their keys. */
export function listPushDevices(ctx: Pick<Ctx, 'db'>) {
  return {
    devices: subscriptions(ctx).map((s) => ({
      endpoint: s.endpoint,
      label: s.label,
      createdAt: s.createdAt,
    })),
  };
}

export const hasPushDevices = (ctx: Pick<Ctx, 'db'>) => subscriptions(ctx).length > 0;

/** Adds (or renews) this device's subscription. */
export function addPushSubscription(ctx: Ctx, input: z.infer<typeof pushSubscriptionBody>) {
  const sub = pushSubscriptionBody.parse(input);
  tx(ctx, () => {
    const others = subscriptions(ctx).filter((s) => s.endpoint !== sub.endpoint);
    const label = sub.label || 'Appareil';
    writeRow(ctx, SUBS_ROW, [...others, { ...sub, label, createdAt: ctxNow(ctx).toISOString() }]);
    audit(ctx, 'setting', 'settings', 'update', null, { 'push.device': `ajouté : ${label}` });
  });
  return listPushDevices(ctx);
}

/** Forgets a device (« Désactiver » on it, or from another device). */
export function removePushSubscription(ctx: Ctx, endpoint: string) {
  const subs = subscriptions(ctx);
  const gone = subs.find((s) => s.endpoint === endpoint);
  if (!gone) throw new NotFoundError('push_subscription', endpoint.slice(-12));
  tx(ctx, () => {
    writeRow(
      ctx,
      SUBS_ROW,
      subs.filter((s) => s.endpoint !== endpoint),
    );
    audit(ctx, 'setting', 'settings', 'update', null, { 'push.device': `retiré : ${gone.label}` });
  });
  return listPushDevices(ctx);
}

const webpushSender: PushSender = (sub, payload, keys) =>
  webpush.sendNotification(sub, payload, {
    vapidDetails: { subject: VAPID_SUBJECT, ...keys },
    TTL: 24 * 3600,
    urgency: 'normal',
  });

/**
 * Sends a notification to every subscribed device. A device the push service says is gone (404 / 410) is
 * forgotten; other failures are counted, never retried.
 */
export async function sendPush(ctx: Ctx, msg: PushMessage, send: PushSender = webpushSender) {
  const subs = subscriptions(ctx);
  if (!subs.length) return { sent: 0, failed: 0, removed: 0 };
  const keys = vapidKeys(ctx);
  const payload = JSON.stringify({ ...msg, body: msg.body.slice(0, 600) });
  const results = await Promise.allSettled(subs.map((s) => send(s, payload, keys)));
  const gone = new Set<string>();
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') return;
    const code = (r.reason as { statusCode?: number })?.statusCode;
    if (code === 404 || code === 410) gone.add(subs[i].endpoint);
    else failed++;
  });
  if (gone.size)
    writeRow(
      ctx,
      SUBS_ROW,
      subscriptions(ctx).filter((s) => !gone.has(s.endpoint)),
    );
  return { sent: subs.length - gone.size - failed, failed, removed: gone.size };
}
