CREATE TABLE `person` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`group` text DEFAULT 'other' NOT NULL,
	`color` text DEFAULT '#7F77DD' NOT NULL,
	`birth_date` text,
	`active` integer DEFAULT true NOT NULL,
	`to_confirm` integer DEFAULT false NOT NULL,
	`alert_after_days` integer,
	`position` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "person_group_check" CHECK("person"."group" in ('family', 'friends', 'other')),
	CONSTRAINT "person_birth_date_check" CHECK("person"."birth_date" is null or date("person"."birth_date") is "person"."birth_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_name_key_uq` ON `person` (`name_key`);--> statement-breakpoint
CREATE TABLE `photo` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`souvenir_id` text NOT NULL,
	`taken_at` text,
	`lat` real,
	`lng` real,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes_full` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`souvenir_id`) REFERENCES `souvenir`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photo_souvenir_idx` ON `photo` (`souvenir_id`);--> statement-breakpoint
CREATE TABLE `place` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`provider` text DEFAULT 'manual' NOT NULL,
	`provider_ref` text,
	`website` text,
	`phone` text,
	CONSTRAINT "place_provider_check" CHECK("place"."provider" in ('osm', 'google', 'manual')),
	CONSTRAINT "place_lat_check" CHECK("place"."lat" between -90 and 90 and "place"."lng" between -180 and 180)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `place_provider_ref_uq` ON `place` (`provider`,`provider_ref`);--> statement-breakpoint
CREATE TABLE `souvenir` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`task_id` text NOT NULL,
	`end_date` text,
	`place_id` text,
	`phrase` text DEFAULT '' NOT NULL,
	`rating` text,
	`cover_photo_id` text,
	`wish_id` text,
	`source` text DEFAULT 'app' NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`client_capture_id` text,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wish_id`) REFERENCES `wish`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "souvenir_rating_check" CHECK("souvenir"."rating" is null or "souvenir"."rating" in ('again', 'good', 'meh')),
	CONSTRAINT "souvenir_source_check" CHECK("souvenir"."source" in ('app', 'share', 'import')),
	CONSTRAINT "souvenir_status_check" CHECK("souvenir"."status" in ('draft', 'saved')),
	CONSTRAINT "souvenir_end_date_check" CHECK("souvenir"."end_date" is null or date("souvenir"."end_date") is "souvenir"."end_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `souvenir_task_uq` ON `souvenir` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `souvenir_capture_uq` ON `souvenir` (`client_capture_id`);--> statement-breakpoint
CREATE INDEX `souvenir_place_idx` ON `souvenir` (`place_id`);--> statement-breakpoint
CREATE TABLE `souvenir_person` (
	`souvenir_id` text NOT NULL,
	`person_id` text NOT NULL,
	PRIMARY KEY(`souvenir_id`, `person_id`),
	FOREIGN KEY (`souvenir_id`) REFERENCES `souvenir`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `souvenir_person_person_idx` ON `souvenir_person` (`person_id`);--> statement-breakpoint
CREATE TABLE `wish` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`title` text NOT NULL,
	`list_id` text,
	`place_id` text,
	`url` text,
	`has_image` integer DEFAULT false NOT NULL,
	`start_date` text,
	`end_date` text,
	`price` text,
	`duration_min` integer,
	`dog_allowed` text DEFAULT 'unknown' NOT NULL,
	`indoor` text DEFAULT 'unknown' NOT NULL,
	`season` text,
	`person_ids` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'wish' NOT NULL,
	`source` text DEFAULT 'plus' NOT NULL,
	`source_meta` text,
	`task_id` text,
	`client_capture_id` text,
	FOREIGN KEY (`list_id`) REFERENCES `wish_list`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "wish_status_check" CHECK("wish"."status" in ('wish', 'planned', 'lived', 'archived')),
	CONSTRAINT "wish_source_check" CHECK("wish"."source" in ('plus', 'share_url', 'share_place', 'ai')),
	CONSTRAINT "wish_dog_check" CHECK("wish"."dog_allowed" in ('yes', 'no', 'unknown')),
	CONSTRAINT "wish_indoor_check" CHECK("wish"."indoor" in ('yes', 'no', 'mixed', 'unknown')),
	CONSTRAINT "wish_start_date_check" CHECK("wish"."start_date" is null or date("wish"."start_date") is "wish"."start_date"),
	CONSTRAINT "wish_end_date_check" CHECK("wish"."end_date" is null or date("wish"."end_date") is "wish"."end_date")
);
--> statement-breakpoint
CREATE INDEX `wish_list_idx` ON `wish` (`list_id`);--> statement-breakpoint
CREATE INDEX `wish_task_idx` ON `wish` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wish_capture_uq` ON `wish` (`client_capture_id`);--> statement-breakpoint
CREATE TABLE `wish_list` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_by` text DEFAULT 'me' NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'star' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL
);
