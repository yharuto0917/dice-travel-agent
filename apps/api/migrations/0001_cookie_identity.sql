PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text,
	`destination_pref_code` text,
	`destination_pref` text,
	`conditions` text,
	`plan` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_plans`("id", "client_id", "status", "title", "destination_pref_code", "destination_pref", "conditions", "plan", "created_at", "updated_at") SELECT "id", "user_id", "status", "title", "destination_pref_code", "destination_pref", "conditions", "plan", "created_at", "updated_at" FROM `plans`;--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
ALTER TABLE `__new_plans` RENAME TO `plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `plans_client_id_idx` ON `plans` (`client_id`);--> statement-breakpoint
DROP TABLE `rate_limits`;--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`client_id` text NOT NULL,
	`scope` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`client_id`, `scope`, `day`)
);
--> statement-breakpoint
DROP TABLE `users`;
