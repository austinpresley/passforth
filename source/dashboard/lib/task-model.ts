export type TaskStatus = 'working' | 'waiting' | 'blocked' | 'scheduled' | 'paused' | 'completed' | 'cancelled';
export type ActionOwner = 'user' | 'dot' | 'external' | 'unknown';
export interface Task {
  task_key: string; title: string; status: TaskStatus; summary: string; next_step: string; blocker: string;
  source_url: string; next_check_at: string | null; action_owner: ActionOwner;
  updated_at: string; created_at: string; reporter: string; version: number;
  conversation_search?: string; project_search?: string; note_search?: string;
  area_id?: string; project_id?: string; planned_on?: string | null; deadline?: string | null; priority?: number; checklist?: string; tags?: string;
  details?: string; source_label?: string; conversation_url?: string; related_task_key?: string;
  attention_version?: number; read_version?: number; progress_at?: string; progress_reporter?: string;
}
export const statusLabels: Record<TaskStatus, string> = {
  working: 'Reported in progress', waiting: 'Waiting', blocked: 'Blocked', scheduled: 'Scheduled',
  paused: 'Saved for later', completed: 'Completed', cancelled: 'Cancelled',
};
export const ownerLabels: Record<ActionOwner, string> = { user: 'You', dot: 'Dot', external: 'Someone else', unknown: 'Not specified' };
export const isDone = (task: Task) => task.status === 'completed' || task.status === 'cancelled';
export const isWaiting = (task: Pick<Task, 'status'>) => task.status === 'waiting' || task.status === 'blocked';
export const needsYou = (task: Task) => isWaiting(task) && task.action_owner === 'user';
export const unknownOwner = (task: Task) => isWaiting(task) && (!task.action_owner || task.action_owner === 'unknown');
export const reportTime = (task: Task) => task.progress_at || task.updated_at;
export const unread = (task: Task) => (task.attention_version ?? 0) > (task.read_version ?? 0);
export function reportConcern(task: Task, now = Date.now()): string | null {
  if (isDone(task)) return null;
  if (task.next_check_at && Date.parse(task.next_check_at) < now) return 'Expected check-in is missing';
  if ((task.status === 'working' || isWaiting(task)) && now - Date.parse(reportTime(task)) > 6 * 60 * 60 * 1000) return 'No report in over 6 hours';
  return null;
}
export function orderedTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.task_key.localeCompare(b.task_key));
}
export const groupLabels = {
  you: 'Needs you', dot: 'With Dot', reported: 'Reported work', external: 'Waiting on someone else',
  unknown: 'Owner needs clarification', scheduled: 'Scheduled check-ins', later: 'Later', completed: 'Completed', cancelled: 'Cancelled',
};
export type TaskGroup = keyof typeof groupLabels;
export function taskGroup(task: Task): TaskGroup {
  if (task.status === 'completed' || task.status === 'cancelled') return task.status;
  if (task.status === 'scheduled') return 'scheduled';
  if (task.status === 'paused') return 'later';
  if (needsYou(task)) return 'you';
  if (unknownOwner(task)) return 'unknown';
  if (isWaiting(task) && task.action_owner === 'external') return 'external';
  return task.action_owner === 'dot' ? 'dot' : 'reported';
}
export function taskLine(task: Task) {
  const generic = /^awaiting (details|confirmed details|confirmed information)/i.test(task.blocker);
  return isWaiting(task) && task.blocker && !generic ? task.blocker : task.summary;
}
export function matchesTask(task: Task, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = [task.title,task.summary,task.next_step,task.blocker,task.details,task.source_label,task.related_task_key,task.tags,task.conversation_search,task.project_search,task.note_search].join(' ').toLowerCase();
  return words.every(word => text.includes(word));
}
export function sourceLabel(task: Task) {
  if (task.source_label) return task.source_label;
  try {
    const url = new URL(task.source_url);
    if (url.hostname === 'books.zoho.com') return url.hash.includes('/invoices/') ? 'Review invoice' : 'Open Zoho Books';
    if (url.hostname === 'app.notion.com' || url.hostname === 'www.notion.so') return 'Open notes';
    if (url.hostname === 'mail.google.com') return 'Open email';
    if (url.hostname === 'github.com') return url.pathname.includes('/releases/') ? 'View release' : 'Open GitHub';
    if (url.hostname === 'paylesscar.com' || url.hostname.endsWith('.paylesscar.com')) return 'View contact options';
    if (url.hostname === 'chatgpt.com') return 'Open conversation';
    return 'Open ' + url.hostname.replace(/^www\./, '');
  } catch { return 'Open source'; }
}
export function relativeTime(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
export function absoluteTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export type WorkView = 'inbox' | 'today' | 'you' | 'dot' | 'waiting' | 'upcoming' | 'anytime' | 'later' | 'all';
export const workViews: Record<WorkView,string> = { inbox:'Inbox',today:'Today',you:'Needs you',dot:'With Dot',waiting:'Waiting',upcoming:'Upcoming',anytime:'Anytime',later:'Later',all:'All work' };
export function inWorkView(task: Task, view: WorkView, today: string) {
  if (view === 'all') return true;
  if (isDone(task)) return false;
  if (view === 'inbox') return !task.project_id && !task.area_id && task.status === 'paused';
  if (view === 'today') return !!(task.planned_on && task.planned_on <= today || task.deadline && task.deadline <= today);
  if (view === 'you') return needsYou(task);
  if (view === 'dot') return task.action_owner === 'dot';
  if (view === 'waiting') return isWaiting(task) && task.action_owner !== 'user';
  if (view === 'upcoming') return !!(task.planned_on && task.planned_on > today || task.deadline && task.deadline > today);
  if (view === 'anytime') return !task.planned_on && task.status !== 'paused' && task.status !== 'scheduled';
  return task.status === 'paused';
}
