// H-19: the backup is a consistent copy, WAL pages included, while the database is open and written to.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupDb, describeDb, openDb, runMigrations } from '../src/client.ts';

describe('H-19 backup', () => {
  it('copies a live WAL database whole, checks it, and never overwrites a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-backup-'));
    const file = join(dir, 'live.db');
    const { db, sqlite } = openDb(file);
    runMigrations(db);
    sqlite.pragma('wal_autocheckpoint = 0'); // recent writes stay in the -wal file only
    sqlite.exec(
      "insert into domain (id, name, color_light, color_dark, priority_rank, weight, created_at, updated_at) values ('d1', 'Test', '#000', '#fff', 1, 1, '2026-11-07', '2026-11-07')",
    );
    const r = await backupDb(file, join(dir, 'copy.db'));
    expect(r.copy.ok).toBe(true);
    expect(r.copy).toEqual(r.source);
    expect(r.copy.domains).toBe(1);
    expect(r.copy.migrations).toBeGreaterThan(0);
    await expect(backupDb(file, join(dir, 'copy.db'))).rejects.toThrow(/existe déjà/);
    sqlite.close();
    expect(describeDb(openDb(join(dir, 'copy.db')).sqlite).domains).toBe(1);
  });
});
