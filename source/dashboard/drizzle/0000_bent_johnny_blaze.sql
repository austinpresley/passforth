CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`reporter` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_task` ON `events` (`owner`,`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`task_key` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`next_step` text DEFAULT '' NOT NULL,
	`blocker` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`next_check_at` text,
	`updated_at` text NOT NULL,
	`created_at` text NOT NULL,
	`reporter` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_owner` ON `tasks` (`owner`);