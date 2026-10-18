import { z } from 'zod';
import { database as db } from './database';
import type {
  DeskNote,
  StoredNoteLink,
  SavedView,
  TimeBlock,
} from './planning-model';

const key = z.string().min(1).max(200);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + 'T00:00:00Z');
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, 'Use a valid calendar date.');
const base = {
  id: key,
  expected_version: z.number().int().min(0),
  event_id: key,
};
const link = z
  .object({ target_type: z.enum(['task', 'project', 'note']), target_key: key })
  .strict();
export const noteInput = z
  .object({
    ...base,
    title: z.string().trim().min(1).max(200),
    body: z.string().max(50000),
    tags: z.string().max(1000),
    daily_on: date.nullable(),
    archived: z.boolean(),
    links: z.array(link).max(100),
  })
  .strict();
export const filterInput = z
  .object({
    query: z.string().max(1000),
    view: z.enum([
      'inbox',
      'today',
      'you',
      'dot',
      'waiting',
      'upcoming',
      'anytime',
      'later',
      'all',
    ]),
    area_id: z.string().max(200),
    project_id: z.string().max(200),
    label: z.string().max(100),
    scope: z.enum(['all', 'new', 'unknown']),
    priority_min: z.number().int().min(0).max(3),
  })
  .strict();
export const viewInput = z
  .object({
    ...base,
    title: z.string().trim().min(1).max(100),
    filters: filterInput,
    archived: z.boolean(),
  })
  .strict();
export const blockInput = z
  .object({
    ...base,
    task_key: key,
    starts_at: z.string().datetime({ offset: true }),
    duration_minutes: z.number().int().min(15).max(720),
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid time zone.'),
    archived: z.boolean(),
  })
  .strict();

export async function requirePlanningTarget(
  owner: string,
  type: 'task' | 'project' | 'note',
  key: string,
) {
  const table = { task: 'tasks', project: 'projects', note: 'notes' }[type];
  if (
    !table ||
    !(await db()
      .prepare(
        'SELECT id FROM ' +
          table +
          ' WHERE owner=? AND ' +
          (type === 'task' ? 'task_key' : 'id') +
          '=?',
      )
      .bind(owner, key)
      .first())
  )
    throw Object.assign(
      new Error('This task, project or note is not available.'),
      { status: 404 },
    );
}
export async function planningState(owner: string) {
  const [notes, links, views, blocks] = await db().batch([
    db()
      .prepare(
        'SELECT * FROM notes WHERE owner=? ORDER BY archived,updated_at DESC,id',
      )
      .bind(owner),
    db()
      .prepare('SELECT * FROM note_links WHERE owner=? ORDER BY id')
      .bind(owner),
    db()
      .prepare(
        'SELECT * FROM saved_views WHERE owner=? ORDER BY archived,title,id',
      )
      .bind(owner),
    db()
      .prepare('SELECT * FROM time_blocks WHERE owner=? ORDER BY starts_at,id')
      .bind(owner),
  ]);
  return {
    notes: notes.results as unknown as DeskNote[],
    note_links: links.results as unknown as StoredNoteLink[],
    saved_views: views.results as unknown as SavedView[],
    time_blocks: blocks.results as unknown as TimeBlock[],
  };
}
function conflict(
  message = 'This record changed on another device. Your draft is retained. Reload the saved version before saving again.',
) {
  return Object.assign(new Error(message), { status: 409 });
}
/** A record, its links and its retry receipt commit together on both database adapters. */
async function save(
  owner: string,
  table: 'notes' | 'saved_views' | 'time_blocks',
  input: { id: string; event_id: string; expected_version: number },
  fields: Record<string, string | number | null>,
  links?: z.infer<typeof link>[],
) {
  const id = input.id.startsWith(owner + ':')
    ? input.id
    : owner + ':' + input.id;
  const eventId = owner + ':' + input.event_id;
  const payload = JSON.stringify({
    table,
    id,
    fields,
    links: links ?? null,
    expected_version: input.expected_version,
  });
  const prior = await db()
    .prepare('SELECT * FROM planning_changes WHERE owner=? AND id=?')
    .bind(owner, eventId)
    .first();
  const duplicate = (receipt: Record<string, unknown>) => {
    if (receipt.payload !== payload)
      throw conflict('This save identifier belongs to another update.');
    return { record: JSON.parse(String(receipt.result)), duplicate: true };
  };
  if (prior) return duplicate(prior);
  const current = await db()
    .prepare('SELECT * FROM ' + table + ' WHERE owner=? AND id=?')
    .bind(owner, id)
    .first();
  if (Number(current?.version ?? 0) !== input.expected_version)
    throw conflict();
  const now = new Date().toISOString();
  const record = {
    id,
    owner,
    ...fields,
    version: input.expected_version + 1,
    last_change_id: eventId,
    created_at: current?.created_at ?? now,
    updated_at: now,
  };
  const columns = Object.keys(record);
  const statements = [
    db()
      .prepare(
        `INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map(() => '?').join(',')} WHERE NOT EXISTS(SELECT id FROM planning_changes WHERE id=?) ON CONFLICT(id) DO UPDATE SET ${Object.keys(
          fields,
        )
          .map((field) => field + '=excluded.' + field)
          .join(
            ',',
          )},version=${table}.version+1,last_change_id=excluded.last_change_id,updated_at=excluded.updated_at WHERE ${table}.owner=? AND ${table}.version=? AND NOT EXISTS(SELECT id FROM planning_changes WHERE id=?)`,
      )
      .bind(
        ...Object.values(record),
        eventId,
        owner,
        input.expected_version,
        eventId,
      ),
    db()
      .prepare(
        'INSERT INTO planning_changes(id,owner,entity_type,entity_id,payload,result,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()>0',
      )
      .bind(eventId, owner, table, id, payload, JSON.stringify(record), now),
  ];
  if (links) {
    statements.push(
      db()
        .prepare(
          'DELETE FROM note_links WHERE owner=? AND note_id=? AND EXISTS(SELECT id FROM notes WHERE id=? AND last_change_id=?) AND EXISTS(SELECT id FROM planning_changes WHERE id=? AND payload=?)',
        )
        .bind(owner, id, id, eventId, eventId, payload),
    );
    for (const item of links)
      statements.push(
        db()
          .prepare(
            'INSERT INTO note_links(id,owner,note_id,target_type,target_key) SELECT ?,?,?,?,? WHERE EXISTS(SELECT id FROM notes WHERE id=? AND last_change_id=?) AND EXISTS(SELECT id FROM planning_changes WHERE id=? AND payload=?)',
          )
          .bind(
            JSON.stringify([id, item.target_type, item.target_key]),
            owner,
            id,
            item.target_type,
            item.target_key,
            id,
            eventId,
            eventId,
            payload,
          ),
      );
  }
  try {
    await db().batch(statements);
  } catch (error) {
    if (table === 'notes' && fields.daily_on) {
      const existing = await db()
        .prepare('SELECT id FROM notes WHERE owner=? AND daily_on=?')
        .bind(owner, fields.daily_on)
        .first();
      if (existing && existing.id !== id)
        throw conflict(
          'A Daily Note already exists for this day. Open it from Notes.',
        );
    }
    throw error;
  }
  const receipt = await db()
    .prepare('SELECT * FROM planning_changes WHERE owner=? AND id=?')
    .bind(owner, eventId)
    .first();
  if (!receipt) throw conflict();
  if (receipt.payload !== payload)
    throw conflict('This save identifier belongs to another update.');
  return { record: JSON.parse(String(receipt.result)), duplicate: false };
}
export async function saveNote(owner: string, raw: unknown) {
  const value = noteInput.parse(raw);
  const id = value.id.startsWith(owner + ':')
    ? value.id
    : owner + ':' + value.id;
  const seen = new Set<string>();
  for (const item of value.links) {
    const token = item.target_type + ':' + item.target_key;
    if (seen.has(token)) throw new Error('Link each record only once.');
    seen.add(token);
    if (item.target_type === 'note' && item.target_key === id)
      throw new Error('A note cannot link to itself.');
    await requirePlanningTarget(owner, item.target_type, item.target_key);
  }
  return save(
    owner,
    'notes',
    value,
    {
      title: value.title,
      body: value.body,
      tags: value.tags,
      daily_on: value.daily_on,
      archived: Number(value.archived),
    },
    value.links,
  );
}
export async function saveView(owner: string, raw: unknown) {
  const value = viewInput.parse(raw);
  for (const [table, id] of [
    ['areas', value.filters.area_id],
    ['projects', value.filters.project_id],
  ])
    if (
      id &&
      !(await db()
        .prepare('SELECT id FROM ' + table + ' WHERE owner=? AND id=?')
        .bind(owner, id)
        .first())
    )
      throw new Error('Choose an existing area or project.');
  return save(owner, 'saved_views', value, {
    title: value.title,
    filters: JSON.stringify(value.filters),
    archived: Number(value.archived),
  });
}
export async function saveBlock(owner: string, raw: unknown) {
  const value = blockInput.parse(raw);
  await requirePlanningTarget(owner, 'task', value.task_key);
  return save(owner, 'time_blocks', value, {
    task_key: value.task_key,
    starts_at: new Date(value.starts_at).toISOString(),
    duration_minutes: value.duration_minutes,
    timezone: value.timezone,
    archived: Number(value.archived),
  });
}
