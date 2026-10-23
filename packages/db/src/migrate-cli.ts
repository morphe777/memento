import { openDb, resolveDbFile, runMigrations } from './client.ts';

const file = resolveDbFile();
const { db, sqlite } = openDb(file);
runMigrations(db);
sqlite.close();
console.log(`Migrations applied to ${file}`);
