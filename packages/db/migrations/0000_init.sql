CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_hash_uq` ON `api_token` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_name_uq` ON `api_token` (`name`);--> statement-breakpoint
CREATE TABLE `app_user` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`login` text NOT NULL,
	`password_hash` text NOT NULL,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_user_login_uq` ON `app_user` (`login`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`diff` text,
	`reviewed_at` text
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `domain` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`name` text NOT NULL,
	`color_light` text NOT NULL,
	`color_dark` text NOT NULL,
	`priority_rank` integer NOT NULL,
	`weight` real NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_rank_uq` ON `domain` (`priority_rank`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_name_uq` ON `domain` (`name`);--> statement-breakpoint
CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`domain_id` text NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domain`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_name_key_uq` ON `group` (`name_key`);--> statement-breakpoint
CREATE TABLE `job_run` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`period_key` text NOT NULL,
	`ran_at` text NOT NULL,
	`ok` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_run_uq` ON `job_run` (`job`,`period_key`);--> statement-breakpoint
CREATE TABLE `meta_objective` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`horizon_date` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `objective` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`meta_objective_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`smart_indicator` text DEFAULT '' NOT NULL,
	`smart_target` text DEFAULT '' NOT NULL,
	`smart_current` text DEFAULT '' NOT NULL,
	`progress_pct` integer DEFAULT 0 NOT NULL,
	`deadline` text NOT NULL,
	`quarter` text NOT NULL,
	`criticality` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`meta_objective_id`) REFERENCES `meta_objective`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'idea' NOT NULL,
	`objective_id` text,
	`position_in_objective` integer DEFAULT 0 NOT NULL,
	`is_free` integer DEFAULT false NOT NULL,
	`sequence_mode` text DEFAULT 'sequential' NOT NULL,
	`primary_domain_id` text,
	`success_criterion` text DEFAULT '' NOT NULL,
	`start_date` text,
	`due_date` text,
	`month_flag` text,
	`success` integer,
	`completed_at` text,
	`replanned_at` text,
	`replan_done_min` integer,
	`last_touched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`objective_id`) REFERENCES `objective`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_domain_id`) REFERENCES `domain`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_status_idx` ON `project` (`status`);--> statement-breakpoint
CREATE INDEX `project_objective_idx` ON `project` (`objective_id`);--> statement-breakpoint
CREATE TABLE `project_dependency` (
	`project_id` text NOT NULL,
	`depends_on_project_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `depends_on_project_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_group` (
	`project_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `group_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `report` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`period_key` text NOT NULL,
	`generated_at` text NOT NULL,
	`payload` text NOT NULL,
	`schema_version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_period_uq` ON `report` (`kind`,`period_key`);--> statement-breakpoint
CREATE TABLE `resource_link` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `resource_owner_idx` ON `resource_link` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`duration_min` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`is_free` integer DEFAULT false NOT NULL,
	`is_experience` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`due_date` text,
	`recurrence_rule` text,
	`domain_id` text,
	`postpone_count` integer DEFAULT 0 NOT NULL,
	`done_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`domain_id`) REFERENCES `domain`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_project_idx` ON `task` (`project_id`);--> statement-breakpoint
CREATE INDEX `task_status_idx` ON `task` (`status`);--> statement-breakpoint
CREATE TABLE `task_dependency` (
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_task_id`),
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `week_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`iso_week` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`budget_min` integer NOT NULL,
	`budget_reason` text,
	`proposed_at` text,
	`validated_at` text,
	`closed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `week_plan_week_uq` ON `week_plan` (`iso_week`);--> statement-breakpoint
CREATE TABLE `week_plan_item` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`week_plan_id` text NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`score` real,
	`why` text,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`week_plan_id`) REFERENCES `week_plan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `week_plan_item_uq` ON `week_plan_item` (`week_plan_id`,`task_id`);