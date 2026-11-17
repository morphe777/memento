// Mémento database schema (SQLite). Dossier de dev §4, adapted to SQLite (see docs/DECISIONS.md).
// Every business table carries id (UUID text), created_at, updated_at, created_by ('me' | 'ai:<token>').
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
  position: integer('position').notNull().default(0), // D-69: order of the lanes on the map
  outcomeTitle: text('outcome_title'), // DM-113: title rephrased as a result (Vue Plan), ≤ 80 chars
  primaryDomainId: text('primary_domain_id').references(() => domain.id), // DM-114: domain filter of the Vue Plan
  motive: text('motive').notNull().default(''), // D-100: the « why » in a few words, keyword in **bold** (Cap)
});

export const objective = sqliteTable(
  'objective',
  {
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
    // D-62: a recurring objective is renewed (next quarter / next year) when it is closed.
    recurrence: text('recurrence', { enum: ['quarterly', 'yearly'] }),
    previousId: text('previous_id'), // the occurrence this one renews
    position: integer('position').notNull().default(0), // D-69: order inside a (meta-objective, quarter) cell
    outcomeTitle: text('outcome_title'), // DM-113
    motive: text('motive').notNull().default(''), // D-100
  },
  (t) => [index('objective_quarter_idx').on(t.quarter)], // M-19
);

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
    // D-62: a recurring project is renewed (copy with its tasks, planned for the next period) when completed.
    recurrence: text('recurrence', { enum: ['monthly', 'quarterly', 'yearly'] }),
    previousId: text('previous_id'), // the occurrence this one renews
    success: integer('success', { mode: 'boolean' }),
    completedAt: text('completed_at'),
    replannedAt: text('replanned_at'), // RB-16 baseline (trace kept in audit_log and frozen reports)
    replanDoneMin: integer('replan_done_min'),
    lastTouchedAt: text('last_touched_at').notNull().default(now),
    description: text('description').notNull().default(''),
    motive: text('motive').notNull().default(''), // D-100
  },
  (t) => [
    index('project_status_idx').on(t.status),
    index('project_objective_idx').on(t.objectiveId),
    index('project_month_idx').on(t.monthFlag), // M-19
  ],
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
  (t) => [primaryKey({ columns: [t.projectId, t.groupId] }), index('project_group_group_idx').on(t.groupId)],
);

export const task = sqliteTable(
  'task',
  {
    ...base,
    projectId: text('project_id').references(() => project.id), // null = Inbox
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    durationMin: integer('duration_min'), // 5 | 15 | 30 | 60 | 120, nullable for ideas (RB-03)
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
    // D-61: time actually spent (minutes), entered when it differs from the estimate. Null = as estimated.
    actualMin: integer('actual_min'),
  },
  (t) => [
    index('task_project_idx').on(t.projectId),
    index('task_status_idx').on(t.status),
    index('task_due_idx').on(t.dueDate), // M-19
    index('task_done_idx').on(t.doneAt),
  ],
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
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    index('task_dep_on_idx').on(t.dependsOnTaskId),
  ],
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
  (t) => [
    primaryKey({ columns: [t.projectId, t.dependsOnProjectId] }),
    index('project_dep_on_idx').on(t.dependsOnProjectId),
  ],
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
    // D-99: 'unplanned' = done during the week without having been planned (« hors planification »).
    kind: text('kind', { enum: ['week', 'bonus', 'unplanned'] }).notNull(),
    source: text('source', { enum: ['engine', 'me', 'ai'] }).notNull(),
    score: real('score'),
    why: text('why'),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('week_plan_item_uq').on(t.weekPlanId, t.taskId),
    index('week_plan_item_task_idx').on(t.taskId),
  ],
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
    batchId: text('batch_id'), // API-08: the writes of one applied plan draft share a batch
  },
  (t) => [
    index('audit_at_idx').on(t.at),
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_reviewed_idx').on(t.reviewedAt), // M-19
  ],
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
    scopes: text('scopes', { enum: ['read', 'read_write', 'capture'] }).notNull(),
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

// D-117: every notice sent (evening recap, report ready), readable in the app (bell) and opened by the push.
export const notification = sqliteTable(
  'notification',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['daily', 'report', 'job'] }).notNull(),
    title: text('title').notNull(),
    html: text('html').notNull(), // Telegram HTML subset, as sent
    url: text('url'), // what it is about (a report), if anything
    createdAt: text('created_at').notNull().default(now),
    readAt: text('read_at'),
  },
  (t) => [index('notification_created_idx').on(t.createdAt), index('notification_read_idx').on(t.readAt)],
);

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

// ---------- Souvenirs (EX-xx / EXA-xx, D-157 to D-171; the wishes are the reserve of experience tasks) ----------

// EX-30: the people of the souvenirs, managed in Configuration. A name typed in « + quelqu'un d'autre » is created
// `to_confirm` (CE-08) and offered again at the next capture.
export const person = sqliteTable(
  'person',
  {
    ...base,
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(), // lower-cased name: case-insensitive uniqueness
    group: text('group', { enum: ['family', 'friends', 'other'] })
      .notNull()
      .default('other'),
    color: text('color').notNull().default('#7F77DD'),
    birthDate: text('birth_date'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    toConfirm: integer('to_confirm', { mode: 'boolean' }).notNull().default(false),
    alertAfterDays: integer('alert_after_days'), // QE-07: soft alert in the reports, off when null
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('person_name_key_uq').on(t.nameKey),
    check('person_group_check', sql`${t.group} in ('family', 'friends', 'other')`),
    check('person_birth_date_check', sql`${t.birthDate} is null or date(${t.birthDate}) is ${t.birthDate}`),
  ],
);

// EX-13: places remembered once, reused by the souvenirs. One provider reference = one place.
export const place = sqliteTable(
  'place',
  {
    ...base,
    name: text('name').notNull(),
    category: text('category').notNull().default('other'),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    address: text('address').notNull().default(''),
    city: text('city').notNull().default(''),
    provider: text('provider', { enum: ['osm', 'google', 'manual'] })
      .notNull()
      .default('manual'),
    providerRef: text('provider_ref'),
    website: text('website'),
    phone: text('phone'),
  },
  (t) => [
    uniqueIndex('place_provider_ref_uq').on(t.provider, t.providerRef),
    check('place_provider_check', sql`${t.provider} in ('osm', 'google', 'manual')`),
    check('place_lat_check', sql`${t.lat} between -90 and 90 and ${t.lng} between -180 and 180`),
  ],
);

// EX-11: the souvenir of a lived experience task (1–1). Title, domain, project, start (done_at) stay on the task.
export const souvenir = sqliteTable(
  'souvenir',
  {
    ...base,
    taskId: text('task_id')
      .notNull()
      .references(() => task.id),
    endDate: text('end_date'), // a souvenir over several days ends that day (CE-04); null = one day
    placeId: text('place_id').references(() => place.id),
    phrase: text('phrase').notNull().default(''),
    rating: text('rating', { enum: ['again', 'good', 'meh'] }),
    coverPhotoId: text('cover_photo_id'),
    source: text('source', { enum: ['app', 'share', 'import'] })
      .notNull()
      .default('app'),
    status: text('status', { enum: ['draft', 'saved'] })
      .notNull()
      .default('saved'),
    clientCaptureId: text('client_capture_id'),
  },
  (t) => [
    uniqueIndex('souvenir_task_uq').on(t.taskId),
    uniqueIndex('souvenir_capture_uq').on(t.clientCaptureId),
    index('souvenir_place_idx').on(t.placeId),
    check('souvenir_rating_check', sql`${t.rating} is null or ${t.rating} in ('again', 'good', 'meh')`),
    check('souvenir_source_check', sql`${t.source} in ('app', 'share', 'import')`),
    check('souvenir_status_check', sql`${t.status} in ('draft', 'saved')`),
    check('souvenir_end_date_check', sql`${t.endDate} is null or date(${t.endDate}) is ${t.endDate}`),
  ],
);

export const souvenirPerson = sqliteTable(
  'souvenir_person',
  {
    souvenirId: text('souvenir_id')
      .notNull()
      .references(() => souvenir.id),
    personId: text('person_id')
      .notNull()
      .references(() => person.id),
  },
  (t) => [
    primaryKey({ columns: [t.souvenirId, t.personId] }),
    index('souvenir_person_person_idx').on(t.personId),
  ],
);

// EX-20: a photo of a souvenir. The files (full 2560, medium 1280, thumb 480, WebP, no EXIF) live in the photos
// folder; date and position read before compression are kept here only (CE-22).
export const photo = sqliteTable(
  'photo',
  {
    ...base,
    souvenirId: text('souvenir_id')
      .notNull()
      .references(() => souvenir.id),
    takenAt: text('taken_at'),
    lat: real('lat'),
    lng: real('lng'),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytesFull: integer('bytes_full').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('photo_souvenir_idx').on(t.souvenirId)],
);
