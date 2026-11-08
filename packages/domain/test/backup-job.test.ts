// D-135: nightly backup of the database into <data folder>/backups, 7 daily copies kept, retried until it succeeds.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, openDbReadonly, runMigrations, schema } from '@memento/db';
import { afterEach, describe, expect, it } from 'vitest';
import { seed } from '../src/seed.ts';
import { backupsToDelete, runBackupJob } from '../src/services/jobs.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A file database in WAL mode, like the real one. */
function fileCtx(at: string) {
  const root = mkdtempSync(join(tmpdir(), 'memento-backup-'));
  dirs.push(root);
  const { db, sqlite } = openDb(join(root, 'memento.db'));
  runMigrations(db);
  let now = new Date(at);
  const ctx = {
    db,
    sqlite,
    actor: 'me' as const,
    now: () => now,
    setNow: (iso: string) => (now = new Date(iso)),
  };
  seed(ctx);
  return { ctx, root, dir: join(root, 'backups') };
}
const notices = (ctx: ReturnType<typeof fileCtx>['ctx']) =>
  ctx.db
    .select()
    .from(schema.notification)
    .all()
    .filter((n) => n.kind === 'job' && n.title.includes('Sauvegarde'));

describe('D-135 nightly backup', () => {
  it('copies the database once a day from 03:00 Paris, a valid file with the same content', async () => {
    const { ctx, dir } = fileCtx('2026-11-08T01:59:00.000Z'); // 02:59 Paris
    expect(await runBackupJob(ctx, dir)).toBe('skipped');
    ctx.setNow('2026-11-08T02:00:00.000Z'); // 03:00 Paris
    expect(await runBackupJob(ctx, dir)).toBe('done');
    expect(readdirSync(dir)).toEqual(['memento-2026-11-08.db']); // no partial, -wal or -shm file left
    const copy = openDbReadonly(join(dir, 'memento-2026-11-08.db'));
    const n = (s: { prepare: (q: string) => { get: () => unknown } }) =>
      (s.prepare('select count(*) as n from domain').get() as { n: number }).n;
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(n(copy)).toBe(n(ctx.sqlite));
    copy.close();
    ctx.setNow('2026-11-08T15:00:00.000Z');
    expect(await runBackupJob(ctx, dir)).toBe('skipped'); // once a day
    ctx.setNow('2026-11-09T09:00:00.000Z'); // the worker was down at 03:00: caught up later in the day
    expect(await runBackupJob(ctx, dir)).toBe('done');
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('keeps the 7 most recent copies and never touches other files', async () => {
    const { ctx, dir } = fileCtx('2026-11-08T03:00:00.000Z');
    await runBackupJob(ctx, dir);
    for (let d = 1; d <= 8; d++) writeFileSync(join(dir, `memento-2026-10-0${d}.db`), '');
    writeFileSync(join(dir, 'mine.db'), '');
    ctx.setNow('2026-11-09T03:00:00.000Z');
    expect(await runBackupJob(ctx, dir)).toBe('done');
    expect(readdirSync(dir).sort()).toEqual([
      'memento-2026-10-04.db',
      'memento-2026-10-05.db',
      'memento-2026-10-06.db',
      'memento-2026-10-07.db',
      'memento-2026-10-08.db',
      'memento-2026-11-08.db',
      'memento-2026-11-09.db',
      'mine.db',
    ]);
    expect(backupsToDelete(['a.db', 'memento-2026-01-01.db'], 0)).toEqual(['memento-2026-01-01.db']);
  });

  it('a failure is retried at every tick and announced once', async () => {
    const { ctx, root } = fileCtx('2026-11-08T03:00:00.000Z');
    const blocked = join(root, 'not-a-folder');
    writeFileSync(blocked, '');
    expect(await runBackupJob(ctx, blocked)).toBe('failed');
    ctx.setNow('2026-11-08T03:01:00.000Z');
    expect(await runBackupJob(ctx, blocked)).toBe('failed');
    expect(notices(ctx)).toHaveLength(1);
    expect(await runBackupJob(ctx, join(root, 'backups'))).toBe('done');
    expect(await runBackupJob(ctx, join(root, 'backups'))).toBe('skipped');
  });
});
