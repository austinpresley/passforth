import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    taskKey: text('task_key').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    summary: text('summary').notNull(),
    nextStep: text('next_step').notNull().default(''),
    blocker: text('blocker').notNull().default(''),
    sourceUrl: text('source_url').notNull().default(''),
    nextCheckAt: text('next_check_at'),
    updatedAt: text('updated_at').notNull(),
    createdAt: text('created_at').notNull(),
    actionOwner: text('action_owner').notNull().default('unknown'),
    details: text('details').notNull().default(''),
    sourceLabel: text('source_label').notNull().default(''),
    conversationUrl: text('conversation_url').notNull().default(''),
    relatedTaskKey: text('related_task_key').notNull().default(''),
    attentionVersion: integer('attention_version').notNull().default(1),
    progressAt: text('progress_at').notNull().default(''),
    progressReporter: text('progress_reporter').notNull().default(''),
    areaId: text('area_id').notNull().default(''),
    projectId: text('project_id').notNull().default(''),
    plannedOn: text('planned_on'),
    deadline: text('deadline'),
    priority: integer('priority').notNull().default(0),
    checklist: text('checklist').notNull().default('[]'),
    tags: text('tags').notNull().default(''),
    reporter: text('reporter').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [index('tasks_owner').on(t.owner)],
);
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    taskId: text('task_id').notNull(),
    status: text('status').notNull(),
    summary: text('summary').notNull(),
    actionOwner: text('action_owner').notNull().default('unknown'),
    reporter: text('reporter').notNull(),
    createdAt: text('created_at').notNull(),
    kind: text('kind').notNull().default('progress'),
    changeNote: text('change_note').notNull().default(''),
    changedFields: text('changed_fields').notNull().default('[]'),
    details: text('details').notNull().default(''),
  },
  (t) => [index('events_task').on(t.owner, t.taskId)],
);
export const taskReads = sqliteTable(
  'task_reads',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    taskId: text('task_id').notNull(),
    readVersion: integer('read_version').notNull().default(0),
  },
  (t) => [index('task_reads_owner').on(t.owner)],
);

export const areas = sqliteTable(
  'areas',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    title: text('title').notNull(),
    version: integer('version').notNull().default(1),
    archived: integer('archived').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('areas_owner').on(t.owner)],
);
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    areaId: text('area_id').notNull().default(''),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    version: integer('version').notNull().default(1),
    archived: integer('archived').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('projects_owner').on(t.owner)],
);
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    targetType: text('target_type').notNull(),
    targetKey: text('target_key').notNull(),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    author: text('author').notNull(),
    authorKind: text('author_kind').notNull(),
    requestId: text('request_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check(
      'comments_target_type_check',
      sql`${t.targetType} IN ('task','project','note')`,
    ),
    check(
      'comments_kind_check',
      sql`${t.kind} IN ('reference','request','reply')`,
    ),
    check(
      'comments_author_kind_check',
      sql`${t.authorKind} IN ('user','agent')`,
    ),
    index('comments_target').on(
      t.owner,
      t.targetType,
      t.targetKey,
      t.createdAt,
      t.id,
    ),
  ],
);
export const requests = sqliteTable(
  'requests',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    commentId: text('comment_id').notNull(),
    targetType: text('target_type').notNull(),
    targetKey: text('target_key').notNull(),
    agentId: text('agent_id').notNull().default('dot'),
    state: text('state').notNull(),
    acknowledgedAt: text('acknowledged_at'),
    answeredAt: text('answered_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check(
      'requests_state_check',
      sql`${t.state} IN ('queued','acknowledged','answered','cancelled')`,
    ),
    index('requests_inbox').on(t.owner, t.agentId, t.state, t.createdAt),
  ],
);
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    arguments: text('arguments').notNull(),
    callbackUrl: text('callback_url').notNull(),
    secret: text('secret').notNull(),
    expiresAt: text('expires_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('subscriptions_identity').on(
      t.owner,
      t.name,
      t.arguments,
      t.callbackUrl,
    ),
  ],
);
export const deliveries = sqliteTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    subscriptionId: text('subscription_id').notNull(),
    requestId: text('request_id').notNull(),
    body: text('body').notNull(),
    state: text('state').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lastError: text('last_error').notNull().default(''),
    deliveredAt: text('delivered_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('deliveries_pending').on(t.owner, t.state, t.nextAttemptAt)],
);
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    targetType: text('target_type').notNull(),
    targetKey: text('target_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    objectKey: text('object_key').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('attachments_target').on(t.owner, t.targetType, t.targetKey)],
);

export const maintenanceRuns = sqliteTable(
  'maintenance_runs',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    state: text('state').notNull(),
    leaseUntil: text('lease_until').notNull(),
    result: text('result').notNull().default(''),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('maintenance_owner').on(t.owner, t.updatedAt)],
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    tags: text('tags').notNull().default(''),
    dailyOn: text('daily_on'),
    archived: integer('archived').notNull().default(0),
    version: integer('version').notNull().default(1),
    lastChangeId: text('last_change_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('notes_owner').on(t.owner, t.updatedAt),
    uniqueIndex('notes_daily').on(t.owner, t.dailyOn),
  ],
);
export const noteLinks = sqliteTable(
  'note_links',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    noteId: text('note_id').notNull(),
    targetType: text('target_type').notNull(),
    targetKey: text('target_key').notNull(),
  },
  (t) => [
    index('note_links_target').on(t.owner, t.targetType, t.targetKey),
    index('note_links_note').on(t.owner, t.noteId),
  ],
);
export const savedViews = sqliteTable(
  'saved_views',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    title: text('title').notNull(),
    filters: text('filters').notNull(),
    archived: integer('archived').notNull().default(0),
    version: integer('version').notNull().default(1),
    lastChangeId: text('last_change_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('saved_views_owner').on(t.owner)],
);
export const timeBlocks = sqliteTable(
  'time_blocks',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    taskKey: text('task_key').notNull(),
    startsAt: text('starts_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    timezone: text('timezone').notNull(),
    archived: integer('archived').notNull().default(0),
    version: integer('version').notNull().default(1),
    lastChangeId: text('last_change_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('time_blocks_owner').on(t.owner, t.startsAt)],
);
export const planningChanges = sqliteTable(
  'planning_changes',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    payload: text('payload').notNull(),
    result: text('result').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('planning_changes_entity').on(t.owner, t.entityType, t.entityId),
  ],
);
