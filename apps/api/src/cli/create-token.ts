// Usage: pnpm token:create <name> [read|read_write]   — prints the secret once; only its hash is stored.
import { openDb, runMigrations } from '@memento/db';
import { createToken } from '../auth.ts';

const [name, scope = 'read_write'] = process.argv.slice(2);
if (!name || !['read', 'read_write'].includes(scope)) {
  console.error('Usage : pnpm token:create <nom> [read|read_write]');
  process.exit(1);
}
const { db, sqlite } = openDb();
runMigrations(db);
try {
  const t = createToken(db, name, scope as 'read' | 'read_write');
  console.log(
    `Jeton « ${t.name} » (${t.scopes}) — copie-le maintenant, il ne sera plus affiché :\n${t.token}`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
