import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@memento/db';
import { describe, expect, it } from 'vitest';
import type { Ctx } from '../src/context.ts';
import { getAiKey, getSettings, patchSettings, seed, setAiKey } from '../src/index.ts';

/** Starts like a container does: open the file, run the migrations, run the seed. */
function boot(file: string): Ctx {
  const { db, sqlite } = openDb(file);
  runMigrations(db);
  const ctx = { db, sqlite, actor: 'me', now: () => new Date() } as Ctx;
  seed(ctx);
  return ctx;
}

describe('settings survive a restart (container recreated on the same /data)', () => {
  it('keeps the AI configuration, its key and the other settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-'));
    const file = join(dir, 'memento.db');
    try {
      const a = boot(file);
      patchSettings(a, {
        'ai.provider': 'openrouter',
        'ai.model': 'anthropic/claude-test',
        'ai.instructions': 'Sois bref.',
        'budget.weekly_min': 420,
        theme: 'dark',
      });
      setAiKey(a, 'openrouter', 'sk-or-test-123456789');
      a.sqlite.close();
      const b = boot(file);
      expect(getSettings(b)).toMatchObject({
        'ai.provider': 'openrouter',
        'ai.model': 'anthropic/claude-test',
        'ai.instructions': 'Sois bref.',
        'budget.weekly_min': 420,
        theme: 'dark',
      });
      expect(getAiKey(b, 'openrouter')).toBe('sk-or-test-123456789');
      b.sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
