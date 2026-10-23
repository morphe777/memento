import { openDb, runMigrations } from '@memento/db';
import { seed } from '@memento/domain';
import { buildApp } from './app.ts';

const { db, sqlite } = openDb();
runMigrations(db); // migrations applied at startup (dossier §12)
seed({ db, sqlite, actor: 'me' }); // idempotent
const app = await buildApp({
  db,
  sqlite,
  cookieSecure: process.env.MEMENTO_COOKIE_SECURE === 'true',
  logger: true,
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
