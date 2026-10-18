-- Apply once to an empty Supabase project. Existing D1 records are imported separately.
BEGIN;

CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"task_id" text NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"reporter" text NOT NULL,
	"created_at" text NOT NULL
);


CREATE INDEX "events_task" ON "events" ("owner","task_id");

CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"task_key" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"next_step" text DEFAULT '' NOT NULL,
	"blocker" text DEFAULT '' NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"next_check_at" text,
	"updated_at" text NOT NULL,
	"created_at" text NOT NULL,
	"reporter" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);


CREATE INDEX "tasks_owner" ON "tasks" ("owner");
ALTER TABLE "events" ADD "action_owner" text DEFAULT 'unknown' NOT NULL;

ALTER TABLE "tasks" ADD "action_owner" text DEFAULT 'unknown' NOT NULL;
CREATE TABLE "task_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"task_id" text NOT NULL,
	"read_version" integer DEFAULT 0 NOT NULL
);


CREATE INDEX "task_reads_owner" ON "task_reads" ("owner");

ALTER TABLE "events" ADD "kind" text DEFAULT 'progress' NOT NULL;

ALTER TABLE "events" ADD "change_note" text DEFAULT '' NOT NULL;

ALTER TABLE "events" ADD "changed_fields" text DEFAULT '[]' NOT NULL;

ALTER TABLE "events" ADD "details" text DEFAULT '' NOT NULL;

ALTER TABLE "tasks" ADD "details" text DEFAULT '' NOT NULL;

ALTER TABLE "tasks" ADD "source_label" text DEFAULT '' NOT NULL;

ALTER TABLE "tasks" ADD "conversation_url" text DEFAULT '' NOT NULL;

ALTER TABLE "tasks" ADD "related_task_key" text DEFAULT '' NOT NULL;

ALTER TABLE "tasks" ADD "attention_version" integer DEFAULT 1 NOT NULL;

ALTER TABLE "tasks" ADD "progress_at" text DEFAULT '' NOT NULL;

ALTER TABLE "tasks" ADD "progress_reporter" text DEFAULT '' NOT NULL;

UPDATE tasks SET progress_at=updated_at, progress_reporter=reporter;


INSERT INTO task_reads(id,owner,task_id,read_version) SELECT id,owner,id,attention_version FROM tasks;

ALTER TABLE tasks ADD COLUMN area_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN planned_on TEXT;
ALTER TABLE tasks ADD COLUMN deadline TEXT;
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN checklist TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT '';
CREATE TABLE areas (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX areas_owner ON areas(owner);
CREATE TABLE projects (id TEXT PRIMARY KEY, owner TEXT NOT NULL, area_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX projects_owner ON projects(owner);
CREATE TABLE comments (id TEXT PRIMARY KEY, owner TEXT NOT NULL, target_type TEXT NOT NULL CHECK(target_type IN ('task','project')), target_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reference','request','reply')), body TEXT NOT NULL, author TEXT NOT NULL, author_kind TEXT NOT NULL CHECK(author_kind IN ('user','agent')), request_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX comments_target ON comments(owner,target_type,target_key,created_at,id);
CREATE TABLE requests (id TEXT PRIMARY KEY, owner TEXT NOT NULL, comment_id TEXT NOT NULL, target_type TEXT NOT NULL, target_key TEXT NOT NULL, agent_id TEXT NOT NULL DEFAULT 'dot', state TEXT NOT NULL CHECK(state IN ('queued','acknowledged','answered','cancelled')), acknowledged_at TEXT, answered_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX requests_inbox ON requests(owner,agent_id,state,created_at);
CREATE TABLE subscriptions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, arguments TEXT NOT NULL, callback_url TEXT NOT NULL, secret TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX subscriptions_identity ON subscriptions(owner,name,arguments,callback_url);
CREATE TABLE deliveries (id TEXT PRIMARY KEY, owner TEXT NOT NULL, subscription_id TEXT NOT NULL, request_id TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, last_error TEXT NOT NULL DEFAULT '', delivered_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX deliveries_pending ON deliveries(owner,state,next_attempt_at);
CREATE TABLE attachments (id TEXT PRIMARY KEY, owner TEXT NOT NULL, target_type TEXT NOT NULL, target_key TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, object_key TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX attachments_target ON attachments(owner,target_type,target_key);


CREATE TABLE maintenance_runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, lease_until TEXT NOT NULL, result TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
CREATE INDEX maintenance_owner ON maintenance_runs(owner,updated_at);

ALTER TABLE public.maintenance_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maintenance_runs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_runs TO service_role;

-- Application data is accessed only by the authenticated application server.

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tasks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO service_role;

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO service_role;

ALTER TABLE public.task_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_reads FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_reads TO service_role;

ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.areas FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.areas TO service_role;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projects FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO service_role;

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO service_role;

ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.requests TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;

ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deliveries FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO service_role;

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attachments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attachments TO service_role;


-- Private compatibility adapter. Never grant this RPC to browser or agent identities.
-- Every call is one transaction; the shared lock also makes exports consistent
-- with all application writes. Values are quoted by PostgreSQL, never interpolated by callers.
CREATE OR REPLACE FUNCTION public.desk_query(statements jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE statement jsonb; query text; pieces text[]; params jsonb; rendered text; rows jsonb;
  output jsonb := '[]'::jsonb; affected integer := 0; i integer; is_read boolean;
BEGIN
  IF jsonb_typeof(statements) <> 'array' OR jsonb_array_length(statements) > 10000 THEN
    RAISE EXCEPTION 'Invalid statement batch';
  END IF;
  PERFORM pg_advisory_xact_lock(713501);
  FOR statement IN SELECT value FROM jsonb_array_elements(statements) LOOP
    query := statement->>'sql'; params := COALESCE(statement->'params','[]'::jsonb);
    IF query IS NULL OR length(query) > 100000 OR query LIKE '%;%' OR query !~* '^\s*(SELECT|INSERT|UPDATE|DELETE)\s' THEN
      RAISE EXCEPTION 'Unsupported application statement';
    END IF;
    query := replace(query,'MAX(task_reads.read_version,excluded.read_version)','GREATEST(task_reads.read_version,excluded.read_version)');
    query := replace(query,'rowid DESC','id DESC');
    query := replace(query,'GROUP_CONCAT(body,'' '')','string_agg(body,'' '')');
    query := replace(query,'changes()',affected::text);
    pieces := string_to_array(query,'?');
    IF cardinality(pieces)-1 <> jsonb_array_length(params) THEN RAISE EXCEPTION 'Parameter count mismatch'; END IF;
    rendered := pieces[1];
    IF cardinality(pieces)>1 THEN
      FOR i IN 1..cardinality(pieces)-1 LOOP
        rendered := rendered || COALESCE(quote_literal(params->>(i-1)),'NULL') || pieces[i+1];
      END LOOP;
    END IF;
    is_read := rendered ~* '^\s*SELECT\s';
    IF is_read THEN
      EXECUTE 'SELECT COALESCE(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM ('||rendered||') q' INTO rows;
      affected := 0;
    ELSE
      EXECUTE 'WITH q AS ('||rendered||' RETURNING *) SELECT COALESCE(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM q' INTO rows;
      affected := jsonb_array_length(rows);
    END IF;
    output := output || jsonb_build_array(jsonb_build_object('results',rows,'meta',jsonb_build_object('changes',affected)));
  END LOOP;
  RETURN output;
END;
$$;
REVOKE ALL ON FUNCTION public.desk_query(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_query(jsonb) TO service_role;
COMMIT;
