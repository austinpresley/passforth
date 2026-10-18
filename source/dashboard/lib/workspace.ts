import { z } from 'zod';
import { db, listTasks } from './tasks';
import { planningState, requirePlanningTarget } from './planning';

const key = z.string().min(1).max(200);
const target = {
  target_type: z.enum(['task', 'project', 'note']),
  target_key: key,
};
export const commentSchema = z
  .object({
    ...target,
    body: z.string().trim().min(1).max(20000),
    kind: z.enum(['reference', 'request']),
    event_id: key,
    agent_id: z
      .string()
      .regex(/^[a-z0-9_-]{1,80}$/)
      .default('dot'),
  })
  .strict();
const tables = [
  'tasks',
  'events',
  'task_reads',
  'areas',
  'projects',
  'comments',
  'requests',
  'attachments',
  'notes',
  'note_links',
  'saved_views',
  'time_blocks',
  'planning_changes',
] as const;
export async function requireTarget(
  owner: string,
  type: 'task' | 'project' | 'note',
  value: string,
) {
  await requirePlanningTarget(owner, type, value);
}
export async function workspace(owner: string) {
  const [areas, projects, requests] = await Promise.all([
    db()
      .prepare('SELECT * FROM areas WHERE owner=? ORDER BY archived,title,id')
      .bind(owner)
      .all(),
    db()
      .prepare(
        'SELECT * FROM projects WHERE owner=? ORDER BY archived,title,id',
      )
      .bind(owner)
      .all(),
    inbox(owner),
  ]);
  return {
    areas: areas.results,
    projects: projects.results,
    requests,
    delivery: await deliveryStatus(owner),
    ...(await planningState(owner)),
  };
}
export async function conversation(
  owner: string,
  type: 'task' | 'project' | 'note',
  value: string,
) {
  await requireTarget(owner, type, value);
  const comments = await db()
    .prepare(
      `SELECT comments.*, requests.state AS request_state, requests.acknowledged_at, requests.answered_at,
    requests.agent_id FROM comments LEFT JOIN requests ON requests.id=comments.request_id AND requests.owner=comments.owner
    WHERE comments.owner=? AND comments.target_type=? AND comments.target_key=? ORDER BY comments.created_at,comments.id`,
    )
    .bind(owner, type, value)
    .all();
  const files = await db()
    .prepare(
      'SELECT id,filename,content_type,byte_size,created_at FROM attachments WHERE owner=? AND target_type=? AND target_key=? ORDER BY created_at,id',
    )
    .bind(owner, type, value)
    .all();
  return { comments: comments.results, attachments: files.results };
}
export async function addComment(owner: string, raw: unknown) {
  const value = commentSchema.parse(raw);
  await requireTarget(owner, value.target_type, value.target_key);
  const id = owner + ':' + value.event_id;
  const prior = await db()
    .prepare('SELECT * FROM comments WHERE owner=? AND id=?')
    .bind(owner, id)
    .first();
  if (prior) {
    if (
      prior.body !== value.body ||
      prior.kind !== value.kind ||
      prior.target_type !== value.target_type ||
      prior.target_key !== value.target_key
    )
      throw Object.assign(
        new Error('This save identifier belongs to another comment.'),
        { status: 409 },
      );
    return { comment: prior, duplicate: true };
  }
  const now = new Date().toISOString();
  const statements = [
    db()
      .prepare(
        `INSERT INTO comments(id,owner,target_type,target_key,kind,body,author,author_kind,request_id,created_at)
    VALUES(?,?,?,?,?,?,?,'user',?,?) ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        id,
        owner,
        value.target_type,
        value.target_key,
        value.kind,
        value.body,
        'You',
        value.kind === 'request' ? id : null,
        now,
      ),
  ];
  if (value.kind === 'request')
    statements.push(
      db()
        .prepare(
          `INSERT INTO requests(id,owner,comment_id,target_type,target_key,agent_id,state,created_at)
    VALUES(?,?,?,?,?,?,'queued',?) ON CONFLICT(id) DO NOTHING`,
        )
        .bind(
          id,
          owner,
          id,
          value.target_type,
          value.target_key,
          value.agent_id,
          now,
        ),
    );
  await db().batch(statements);
  const saved = await db()
    .prepare('SELECT * FROM comments WHERE owner=? AND id=?')
    .bind(owner, id)
    .first();
  if (
    saved?.body !== value.body ||
    saved?.kind !== value.kind ||
    saved?.target_key !== value.target_key ||
    saved?.target_type !== value.target_type
  )
    throw Object.assign(
      new Error('A different comment used this identifier. Refresh and retry.'),
      { status: 409 },
    );
  return { comment: saved, duplicate: false };
}
export async function inbox(owner: string, agent = '') {
  return (
    await db()
      .prepare(
        `SELECT requests.*,comments.body FROM requests JOIN comments ON requests.comment_id=comments.id AND requests.owner=comments.owner
    WHERE requests.owner=? AND requests.state IN ('queued','acknowledged') ${agent ? 'AND requests.agent_id=?' : ''} ORDER BY requests.created_at,requests.id`,
      )
      .bind(...(agent ? [owner, agent] : [owner]))
      .all()
  ).results;
}
export async function acknowledge(owner: string, raw: unknown) {
  const value = z
    .object({
      request_id: key,
      agent_id: z
        .string()
        .regex(/^[a-z0-9_-]{1,80}$/)
        .default('dot'),
    })
    .strict()
    .parse(raw);
  const request = await db()
    .prepare('SELECT * FROM requests WHERE owner=? AND id=? AND agent_id=?')
    .bind(owner, value.request_id, value.agent_id)
    .first();
  if (!request)
    throw Object.assign(new Error('Request not found for this agent.'), {
      status: 404,
    });
  if (request.state === 'cancelled')
    throw Object.assign(new Error('This request was cancelled.'), {
      status: 409,
    });
  await db()
    .prepare(
      `UPDATE requests SET state='acknowledged',acknowledged_at=COALESCE(acknowledged_at,?) WHERE owner=? AND id=? AND state='queued'`,
    )
    .bind(new Date().toISOString(), owner, value.request_id)
    .run();
  return db()
    .prepare('SELECT * FROM requests WHERE owner=? AND id=?')
    .bind(owner, value.request_id)
    .first();
}
export async function reply(owner: string, raw: unknown) {
  const value = z
    .object({
      request_id: key,
      body: z.string().trim().min(1).max(20000),
      event_id: key,
      agent_id: z
        .string()
        .regex(/^[a-z0-9_-]{1,80}$/)
        .default('dot'),
      final: z.boolean().default(true),
    })
    .strict()
    .parse(raw);
  const request = await db()
    .prepare('SELECT * FROM requests WHERE owner=? AND id=? AND agent_id=?')
    .bind(owner, value.request_id, value.agent_id)
    .first();
  if (!request)
    throw Object.assign(new Error('Request not found for this agent.'), {
      status: 404,
    });
  if (request.state === 'cancelled')
    throw Object.assign(new Error('This request was cancelled.'), {
      status: 409,
    });
  const id = owner + ':' + value.event_id;
  const prior = await db()
    .prepare('SELECT * FROM comments WHERE id=? AND owner=?')
    .bind(id, owner)
    .first();
  if (prior) {
    if (
      prior.request_id !== value.request_id ||
      prior.body !== value.body ||
      prior.author_kind !== 'agent'
    )
      throw Object.assign(
        new Error('This save identifier belongs to another reply.'),
        { status: 409 },
      );
    return { comment: prior, duplicate: true };
  }
  if (request.state === 'answered' && !value.final)
    throw Object.assign(new Error('This request is already answered.'), {
      status: 409,
    });
  const now = new Date().toISOString();
  await db().batch([
    db()
      .prepare(
        `INSERT INTO comments(id,owner,target_type,target_key,kind,body,author,author_kind,request_id,created_at)
      SELECT ?,owner,target_type,target_key,'reply',?,?,'agent',id,? FROM requests WHERE owner=? AND id=? AND state!='cancelled' AND (?=1 OR state!='answered')`,
      )
      .bind(
        id,
        value.body,
        value.agent_id,
        now,
        owner,
        value.request_id,
        Number(value.final),
      ),
    db()
      .prepare(
        `UPDATE requests SET state=?,acknowledged_at=COALESCE(acknowledged_at,?),answered_at=? WHERE owner=? AND id=? AND state!='cancelled' AND EXISTS(SELECT 1 FROM comments WHERE id=?)`,
      )
      .bind(
        value.final ? 'answered' : 'acknowledged',
        now,
        value.final ? now : null,
        owner,
        value.request_id,
        id,
      ),
    db()
      .prepare(
        `UPDATE tasks SET attention_version=attention_version+1,version=version+1,updated_at=? WHERE owner=? AND task_key=? AND EXISTS(SELECT 1 FROM comments WHERE id=? AND target_type='task') AND changes()>0`,
      )
      .bind(now, owner, request.target_key, id),
  ]);
  const saved = await db()
    .prepare('SELECT * FROM comments WHERE id=? AND owner=?')
    .bind(id, owner)
    .first();
  if (!saved)
    throw Object.assign(
      new Error('The request changed before the reply was saved.'),
      { status: 409 },
    );
  return { comment: saved, duplicate: false };
}
export async function cancelRequest(owner: string, requestId: string) {
  await db()
    .prepare(
      `UPDATE requests SET state='cancelled' WHERE owner=? AND id=? AND state IN ('queued','acknowledged')`,
    )
    .bind(owner, requestId)
    .run();
  return { cancelled: true };
}
export async function saveEntity(owner: string, raw: unknown) {
  const parsed = z
    .object({
      type: z.enum(['area', 'project']),
      id: key,
      title: z.string().trim().min(1).max(200),
      notes: z.string().max(20000).optional(),
      area_id: z.string().max(200).optional(),
      archived: z.boolean().optional(),
      expected_version: z.number().int().min(0),
    })
    .strict()
    .parse(raw);
  const table = parsed.type === 'area' ? 'areas' : 'projects';
  const id = parsed.id.startsWith(owner + ':')
    ? parsed.id
    : owner + ':' + parsed.id;
  const current = await db()
    .prepare('SELECT * FROM ' + table + ' WHERE owner=? AND id=?')
    .bind(owner, id)
    .first();
  const value = {
    ...parsed,
    notes: parsed.notes ?? String(current?.notes ?? ''),
    area_id: parsed.area_id ?? String(current?.area_id ?? ''),
    archived: parsed.archived ?? !!current?.archived,
  };
  if (
    value.type === 'project' &&
    value.area_id &&
    !(await db()
      .prepare('SELECT id FROM areas WHERE owner=? AND id=?')
      .bind(owner, value.area_id)
      .first())
  )
    throw new Error('Choose an existing area.');
  const version = Number(current?.version ?? 0);
  if (
    current &&
    Number(current.version) === value.expected_version + 1 &&
    current.title === value.title &&
    Number(current.archived) === Number(value.archived) &&
    (value.type === 'area' ||
      (current.notes === value.notes && current.area_id === value.area_id))
  )
    return current;
  if (version !== value.expected_version)
    throw Object.assign(
      new Error('This ' + value.type + ' changed. Refresh before saving.'),
      { status: 409 },
    );
  const now = new Date().toISOString();
  const statement =
    value.type === 'area'
      ? db()
          .prepare(
            `INSERT INTO areas(id,owner,title,archived,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,archived=excluded.archived,updated_at=excluded.updated_at,version=areas.version+1 WHERE areas.version=?`,
          )
          .bind(
            id,
            owner,
            value.title,
            Number(value.archived),
            now,
            now,
            version,
          )
      : db()
          .prepare(
            `INSERT INTO projects(id,owner,title,notes,area_id,archived,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,notes=excluded.notes,area_id=excluded.area_id,archived=excluded.archived,updated_at=excluded.updated_at,version=projects.version+1 WHERE projects.version=?`,
          )
          .bind(
            id,
            owner,
            value.title,
            value.notes,
            value.area_id,
            Number(value.archived),
            now,
            now,
            version,
          );
  const statements = [statement];
  if (value.type === 'project' && current && current.area_id !== value.area_id)
    statements.push(
      db()
        .prepare(
          `UPDATE tasks SET area_id=?,version=version+1,updated_at=? WHERE owner=? AND project_id=? AND changes()>0`,
        )
        .bind(value.area_id, now, owner, id),
    );
  const result = await db().batch(statements);
  if (!result[0].meta.changes)
    throw Object.assign(
      new Error('The record changed while saving. Refresh and retry.'),
      { status: 409 },
    );
  return db()
    .prepare('SELECT * FROM ' + table + ' WHERE owner=? AND id=?')
    .bind(owner, id)
    .first();
}
export async function deliveryStatus(owner: string) {
  const now = new Date().toISOString();
  const subscribed = await db()
    .prepare(
      'SELECT COUNT(*) AS count FROM subscriptions WHERE owner=? AND (expires_at IS NULL OR expires_at>?)',
    )
    .bind(owner, now)
    .first();
  const counts = await db()
    .prepare(
      `SELECT deliveries.state,COUNT(*) AS count FROM deliveries JOIN requests ON requests.id=deliveries.request_id AND requests.owner=deliveries.owner WHERE deliveries.owner=? AND requests.state='queued' AND deliveries.state IN ('pending','failed') GROUP BY deliveries.state`,
    )
    .bind(owner)
    .all();
  return {
    subscribed: Number(subscribed?.count ?? 0) > 0,
    pending_notifications: Number(
      counts.results.find((row) => row.state === 'pending')?.count ?? 0,
    ),
    failed_notifications: Number(
      counts.results.find((row) => row.state === 'failed')?.count ?? 0,
    ),
  };
}
export async function exportWorkspace(owner: string) {
  const rows = await db().batch(
    tables.map((table) =>
      db()
        .prepare('SELECT * FROM ' + table + ' WHERE owner=? ORDER BY id')
        .bind(owner),
    ),
  );
  const entries = tables.map(
    (table, index) => [table, rows[index].results] as const,
  );
  return {
    format: 'dot-desk',
    schema_version: 4,
    exported_at: new Date().toISOString(),
    tables: Object.fromEntries(entries),
  };
}
export async function contextForAgent(
  owner: string,
  type: 'task' | 'project' | 'note',
  value: string,
) {
  const thread = await conversation(owner, type, value);
  const state = await workspace(owner);
  const task =
    type === 'task'
      ? (await listTasks(owner)).find((item) => item.task_key === value)
      : null;
  const project = state.projects.find(
    (item) => item.id === (type === 'project' ? value : task?.project_id),
  );
  return {
    ...thread,
    task,
    project: project ?? null,
    note:
      type === 'note'
        ? (state.notes.find((item) => item.id === value) ?? null)
        : null,
    linked_notes: state.notes.filter(
      (note) =>
        !note.archived &&
        state.note_links.some(
          (link) =>
            link.note_id === note.id &&
            ((link.target_type === type && link.target_key === value) ||
              (type === 'task' &&
                project &&
                link.target_type === 'project' &&
                link.target_key === project.id)),
        ),
    ),
    note_links:
      type === 'note'
        ? state.note_links.filter((link) => link.note_id === value)
        : [],
    project_conversation:
      project && type === 'task'
        ? await conversation(owner, 'project', String(project.id))
        : null,
  };
}
