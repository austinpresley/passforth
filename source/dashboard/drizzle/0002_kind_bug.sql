CREATE TABLE `task_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`task_id` text NOT NULL,
	`read_version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_reads_owner` ON `task_reads` (`owner`);--> statement-breakpoint
ALTER TABLE `events` ADD `kind` text DEFAULT 'progress' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `change_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `changed_fields` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `details` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `details` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `conversation_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `related_task_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `attention_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `progress_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `progress_reporter` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE tasks SET progress_at=updated_at, progress_reporter=reporter;
--> statement-breakpoint
INSERT INTO task_reads(id,owner,task_id,read_version) SELECT id,owner,id,attention_version FROM tasks;
