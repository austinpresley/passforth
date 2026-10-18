import { env } from 'cloudflare:workers';
import { database } from './database';
import { resolveIdentity,authConfig } from './auth';
import { z } from 'zod';

export const statuses = ['working', 'waiting', 'blocked', 'scheduled', 'paused', 'completed', 'cancelled'] as const;
export const actionOwners = ['user', 'dot', 'external', 'unknown'] as const;
const httpsUrl = (label: string) => z.string().max(1500).refine(value => {
  if (!value) return true;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}, 'Use an https ' + label);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const date=new Date(value+'T00:00:00Z');return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;},'Use a valid calendar date.').nullable();
const fields = {
  title: z.string().trim().min(1).max(200), status: z.enum(statuses),
  summary: z.string().trim().min(1).max(4000), next_step: z.string().max(2000),
  blocker: z.string().max(2000), source_url: httpsUrl('URL'),
  next_check_at: z.string().datetime({ offset: true }).nullable(), action_owner: z.enum(actionOwners),
  details: z.string().max(20000), source_label: z.string().trim().max(60),
  conversation_url: httpsUrl('conversation URL'),
  area_id: z.string().max(200), project_id: z.string().max(200),
  planned_on: day, deadline: day,
  priority: z.number().int().min(0).max(3), checklist: z.string().max(20000).refine(value => { try { const items=JSON.parse(value); return Array.isArray(items) && items.length <= 100 && items.every(item => typeof item.text === 'string' && item.text.length <= 500 && typeof item.done === 'boolean'); } catch { return false; } }, 'Use a valid checklist.'), tags: z.string().max(1000),
  related_task_key: z.string().regex(/^$|^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/),
};
export const taskInput = z.object({
  ...z.object(fields).partial().shape,
  task_key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/),
  event_id: z.string().min(1).max(150), expected_version: z.number().int().min(0).optional(),
  change_note: z.string().trim().max(400).optional(),
  presentation_only: z.boolean().optional(),
}).strict();
const taskState = z.object(fields).superRefine((value, context) => {
  if (['blocked', 'waiting'].includes(value.status) && !value.blocker.trim()) {
    context.addIssue({ code: 'custom', path: ['blocker'], message: 'Explain what is needed to continue.' });
  }
  if (value.status === 'scheduled' && !value.next_check_at) {
    context.addIssue({ code: 'custom', path: ['next_check_at'], message: 'Scheduled tasks need a next check time.' });
  }
});
function conflict(message = 'Task changed since you read it. Read the current task and retry with its version.') {
  return Object.assign(new Error(message), { status: 409 });
}
export function db() {
  return database();
}
export const identity = resolveIdentity;
export function writeGuard(request: Request) {
  if((env as {DESK_READ_ONLY?:string}).DESK_READ_ONLY==='1')throw Object.assign(new Error('Passforth is temporarily read-only during migration. Your draft is retained.'),{status:503});
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw Object.assign(new Error('Origin not allowed.'), { status: 403 });
}
export async function listTasks(owner: string) {
  return (await db().prepare(`SELECT tasks.*, COALESCE(task_reads.read_version,0) AS read_version,
    (SELECT GROUP_CONCAT(body,' ') FROM comments WHERE comments.owner=tasks.owner AND comments.target_type='task' AND comments.target_key=tasks.task_key) AS conversation_search,
    (SELECT GROUP_CONCAT(body,' ') FROM notes WHERE notes.owner=tasks.owner AND notes.archived=0 AND EXISTS(SELECT 1 FROM note_links WHERE note_links.owner=tasks.owner AND note_links.note_id=notes.id AND (note_links.target_type='task' AND note_links.target_key=tasks.task_key OR note_links.target_type='project' AND note_links.target_key=tasks.project_id))) AS note_search,
    (SELECT title || ' ' || notes FROM projects WHERE projects.id=tasks.project_id AND projects.owner=tasks.owner) AS project_search
    FROM tasks LEFT JOIN task_reads ON task_reads.id=tasks.id AND task_reads.owner=tasks.owner
    WHERE tasks.owner=? ORDER BY tasks.created_at, tasks.task_key`).bind(owner).all()).results;
}
export async function markRead(owner: string, raw: unknown) {
  const input = z.object({ task_key: z.string().min(1).max(120), attention_version: z.number().int().min(1) }).strict().parse(raw);
  const id = owner + ':' + input.task_key;
  const result = await db().prepare(`INSERT INTO task_reads(id,owner,task_id,read_version)
    SELECT id,owner,id,? FROM tasks WHERE id=? AND owner=? AND attention_version>=?
    ON CONFLICT(id) DO UPDATE SET read_version=MAX(task_reads.read_version,excluded.read_version)`)
    .bind(input.attention_version, id, owner, input.attention_version).run();
  if (!result.meta.changes) throw conflict('This report is no longer available. Refresh saved work.');
  return { task_key: input.task_key, read_version: input.attention_version };
}
export async function history(owner: string, key: string) {
  return (await db().prepare(
    'SELECT * FROM events WHERE owner=? AND task_id=? ORDER BY created_at DESC, rowid DESC LIMIT 100',
  ).bind(owner, owner + ':' + key).all()).results;
}
export async function putTask(owner: string, raw: unknown, reporter: string) {
  const input = taskInput.parse(raw);
  const id = owner + ':' + input.task_key;
  const eventId = owner + ':' + input.event_id;
  const readTask = () => db().prepare('SELECT * FROM tasks WHERE id=? AND owner=?').bind(id, owner).first();
  const readEvent = () => db().prepare('SELECT * FROM events WHERE id=? AND owner=?').bind(eventId, owner).first();
  const duplicate = async (event: Record<string, unknown>) => {
    if (event.task_id !== id) throw conflict('This event_id was already used for another task.');
    return { duplicate: true, task: await readTask() };
  };
  const previousEvent = await readEvent();
  if (previousEvent) return duplicate(previousEvent);
  const current = await readTask();
  const version = Number(current?.version ?? 0);
  if (input.expected_version !== undefined && input.expected_version !== version) throw conflict();
  const value = taskState.parse({
    next_step: '', blocker: '', source_url: '', next_check_at: null, action_owner: 'unknown',
    details: '', source_label: '', conversation_url: '', related_task_key: '', area_id: '', project_id: '', planned_on: null, deadline: null, priority: 0, checklist: '[]', tags: '', ...current, ...input,
  });
  if (value.related_task_key) {
    if (value.related_task_key === input.task_key) throw new Error('A task cannot be related to itself.');
    const related = await db().prepare('SELECT id FROM tasks WHERE owner=? AND task_key=?').bind(owner, value.related_task_key).first();
    if (!related) throw new Error('Related task must be saved in your register first.');
  }
  for (const [table, key] of [['areas',value.area_id],['projects',value.project_id]] as const) {
    if (key && !await db().prepare('SELECT id FROM ' + table + ' WHERE owner=? AND id=?').bind(owner,key).first()) throw new Error('Choose an existing ' + (table === 'areas' ? 'area.' : 'project.'));
  }
  if(value.project_id){const project=await db().prepare('SELECT area_id FROM projects WHERE owner=? AND id=?').bind(owner,value.project_id).first();if(project?.area_id){if(value.area_id&&value.area_id!==project.area_id)throw new Error('The task area must match its project.');value.area_id=String(project.area_id);}}
  const changed = Object.keys(fields).filter(field => current?.[field] !== value[field as keyof typeof value]);
  const attentionFields = ['title', 'status', 'summary', 'details', 'next_step', 'blocker', 'source_url', 'conversation_url'];
  if (input.presentation_only && (!current || changed.some(field => ['status','source_url','conversation_url','next_check_at'].includes(field)))) {
    throw Object.assign(new Error('Presentation-only edits must preserve status, links, and check-in commitments.'), { status: 400 });
  }
  const meaningful = !current || !input.presentation_only && changed.some(field => attentionFields.includes(field));
  const checkin = !meaningful && !input.presentation_only && reporter === 'Dot' && input.summary !== undefined;
  const kind = input.presentation_only ? 'formatting' : meaningful ? 'progress' : checkin ? 'checkin' : 'metadata';
  const note = (meaningful || input.presentation_only) && input.change_note ? input.change_note
    : !current || changed.includes('summary') ? value.summary
    : changed.includes('status') ? 'Status changed to ' + value.status + '.'
    : changed.length ? changed.map(field => field.replaceAll('_', ' ')).join(', ') + ' updated.'
    : checkin ? 'Check-in: no material change.' : 'No fields changed.';
  const now = new Date().toISOString();
  const nextCheck = value.next_check_at ? new Date(value.next_check_at).toISOString() : null;
  const attentionVersion = Number(current?.attention_version ?? 0) + (meaningful ? 1 : 0);
  const progressAt = meaningful || checkin ? now : current?.progress_at || current?.updated_at || now;
  const progressReporter = meaningful || checkin ? reporter : current?.progress_reporter || current?.reporter || reporter;
  const result = await db().batch([
    db().prepare(`INSERT INTO tasks (
        id,owner,task_key,title,status,summary,next_step,blocker,source_url,next_check_at,action_owner,
        updated_at,created_at,reporter,version,details,source_label,conversation_url,related_task_key,
        attention_version,progress_at,progress_reporter,area_id,project_id,planned_on,deadline,priority,checklist,tags
      ) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE (?=0 OR EXISTS(SELECT 1 FROM tasks WHERE id=?)) AND NOT EXISTS(SELECT 1 FROM events WHERE id=?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,status=excluded.status,summary=excluded.summary,next_step=excluded.next_step,
        blocker=excluded.blocker,source_url=excluded.source_url,next_check_at=excluded.next_check_at,
        action_owner=excluded.action_owner,updated_at=excluded.updated_at,reporter=excluded.reporter,version=tasks.version+1,
        details=excluded.details,source_label=excluded.source_label,conversation_url=excluded.conversation_url,
        related_task_key=excluded.related_task_key,attention_version=excluded.attention_version,
        progress_at=excluded.progress_at,progress_reporter=excluded.progress_reporter,area_id=excluded.area_id,project_id=excluded.project_id,planned_on=excluded.planned_on,deadline=excluded.deadline,priority=excluded.priority,checklist=excluded.checklist,tags=excluded.tags
      WHERE tasks.version=? AND NOT EXISTS(SELECT 1 FROM events WHERE id=?)`).bind(
      id,owner,input.task_key,value.title,value.status,value.summary,value.next_step,value.blocker,value.source_url,
      nextCheck,value.action_owner,now,now,reporter,value.details,value.source_label,value.conversation_url,
      value.related_task_key,attentionVersion,progressAt,progressReporter,value.area_id,value.project_id,value.planned_on,value.deadline,value.priority,value.checklist,value.tags,version,id,eventId,version,eventId,
    ),
    db().prepare(`INSERT INTO events(id,owner,task_id,status,summary,reporter,created_at,action_owner,kind,change_note,changed_fields,details)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE changes()>0`).bind(
      eventId,owner,id,value.status,value.summary,reporter,now,value.action_owner,kind,note,JSON.stringify(changed),value.details,
    ),
  ]);
  if (!result[0].meta.changes) {
    const retry = await readEvent();
    if (retry) return duplicate(retry);
    throw conflict();
  }
  return { duplicate: false, task: await readTask() };
}
export function fail(error: unknown) {
  const err = error as Error & { status?: number };
  return Response.json({ error: err instanceof z.ZodError
    ? err.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('; ') : err.message || 'Request failed',
    ...(err.status === 401 ? {sign_in:authConfig().DESK_AUTH_MODE === 'supabase' ? '/login' : '/signin-with-chatgpt?return_to=%2F'} : {}) }, { status: err.status ?? (err instanceof z.ZodError || err instanceof SyntaxError ? 400 : 500), headers: { 'Cache-Control': 'no-store' } });
}
