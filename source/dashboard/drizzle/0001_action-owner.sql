ALTER TABLE `events` ADD `action_owner` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `action_owner` text DEFAULT 'unknown' NOT NULL;