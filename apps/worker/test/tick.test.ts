// Audit v1.0 Lot 2, H-14 (rest): the worker tick runs the due jobs, logs what ran, and a failure is logged
// without stopping the worker.
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@memento/db';
import { seed } from '@memento/domain';
import { describe, expect, it } from 'vitest';
import { tick } from '../src/tick.ts';

function ctxAt(iso: string) {
  const { db, sqlite } = openDb(':memory:');
  runMigrations(db);
  seed({ db, sqlite, actor: 'me' });
  return { db, sqlite, actor: 'me' as const, now: () => new Date(iso) };
}

describe('H-14 worker tick', () => {
  it('runs the due jobs (here the nightly backup and the month roll) and logs them, once', async () => {
    const ctx = ctxAt('2026-11-10T04:00:00+01:00');
    const dir = mkdtempSync(join(tmpdir(), 'memento-tick-'));
    const lines: Record<string, unknown>[] = [];
    const first = await tick(ctx, dir, {}, (l) => lines.push(l));
    expect(first?.backup).toBe('done');
    expect(readdirSync(dir)).toEqual(['memento-2026-11-10.db']);
    expect(lines.at(-1)).toMatchObject({ level: 30, msg: 'jobs' });
    const again = await tick(ctx, dir, {}, (l) => lines.push(l));
    expect(again?.backup).toBe('skipped');
  });

  it('a failing tick is logged and returns nothing, it does not throw', async () => {
    const ctx = ctxAt('2026-11-10T04:00:00+01:00');
    ctx.sqlite.close();
    const lines: Record<string, unknown>[] = [];
    await expect(tick(ctx, '/nonexistent', {}, (l) => lines.push(l))).resolves.toBeNull();
    expect(lines).toEqual([expect.objectContaining({ level: 50, msg: 'tick failed' })]);
  });
});
