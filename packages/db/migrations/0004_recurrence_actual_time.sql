ALTER TABLE `objective` ADD `recurrence` text;--> statement-breakpoint
ALTER TABLE `objective` ADD `previous_id` text;--> statement-breakpoint
ALTER TABLE `project` ADD `recurrence` text;--> statement-breakpoint
ALTER TABLE `project` ADD `previous_id` text;--> statement-breakpoint
ALTER TABLE `task` ADD `actual_min` integer;