import { eq, schema } from '@memento/db';
import { DEFAULT_AI_PROMPTS, PREVIOUS_AI_PROMPTS } from './ai/prompts.ts';
// Idempotent seed: 8 domains in priority order, default groups, default settings (L0).
// D-64: domains and groups are a starter set written on a fresh database only; afterwards they are the
// user's configuration (renamed, reordered, deleted) and the seed never reads or touches them again.
import { type Ctx, newId, tx } from './context.ts';
import { defaultWeight, SEED_DOMAINS, SEED_GROUPS } from './seed-data.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

export function seed(ctx: Ctx): { domains: number; groups: number } {
  return tx(ctx, () => {
    let domains = 0;
    let groups = 0;
    const fresh = !ctx.db.select({ id: schema.domain.id }).from(schema.domain).limit(1).get();
    if (fresh)
      SEED_DOMAINS.forEach((d, i) => {
        ctx.db
          .insert(schema.domain)
          .values({ id: newId(), ...d, priorityRank: i + 1, weight: defaultWeight(i + 1) })
          .run();
        domains++;
      });
    for (const [domainName, names] of fresh ? Object.entries(SEED_GROUPS) : []) {
      const dom = ctx.db.select().from(schema.domain).where(eq(schema.domain.name, domainName)).get();
      if (!dom) continue;
      for (const name of names) {
        const exists = ctx.db
          .select()
          .from(schema.group)
          .where(eq(schema.group.nameKey, name.toLowerCase()))
          .get();
        if (!exists) {
          ctx.db
            .insert(schema.group)
            .values({ id: newId(), name, nameKey: name.toLowerCase(), domainId: dom.id })
            .run();
          groups++;
        }
      }
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      ctx.db.insert(schema.setting).values({ key, value }).onConflictDoNothing().run();
    }
    // D-72: a prompt never edited (still an earlier default text) follows the new default.
    for (const [name, olds] of Object.entries(PREVIOUS_AI_PROMPTS)) {
      const key = `ai.prompt.${name}`;
      const row = ctx.db.select().from(schema.setting).where(eq(schema.setting.key, key)).get();
      if (typeof row?.value === 'string' && olds.includes(row.value))
        ctx.db
          .update(schema.setting)
          .set({ value: DEFAULT_AI_PROMPTS[name as keyof typeof DEFAULT_AI_PROMPTS] })
          .where(eq(schema.setting.key, key))
          .run();
    }
    return { domains, groups };
  });
}
