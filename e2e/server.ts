// H-16: the server the end-to-end tests talk to (started by Playwright `webServer`, see playwright.config.ts).
// A fresh SQLite database in the system temp folder (never data/), the built web app, a fake AI, port 4530.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildApp } from '../apps/api/src/app.ts';
import { setUserPassword } from '../apps/api/src/auth.ts';
import { openDb, runMigrations } from '../packages/db/src/index.ts';
import { runDataMigrations, seed } from '../packages/domain/src/index.ts';
import { E2E_LOGIN, E2E_PASSWORD, E2E_PORT } from './constants.ts';

// A fixed folder, emptied at each start: a server stopped abruptly leaves nothing that piles up.
const root = join(tmpdir(), 'memento-e2e');
rmSync(root, { recursive: true, force: true });
const backupDir = join(root, 'backups');
mkdirSync(backupDir, { recursive: true });
const { db, sqlite } = openDb(join(root, 'e2e.db'));
runMigrations(db);
seed({ db, sqlite, actor: 'me' });
runDataMigrations({ db, sqlite, actor: 'me' });
await setUserPassword(db, E2E_LOGIN, E2E_PASSWORD);

const app = await buildApp({
  db,
  sqlite,
  cookieSecure: false,
  logger: false,
  webDist: resolve(import.meta.dirname, '../apps/web/dist'),
  backupDir,
  // The login is limited to 5 a minute per address: the tests send a different X-Forwarded-For each (helpers.ts).
  trustProxy: '127.0.0.1',
  llm: async () => ({ text: '{}', model: 'fake' }),
});
await app.listen({ port: E2E_PORT, host: '127.0.0.1' });
console.log(`Mémento e2e server on http://127.0.0.1:${E2E_PORT} (database ${root})`);

const stop = async () => {
  await app.close();
  sqlite.close();
  rmSync(root, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
