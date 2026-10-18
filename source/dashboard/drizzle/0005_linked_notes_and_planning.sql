CREATE TABLE `note_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`note_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `note_links_target` ON `note_links` (`owner`,`target_type`,`target_key`);--> statement-breakpoint
CREATE INDEX `note_links_note` ON `note_links` (`owner`,`note_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`daily_on` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_change_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_owner` ON `notes` (`owner`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notes_daily` ON `notes` (`owner`,`daily_on`);--> statement-breakpoint
CREATE TABLE `planning_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `planning_changes_entity` ON `planning_changes` (`owner`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`filters` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_change_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_views_owner` ON `saved_views` (`owner`);--> statement-breakpoint
CREATE TABLE `time_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`task_key` text NOT NULL,
	`starts_at` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`timezone` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_change_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `time_blocks_owner` ON `time_blocks` (`owner`,`starts_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`target_type` text NOT NULL,
	`target_key` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`author` text NOT NULL,
	`author_kind` text NOT NULL,
	`request_id` text,
	`created_at` text NOT NULL,
	CONSTRAINT "comments_target_type_check" CHECK("__new_comments"."target_type" IN ('task','project','note')),
	CONSTRAINT "comments_kind_check" CHECK("__new_comments"."kind" IN ('reference','request','reply')),
	CONSTRAINT "comments_author_kind_check" CHECK("__new_comments"."author_kind" IN ('user','agent'))
);
--> statement-breakpoint
INSERT INTO `__new_comments`("id", "owner", "target_type", "target_key", "kind", "body", "author", "author_kind", "request_id", "created_at") SELECT "id", "owner", "target_type", "target_key", "kind", "body", "author", "author_kind", "request_id", "created_at" FROM `comments`;--> statement-breakpoint
DROP TABLE `comments`;--> statement-breakpoint
ALTER TABLE `__new_comments` RENAME TO `comments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `comments_target` ON `comments` (`owner`,`target_type`,`target_key`,`created_at`,`id`);