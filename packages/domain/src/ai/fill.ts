// D-97: « Compléter avec l'IA » in the panel of a meta-objective, an objective or a project — 3 alternative titles
// and a proposal for each field the form asks for (description from its template, SMART measure, success
// criterion). Nothing is saved here: the panel shows the proposals and the user picks what replaces what.
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getSettings } from '../settings.ts';
import { describeContext } from './describe.ts';
import { parseJsonObject } from './propose.ts';
import type { Llm } from './providers.ts';

export const FILL_FIELDS = {
  meta_objective: ['description', 'motive'],
  objective: ['description', 'smartIndicator', 'smartTarget', 'motive'],
  project: ['description', 'successCriterion', 'motive'],
} as const;
type FillKind = keyof typeof FILL_FIELDS;
const LABEL: Record<FillKind, string> = {
  meta_objective: 'méta-objectif',
  objective: 'objectif',
  project: 'projet',
};

export const aiFillBody = z.object({
  kind: z.enum(['meta_objective', 'objective', 'project']),
  /** The item, when it exists; a creation form sends its parent instead. */
  id: z.uuid().optional(),
  /** Creation form: the meta-objective of a new objective, the objective of a new project. */
  parentId: z.uuid().optional(),
  /** What the form holds right now (title required). */
  values: z.object({
    title: z.string().trim().min(1, 'Donne d’abord un titre : l’IA en a besoin.').max(300),
    description: z.string().max(20_000).default(''),
    smartIndicator: z.string().max(500).default(''),
    smartTarget: z.string().max(200).default(''),
    successCriterion: z.string().max(500).default(''),
    motive: z.string().max(120).default(''), // D-100
  }),
  remark: z.string().trim().max(2000).optional(),
});
export type AiFillInput = z.input<typeof aiFillBody>;

const OUTPUT = z.object({
  titles: z.array(z.string()),
  fields: z.object({
    description: z.string().optional(),
    smartIndicator: z.string().optional(),
    smartTarget: z.string().optional(),
    successCriterion: z.string().optional(),
    motive: z.string().optional(),
  }),
  comment: z.string().optional(),
});

export async function fillWithAi(ctx: Ctx, raw: AiFillInput, llm: Llm) {
  const input = aiFillBody.parse(raw);
  const settings = getSettings(ctx);
  const wanted = FILL_FIELDS[input.kind];
  const template = settings[`templates.${input.kind}`].trim();
  const v = input.values;
  const current = Object.fromEntries(
    wanted.map((k) => [k, v[k].trim() && !(k === 'description' && v[k].trim() === template) ? v[k] : null]),
  );
  const data = {
    kind: LABEL[input.kind],
    title: v.title,
    item: describeContext(ctx, { kind: input.kind, id: input.id, parentId: input.parentId, current: '' }),
    wanted,
    current,
    template: template || null,
    // D-100: the motive is read in a glance (Cap, Ma semaine), not a sentence to explain.
    fieldHints: {
      motive:
        'le pourquoi, pas le quoi : 3 à 8 mots, sans point final, le mot-clé qui déclenche entre **…** (ex. « Vieillir **debout** »)',
    },
    remark: input.remark || null,
    userContext: settings['ai.instructions'].trim() || null,
  };
  const { text, model } = await llm({
    system: `${settings['ai.prompt.fill']}\n\nRéponds uniquement par un objet JSON {"titles": string[], "fields": {${wanted.map((k) => `"${k}": string`).join(', ')}}, "comment": string}.`,
    user: `Complète la fiche de ce ${LABEL[input.kind]}.\n\nDonnées (JSON) :\n${JSON.stringify(data)}`,
    schema: z.toJSONSchema(OUTPUT) as Record<string, unknown>,
  });
  const parsed = OUTPUT.safeParse(parseJsonObject(text));
  if (!parsed.success)
    throw new DomainError('AI_BAD_ANSWER', "La proposition de l'IA ne respecte pas le format attendu.");
  const clean = (t: string) =>
    t
      .trim()
      .replace(/[.«»"]+$/u, '')
      .trim();
  const fields: Partial<Record<(typeof wanted)[number], string>> = {};
  for (const k of wanted) {
    const value = parsed.data.fields[k]?.trim();
    if (value)
      fields[k] =
        k === 'description' ? value : value.slice(0, k === 'motive' ? 120 : k === 'smartTarget' ? 200 : 500);
  }
  return {
    model,
    titles: [...new Set(parsed.data.titles.map(clean).filter((t) => t && t !== v.title.trim()))]
      .slice(0, 3)
      .map((t) => t.slice(0, 120)),
    fields,
    comment: parsed.data.comment?.trim() || null,
  };
}
