CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`html` text NOT NULL,
	`url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE INDEX `notification_created_idx` ON `notification` (`created_at`);