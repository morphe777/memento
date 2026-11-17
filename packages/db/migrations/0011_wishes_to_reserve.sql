-- D-171: the wishes become the reserve (« Envies »): every wish still to live becomes an Inbox experience task,
-- its details in the description, before the wish tables go. The rest (planned, lived, archived) already has its task.
INSERT INTO `task` (`id`, `created_by`, `title`, `description`, `duration_min`, `is_experience`, `domain_id`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
		|| substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	w.`created_by`,
	w.`title`,
	trim(
		coalesce(w.`note`, '')
		|| CASE WHEN w.`url` IS NOT NULL THEN char(10) || w.`url` ELSE '' END
		|| CASE WHEN w.`start_date` IS NOT NULL THEN char(10) || 'Dates : ' || w.`start_date`
			|| coalesce(' → ' || w.`end_date`, '') ELSE '' END
		|| CASE WHEN w.`price` IS NOT NULL THEN char(10) || 'Prix : ' || w.`price` ELSE '' END
		|| CASE WHEN p.`name` IS NOT NULL THEN char(10) || 'Lieu : ' || p.`name`
			|| CASE WHEN p.`city` <> '' THEN ', ' || p.`city` ELSE '' END ELSE '' END,
		char(10) || ' '
	),
	CASE WHEN w.`duration_min` IN (5, 15, 30, 60, 120) THEN w.`duration_min` END,
	1,
	(SELECT `id` FROM `domain` WHERE `name` = 'Famille' LIMIT 1)
FROM `wish` w
LEFT JOIN `place` p ON p.`id` = w.`place_id`
WHERE w.`status` = 'wish' AND w.`task_id` IS NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_souvenir` (
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
	`source` text DEFAULT 'app' NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`client_capture_id` text,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "souvenir_rating_check" CHECK("__new_souvenir"."rating" is null or "__new_souvenir"."rating" in ('again', 'good', 'meh')),
	CONSTRAINT "souvenir_source_check" CHECK("__new_souvenir"."source" in ('app', 'share', 'import')),
	CONSTRAINT "souvenir_status_check" CHECK("__new_souvenir"."status" in ('draft', 'saved')),
	CONSTRAINT "souvenir_end_date_check" CHECK("__new_souvenir"."end_date" is null or date("__new_souvenir"."end_date") is "__new_souvenir"."end_date")
);
--> statement-breakpoint
INSERT INTO `__new_souvenir`("id", "created_at", "updated_at", "created_by", "task_id", "end_date", "place_id", "phrase", "rating", "cover_photo_id", "source", "status", "client_capture_id") SELECT "id", "created_at", "updated_at", "created_by", "task_id", "end_date", "place_id", "phrase", "rating", "cover_photo_id", "source", "status", "client_capture_id" FROM `souvenir`;--> statement-breakpoint
DROP TABLE `souvenir`;--> statement-breakpoint
ALTER TABLE `__new_souvenir` RENAME TO `souvenir`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `souvenir_task_uq` ON `souvenir` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `souvenir_capture_uq` ON `souvenir` (`client_capture_id`);--> statement-breakpoint
CREATE INDEX `souvenir_place_idx` ON `souvenir` (`place_id`);--> statement-breakpoint
DROP TABLE `wish`;--> statement-breakpoint
DROP TABLE `wish_list`;
