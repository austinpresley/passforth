import {
  Task,
  WorkView,
  inWorkView,
  matchesTask,
  unread,
  taskGroup,
} from './task-model';

export type TargetType = 'task' | 'project' | 'note';
export interface NoteLink {
  target_type: TargetType;
  target_key: string;
}
export interface DeskNote {
  id: string;
  title: string;
  body: string;
  tags: string;
  daily_on: string | null;
  archived: number;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface StoredNoteLink extends NoteLink {
  id: string;
  note_id: string;
}
export interface ViewFilter {
  query: string;
  view: WorkView;
  area_id: string;
  project_id: string;
  label: string;
  scope: 'all' | 'new' | 'unknown';
  priority_min: number;
}
export interface SavedView {
  id: string;
  title: string;
  filters: string;
  version: number;
  archived: number;
}
export interface TimeBlock {
  id: string;
  task_key: string;
  starts_at: string;
  duration_minutes: number;
  timezone: string;
  version: number;
  archived: number;
}
export const emptyFilter: ViewFilter = {
  query: '',
  view: 'all',
  area_id: '',
  project_id: '',
  label: '',
  scope: 'all',
  priority_min: 0,
};
export function localDay(date = new Date()) {
  return (
    date.getFullYear() +
    '-' +
    String(date.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(date.getDate()).padStart(2, '0')
  );
}
export function addDays(day: string, count: number) {
  const date = new Date(day + 'T12:00:00');
  date.setDate(date.getDate() + count);
  return localDay(date);
}
export function weekDays(day: string) {
  const date = new Date(day + 'T12:00:00');
  const monday = addDays(day, -((date.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}
export function labels(tags = '') {
  return [...new Set(tags.split(/\s+/).filter(Boolean))];
}
export function labelMatches(tags: string, label: string) {
  return (
    !label ||
    labels(tags).some(
      (tag) =>
        tag.toLowerCase() === label.toLowerCase() ||
        tag.toLowerCase().startsWith(label.toLowerCase() + '/'),
    )
  );
}
export function labelTree(values: string[]) {
  const names = new Set<string>();
  for (const value of values)
    for (const tag of labels(value)) {
      const parts = tag.split('/').filter(Boolean);
      for (let count = 1; count <= parts.length; count++)
        names.add(parts.slice(0, count).join('/'));
    }
  return [...names].sort((a, b) => a.localeCompare(b));
}
export function matchesView(
  task: Task,
  filter: ViewFilter,
  today: string,
  blocks: TimeBlock[] = [],
) {
  const timed =
    task.status !== 'completed' &&
    task.status !== 'cancelled' &&
    blocks.some(
      (block) =>
        !block.archived &&
        block.task_key === task.task_key &&
        (filter.view === 'today'
          ? localDay(new Date(block.starts_at)) === today
          : filter.view === 'upcoming' &&
            localDay(new Date(block.starts_at)) > today),
    );
  return (
    (inWorkView(task, filter.view, today) || timed) &&
    matchesTask(task, filter.query) &&
    (!filter.area_id || task.area_id === filter.area_id) &&
    (!filter.project_id || task.project_id === filter.project_id) &&
    labelMatches(task.tags || '', filter.label) &&
    (task.priority || 0) >= filter.priority_min &&
    (filter.scope === 'all' ||
      (filter.scope === 'new' && unread(task)) ||
      (filter.scope === 'unknown' && taskGroup(task) === 'unknown'))
  );
}
export function blocksOverlap(a: TimeBlock, b: TimeBlock) {
  return (
    a.id !== b.id &&
    !a.archived &&
    !b.archived &&
    Date.parse(a.starts_at) <
      Date.parse(b.starts_at) + b.duration_minutes * 60000 &&
    Date.parse(b.starts_at) <
      Date.parse(a.starts_at) + a.duration_minutes * 60000
  );
}
