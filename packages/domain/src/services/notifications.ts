// D-117: the notices sent (evening recap, report ready) are kept so they can be read in full in the app: the
// bell lists them, the push opens one. Kept 90 days.
import { and, desc, eq, isNull, lt, schema } from '@memento/db';
import { type Ctx, ctxNow, ctxNowIso, newId } from '../context.ts';
import { NotFoundError } from '../errors.ts';
import { addDays, parisDate } from '../time.ts';

const { notification } = schema;
const KEEP_DAYS = 90;

/** Records a notice before it is sent; returns its id (the push opens /notifications/{id}). */
export function recordNotification(
  ctx: Ctx,
  n: { kind: 'daily' | 'report' | 'job'; title: string; html: string; url?: string | null },
): string {
  const id = newId();
  ctx.db
    .insert(notification)
    .values({ id, kind: n.kind, title: n.title, html: n.html, url: n.url ?? null, createdAt: ctxNowIso(ctx) })
    .run();
  const limit = new Date(`${addDays(parisDate(ctxNow(ctx)), -KEEP_DAYS)}T00:00:00Z`).toISOString();
  ctx.db.delete(notification).where(lt(notification.createdAt, limit)).run();
  return id;
}

/** GET /notifications: newest first, and how many are unread (the bell's badge). */
export function listNotifications(ctx: Ctx, limit = 50) {
  const items = ctx.db.select().from(notification).orderBy(desc(notification.createdAt)).limit(limit).all();
  const unread = ctx.db
    .select({ id: notification.id })
    .from(notification)
    .where(isNull(notification.readAt))
    .all().length;
  return { unread, items };
}

/** GET /notifications/{id}: the whole notice; reading it marks it read. */
export function readNotification(ctx: Ctx, id: string) {
  const row = ctx.db.select().from(notification).where(eq(notification.id, id)).get();
  if (!row) throw new NotFoundError('notification', id);
  if (row.readAt) return row;
  const readAt = ctxNowIso(ctx);
  ctx.db.update(notification).set({ readAt }).where(eq(notification.id, id)).run();
  return { ...row, readAt };
}

/** POST /notifications/read-all. */
export function readAllNotifications(ctx: Ctx) {
  ctx.db
    .update(notification)
    .set({ readAt: ctxNowIso(ctx) })
    .where(and(isNull(notification.readAt)))
    .run();
  return listNotifications(ctx);
}
