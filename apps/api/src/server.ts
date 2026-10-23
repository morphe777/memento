import { accessSync, constants, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb, resolveDbFile, runMigrations } from '@memento/db';
import { seed } from '@memento/domain';
import { buildApp } from './app.ts';

// A data folder the process cannot write (typically a Docker bind created by root) is the usual cause of a
// crash at startup: say so plainly instead of a bare SQLite error.
const dataDir = dirname(resolveDbFile());
try {
  if (existsSync(dataDir)) accessSync(dataDir, constants.W_OK);
} catch {
  if (process.getuid) {
    console.error(
      `Mémento: the data folder ${dataDir} is not writable by uid ${process.getuid()}. ` +
        `On the host: sudo chown -R ${process.getuid()}:${process.getgid?.()} <bind folder>`,
    );
  }
}
const { db, sqlite } = openDb();
runMigrations(db); // migrations applied at startup (dossier §12)
seed({ db, sqlite, actor: 'me' }); // idempotent
const app = await buildApp({
  db,
  sqlite,
  cookieSecure: process.env.MEMENTO_COOKIE_SECURE === 'true',
  logger: true,
  backupDir: dirname(resolveDbFile()),
});
const port = Number(process.env.MEMENTO_API_PORT ?? 4500);
const host = process.env.MEMENTO_HOST ?? '127.0.0.1';
await app.listen({ port, host });

const stop = async () => {
  await app.close();
  sqlite.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
