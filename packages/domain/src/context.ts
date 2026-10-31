import { randomUUID } from 'node:crypto';
import { type Db, type SqliteDatabase, schema } from '@memento/db';

import { nowIso } from './time.ts';

/** 'me' for a web user, 'ai:<token name>' for an API token (F-23), 'system:<job>' for one-off jobs (DM-109). */
export type Actor = 'me' | `ai:${string}` | `system:${string}`;

export interface Ctx {
  db: Db;
  sqlite: SqliteDatabase;
  actor: Actor;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
  /** API-08: set while applying a plan draft, stamped on every audit row of that draft. */
  batchId?: string;
}

export const newId = (): string => randomUUID();
export const ctxNow = (ctx: Pick<Ctx, 'now'>): Date => (ctx.now ? ctx.now() : new Date());
export const ctxNowIso = (ctx: Pick<Ctx, 'now'>): string => (ctx.now ? ctx.now().toISOString() : nowIso());

/** Runs fn in a single SQLite transaction (nested calls become savepoints). */
export function tx<T>(ctx: Ctx, fn: () => T): T {
  return ctx.sqlite.transaction(fn)();
}

type Plain = Record<string, unknown>;

/** RB-15: field-level diff, only changed keys, as { key: [before, after] }. */
export function computeDiff(before: Plain | null, after: Plain | null): Record<string, [unknown, unknown]> {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Record<string, [unknown, unknown]> = {};
  for (const k of keys) {
    if (k === 'updatedAt') continue;
    const a = before?.[k] ?? null;
    const b = after?.[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b];
  }
  return out;
}

/** RB-15: writes one audit_log row. Must be called inside the mutation's transaction. */
export function audit(
  ctx: Ctx,
  entityType: string,
  entityId: string,
  action: string,
  before: Plain | null,
  after: Plain | null,
): void {
  ctx.db
    .insert(schema.auditLog)
    .values({
      id: newId(),
      at: ctxNowIso(ctx),
      actor: ctx.actor,
      entityType,
      entityId,
      action,
      diff: computeDiff(before, after),
      batchId: ctx.batchId ?? null,
    })
    .run();
}
