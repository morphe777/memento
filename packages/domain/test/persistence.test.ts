import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@memento/db';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_PROMPTS } from '../src/ai/prompts.ts';
import type { Ctx } from '../src/context.ts';
import { getAiKey, getSettings, patchSettings, seed, setAiKey } from '../src/index.ts';

/** An earlier default text of the week prompt (D-72). */
const OLD_WEEK_PROMPT = `Propose la sélection de la semaine : la liste COMPLÈTE des tâches à faire (kind "week") et quelques bonus (kind "bonus", si le budget est atteint).
- Les tâches "mandatory" (deadline dans la semaine) doivent être retenues.
- Une tâche "locked" (attend une tâche précédente) ne peut pas être retenue, sauf si la tâche qui la bloque est elle-même retenue et la précède dans le même projet.
- Le total des tâches "week" doit tenir dans budgetMin (en minutes) ; les bonus sont hors budget.
- Privilégie les projets du mois, la continuité (avancer un projet plutôt que tout disperser), les deadlines, et une ou deux expériences si la cible n'est pas atteinte.`;

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

  it('D-72: a prompt never edited follows the new default, an edited one is kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-'));
    const file = join(dir, 'memento.db');
    try {
      const a = boot(file);
      patchSettings(a, { 'ai.prompt.week': OLD_WEEK_PROMPT, 'ai.prompt.system': 'Mon prompt.' });
      a.sqlite.close();
      const b = boot(file);
      expect(getSettings(b)['ai.prompt.week']).toBe(DEFAULT_AI_PROMPTS.week);
      expect(getSettings(b)['ai.prompt.system']).toBe('Mon prompt.');
      b.sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
