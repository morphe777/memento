// D-155: « Compléter le budget » in Planifier › Semaine. The AI reads the planning page, takes the current
// selection as fixed, and proposes 1 to 3 tasks that fit in what is left of the budget, each with an angle (a
// coloured tag), a reason of 15 words at most and the key words of that reason (shown in bold). Nothing is written
// here: the user checks what to add, applied through PUT /week-plans/{week}/items. The AI can only add; ids it
// invents, tasks already chosen, locked or too long for what is left are dropped (in its order of preference).
import { z } from 'zod';
import type { Ctx } from '../context.ts';
import { DomainError } from '../errors.ts';
import { getSettings } from '../settings.ts';
import { DATA_RULE, dataBlock } from './prompts.ts';
import { parseJsonObject, weekData } from './propose.ts';
import type { Llm } from './providers.ts';

export const FILL_ANGLES = ['month', 'balance', 'deadline', 'experience', 'momentum'] as const;
export type FillAngle = (typeof FILL_ANGLES)[number];
/** At most this many tasks proposed. */
export const FILL_MAX_ITEMS = 3;

export const aiFillWeekBody = z.object({ isoWeek: z.string() });

const OUTPUT = z.object({
  summary: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      angle: z.enum(FILL_ANGLES),
      reason: z.string(),
      key: z.string().optional(),
    }),
  ),
});
const FORMAT =
  '{"summary": string, "items": [{"id": taskId, "angle": "month"|"balance"|"deadline"|"experience"|"momentum", "reason": string, "key": string}]}';
const FORMAT_RULE =
  'Réponds uniquement par un objet JSON conforme au schéma demandé, sans texte autour. Utilise uniquement les identifiants (id) présents dans les données.';

export interface FillWeekItem {
  id: string;
  title: string;
  durationMin: number | null;
  isExperience: boolean;
  projectTitle: string | null;
  domainId: string | null;
  angle: FillAngle;
  reason: string;
  /** Words of `reason` to show in bold; null when the AI gave none found in the reason. */
  key: string | null;
}

export interface FillWeekProposal {
  isoWeek: string;
  remainingMin: number;
  summary: string;
  model: string;
  items: FillWeekItem[];
}

export async function fillWeekWithAi(ctx: Ctx, isoWeek: string, llm: Llm): Promise<FillWeekProposal> {
  const { page, tasks, data } = weekData(ctx, isoWeek, true);
  const remainingMin = page.budget.budgetMin - page.budget.usedMin;
  if (remainingMin <= 0)
    throw new DomainError('BUDGET_FULL', 'Le budget de la semaine est déjà rempli : rien à compléter.');
  const s = getSettings(ctx);
  const { text, model } = await llm({
    task: 'fill-week',
    system: `${s['ai.prompt.system']}\n\n${FORMAT_RULE}\n\n${DATA_RULE}`,
    user: `${s['ai.prompt.fill_week']}\n\nSchéma de la réponse : ${FORMAT}\n\nDonnées (JSON) :\n${dataBlock({
      ...data,
      remainingMin,
      plannedMix: page.mix,
      maxItems: FILL_MAX_ITEMS,
    })}`,
    schema: z.toJSONSchema(OUTPUT) as Record<string, unknown>,
  });
  const parsed = OUTPUT.safeParse(parseJsonObject(text));
  if (!parsed.success)
    throw new DomainError('AI_BAD_ANSWER', "La proposition de l'IA ne respecte pas le format attendu.");

  const addable = new Map(
    tasks.filter((t) => !t.selection && !t.locked && (t.durationMin ?? 0) > 0).map((t) => [t.taskId, t]),
  );
  const items: FillWeekItem[] = [];
  let left = remainingMin;
  for (const p of parsed.data.items) {
    if (items.length >= FILL_MAX_ITEMS) break;
    const t = addable.get(p.id);
    if (!t || items.some((i) => i.id === p.id)) continue;
    const cost = t.isExperience ? 0 : (t.durationMin ?? 0); // RB-09: an experience is outside the budget
    if (cost > left) continue;
    left -= cost;
    const key = p.key?.trim();
    items.push({
      id: t.taskId,
      title: t.title,
      durationMin: t.durationMin,
      isExperience: t.isExperience,
      projectTitle: t.projectTitle,
      domainId: t.domainId,
      angle: p.angle,
      reason: p.reason.trim(),
      key: key && p.reason.includes(key) ? key : null,
    });
  }
  return { isoWeek, remainingMin, summary: parsed.data.summary.trim(), model, items };
}
