import { createHash } from 'node:crypto';
import { eq, schema } from '@memento/db';
import { DEFAULT_AI_PROMPTS, PREVIOUS_AI_PROMPT_HASHES } from './ai/prompts.ts';
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
    // D-72, D-122: a prompt never edited (an earlier default text, known by its hash) follows the new default.
    for (const [name, olds] of Object.entries(PREVIOUS_AI_PROMPT_HASHES)) {
      const key = `ai.prompt.${name}`;
      const row = ctx.db.select().from(schema.setting).where(eq(schema.setting.key, key)).get();
      if (
        typeof row?.value === 'string' &&
        olds.includes(createHash('sha256').update(row.value).digest('hex'))
      )
        ctx.db
          .update(schema.setting)
          .set({ value: DEFAULT_AI_PROMPTS[name as keyof typeof DEFAULT_AI_PROMPTS] })
          .where(eq(schema.setting.key, key))
          .run();
    }
    clearTemplateDescriptions(ctx);
    return { domains, groups };
  });
}

/**
 * D-119: the description templates were copied into every new item (D-35, abandoned): a description that is
 * still exactly a template (the current one or the default one) is emptied. Idempotent, at every start.
 */
function clearTemplateDescriptions(ctx: Ctx) {
  const stored = new Map(
    ctx.db
      .select()
      .from(schema.setting)
      .all()
      .map((r) => [r.key, r.value]),
  );
  const tables = {
    task: schema.task,
    project: schema.project,
    objective: schema.objective,
    meta_objective: schema.metaObjective,
  } as const;
  for (const [kind, table] of Object.entries(tables)) {
    const key = `templates.${kind}` as keyof typeof DEFAULT_SETTINGS;
    const templates = new Set(
      [stored.get(key), DEFAULT_SETTINGS[key]]
        .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        .map((v) => v.trim()),
    );
    if (!templates.size) continue;
    for (const r of ctx.db.select({ id: table.id, d: table.description }).from(table).all())
      if (templates.has(r.d.trim()))
        ctx.db.update(table).set({ description: '' }).where(eq(table.id, r.id)).run();
  }
}
