// H-04: a transaction takes the write lock at its start (IMMEDIATE), so another process cannot slip a commit
// between its read and its write (SQLITE_BUSY_SNAPSHOT with a deferred transaction).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq, openDb, runMigrations, schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { type Ctx, tx } from '../src/context.ts';
import { seed } from '../src/seed.ts';

describe('H-04 transactions are immediate', () => {
  it('a read then a write inside tx() survive a write attempted meanwhile by another process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-tx-'));
    const file = join(dir, 'memento.db');
    const { db, sqlite } = openDb(file);
    try {
      runMigrations(db);
      const ctx: Ctx = { db, sqlite, actor: 'me' };
      seed(ctx);
      let other = -1;
      expect(() =>
        tx(ctx, () => {
          ctx.db.select().from(schema.setting).all(); // the read
          // Another process writes now (it waits at most 1 s for the lock, then gives up).
          other =
            spawnSync(
              process.execPath,
              [
                '-e',
                `const D = require(${JSON.stringify(resolve(import.meta.dirname, '../../db/node_modules/better-sqlite3'))});
                 const c = new D(${JSON.stringify(file)}); c.pragma('busy_timeout = 1000');
                 c.prepare("update setting set value = '\\"dark\\"' where key = 'theme'").run();`,
              ],
              { encoding: 'utf8' },
            ).status ?? -1;
          ctx.db.update(schema.setting).set({ value: 'light' }).where(eq(schema.setting.key, 'theme')).run();
        }),
      ).not.toThrow();
      expect(other).not.toBe(0); // it had to wait, and gave up: our transaction held the lock
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
