import { openDb, runMigrations } from '@memento/db';
import { seed } from '../seed.ts';

const { db, sqlite } = openDb();
runMigrations(db);
const r = seed({ db, sqlite, actor: 'me' });
sqlite.close();
console.log(`Seed OK: ${r.domains} domaine(s) et ${r.groups} groupe(s) ajoutés.`);
