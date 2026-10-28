// Settings (dossier de dev §4 "Réglages") with defaults and validation (V-14).
import { schema } from '@memento/db';
import { z } from 'zod';
import { DEFAULT_AI_PROMPTS } from './ai/prompts.ts';
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
  'ui.breadcrumb': z.boolean(),
  'ui.show_recalculate': z.boolean(),
  'inbox.recurring_horizon_days': z.number().int().min(0).max(365),
  'ui.projects_default_view': z.enum(['tree', 'list', 'kanban']),
  'month.max_projects': z.number().int().min(1).max(20),
  'quarter.max_objectives': z.number().int().min(1).max(20),
  'map.no_meta_position': z.number().int().min(0).max(1000),
  // D-58: AI provider for « Proposer avec l'IA ». Keys stay in environment variables, never here.
  'ai.provider': z.enum(['none', 'anthropic', 'openai', 'openrouter', 'google', 'ollama', 'custom']),
  'ai.model': z.string().trim().max(200),
  'ai.base_url': z.union([z.literal(''), z.url({ protocol: /^https?$/ })]),
  'ai.instructions': z.string().max(4000),
  'ai.prompt.system': z.string().trim().min(1).max(8000),
  'ai.prompt.week': z.string().trim().min(1).max(8000),
  'ai.prompt.month': z.string().trim().min(1).max(8000),
  'ai.prompt.quarter': z.string().trim().min(1).max(8000),
  'ai.prompt.describe': z.string().trim().min(1).max(8000),
  'ai.prompt.breakdown': z.string().trim().min(1).max(8000),
  'ai.prompt.path': z.string().trim().min(1).max(8000),
  'ai.prompt.daily': z.string().trim().min(1).max(8000),
  // D-77: evening recap « Ta journée » on Telegram. The bot token is a secret row, never here.
  'notify.daily_recap': z.object({ enabled: z.boolean(), time: hhmm, ai: z.boolean() }),
  'notify.telegram_chat_id': z
    .string()
    .trim()
    .regex(/^(-?\d{1,20}|@\w{3,64})?$/),
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
  'ui.breadcrumb': false, // user request 23/10/2026: off by default, links are everywhere
  'ui.show_recalculate': false, // « Recalculer » hidden until the AI proposal replaces it (23/10/2026)
  'inbox.recurring_horizon_days': 14, // D-44: recurring tasks due later than this go to « Plus tard »
  'ui.projects_default_view': 'tree',
  'month.max_projects': 3, // D-47: alert above this many month projects at once
  'quarter.max_objectives': 3, // D-48: alert above this many objectives in a quarter
  'map.no_meta_position': 0, // D-69: « Sans méta-objectif » lane on top, movable (index among the meta-objectives)
  'ai.provider': 'none', // D-58: off until chosen in Configuration › IA
  'ai.model': '', // empty: the provider's default (Anthropic) or required
  'ai.base_url': '', // empty: the provider's usual URL
  'ai.instructions': '',
  'ai.prompt.system': DEFAULT_AI_PROMPTS.system, // editable without a new image (Configuration › IA)
  'ai.prompt.week': DEFAULT_AI_PROMPTS.week,
  'ai.prompt.month': DEFAULT_AI_PROMPTS.month,
  'ai.prompt.quarter': DEFAULT_AI_PROMPTS.quarter,
  'ai.prompt.describe': DEFAULT_AI_PROMPTS.describe, // D-68: « Rédiger avec l'IA »
  'ai.prompt.breakdown': DEFAULT_AI_PROMPTS.breakdown, // D-70: « Découper avec l'IA »
  'ai.prompt.path': DEFAULT_AI_PROMPTS.path, // D-75: « Proposer un chemin avec l'IA »
  'ai.prompt.daily': DEFAULT_AI_PROMPTS.daily, // D-77: opening words of « Ta journée »
  'notify.daily_recap': { enabled: true, time: '19:30', ai: true }, // sent only once Telegram is set up
  'notify.telegram_chat_id': '',
};

export const settingsPatchSchema = settingsSchema.partial();

export type TemplateKind = 'meta_objective' | 'objective' | 'project' | 'task';

/** Description templates (Configuration › Templates) apply to every creation, whatever the channel (UI, API, MCP), when no description is given. */
export function withTemplate(
  ctx: Pick<Ctx, 'db'>,
  kind: TemplateKind,
  description: string | undefined,
): string {
  if (description?.trim()) return description;
  return getSettings(ctx)[`templates.${kind}`];
}

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
        .onConflictDoUpdate({
          target: schema.setting.key,
          set: { value, updatedAt: new Date().toISOString() },
        })
        .run();
    }
    const after = getSettings(ctx);
    audit(ctx, 'setting', 'settings', 'update', before, after);
    return after;
  });
}
