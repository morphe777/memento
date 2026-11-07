// C-05, C-06: `pnpm db:check` finds the bad values already stored, and never writes to the database.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, openDbReadonly, runMigrations } from '@memento/db';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../src/context.ts';
import { seed } from '../src/seed.ts';
import { findInvalidData } from '../src/services/integrity.ts';
import { createTask } from '../src/services/tasks.ts';

const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

describe('C-05, C-06 read-only data check', () => {
  it('lists impossible dates and unreadable rules, without writing anything', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'memento-check-')), 'm.db');
    const { db, sqlite } = openDb(file);
    runMigrations(db);
    seed({ db, sqlite, actor: 'me' });
    const ctx: Ctx = { db, sqlite, actor: 'me' };
    const good = createTask(ctx, { title: 'ok', dueDate: '2026-11-10', recurrenceRule: 'FREQ=WEEKLY' });
    const bad = createTask(ctx, { title: 'ko', dueDate: '2026-11-10', recurrenceRule: 'FREQ=WEEKLY' });
    sqlite
      .prepare(
        "update task set due_date = '2026-02-30', recurrence_rule = 'FREQ=DAILY;INTERVAL=0' where id = ?",
      )
      .run(bad.id);
    sqlite
      .prepare("update setting set value = ? where key = 'notify.vacations'")
      .run(JSON.stringify([{ from: '2026-12-20', to: '2026-13-45' }]));
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.close();
    const before = sha(file);

    const ro = openDbReadonly(file);
    expect(() => ro.prepare('delete from task').run()).toThrow(/readonly/);
    const found = findInvalidData(ro);
    ro.close();
    expect(found).toEqual([
      { table: 'task', id: bad.id, column: 'due_date', value: '2026-02-30' },
      { table: 'task', id: bad.id, column: 'recurrence_rule', value: 'FREQ=DAILY;INTERVAL=0' },
      { table: 'setting', id: 'notify.vacations[0]', column: 'to', value: '2026-13-45' },
    ]);
    expect(found.some((f) => f.id === good.id)).toBe(false);

    const cli = spawnSync(
      process.execPath,
      ['--import', 'tsx', new URL('../src/cli/check-data.ts', import.meta.url).pathname, file],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(cli.status).toBe(1);
    expect(cli.stdout).toContain('3 valeur(s)');
    expect(sha(file)).toBe(before);
  });
});
