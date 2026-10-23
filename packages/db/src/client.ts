import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema>;

const here = dirname(fileURLToPath(import.meta.url));
export const migrationsFolder = resolve(here, '../migrations');
const repoRoot = resolve(here, '../../..');

/** Resolves MEMENTO_DB_FILE relative to the repository root. ':memory:' allowed for tests. */
export function resolveDbFile(file = process.env.MEMENTO_DB_FILE ?? './data/memento.db'): string {
  return file === ':memory:' ? file : resolve(repoRoot, file);
}

export function openDb(file = resolveDbFile()): { db: Db; sqlite: Database.Database } {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/** Applies pending migrations. Safe to run repeatedly (L0: "migrations rejouables"). */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}
