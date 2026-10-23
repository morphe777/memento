import { openDb, runMigrations } from '@memento/db';
import type { Actor, Ctx } from '../src/context.ts';
import { seed } from '../src/seed.ts';
import { listDomains, listGroups } from '../src/services/referential.ts';

/** Fresh migrated + seeded in-memory database with a fixed clock (Friday 23 Oct 2026, 10:00 Paris). */
export function makeCtx(at = '2026-10-23T08:00:00.000Z', actor: Actor = 'me') {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  let now = new Date(at);
  const ctx: Ctx & { setNow: (iso: string) => void; as: (a: Actor) => Ctx } = {
    db,
    sqlite,
    actor,
    now: () => now,
    setNow: (iso: string) => {
      now = new Date(iso);
    },
    as: (a: Actor) => ({ ...ctx, actor: a }),
  };
  seed(ctx);
  return ctx;
}

export function lookups(ctx: Ctx) {
  const domains = listDomains(ctx);
  const groups = listGroups(ctx);
  return {
    domain: (name: string) => domains.find((d) => d.name === name)!,
    group: (name: string) => groups.find((g) => g.name === name)!,
  };
}
