// Configuration › Données (decision D-45): full export of the data as JSON, as a backup / for other tools.
// Secrets are never exported: password hashes, sessions, API token hashes and AI keys (D-66) are left out.
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { copyDb, schema, sql } from '@memento/db';
import { SECRET_SETTING_PREFIX } from '../ai/providers.ts';
import { audit, type Ctx, ctxNow, tx } from '../context.ts';
import { DomainError } from '../errors.ts';
import { settingsSchema } from '../settings.ts';
import { findInvalidData } from './integrity.ts';

export const EXPORT_VERSION = 1;

export function exportData(ctx: Ctx) {
  const s = schema;
  return {
    app: 'memento',
    exportVersion: EXPORT_VERSION,
    exportedAt: ctxNow(ctx).toISOString(),
    tables: {
      domain: ctx.db.select().from(s.domain).all(),
      group: ctx.db.select().from(s.group).all(),
      metaObjective: ctx.db.select().from(s.metaObjective).all(),
      objective: ctx.db.select().from(s.objective).all(),
      project: ctx.db.select().from(s.project).all(),
      projectGroup: ctx.db.select().from(s.projectGroup).all(),
      projectDependency: ctx.db.select().from(s.projectDependency).all(),
      task: ctx.db.select().from(s.task).all(),
      taskDependency: ctx.db.select().from(s.taskDependency).all(),
      resourceLink: ctx.db.select().from(s.resourceLink).all(),
      weekPlan: ctx.db.select().from(s.weekPlan).all(),
      weekPlanItem: ctx.db.select().from(s.weekPlanItem).all(),
      report: ctx.db.select().from(s.report).all(),
      setting: ctx.db
        .select()
        .from(s.setting)
        .all()
        .filter((r) => !r.key.startsWith(SECRET_SETTING_PREFIX)),
      auditLog: ctx.db.select().from(s.auditLog).all(),
      apiToken: ctx.db
        .select({
          id: s.apiToken.id,
          name: s.apiToken.name,
          scopes: s.apiToken.scopes,
          createdAt: s.apiToken.createdAt,
          revokedAt: s.apiToken.revokedAt,
        })
        .from(s.apiToken)
        .all(),
      appUser: ctx.db
        .select({ id: s.appUser.id, login: s.appUser.login, createdAt: s.appUser.createdAt })
        .from(s.appUser)
        .all(),
    },
  };
}

// Insertion order respects foreign keys; deletion runs in reverse. Users, sessions, tokens and job runs are
// never touched by an import (D-50): secrets are not in the file, and the current login stays valid.
const IMPORT_ORDER = [
  ['domain', schema.domain],
  ['group', schema.group],
  ['metaObjective', schema.metaObjective],
  ['objective', schema.objective],
  ['project', schema.project],
  ['projectGroup', schema.projectGroup],
  ['projectDependency', schema.projectDependency],
  ['task', schema.task],
  ['taskDependency', schema.taskDependency],
  ['resourceLink', schema.resourceLink],
  ['weekPlan', schema.weekPlan],
  ['weekPlanItem', schema.weekPlanItem],
  ['report', schema.report],
  ['setting', schema.setting],
  ['auditLog', schema.auditLog],
] as const;

type ExportFile = { exportedAt?: string; tables: Record<string, unknown> };

function readExport(data: unknown): ExportFile {
  const d = data as { app?: unknown; exportVersion?: unknown; tables?: Record<string, unknown> };
  if (
    !d ||
    d.app !== 'memento' ||
    d.exportVersion !== EXPORT_VERSION ||
    typeof d.tables !== 'object' ||
    !d.tables
  )
    throw new DomainError(
      'INVALID_EXPORT',
      'Fichier non reconnu : ce n’est pas un export Mémento (version 1).',
    );
  for (const [key] of IMPORT_ORDER)
    if (!Array.isArray(d.tables[key]))
      throw new DomainError('INVALID_EXPORT', `Export incomplet : table « ${key} » absente.`);
  return d as ExportFile;
}

const invalid = (message: string) => new DomainError('INVALID_EXPORT', `Export refusé : ${message}`);

/** Replaces the business data, then checks what was written (M-13). Runs inside a transaction. */
function writeImport(ctx: Ctx, d: ExportFile) {
  // The stored AI keys (D-66) are not in the file: they stay as they are.
  for (const [, table] of [...IMPORT_ORDER].reverse())
    if (table === schema.setting)
      ctx.db
        .delete(table)
        .where(sql`${schema.setting.key} not like ${`${SECRET_SETTING_PREFIX}%`}`)
        .run();
    else ctx.db.delete(table).run();
  const counts: Record<string, number> = {};
  for (const [key, table] of IMPORT_ORDER) {
    let rows = d.tables[key] as Record<string, unknown>[];
    if (table === schema.setting) {
      rows = rows.filter((r) => !String(r?.key).startsWith(SECRET_SETTING_PREFIX));
      // M-13: a known setting must have a valid value (as when saved from Configuration).
      for (const r of rows) {
        const rule = settingsSchema.shape[r?.key as keyof typeof settingsSchema.shape];
        if (rule && !rule.safeParse(r.value).success) throw invalid(`réglage « ${r.key} » invalide.`);
      }
    }
    for (let i = 0; i < rows.length; i += 200)
      try {
        ctx.db
          .insert(table)
          .values(rows.slice(i, i + 200) as never)
          .run();
      } catch (e) {
        throw invalid(`ligne invalide dans « ${key} » (${(e as Error).message}).`);
      }
    counts[key] = rows.length;
  }
  // M-13: the same checks as `pnpm db:check` (C-05, C-06), plus the links between rows.
  const wrong = findInvalidData(ctx.sqlite);
  if (wrong.length)
    throw invalid(
      `${wrong[0].table}.${wrong[0].column} = ${JSON.stringify(wrong[0].value)} (date ou règle invalide).`,
    );
  const broken = ctx.sqlite.pragma('foreign_key_check') as { table: string }[];
  if (broken.length) throw invalid(`lien cassé dans « ${broken[0].table} ».`);
  audit(ctx, 'import', 'import', 'import', null, { exportedAt: d.exportedAt ?? null, counts });
  return { ok: true as const, counts };
}

/**
 * D-50: restore a JSON export, replacing all business data in one transaction (all or nothing).
 * M-13: the API calls checkImport first, then takes its safety copy, then imports.
 */
export function importData(ctx: Ctx, data: unknown) {
  const d = readExport(data);
  return tx(ctx, () => writeImport(ctx, d));
}

const ROLLBACK = Symbol('rollback');

/** M-13: the whole import, checked, then rolled back: nothing is written. Throws INVALID_EXPORT when refused. */
export function checkImport(ctx: Ctx, data: unknown) {
  const d = readExport(data);
  try {
    tx(ctx, () => {
      writeImport(ctx, d);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return { ok: true as const };
}

/** M-13: safety copies taken before an import or a purge, per kind. */
export const SAFETY_COPY_KEEP = 5;

/**
 * M-13, M-15: a checked copy of the database before an import or a purge, readable by its owner only (it holds the
 * stored AI keys); only the SAFETY_COPY_KEEP most recent copies of that kind are kept. Returns the file name.
 */
export async function safetyCopy(ctx: Ctx, dir: string, kind: 'import' | 'purge') {
  mkdirSync(dir, { recursive: true });
  const prefix = `backup-avant-${kind}-`;
  const name = `${prefix}${ctxNow(ctx).toISOString().replace(/[:.]/g, '-')}.db`;
  await copyDb(ctx.sqlite, join(dir, name));
  chmodSync(join(dir, name), 0o600);
  const old = readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith('.db'))
    .sort()
    .reverse()
    .slice(SAFETY_COPY_KEEP);
  for (const n of old) rmSync(join(dir, n));
  return name;
}

// D-57: « Vider les données » — removes every meta-objective, objective, project and task (with their links),
// keeping the configuration: domains, groups, settings, account, sessions, tokens and job runs. With
// `history`, week plans, frozen reports and the journal go too (a clean start). Children first (foreign keys).
const PURGE_TABLES = [
  ['taskDependency', schema.taskDependency],
  ['weekPlanItem', schema.weekPlanItem],
  ['resourceLink', schema.resourceLink],
  ['task', schema.task],
  ['projectDependency', schema.projectDependency],
  ['projectGroup', schema.projectGroup],
  ['project', schema.project],
  ['objective', schema.objective],
  ['metaObjective', schema.metaObjective],
] as const;
const HISTORY_TABLES = [
  ['weekPlan', schema.weekPlan],
  ['report', schema.report],
  ['auditLog', schema.auditLog],
] as const;

export function purgeData(ctx: Ctx, opts: { history: boolean }) {
  return tx(ctx, () => {
    const counts: Record<string, number> = {};
    for (const [key, table] of [...PURGE_TABLES, ...(opts.history ? HISTORY_TABLES : [])])
      counts[key] = ctx.db.delete(table).run().changes;
    // Logged after the wipe, so the journal keeps a trace even when it was emptied.
    audit(ctx, 'purge', 'purge', 'purge', null, { history: opts.history, counts });
    return { ok: true as const, counts };
  });
}
