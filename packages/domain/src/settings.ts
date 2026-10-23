// Settings (dossier de dev §4 "Réglages") with defaults and validation (V-14).
import { schema } from '@memento/db';
import { z } from 'zod';
import { audit, type Ctx, tx } from './context.ts';
import { DomainError } from './errors.ts';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const settingsSchema = z.object({
  'budget.weekly_min': z.number().int().min(0).max(10_080),
  'experience.target': z.number().int().min(0).max(50),
  'experience.window_weeks': z.number().int().min(1).max(26),
  'experience.badge_color': z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  'ideas.purge_after_months': z.number().int().min(1).max(120),
  'engine.weights': z.object({
    value: z.number().min(0).max(10),
    urgency: z.number().min(0).max(10),
    delay: z.number().min(0).max(10),
    continuity: z.number().min(0).max(10),
    age: z.number().min(0).max(10),
  }),
  'engine.bonus_count': z.number().int().min(0).max(10),
  'engine.consider_also_count': z.number().int().min(0).max(20),
  'guards.window_weeks': z.number().int().min(1).max(26),
  'schedule.week_plan': z.object({ day: z.number().int().min(1).max(7), time: hhmm }),
  'schedule.reports': z.object({ time: hhmm }),
  'report.rhythm_low_pct': z.number().int().min(0).max(200),
  'report.rhythm_high_pct': z.number().int().min(0).max(300),
  'templates.meta_objective': z.string().max(4000),
  'templates.objective': z.string().max(4000),
  'templates.project': z.string().max(4000),
  'templates.task': z.string().max(4000),
  theme: z.enum(['auto', 'light', 'dark']),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  'budget.weekly_min': 360, // CH-11
  'experience.target': 2, // R-02
  'experience.window_weeks': 4,
  'experience.badge_color': '#D9AE3C', // V-14
  'ideas.purge_after_months': 12, // DM-87
  'engine.weights': { value: 1, urgency: 1, delay: 1, continuity: 1, age: 1 },
  'engine.bonus_count': 3, // WF-07
  'engine.consider_also_count': 3,
  'guards.window_weeks': 4, // CH-05
  'schedule.week_plan': { day: 1, time: '07:00' }, // WF-01
  'schedule.reports': { time: '07:00' },
  'report.rhythm_low_pct': 80, // R-05
  'report.rhythm_high_pct': 110,
  'templates.meta_objective':
    "## Ce que je veux dans ~1 an\n\n## Pourquoi ça compte vraiment\n\n## À quoi je verrai que c'est atteint\n",
  'templates.objective':
    '## Résultat attendu (SMART)\n\n## Pourquoi en surface\n\n## Pourquoi profond\n\n## Comment je mesure\n\n## Ce que je ne fais pas\n',
  'templates.project':
    '## Résultat attendu en 1 phrase\n\n## Critère de succès (oui / non)\n\n## Contexte en 2 lignes\n\n## Ressources\n',
  'templates.task': '## Quoi faire, concrètement\n\n## Où / avec quoi (lien)\n',
  theme: 'auto', // NF-06
};

export const settingsPatchSchema = settingsSchema.partial();

/** Reads all settings, falling back to defaults for missing keys. */
export function getSettings(ctx: Pick<Ctx, 'db'>): Settings {
  const rows = ctx.db.select().from(schema.setting).all();
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as Settings;
}

export function patchSettings(ctx: Ctx, patch: unknown): Settings {
  const parsed = settingsPatchSchema.safeParse(patch);
  if (!parsed.success) throw new DomainError('INVALID_SETTINGS', 'Réglages invalides', parsed.error.issues);
  return tx(ctx, () => {
    const before = getSettings(ctx);
    for (const [key, value] of Object.entries(parsed.data)) {
      ctx.db
        .insert(schema.setting)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.setting.key, set: { value, updatedAt: new Date().toISOString() } })
        .run();
    }
    const after = getSettings(ctx);
    audit(ctx, 'setting', 'settings', 'update', before, after);
    return after;
  });
}
