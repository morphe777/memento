ALTER TABLE `project` ADD `previous_month_flag` text;--> statement-breakpoint
-- Decision D-42: « actif » now means « projet du mois ». Active projects not flagged for the current month
-- become « prêt » (backlog). Month in Paris time is close enough to UTC at migration time.
UPDATE `project` SET `status` = 'ready', `month_flag` = NULL
WHERE `status` = 'active' AND (`month_flag` IS NULL OR `month_flag` <> strftime('%Y-%m', 'now'));
