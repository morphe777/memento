// Mémento database schema (SQLite). Dossier de dev §4, adapted to SQLite (see docs/DECISIONS.md).
// Every business table carries id (UUID text), created_at, updated_at, created_by ('me' | 'ai:<token>').
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

const base = {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
  createdBy: text('created_by').notNull().default('me'),
};

export const domain = sqliteTable(
  'domain',
  {
    ...base,
    name: text('name').notNull(),
    // What belongs here (and what does not): read by the AI to file projects in the right domain.
    description: text('description').notNull().default(''),
    colorLight: text('color_light').notNull(),
    colorDark: text('color_dark').notNull(),
    priorityRank: integer('priority_rank').notNull(),
    weight: real('weight').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('domain_rank_uq').on(t.priorityRank), uniqueIndex('domain_name_uq').on(t.name)],
);

export const group = sqliteTable(
  'group',
  {
    ...base,
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(), // lower-cased name: case-insensitive uniqueness
    domainId: text('domain_id')
      .notNull()
      .references(() => domain.id),
  },
  (t) => [uniqueIndex('group_name_key_uq').on(t.nameKey)],
);

export const metaObjective = sqliteTable('meta_objective', {
  ...base,
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  horizonDate: text('horizon_date'),
  status: text('status', { enum: ['active', 'paused', 'achieved', 'abandoned'] })
    .notNull()
    .default('active'),
});

export const objective = sqliteTable('objective', {
  ...base,
  metaObjectiveId: text('meta_objective_id').references(() => metaObjective.id),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  smartIndicator: text('smart_indicator').notNull().default(''),
  smartTarget: text('smart_target').notNull().default(''),
  smartCurrent: text('smart_current').notNull().default(''),
  // Stored, not recomputed on read (user decision 2026-10-23): updated by the API on project changes.
  progressPct: integer('progress_pct').notNull().default(0),
  deadline: text('deadline').notNull(),
  quarter: text('quarter').notNull(), // e.g. 2026-Q4
  criticality: integer('criticality').notNull().default(2),
  status: text('status', { enum: ['active', 'paused', 'achieved', 'partial', 'failed', 'abandoned'] })
    .notNull()
    .default('active'),
});

export const project = sqliteTable(
  'project',
  {
    ...base,
    title: text('title').notNull(),
    status: text('status', { enum: ['idea', 'ready', 'active', 'paused', 'done', 'abandoned'] })
      .notNull()
      .default('idea'),
    objectiveId: text('objective_id').references(() => objective.id),
    positionInObjective: integer('position_in_objective').notNull().default(0),
    isFree: integer('is_free', { mode: 'boolean' }).notNull().default(false),
    sequenceMode: text('sequence_mode', { enum: ['sequential', 'parallel'] })
      .notNull()
      .default('sequential'),
    primaryDomainId: text('primary_domain_id').references(() => domain.id),
    successCriterion: text('success_criterion').notNull().default(''),
    startDate: text('start_date'),
    dueDate: text('due_date'),
    monthFlag: text('month_flag'), // YYYY-MM
    previousMonthFlag: text('previous_month_flag'),
    // D-53: project-level importance, independent of the domain weight (× 0.5 / 1 / 1.5 on V).
    importance: text('importance', { enum: ['low', 'normal', 'high'] })
      .notNull()
      .default('normal'), // set at month end when an unfinished month project goes back to ready
    success: integer('success', { mode: 'boolean' }),
    completedAt: text('completed_at'),
    replannedAt: text('replanned_at'), // RB-16 baseline (trace kept in audit_log and frozen reports)
    replanDoneMin: integer('replan_done_min'),
    lastTouchedAt: text('last_touched_at').notNull().default(now),
    description: text('description').notNull().default(''),
  },
  (t) => [index('project_status_idx').on(t.status), index('project_objective_idx').on(t.objectiveId)],
);

export const projectGroup = sqliteTable(
  'project_group',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id),
    groupId: text('group_id')
      .notNull()
      .references(() => group.id),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.groupId] })],
);

export const task = sqliteTable(
  'task',
  {
    ...base,
    projectId: text('project_id').references(() => project.id), // null = Inbox
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    durationMin: integer('duration_min'), // 30 | 60 | 120, nullable for ideas (RB-03)
    position: integer('position').notNull().default(0),
    isFree: integer('is_free', { mode: 'boolean' }).notNull().default(false),
    isExperience: integer('is_experience', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['todo', 'done', 'cancelled'] })
      .notNull()
      .default('todo'),
    dueDate: text('due_date'),
    recurrenceRule: text('recurrence_rule'),
    domainId: text('domain_id').references(() => domain.id), // Inbox tasks only
    postponeCount: integer('postpone_count').notNull().default(0),
    doneAt: text('done_at'),
  },
  (t) => [index('task_project_idx').on(t.projectId), index('task_status_idx').on(t.status)],
);

export const taskDependency = sqliteTable(
  'task_dependency',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    dependsOnTaskId: text('depends_on_task_id')
      .notNull()
      .references(() => task.id),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

export const projectDependency = sqliteTable(
  'project_dependency',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id),
    dependsOnProjectId: text('depends_on_project_id')
      .notNull()
      .references(() => project.id),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.dependsOnProjectId] })],
);

export const resourceLink = sqliteTable(
  'resource_link',
  {
    ...base,
    ownerType: text('owner_type', { enum: ['objective', 'project', 'task', 'group'] }).notNull(),
    ownerId: text('owner_id').notNull(),
    label: text('label').notNull(),
    url: text('url').notNull(),
  },
  (t) => [index('resource_owner_idx').on(t.ownerType, t.ownerId)],
);

export const weekPlan = sqliteTable(
  'week_plan',
  {
    ...base,
    isoWeek: text('iso_week').notNull(),
    status: text('status', { enum: ['draft', 'validated'] })
      .notNull()
      .default('draft'),
    budgetMin: integer('budget_min').notNull(),
    budgetReason: text('budget_reason'),
    proposedAt: text('proposed_at'),
    validatedAt: text('validated_at'),
    closedAt: text('closed_at'), // RB-10 carry-over done
  },
  (t) => [uniqueIndex('week_plan_week_uq').on(t.isoWeek)],
);

export const weekPlanItem = sqliteTable(
  'week_plan_item',
  {
    ...base,
    weekPlanId: text('week_plan_id')
      .notNull()
      .references(() => weekPlan.id),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    kind: text('kind', { enum: ['week', 'bonus'] }).notNull(),
    source: text('source', { enum: ['engine', 'me', 'ai'] }).notNull(),
    score: real('score'),
    why: text('why'),
    position: integer('position').notNull().default(0),
  },
  (t) => [uniqueIndex('week_plan_item_uq').on(t.weekPlanId, t.taskId)],
);

export const report = sqliteTable(
  'report',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['week', 'month', 'quarter'] }).notNull(),
    periodKey: text('period_key').notNull(),
    generatedAt: text('generated_at').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
  },
  (t) => [uniqueIndex('report_period_uq').on(t.kind, t.periodKey)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: text('at').notNull(),
    actor: text('actor').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    diff: text('diff', { mode: 'json' }),
    reviewedAt: text('reviewed_at'),
  },
  (t) => [index('audit_at_idx').on(t.at), index('audit_entity_idx').on(t.entityType, t.entityId)],
);

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

export const apiToken = sqliteTable(
  'api_token',
  {
    ...base,
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    scopes: text('scopes', { enum: ['read', 'read_write'] }).notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [uniqueIndex('api_token_hash_uq').on(t.tokenHash), uniqueIndex('api_token_name_uq').on(t.name)],
);

export const appUser = sqliteTable(
  'app_user',
  {
    ...base,
    login: text('login').notNull(),
    passwordHash: text('password_hash').notNull(),
    lastSeenAt: text('last_seen_at'), // F-25 "depuis ma dernière visite"
  },
  (t) => [uniqueIndex('app_user_login_uq').on(t.login)],
);

export const session = sqliteTable('session', {
  id: text('id').primaryKey(), // sha256 of the cookie value, never the raw value
  userId: text('user_id')
    .notNull()
    .references(() => appUser.id),
  createdAt: text('created_at').notNull().default(now),
  expiresAt: text('expires_at').notNull(),
  previousSeenAt: text('previous_seen_at'), // user's previous visit, for "À revoir · depuis ma dernière visite"
});

// Worker bookkeeping: one row per executed scheduled job and period (idempotence).
export const jobRun = sqliteTable(
  'job_run',
  {
    id: text('id').primaryKey(),
    job: text('job').notNull(),
    periodKey: text('period_key').notNull(),
    ranAt: text('ran_at').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    error: text('error'),
  },
  (t) => [uniqueIndex('job_run_uq').on(t.job, t.periodKey)],
);
