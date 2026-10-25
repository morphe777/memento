import { eq, schema } from '@memento/db';
// Idempotent seed: 8 domains in priority order, default groups, default settings (L0).
// D-64: domains and groups are created on a fresh database only; afterwards they are the user's (renamed,
// reordered, deleted) and the seed never recreates them.
import { type Ctx, newId, tx } from './context.ts';
import { defaultWeight, SEED_DOMAINS, SEED_GROUPS } from './seed-data.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

export function seed(ctx: Ctx): { domains: number; groups: number } {
  return tx(ctx, () => {
    let domains = 0;
    let groups = 0;
    const fresh = !ctx.db.select({ id: schema.domain.id }).from(schema.domain).limit(1).get();
    SEED_DOMAINS.forEach((d, i) => {
      const exists = ctx.db.select().from(schema.domain).where(eq(schema.domain.name, d.name)).get();
      if (!exists && fresh) {
        ctx.db
          .insert(schema.domain)
          .values({ id: newId(), ...d, priorityRank: i + 1, weight: defaultWeight(i + 1) })
          .run();
        domains++;
      } else if (exists && !exists.description) {
        // D-49: propose a description for domains that have none yet (never overwrites).
        ctx.db
          .update(schema.domain)
          .set({ description: d.description })
          .where(eq(schema.domain.id, exists.id))
          .run();
      }
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
    return { domains, groups };
  });
}
