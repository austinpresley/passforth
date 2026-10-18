'use client';
import { useEffect, useRef, useState } from 'react';
import { useDeskData } from '../components/desk/use-desk-data';
import { TaskDetails, TaskItem, TaskLinks } from '../components/desk/task-item';
import {
  ProjectManager,
  emptyWorkspace,
} from '../components/desk/organization';
import { WorkView, workViews, inWorkView } from '../lib/task-model';
import { Notes, LinkedNotes } from '../components/desk/notes';
import { Week } from '../components/desk/week';
import { SavedViews } from '../components/desk/saved-views';
import {
  ViewFilter,
  SavedView,
  labelTree,
  localDay,
  matchesView,
} from '../lib/planning-model';
import { Setup } from '../components/desk/setup';
import {
  Task,
  TaskGroup,
  needsYou,
  isDone,
  orderedTasks,
  reportConcern,
  relativeTime,
  absoluteTime,
  reportTime,
  unread,
  taskGroup,
  groupLabels,
  matchesTask,
} from '../lib/task-model';

type Capture = { task_key: string; title: string; event_id: string };
type Undo = { task_key: string; expected_version: number; event_id: string };
interface Preferences {
  view: 'next' | 'all' | 'notes' | 'week';
  selectedNote?: string;
  label?: string;
  priorityMin?: number;
  savedView?: string;
  selected: string;
  request: string;
  query: string;
  draft: string;
  workView?: WorkView;
  project?: string;
  area?: string;
  scope: 'all' | 'new' | 'unknown';
  capture: Capture | null;
  undo: Undo | null;
}
const defaults: Preferences = {
  view: 'next',
  selected: '',
  request: '',
  query: '',
  draft: '',
  scope: 'all',
  capture: null,
  undo: null,
};
function readPreferences(key: string): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    return {
      view: ['all', 'notes', 'week'].includes(saved.view) ? saved.view : 'next',
      selectedNote:
        typeof saved.selectedNote === 'string' ? saved.selectedNote : '',
      label: typeof saved.label === 'string' ? saved.label : '',
      priorityMin: [0, 1, 2, 3].includes(saved.priorityMin)
        ? saved.priorityMin
        : 0,
      savedView: typeof saved.savedView === 'string' ? saved.savedView : '',
      selected: typeof saved.selected === 'string' ? saved.selected : '',
      request:
        typeof saved.request === 'string'
          ? saved.request
          : typeof saved.selected === 'string'
            ? saved.selected
            : '',
      query: typeof saved.query === 'string' ? saved.query : '',
      draft: typeof saved.draft === 'string' ? saved.draft : '',
      workView: saved.workView in workViews ? saved.workView : 'all',
      project: typeof saved.project === 'string' ? saved.project : '',
      area: typeof saved.area === 'string' ? saved.area : '',
      scope: ['all', 'new', 'unknown'].includes(saved.scope)
        ? saved.scope
        : 'all',
      capture:
        saved.capture &&
        ['task_key', 'title', 'event_id'].every(
          (field) => typeof saved.capture[field] === 'string',
        )
          ? saved.capture
          : null,
      undo:
        saved.undo &&
        typeof saved.undo.task_key === 'string' &&
        typeof saved.undo.event_id === 'string' &&
        Number.isInteger(saved.undo.expected_version)
          ? saved.undo
          : null,
    };
  } catch {
    return defaults;
  }
}
type DeskData = ReturnType<typeof useDeskData>;
function Workspace({ data }: { data: DeskData }) {
  const storageKey = 'dot-desk:v2:' + data.viewerKey;
  const [preferences, setPreferences] = useState(() =>
    readPreferences(storageKey),
  );
  const preferenceRef = useRef(preferences);
  const [storageError, setStorageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [workspaceState, setWorkspaceState] = useState(emptyWorkspace);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [workspaceError, setWorkspaceError] = useState('');
  async function loadWorkspace() {
    try {
      const response = await fetch('/api/workspace', {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok)
        throw new Error('Could not read project and delivery information.');
      setWorkspaceState(await response.json());
      setWorkspaceError('');
    } catch (error) {
      setWorkspaceError((error as Error).message);
    }
  }
  async function reloadAll() {
    await Promise.all([data.load(), loadWorkspace()]);
  }
  useEffect(() => {
    void loadWorkspace();
    const timer = setInterval(loadWorkspace, 30000);
    return () => clearInterval(timer);
  }, []);
  const [saved, setSaved] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [cancelledOpen, setCancelledOpen] = useState(false);
  const [compact] = useState(
    () => new URLSearchParams(location.search).get('view') === 'menubar',
  );
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const tasks = orderedTasks(data.tasks);
  const requests = tasks.filter(needsYou);
  const request =
    requests.find((task) => task.task_key === preferences.request) ||
    requests[0];
  const selected = tasks.find((task) => task.task_key === preferences.selected);
  const unknown = tasks.filter((task) => taskGroup(task) === 'unknown');
  const newCount = tasks.filter(unread).length;

  function remember(change: Partial<Preferences>) {
    const next = { ...preferenceRef.current, ...change };
    preferenceRef.current = next;
    setPreferences(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setStorageError(true);
    }
  }
  function selectTask(task: Task) {
    remember({ selected: task.task_key });
    setDetailsOpen(true);
    void data.markRead(task);
  }
  function closeDetails() {
    setDetailsOpen(false);
    requestAnimationFrame(() => {
      const row = mainRef.current?.querySelector<HTMLButtonElement>(
        '[data-task-row="' + preferences.selected + '"]',
      );
      const requestButton = mainRef.current?.querySelector<HTMLButtonElement>(
        '[data-open-request]',
      );
      (
        row ||
        requestButton ||
        mainRef.current?.querySelector<HTMLButtonElement>(
          'nav button[aria-pressed="true"]',
        )
      )?.focus();
    });
  }
  useEffect(() => {
    if (request && preferences.request !== request.task_key)
      remember({ request: request.task_key });
    // Keep the chosen request stable while it remains eligible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.task_key]);
  useEffect(() => {
    if (detailsOpen) panelRef.current?.focus();
  }, [detailsOpen, selected?.task_key]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const editing = !!target.closest(
        'input,textarea,select,[contenteditable="true"]',
      );
      if (
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') ||
        (!editing && event.key === '/')
      ) {
        event.preventDefault();
        remember({ view: 'all' });
        setDetailsOpen(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (!editing && event.key === 'Escape' && detailsOpen) {
        event.preventDefault();
        closeDetails();
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
    // The handler uses the current selection and open state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsOpen, preferences.selected]);

  async function capture(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !preferences.draft.trim()) return;
    const attempt = preferences.capture || {
      task_key: 'capture-' + crypto.randomUUID(),
      title: preferences.draft.trim(),
      event_id: crypto.randomUUID(),
    };
    remember({ capture: attempt });
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...attempt,
          expected_version: 0,
          status: 'paused',
          action_owner: 'unknown',
          summary: 'Saved for later. Dot has not accepted this task.',
          next_step: 'Ask Dot to take this on.',
        }),
        signal: AbortSignal.timeout(12000),
      });
      const result = (await response.json()) as { error?: string; task?: Task };
      if (!response.ok || !result.task) {
        if (response.status < 500 && response.status !== 429)
          remember({ capture: null });
        throw new Error(result.error || 'Could not save your thought.');
      }
      remember({
        draft: '',
        capture: null,
        undo: {
          task_key: attempt.task_key,
          expected_version: result.task.version,
          event_id: crypto.randomUUID(),
        },
      });
      setSaved(true);
      await data.load();
    } catch (error) {
      setSaveError('Save not confirmed. ' + (error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    const reconnect = () => {
      if (preferenceRef.current.capture && !saving)
        void capture({ preventDefault() {} } as React.FormEvent);
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [saving, preferences.capture]);
  async function undoCapture() {
    if (!preferences.undo || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...preferences.undo,
          status: 'cancelled',
          change_note: 'Undid capture.',
        }),
        signal: AbortSignal.timeout(12000),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429)
          remember({ undo: null });
        throw new Error(result.error || 'Undo not confirmed.');
      }
      remember({ undo: null });
      setSaved(false);
      await data.load();
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function createBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupMessage('');
    setWorkspaceError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backup' }),
        signal: AbortSignal.timeout(60000),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || 'Backup was not confirmed.');
      setBackupMessage('Private backup saved and verified.');
    } catch (error) {
      setWorkspaceError((error as Error).message);
    } finally {
      setBackupBusy(false);
    }
  }
  function exportTasks() {
    location.assign('/api/workspace?export=1');
  }
  function showAll(scope: Preferences['scope'] = 'all') {
    remember({
      view: 'all',
      scope,
      query: '',
      workView: 'all',
      project: '',
      area: '',
      label: '',
      priorityMin: 0,
      savedView: '',
    });
    setDetailsOpen(false);
  }
  function row(task: Task) {
    return (
      <TaskItem
        key={task.task_key}
        task={task}
        now={data.clock}
        selected={detailsOpen && selected?.task_key === task.task_key}
        onSelect={selectTask}
      />
    );
  }
  const query = preferences.query.trim();
  const today = localDay();
  const filter: ViewFilter = {
    query: preferences.query,
    view: preferences.workView || 'all',
    area_id: preferences.area || '',
    project_id: preferences.project || '',
    label: preferences.label || '',
    scope: preferences.scope,
    priority_min: preferences.priorityMin || 0,
  };
  const matching = tasks.filter((task) =>
    matchesView(task, filter, today, workspaceState.time_blocks),
  );
  function openNote(id: string) {
    remember({ view: 'notes', selectedNote: id });
    setDetailsOpen(false);
  }
  function openProject(id: string) {
    remember({
      view: 'all',
      project: id,
      area: '',
      workView: 'all',
      query: '',
      scope: 'all',
      label: '',
      priorityMin: 0,
      savedView: '',
    });
    setDetailsOpen(false);
  }
  function applySavedView(view: SavedView) {
    try {
      const value = JSON.parse(view.filters) as ViewFilter;
      remember({
        view: 'all',
        workView: value.view,
        query: value.query,
        project: value.project_id,
        area: value.area_id,
        label: value.label,
        priorityMin: value.priority_min,
        scope: value.scope,
        savedView: view.id,
      });
      setDetailsOpen(false);
    } catch {
      setWorkspaceError('This saved view could not be read.');
    }
  }
  const selectedDone = detailsOpen && selected && isDone(selected);
  const terminalOpen = (group: TaskGroup) =>
    !!query ||
    preferences.scope === 'new' ||
    (selectedDone && taskGroup(selected) === group) ||
    (group === 'completed' ? completedOpen : cancelledOpen);

  return (
    <main
      ref={mainRef}
      className={
        'desk' +
        (preferences.view === 'notes' || preferences.view === 'week'
          ? ' wide-workspace'
          : '') +
        (compact ? ' compact' : '') +
        (detailsOpen && selected ? ' has-detail' : '')
      }
      onKeyDown={(event) => {
        if (
          !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
          !(event.target as HTMLElement).closest('[data-task-row]')
        )
          return;
        const rows = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[data-task-row]',
          ),
        ].filter((item) => item.offsetParent !== null);
        const index = rows.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rows.length - 1
              : Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    index + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                );
        rows[next]?.focus();
      }}
    >
      <header className="desk-header">
        <button
          className="brand"
          onClick={() => {
            remember({ view: 'next' });
            setDetailsOpen(false);
          }}
          aria-label="Passforth home"
        >
          <span className="brand-dot" />
          Passforth
        </button>
        <nav aria-label="Work views">
          <button
            aria-pressed={preferences.view === 'next'}
            onClick={() => {
              remember({ view: 'next' });
              setDetailsOpen(false);
            }}
          >
            Next for you
          </button>
          <button
            aria-pressed={preferences.view === 'all'}
            onClick={() => showAll()}
          >
            All work
          </button>
          <button
            aria-pressed={preferences.view === 'notes'}
            onClick={() => {
              remember({ view: 'notes' });
              setDetailsOpen(false);
            }}
          >
            Notes
          </button>
          <button
            aria-pressed={preferences.view === 'week'}
            onClick={() => {
              remember({ view: 'week' });
              setDetailsOpen(false);
            }}
          >
            Week
          </button>
        </nav>
      </header>
      {(data.error || data.stale) && (
        <div className="connection-warning" role="alert">
          <strong>These reports may be out of date.</strong>
          <p>
            {data.error ||
              'The dashboard has not refreshed in over two minutes.'}
          </p>
          <button className="secondary" onClick={data.load}>
            Try again
          </button>
        </div>
      )}
      {data.readError && (
        <p className="error-text" role="status">
          {data.readError}
        </p>
      )}
      <div className="workspace">
        <div className="work-list">
          {preferences.view === 'next' ? (
            <>
              <section className="next-section" aria-labelledby="next-heading">
                <div className="section-heading">
                  <h1 id="next-heading">Next for you</h1>
                  <span className="meta">
                    {requests.length}{' '}
                    {requests.length === 1 ? 'request' : 'requests'}
                  </span>
                </div>
                {request ? (
                  <article className="next-card">
                    <p className="request-subject">{request.title}</p>
                    <h2 className="request-question">{request.blocker}</h2>
                    {request.summary.length <= 200 &&
                      request.summary.trim() !== request.blocker.trim() && (
                        <p className="request-context">{request.summary}</p>
                      )}
                    <div className="card-actions">
                      <TaskLinks task={request} primary />
                      <button
                        className="secondary"
                        data-open-request
                        onClick={() => selectTask(request)}
                      >
                        Reply or read details
                      </button>
                    </div>
                    {!request.conversation_url && (
                      <p className="meta">Open this task to answer here.</p>
                    )}
                    <p
                      className="meta"
                      title={absoluteTime(reportTime(request))}
                    >
                      Reported {relativeTime(reportTime(request), data.clock)}
                      {unread(request) ? ', new update' : ''}
                    </p>
                    {reportConcern(request, data.clock) && (
                      <p className="report-concern">
                        {reportConcern(request, data.clock)}
                      </p>
                    )}
                  </article>
                ) : (
                  <p className="lead">
                    {tasks.length
                      ? unknown.length
                        ? 'No confirmed requests for you. Some owners need clarification below.'
                        : 'No saved requests for you.'
                      : 'Save a thought below, or connect Dot to report its work.'}
                  </p>
                )}
                {requests.length > 1 && (
                  <details className="other-requests">
                    <summary>
                      {requests.length - 1} other{' '}
                      {requests.length === 2 ? 'request' : 'requests'}
                    </summary>
                    {requests
                      .filter((task) => task.task_key !== request?.task_key)
                      .map((task) => (
                        <button
                          className="request-choice"
                          key={task.task_key}
                          onClick={() => {
                            remember({ request: task.task_key });
                            setDetailsOpen(false);
                          }}
                        >
                          <strong>{task.title}</strong>
                          <span>{task.blocker}</span>
                        </button>
                      ))}
                  </details>
                )}
              </section>
              {!!unknown.length && (
                <details className="owner-review">
                  <summary>
                    Owner needs clarification <span>{unknown.length}</span>
                  </summary>
                  {unknown.slice(0, 3).map(row)}
                  <button
                    className="text-button"
                    onClick={() => showAll('unknown')}
                  >
                    Review all {unknown.length} owners
                  </button>
                </details>
              )}
              {(
                [
                  'dot',
                  'reported',
                  'external',
                  'scheduled',
                  'later',
                  'completed',
                  'cancelled',
                ] as TaskGroup[]
              ).map((group) => {
                const items = tasks.filter((task) => taskGroup(task) === group);
                if (!items.length) return null;
                const terminal = group === 'completed' || group === 'cancelled';
                const content = (
                  <>
                    {items.slice(0, 3).map(row)}
                    {items.length > 3 && (
                      <button className="text-button" onClick={() => showAll()}>
                        See all saved work
                      </button>
                    )}
                  </>
                );
                return terminal || group === 'later' ? (
                  <details className="work-section" key={group}>
                    <summary>
                      {groupLabels[group]} <span>{items.length}</span>
                    </summary>
                    {content}
                  </details>
                ) : (
                  <section className="work-section" key={group}>
                    <h2>
                      {groupLabels[group]} <span>{items.length}</span>
                    </h2>
                    {content}
                  </section>
                );
              })}
            </>
          ) : preferences.view === 'notes' ? (
            <Notes
              state={workspaceState}
              tasks={tasks}
              viewerKey={data.viewerKey}
              selected={preferences.selectedNote || ''}
              onSelect={(id) => remember({ selectedNote: id })}
              onSaved={reloadAll}
              onTask={selectTask}
              onProject={openProject}
            />
          ) : preferences.view === 'week' ? (
            <Week
              tasks={tasks}
              blocks={workspaceState.time_blocks}
              onTask={selectTask}
              onSaved={reloadAll}
            />
          ) : (
            <section className="all-work" aria-labelledby="all-heading">
              <h1 id="all-heading">
                {(preferences.savedView &&
                  workspaceState.saved_views.find(
                    (view) =>
                      view.id === preferences.savedView && !view.archived,
                  )?.title) ||
                  (preferences.project
                    ? workspaceState.projects.find(
                        (project) => project.id === preferences.project,
                      )?.title || 'Project tasks'
                    : workViews[preferences.workView || 'all'])}
              </h1>
              <SavedViews
                views={workspaceState.saved_views}
                filter={filter}
                selected={preferences.savedView || ''}
                onSelect={applySavedView}
                onSaved={loadWorkspace}
              />
              <div
                className="work-view-tabs"
                role="group"
                aria-label="Task views"
              >
                {Object.entries(workViews).map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={
                      (preferences.workView || 'all') === value &&
                      !preferences.project
                    }
                    onClick={() =>
                      remember({
                        workView: value as WorkView,
                        project: '',
                        area: '',
                        savedView: '',
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <details className="task-filter-options">
                <summary>
                  Filter work
                  {preferences.area ||
                  preferences.project ||
                  preferences.label ||
                  preferences.priorityMin
                    ? ' · Active filters'
                    : ''}
                </summary>
                <div className="project-filters">
                  <label>
                    Area
                    <select
                      value={preferences.area || ''}
                      onChange={(event) =>
                        remember({ area: event.target.value, savedView: '' })
                      }
                    >
                      <option value="">All areas</option>
                      {workspaceState.areas
                        .filter((area) => !area.archived)
                        .map((area) => (
                          <option key={area.id} value={area.id}>
                            {area.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Project
                    <select
                      value={preferences.project || ''}
                      onChange={(event) =>
                        remember({
                          project: event.target.value,
                          workView: 'all',
                          savedView: '',
                        })
                      }
                    >
                      <option value="">All projects</option>
                      {workspaceState.projects
                        .filter((project) => !project.archived)
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="project-filters">
                  <label>
                    Label
                    <select
                      value={preferences.label || ''}
                      onChange={(event) =>
                        remember({ label: event.target.value, savedView: '' })
                      }
                    >
                      <option value="">All labels</option>
                      {labelTree(tasks.map((task) => task.tags || '')).map(
                        (label) => (
                          <option key={label} value={label}>
                            {label.replaceAll('/', ' / ')}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Priority
                    <select
                      value={preferences.priorityMin || 0}
                      onChange={(event) =>
                        remember({
                          priorityMin: Number(event.target.value),
                          savedView: '',
                        })
                      }
                    >
                      <option value={0}>Any priority</option>
                      <option value={1}>Low and above</option>
                      <option value={2}>Medium and above</option>
                      <option value={3}>High only</option>
                    </select>
                  </label>
                </div>
              </details>
              <label className="search-label">
                Search saved work
                <input
                  ref={searchRef}
                  type="search"
                  value={preferences.query}
                  onChange={(event) =>
                    remember({ query: event.target.value, savedView: '' })
                  }
                  placeholder="Tasks, updates, or evidence"
                />
              </label>
              <div
                className="work-filters"
                role="group"
                aria-label="Show saved work"
              >
                <button
                  aria-pressed={preferences.scope === 'all'}
                  onClick={() => remember({ scope: 'all', savedView: '' })}
                >
                  All
                </button>
                <button
                  aria-pressed={preferences.scope === 'new'}
                  onClick={() => remember({ scope: 'new', savedView: '' })}
                >
                  New updates {newCount > 0 ? newCount : ''}
                </button>
                <button
                  aria-pressed={preferences.scope === 'unknown'}
                  onClick={() => remember({ scope: 'unknown', savedView: '' })}
                >
                  Needs an owner {unknown.length > 0 ? unknown.length : ''}
                </button>
              </div>
              <div className="all-work-rows">
                {(Object.keys(groupLabels) as TaskGroup[]).flatMap((group) => {
                  const items = matching.filter(
                    (task) => taskGroup(task) === group,
                  );
                  if (!items.length) return [];
                  const terminal =
                    group === 'completed' || group === 'cancelled';
                  const open = !terminal || terminalOpen(group);
                  return [
                    <h2 className="work-group-heading" key={'group:' + group}>
                      {terminal &&
                      !query &&
                      preferences.scope !== 'new' &&
                      !(selectedDone && taskGroup(selected) === group) ? (
                        <button
                          className="done-toggle"
                          aria-expanded={!!open}
                          onClick={() =>
                            group === 'completed'
                              ? setCompletedOpen(!open)
                              : setCancelledOpen(!open)
                          }
                        >
                          {groupLabels[group]} <span>{items.length}</span>
                        </button>
                      ) : (
                        <>
                          {groupLabels[group]} <span>{items.length}</span>
                        </>
                      )}
                    </h2>,
                    ...items.map((task) => (
                      <div key={task.task_key} hidden={!open}>
                        {row(task)}
                      </div>
                    )),
                  ];
                })}
              </div>
              {!matching.length && (
                <p className="lead">
                  {query
                    ? 'No saved work matches your search.'
                    : preferences.scope === 'new'
                      ? 'No unread updates.'
                      : preferences.scope === 'unknown'
                        ? 'Every waiting request has an owner.'
                        : 'No saved work yet.'}
                </p>
              )}
            </section>
          )}
          {(preferences.view === 'next' || preferences.view === 'all') && (
            <>
              <form className="capture" onSubmit={capture}>
                <label htmlFor="capture-thought">
                  Capture a task or thought
                </label>
                <div className="capture-controls">
                  <input
                    id="capture-thought"
                    maxLength={200}
                    required
                    value={preferences.draft}
                    disabled={saving || !!preferences.capture}
                    placeholder="What do you want to come back to?"
                    onChange={(event) => {
                      remember({ draft: event.target.value });
                      setSaved(false);
                    }}
                  />
                  <button
                    className="secondary"
                    disabled={saving || !preferences.draft.trim()}
                  >
                    {saving
                      ? 'Saving…'
                      : preferences.capture
                        ? 'Retry save'
                        : 'Save'}
                  </button>
                </div>
                <p className="meta">
                  Saved in Inbox and Later. Open the task to send Dot a request.
                </p>
                {saveError && (
                  <p className="error-text" role="alert">
                    {saveError}
                  </p>
                )}
                {(saved || preferences.undo) && (
                  <p role="status">
                    Saved in Later.{' '}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => showAll()}
                    >
                      Find saved thought
                    </button>
                    {preferences.undo && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={saving}
                        onClick={undoCapture}
                      >
                        Undo capture
                      </button>
                    )}
                  </p>
                )}
                {storageError && (
                  <p role="status">
                    Device storage is unavailable. Keep this page open to retain
                    your draft.
                  </p>
                )}
              </form>
              <ProjectManager
                state={workspaceState}
                viewerKey={data.viewerKey}
                onSaved={reloadAll}
                onOpenNote={openNote}
                onSelectProject={openProject}
              />
            </>
          )}
          {workspaceError && (
            <p role="alert" className="error-text">
              {workspaceError}
            </p>
          )}
        </div>
        {detailsOpen && selected && (
          <aside
            className="detail-pane"
            ref={panelRef}
            tabIndex={-1}
            aria-label={'Details for ' + selected.title}
          >
            <button className="back-button secondary" onClick={closeDetails}>
              Back to work
            </button>
            <TaskDetails
              key={selected.task_key}
              task={selected}
              tasks={tasks}
              now={data.clock}
              onSaved={reloadAll}
              onSelect={selectTask}
              onRead={data.markRead}
              viewerKey={data.viewerKey}
            />
            <LinkedNotes
              state={workspaceState}
              type="task"
              targetKey={selected.task_key}
              onOpen={openNote}
            />
          </aside>
        )}
      </div>
      <footer className="desk-footer">
        <Setup hasDotReport={tasks.some((task) => task.reporter === 'Dot')} />
        <p className="meta">
          {workspaceState.delivery.subscribed
            ? 'Agent notifications connected.'
            : 'Agent notifications are not connected yet. Requests stay queued until an agent reads them.'}
          {workspaceState.delivery.failed_notifications
            ? ' ' +
              workspaceState.delivery.failed_notifications +
              ' notifications failed. Reconnect the agent if retry does not recover them.'
            : ''}
          {workspaceState.delivery.pending_notifications > 0
            ? ' ' +
              workspaceState.delivery.pending_notifications +
              ' notifications awaiting delivery.'
            : ''}
        </p>
        <details className="utilities">
          <summary>More</summary>
          <button className="text-button" onClick={data.load}>
            Refresh saved reports
          </button>
          <button className="text-button" onClick={exportTasks}>
            Download complete record backup
          </button>
          <button
            className="text-button"
            disabled={backupBusy}
            onClick={createBackup}
          >
            {backupBusy ? 'Creating backup…' : 'Create private backup'}
          </button>
          <button
            className="text-button"
            onClick={async () => {
              await fetch('/api/workspace', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'retry_delivery' }),
              });
              await loadWorkspace();
            }}
          >
            Retry pending notifications
          </button>
          {backupMessage && <p role="status">{backupMessage}</p>}
          <p className="meta" title={absoluteTime(data.checkedAt)}>
            Read saved reports {relativeTime(data.checkedAt, data.clock)}.
          </p>
          <p className="meta">
            Search with ⌘K or /. Use arrow keys between task rows, Return to
            open, and Escape to return.
          </p>
        </details>
      </footer>
    </main>
  );
}
export default function Dashboard() {
  const data = useDeskData();
  if (!data.viewerKey)
    return (
      <main className="desk initial-state">
        <p className="brand">
          <span className="brand-dot" />
          Passforth
        </p>
        <h1>
          {data.loading
            ? 'Reading saved work…'
            : data.signedOut
              ? 'Sign in to Passforth'
              : 'Could not read saved work'}
        </h1>
        {data.error && <p role="alert">{data.error}</p>}
        {data.signedOut ? (
          <a className="primary" href={data.signInPath}>
            Sign in
          </a>
        ) : (
          !data.loading && (
            <button className="primary" onClick={data.load}>
              Try again
            </button>
          )
        )}
      </main>
    );
  return <Workspace key={data.viewerKey} data={data} />;
}
