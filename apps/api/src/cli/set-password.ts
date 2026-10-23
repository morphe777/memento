// Usage: pnpm user:set-password [login]   — creates the web user or changes its password (no default password).
import { openDb, runMigrations } from '@memento/db';
import { setUserPassword } from '../auth.ts';
import { ask } from './prompt.ts';

const login = process.argv[2] ?? (await ask('Identifiant : '));
const password = await ask('Mot de passe (12 caractères min.) : ', true);
if (process.stdin.isTTY) {
  const again = await ask('Confirmer : ', true);
  if (again !== password) {
    console.error('Les mots de passe ne correspondent pas.');
    process.exit(1);
  }
}
const { db, sqlite } = openDb();
runMigrations(db);
try {
  const r = await setUserPassword(db, login, password);
  console.log(
    r.created ? `Utilisateur « ${login} » créé.` : `Mot de passe de « ${login} » changé (sessions fermées).`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
