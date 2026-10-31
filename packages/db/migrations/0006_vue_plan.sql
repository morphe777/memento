ALTER TABLE `audit_log` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `meta_objective` ADD `outcome_title` text;--> statement-breakpoint
ALTER TABLE `meta_objective` ADD `primary_domain_id` text REFERENCES domain(id);--> statement-breakpoint
ALTER TABLE `objective` ADD `outcome_title` text;