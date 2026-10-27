// Shared Zod input schemas: single source of truth for API validation, OpenAPI, web forms and MCP tools.
import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const title = z.string().trim().min(1, 'Titre obligatoire').max(200);
const text = z.string().max(20_000);
export const uuid = z.string().uuid();

export const idParam = z.object({ id: uuid });
export const isoWeekParam = z.object({ isoWeek: z.string().regex(/^\d{4}-W\d{2}$/) });

export const domainCreate = z.object({
  name: title,
  colorLight: color,
  colorDark: color,
  description: z.string().max(4000).optional(),
});
export const domainPatch = z
  .object({
    name: title,
    colorLight: color,
    colorDark: color,
    weight: z.number().min(0).max(1),
    archived: z.boolean(),
    description: z.string().max(4000),
  })
  .partial();
export const reorderBody = z.object({ ids: z.array(uuid).min(1) });

export const groupCreate = z.object({ name: title, domainId: uuid });
export const groupPatch = groupCreate.partial();

export const metaObjectiveStatus = z.enum(['active', 'paused', 'achieved', 'abandoned']);
export const metaObjectiveCreate = z.object({
  title,
  description: text.optional(),
  horizonDate: date.nullable().optional(),
  status: metaObjectiveStatus.optional(),
});
export const metaObjectivePatch = metaObjectiveCreate.partial();

export const objectiveStatus = z.enum(['active', 'paused', 'achieved', 'partial', 'failed', 'abandoned']);
export const objectiveCreate = z.object({
  title,
  metaObjectiveId: uuid.nullable().optional(),
  description: text.optional(),
  smartIndicator: z.string().max(500).optional(),
  smartTarget: z.string().max(200).optional(),
  smartCurrent: z.string().max(200).optional(),
  deadline: date,
  quarter: z
    .string()
    .regex(/^\d{4}-Q[1-4]$/)
    .optional(),
  criticality: z.number().int().min(1).max(3).optional(),
  status: objectiveStatus.optional(),
  /** D-62: renewed for the next quarter / year when closed. */
  recurrence: z.enum(['quarterly', 'yearly']).nullable().optional(),
});
export const objectivePatch = objectiveCreate.partial();

export const projectStatus = z.enum(['idea', 'ready', 'active', 'paused', 'done', 'abandoned']);
const projectFields = {
  title,
  description: text.optional(),
  objectiveId: uuid.nullable().optional(),
  isFree: z.boolean().optional(),
  sequenceMode: z.enum(['sequential', 'parallel']).optional(),
  primaryDomainId: uuid.nullable().optional(),
  successCriterion: z.string().max(500).optional(),
  startDate: date.nullable().optional(),
  dueDate: date.nullable().optional(),
  importance: z.enum(['low', 'normal', 'high']).optional(),
  /** D-62: renewed (copy with its tasks) for the next period when completed. */
  recurrence: z.enum(['monthly', 'quarterly', 'yearly']).nullable().optional(),
};
export const quarterKey = z.string().regex(/^\d{4}-Q[1-4]$/);
export const objectiveQuarterBody = z.object({ quarter: quarterKey });
export const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** D-42: choose (month) or drop (null) a project for a month: Planifier › Mois. */
export const projectMonthBody = z.object({ month: monthKey.nullable() });
/** RB-01 + decision D-04: an idea needs a title and at least one group. */
export const projectCreate = z.object({
  ...projectFields,
  groupIds: z.array(uuid).min(1, 'Au moins un groupe'),
});
export const projectPatch = z.object({ ...projectFields, status: projectStatus }).partial();
export const projectGroupsBody = z.object({
  groupIds: z.array(uuid).min(1),
  primaryDomainId: uuid.nullable().optional(),
});
export const projectCompleteBody = z.object({ success: z.boolean() });
/** D-58: « Proposer avec l'IA » on one tab of Planifier. */
export const aiProposeBody = z.object({
  scope: z.enum(['week', 'month', 'quarter']),
  period: z.string().regex(/^\d{4}-(W\d{2}|\d{2}|Q[1-4])$/),
});
const aiProvider = z.enum(['none', 'anthropic', 'openai', 'openrouter', 'google', 'ollama', 'custom']);
/** D-66: API key typed in Configuration › IA (empty: cleared). */
export const aiKeyBody = z.object({ provider: aiProvider, key: z.string().max(500) });
/** D-66: connection test with the form's values; `key` empty = the stored one. */
export const aiCheckBody = z.object({
  provider: aiProvider,
  baseUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).optional(),
  key: z.string().max(500).optional(),
});
/** D-57: the confirmation word guards against an accidental call. */
export const purgeBody = z.object({ confirm: z.literal('SUPPRIMER'), history: z.boolean().default(false) });
export const projectReorderBody = z.object({ objectiveId: uuid, ids: z.array(uuid).min(1) });
export const projectReplanBody = z.object({ dueDate: date.optional() });
export const projectListQuery = z.object({
  status: z.string().optional(), // comma-separated
  groupId: uuid.optional(),
  domainId: uuid.optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  objectiveId: uuid.optional(),
});

export const duration = z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60), z.literal(120)]);
const taskFields = {
  title,
  description: text.optional(),
  durationMin: z.number().int().nullable().optional(), // RB-03 checked in domain for a readable message
  isFree: z.boolean().optional(),
  isExperience: z.boolean().optional(),
  dueDate: date.nullable().optional(),
  recurrenceRule: z.string().max(500).nullable().optional(),
  domainId: uuid.nullable().optional(),
  /** D-61: time actually spent, in minutes (null = as estimated). */
  actualMin: z.number().int().min(1).max(6000).nullable().optional(),
};
/** D-54: an experience idea for the reserve (an Inbox task flagged as experience). */
export const experienceIdea = z.object({
  title,
  description: text.optional(),
  durationMin: taskFields.durationMin,
  domainId: taskFields.domainId,
});
export const taskCreate = z.object({
  ...taskFields,
  projectId: uuid.nullable().optional(),
  position: z.number().int().optional(),
});
export const taskBatchCreate = z.object({
  projectId: uuid.nullable().optional(),
  tasks: z.array(z.object(taskFields)).min(1).max(100),
});
export const taskPatch = z.object({ ...taskFields, status: z.enum(['todo', 'cancelled']) }).partial();
/** D-61: checking a task can carry the time actually spent. */
export const taskCompleteBody = z.object({ actualMin: taskFields.actualMin }).optional();
export const taskMoveBody = z.object({ projectId: uuid.nullable(), position: z.number().int().optional() });
export const taskReorderBody = z.object({ projectId: uuid.nullable(), ids: z.array(uuid).min(1) });
export const taskListQuery = z.object({
  projectId: z.string().optional(), // uuid or "inbox"
  status: z.string().optional(),
});
export const boardQuery = z.object({ projectId: uuid.optional() });
export const weekToggleBody = z.object({ inWeek: z.boolean() });
export const dependencyBody = z.object({ dependsOnId: uuid });

export const resourceCreate = z.object({
  ownerType: z.enum(['objective', 'project', 'task', 'group']),
  ownerId: uuid,
  label: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2000),
});

export const weekItemsBody = z.object({
  items: z.array(z.object({ taskId: uuid, kind: z.enum(['week', 'bonus']) })).max(200),
});
export const weekPatchBody = z.object({
  budgetMin: z.number().int().min(0).max(10_080).nullable(),
  budgetReason: z.string().max(2000).nullable().optional(),
});

export const reportListQuery = z.object({
  kind: z.enum(['week', 'month', 'quarter']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export const reportGenerateBody = z.object({
  kind: z.enum(['week', 'month', 'quarter']),
  periodKey: z.string().regex(/^\d{4}-(W\d{2}|\d{2}|Q[1-4])$/),
});

export const changesQuery = z.object({
  since: z.string().optional(), // ISO timestamp, or "last-visit", "24h", "7d"
  actor: z.enum(['all', 'me', 'ai']).optional(),
  includeReviewed: z.coerce.boolean().optional(),
});
export const markReviewedBody = z.object({ ids: z.array(uuid).optional(), all: z.boolean().optional() });

export type ExperienceIdea = z.infer<typeof experienceIdea>;
export type DomainCreate = z.infer<typeof domainCreate>;
export type DomainPatch = z.infer<typeof domainPatch>;
export type GroupCreate = z.infer<typeof groupCreate>;
export type GroupPatch = z.infer<typeof groupPatch>;
export type MetaObjectiveCreate = z.infer<typeof metaObjectiveCreate>;
export type MetaObjectivePatch = z.infer<typeof metaObjectivePatch>;
export type ObjectiveCreate = z.infer<typeof objectiveCreate>;
export type ObjectivePatch = z.infer<typeof objectivePatch>;
export type ProjectCreate = z.infer<typeof projectCreate>;
export type ProjectPatch = z.infer<typeof projectPatch>;
export type TaskCreate = z.infer<typeof taskCreate>;
export type TaskPatch = z.infer<typeof taskPatch>;
export type ResourceCreate = z.infer<typeof resourceCreate>;
