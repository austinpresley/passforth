-- Forward migration for linked notes, synced views and weekly planning.
BEGIN;
CREATE TABLE "note_links" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"note_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_key" text NOT NULL
);

CREATE INDEX "note_links_target" ON "note_links" ("owner","target_type","target_key");
CREATE INDEX "note_links_note" ON "note_links" ("owner","note_id");
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tags" text DEFAULT '' NOT NULL,
	"daily_on" text,
	"archived" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_change_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE INDEX "notes_owner" ON "notes" ("owner","updated_at");
CREATE UNIQUE INDEX "notes_daily" ON "notes" ("owner","daily_on");
CREATE TABLE "planning_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" text NOT NULL,
	"result" text NOT NULL,
	"created_at" text NOT NULL
);

CREATE INDEX "planning_changes_entity" ON "planning_changes" ("owner","entity_type","entity_id");
CREATE TABLE "saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"title" text NOT NULL,
	"filters" text NOT NULL,
	"archived" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_change_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE INDEX "saved_views_owner" ON "saved_views" ("owner");
CREATE TABLE "time_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"task_key" text NOT NULL,
	"starts_at" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"timezone" text NOT NULL,
	"archived" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_change_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);

CREATE INDEX "time_blocks_owner" ON "time_blocks" ("owner","starts_at");

ALTER TABLE comments DROP CONSTRAINT comments_target_type_check;
ALTER TABLE comments ADD CONSTRAINT comments_target_type_check CHECK(target_type IN ('task','project','note'));

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO service_role;

ALTER TABLE public.note_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.note_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.note_links TO service_role;

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saved_views FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO service_role;

ALTER TABLE public.time_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.time_blocks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_blocks TO service_role;

ALTER TABLE public.planning_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planning_changes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planning_changes TO service_role;

COMMIT;
