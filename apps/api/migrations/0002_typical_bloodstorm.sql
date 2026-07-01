CREATE TABLE `plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`version` integer NOT NULL,
	`plan` text,
	`label` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plan_versions_plan_id_idx` ON `plan_versions` (`plan_id`);--> statement-breakpoint
ALTER TABLE `plans` ADD `version` integer DEFAULT 1 NOT NULL;