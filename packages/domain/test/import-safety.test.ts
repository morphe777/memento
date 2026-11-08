// Audit v1.0 Lot 2, M-13: an import is checked before anything is written; safety copies are bounded.
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schema } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { checkImport, exportData, importData, SAFETY_COPY_KEEP, safetyCopy } from '../src/services/export.ts';
import { createTask, listTasks } from '../src/services/tasks.ts';
import { makeCtx } from './helpers.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('M-13 import checked first', () => {
  it('refuses invalid settings, impossible dates, broken links and incomplete rows, writing nothing', () => {
    const ctx = makeCtx('2026-11-03T10:00:00+01:00');
    createTask(ctx, { title: 'Témoin', durationMin: 15 });
    const good = exportData(ctx);
    const bad = [
      (d: ReturnType<typeof exportData>) =>
        d.tables.setting.push({ key: 'budget.weekly_min', value: 'beaucoup' } as never),
      (d: ReturnType<typeof exportData>) => (d.tables.task[0].dueDate = '2026-02-30'),
      (d: ReturnType<typeof exportData>) =>
        (d.tables.task[0].projectId = '00000000-0000-4000-8000-000000000000'),
      (d: ReturnType<typeof exportData>) => delete (d.tables.task[0] as Record<string, unknown>).title,
    ];
    for (const spoil of bad) {
      const d = clone(good);
      spoil(d);
      expect(() => checkImport(ctx, d)).toThrow(expect.objectContaining({ code: 'INVALID_EXPORT' }));
      expect(() => importData(ctx, d)).toThrow(expect.objectContaining({ code: 'INVALID_EXPORT' }));
      expect(listTasks(ctx, { projectId: 'inbox' }).map((t) => t.title)).toContain('Témoin');
    }
    expect(() => checkImport(ctx, good)).not.toThrow();
  });

  it('a valid check writes nothing', () => {
    const ctx = makeCtx('2026-11-03T10:00:00+01:00');
    const d = exportData(ctx);
    createTask(ctx, { title: 'Après export', durationMin: 15 });
    const before = ctx.db.select().from(schema.auditLog).all().length;
    checkImport(ctx, d);
    expect(listTasks(ctx, { projectId: 'inbox' }).map((t) => t.title)).toContain('Après export');
    expect(ctx.db.select().from(schema.auditLog).all().length).toBe(before);
  });

  it('safety copies: readable by the owner only, the most recent ones kept, other files untouched', async () => {
    const ctx = makeCtx('2026-11-03T10:00:00+01:00');
    const dir = mkdtempSync(join(tmpdir(), 'memento-safety-'));
    writeFileSync(join(dir, 'memento-2026-11-01.db'), 'x');
    for (let i = 0; i < SAFETY_COPY_KEEP + 2; i++)
      writeFileSync(join(dir, `backup-avant-import-2026-10-0${i}T00-00-00-000Z.db`), 'x');
    const name = await safetyCopy(ctx, dir, 'import');
    const left = readdirSync(dir).filter((n) => n.startsWith('backup-avant-import-'));
    expect(left).toHaveLength(SAFETY_COPY_KEEP);
    expect(left).toContain(name);
    expect(readdirSync(dir)).toContain('memento-2026-11-01.db');
    expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
  });
});
