// Worker: runs the scheduled jobs of @memento/domain every minute (no business logic here).
import { dirname, join } from 'node:path';
import { openDb, resolveDbFile, runMigrations } from '@memento/db';
import { seed } from '@memento/domain';
import { tick } from './tick.ts';

const { db, sqlite } = openDb();
const backupDir = join(dirname(resolveDbFile()), 'backups'); // D-135: <data folder>/backups (the bind in Docker)
runMigrations(db);
seed({ db, sqlite, actor: 'me' });

const ctx = { db, sqlite, actor: 'me' as const };
void tick(ctx, backupDir);
const timer = setInterval(() => void tick(ctx, backupDir), 60_000);
const stop = () => {
  clearInterval(timer);
  sqlite.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log(JSON.stringify({ level: 30, time: Date.now(), msg: 'worker started (Europe/Paris)' }));
