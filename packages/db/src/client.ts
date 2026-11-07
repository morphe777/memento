import { existsSync, mkdirSync } from 'node:fs';
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

/** Read-only connection, no migration, no pragma that writes: for checks on a live (production) database. */
export function openDbReadonly(file = resolveDbFile()): Database.Database {
  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  sqlite.pragma('busy_timeout = 5000');
  return sqlite;
}

/** H-19: what a database holds, to compare a backup with its source; `ok` = SQLite integrity check passed. */
export function describeDb(sqlite: Database.Database) {
  const integrity = sqlite.pragma('integrity_check', { simple: true });
  const count = (t: string) => {
    try {
      return (sqlite.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n;
    } catch {
      return 0;
    }
  };
  return {
    ok: integrity === 'ok',
    integrity,
    migrations: count('__drizzle_migrations'),
    domains: count('domain'),
    objectives: count('objective'),
    projects: count('project'),
    tasks: count('task'),
    reports: count('report'),
  };
}

/** H-19: hot, consistent copy (SQLite online backup, WAL included), then checked. No sqlite3 CLI needed. */
export async function backupDb(source: string, destination: string) {
  if (existsSync(destination)) throw new Error(`${destination} existe déjà : choisir un autre nom.`);
  mkdirSync(dirname(destination), { recursive: true });
  const src = openDbReadonly(source);
  try {
    await src.backup(destination);
    const copy = new Database(destination, { readonly: true, fileMustExist: true });
    try {
      return { source: describeDb(src), copy: describeDb(copy) };
    } finally {
      copy.close();
    }
  } finally {
    src.close();
  }
}

/** Applies pending migrations. Safe to run repeatedly (L0: "migrations rejouables"). */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}
