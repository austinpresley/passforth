'use client';
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceState } from './organization';
import type { Task } from '../../lib/task-model';
import {
  DeskNote,
  NoteLink,
  TargetType,
  labelMatches,
  labelTree,
  localDay,
} from '../../lib/planning-model';
import { Conversation } from './conversation';
import { savePlanning } from './planning-client';

export function LinkedNotes({
  state,
  type,
  targetKey,
  onOpen,
}: {
  state: WorkspaceState;
  type: TargetType;
  targetKey: string;
  onOpen: (id: string) => void;
}) {
  const notes = state.notes.filter(
    (note) =>
      !note.archived &&
      state.note_links.some(
        (link) =>
          link.note_id === note.id &&
          link.target_type === type &&
          link.target_key === targetKey,
      ),
  );
  if (!notes.length) return null;
  return (
    <section className="linked-notes">
      <h3>Linked notes</h3>
      {notes.map((note) => (
        <button
          className="related-task"
          key={note.id}
          onClick={() => onOpen(note.id)}
        >
          {note.title}
        </button>
      ))}
    </section>
  );
}
// Markdown stays text. HTML, scripts and embedded remote content are never executed.
function NoteText({ body }: { body: string }) {
  return (
    <div className="note-reading">
      {body.split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h4 key={i}>{line.slice(4)}</h4>;
        if (line.startsWith('## ')) return <h3 key={i}>{line.slice(3)}</h3>;
        if (line.startsWith('# ')) return <h2 key={i}>{line.slice(2)}</h2>;
        if (/^[-*] /.test(line))
          return (
            <p className="note-bullet" key={i}>
              • {line.slice(2)}
            </p>
          );
        return line ? (
          <p key={i}>{line}</p>
        ) : (
          <div className="note-space" key={i} />
        );
      })}
    </div>
  );
}
type Draft = {
  id: string;
  title: string;
  body: string;
  tags: string;
  daily_on: string | null;
  archived: boolean;
  links: NoteLink[];
  expected_version: number;
};
function NoteEditor({
  note,
  state,
  tasks,
  viewerKey,
  onSaved,
  onSelect,
  onTask,
  onProject,
}: {
  note: DeskNote;
  state: WorkspaceState;
  tasks: Task[];
  viewerKey: string;
  onSaved: () => void | Promise<void>;
  onSelect: (id: string) => void;
  onTask: (task: Task) => void;
  onProject: (id: string) => void;
}) {
  const storageKey = 'dot-desk:note:' + viewerKey + ':' + note.id;
  const initial = (): Draft => ({
    id: note.id,
    title: note.title,
    body: note.body,
    tags: note.tags,
    daily_on: note.daily_on,
    archived: !!note.archived,
    links: state.note_links
      .filter((link) => link.note_id === note.id)
      .map(({ target_type, target_key }) => ({ target_type, target_key })),
    expected_version: note.version,
  });
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return saved.draft?.id === note.id ? saved.draft : initial();
    } catch {
      return initial();
    }
  });
  const [pending, setPending] = useState<(Draft & { event_id: string }) | null>(
    () => {
      try {
        return (
          JSON.parse(localStorage.getItem(storageKey) || '{}').pending ?? null
        );
      } catch {
        return null;
      }
    },
  );
  const [dirty, setDirty] = useState(() => {
    try {
      return !!localStorage.getItem(storageKey);
    } catch {
      return false;
    }
  });
  const [editing, setEditing] = useState(note.version === 0 || dirty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [linkType, setLinkType] = useState<TargetType>('task');
  const [linkKey, setLinkKey] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAttempt, setTaskAttempt] = useState<{
    task_key: string;
    title: string;
    event_id: string;
  } | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function persist(next: Draft, attempt: typeof pending = null) {
    setDraft(next);
    setPending(attempt);
    setDirty(true);
    setMessage('');
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ draft: next, pending: attempt }),
      );
    } catch {
      setError(
        'Device storage is unavailable. Keep this note open to retain the draft.',
      );
    }
  }
  useEffect(() => {
    if (!dirty && !pending) setDraft(initial());
  }, [note.version]);
  async function save() {
    if (busy) return;
    const attempt = pending ?? { ...draft, event_id: crypto.randomUUID() };
    persist(draft, attempt);
    setBusy(true);
    setError('');
    try {
      const result = await savePlanning('note', attempt);
      const record = result.record as unknown as DeskNote;
      localStorage.removeItem(storageKey);
      if (active.current) {
        setDraft({ ...draft, id: record.id, expected_version: record.version });
        setPending(null);
        setDirty(false);
        setEditing(false);
        setMessage('Note saved.');
      }
      await onSaved();
      onSelect(record.id);
    } catch (failure) {
      if (active.current) {
        if (
          (failure as { status?: number }).status &&
          (failure as { status: number }).status < 500
        )
          persist(draft, null);
        setError((failure as Error).message);
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const targets =
    linkType === 'task'
      ? tasks.map((task) => ({ id: task.task_key, title: task.title }))
      : linkType === 'project'
        ? state.projects
        : state.notes.filter((item) => item.id !== note.id);
  function targetLabel(link: NoteLink) {
    return link.target_type === 'task'
      ? tasks.find((item) => item.task_key === link.target_key)?.title
      : link.target_type === 'project'
        ? state.projects.find((item) => item.id === link.target_key)?.title
        : state.notes.find((item) => item.id === link.target_key)?.title;
  }
  function openLink(link: NoteLink) {
    if (link.target_type === 'note') onSelect(link.target_key);
    else if (link.target_type === 'project') onProject(link.target_key);
    else {
      const task = tasks.find((item) => item.task_key === link.target_key);
      if (task) onTask(task);
    }
  }
  return (
    <article
      className="note-editor"
      aria-label={'Note ' + (note.title || 'Untitled')}
    >
      {note.version > 0 && (
        <div className="button-row">
          <button
            className="secondary"
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Read note' : 'Edit note'}
          </button>
          {dirty && <span className="meta">Unsaved draft on this device</span>}
        </div>
      )}
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy || !!pending} className="note-fields">
            <label>
              Note title
              <input
                required
                maxLength={200}
                value={draft.title}
                onChange={(e) => persist({ ...draft, title: e.target.value })}
              />
            </label>
            {draft.daily_on && (
              <p className="meta">Daily Note for {draft.daily_on}</p>
            )}
            <label>
              Note
              <textarea
                rows={12}
                maxLength={50000}
                value={draft.body}
                placeholder="Brief, decisions, references, or today's notes. Use # for headings and - for lists."
                onChange={(e) => persist({ ...draft, body: e.target.value })}
              />
            </label>
            <label>
              Labels
              <input
                maxLength={1000}
                value={draft.tags}
                placeholder="studio client/portraits"
                onChange={(e) => persist({ ...draft, tags: e.target.value })}
              />
            </label>
            <label className="checklist-item">
              <input
                type="checkbox"
                checked={draft.archived}
                onChange={(e) =>
                  persist({ ...draft, archived: e.target.checked })
                }
              />
              Archive note
            </label>
            <h3>Link work &amp; notes</h3>
            <div className="note-link-controls">
              <label>
                Link type
                <select
                  value={linkType}
                  onChange={(e) => {
                    setLinkType(e.target.value as TargetType);
                    setLinkKey('');
                  }}
                >
                  <option value="task">Task</option>
                  <option value="project">Project</option>
                  <option value="note">Note</option>
                </select>
              </label>
              <label>
                Link to
                <select
                  value={linkKey}
                  onChange={(e) => setLinkKey(e.target.value)}
                >
                  <option value="">Choose {linkType}</option>
                  {targets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary"
                type="button"
                disabled={
                  !linkKey ||
                  draft.links.some(
                    (link) =>
                      link.target_type === linkType &&
                      link.target_key === linkKey,
                  )
                }
                onClick={() => {
                  persist({
                    ...draft,
                    links: [
                      ...draft.links,
                      { target_type: linkType, target_key: linkKey },
                    ],
                  });
                  setLinkKey('');
                }}
              >
                Add link
              </button>
            </div>
          </fieldset>
          <div className="button-row">
            <button className="primary" disabled={busy || !draft.title.trim()}>
              {busy ? 'Saving…' : pending ? 'Retry note save' : 'Save note'}
            </button>
            {note.version > 0 && (
              <button
                type="button"
                className="text-button"
                disabled={busy || !!pending}
                onClick={() => {
                  const next = initial();
                  setDraft(next);
                  setPending(null);
                  setDirty(false);
                  localStorage.removeItem(storageKey);
                  setError('');
                  setMessage('Saved version loaded.');
                }}
              >
                Discard draft &amp; reload saved note
              </button>
            )}
          </div>
        </form>
      ) : (
        <>
          <h2>{draft.title}</h2>
          {draft.daily_on && (
            <p className="meta">Daily Note for {draft.daily_on}</p>
          )}
          <NoteText body={draft.body} />
        </>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="meta">
          {message}
        </p>
      )}
      {!!draft.links.length && (
        <section className="note-work">
          <h3>Linked work &amp; notes</h3>
          {draft.links.map((link) => (
            <div
              className="note-link-row"
              key={link.target_type + ':' + link.target_key}
            >
              <button className="related-task" onClick={() => openLink(link)}>
                {targetLabel(link) || 'Unavailable ' + link.target_type}
                {link.target_type === 'task' &&
                tasks.find((task) => task.task_key === link.target_key)
                  ?.status === 'completed'
                  ? ' · Completed'
                  : ''}
              </button>
              {editing && (
                <button
                  className="text-button"
                  disabled={busy || !!pending}
                  aria-label={'Unlink ' + targetLabel(link)}
                  onClick={() =>
                    persist({
                      ...draft,
                      links: draft.links.filter((item) => item !== link),
                    })
                  }
                >
                  Unlink
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {note.version > 0 && (
        <>
          <LinkedNotes
            state={state}
            type="note"
            targetKey={note.id}
            onOpen={onSelect}
          />
          <details className="note-new-task">
            <summary>Create a task from this note</summary>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy || dirty || pending) return;
                const attempt = taskAttempt ?? {
                  task_key: 'note-' + crypto.randomUUID(),
                  title: taskTitle.trim(),
                  event_id: crypto.randomUUID(),
                };
                setTaskAttempt(attempt);
                setBusy(true);
                setError('');
                try {
                  const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ...attempt,
                      expected_version: 0,
                      status: 'paused',
                      summary:
                        'Captured from ' + note.title.slice(0, 150) + '.',
                      action_owner: 'unknown',
                    }),
                    signal: AbortSignal.timeout(15000),
                  });
                  const result = (await response.json()) as { error?: string };
                  if (!response.ok)
                    throw new Error(result.error || 'Task save not confirmed.');
                  const links = [
                    ...draft.links.filter(
                      (link) =>
                        !(
                          link.target_type === 'task' &&
                          link.target_key === attempt.task_key
                        ),
                    ),
                    {
                      target_type: 'task' as const,
                      target_key: attempt.task_key,
                    },
                  ];
                  await savePlanning('note', {
                    ...draft,
                    links,
                    event_id: 'link-' + attempt.event_id,
                  });
                  setDraft({
                    ...draft,
                    links,
                    expected_version: draft.expected_version + 1,
                  });
                  setTaskAttempt(null);
                  setTaskTitle('');
                  setMessage('Task created and linked.');
                  await onSaved();
                } catch (failure) {
                  setError(
                    (failure as Error).message +
                      ' If the task was saved, it remains in Inbox. Retry to link it.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Task title
                <input
                  required
                  maxLength={200}
                  value={taskTitle}
                  disabled={busy || !!taskAttempt}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
              </label>
              <button
                className="secondary"
                disabled={busy || dirty || !!pending || !taskTitle.trim()}
              >
                {taskAttempt ? 'Retry linked task' : 'Create linked task'}
              </button>
              {dirty && (
                <p className="meta">
                  Save this note before creating a linked task.
                </p>
              )}
            </form>
          </details>
          <Conversation
            type="note"
            targetKey={note.id}
            viewerKey={viewerKey}
            onSaved={onSaved}
          />
        </>
      )}
    </article>
  );
}
export function Notes({
  state,
  tasks,
  viewerKey,
  selected,
  onSelect,
  onSaved,
  onTask,
  onProject,
}: {
  state: WorkspaceState;
  tasks: Task[];
  viewerKey: string;
  selected: string;
  onSelect: (id: string) => void;
  onSaved: () => void | Promise<void>;
  onTask: (task: Task) => void;
  onProject: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [archived, setArchived] = useState(false);
  const [daily, setDaily] = useState(localDay());
  const [newNote, setNewNote] = useState<DeskNote | null>(null);
  function create(day: string | null = null) {
    const existing = day && state.notes.find((note) => note.daily_on === day);
    if (existing) {
      onSelect(existing.id);
      return;
    }
    const note: DeskNote = {
      id: day ? 'daily-' + day : 'note-' + crypto.randomUUID(),
      title: day
        ? new Date(day + 'T12:00:00').toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })
        : '',
      body: '',
      tags: '',
      daily_on: day,
      archived: 0,
      version: 0,
      created_at: '',
      updated_at: '',
    };
    setNewNote(note);
    onSelect(note.id);
  }
  const drafts: DeskNote[] = [];
  try {
    const prefix = 'dot-desk:note:' + viewerKey + ':';
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const value = JSON.parse(localStorage.getItem(key) || '{}')
        .draft as Draft;
      if (
        value?.id &&
        !value.expected_version &&
        !state.notes.some((item) => item.id === value.id)
      )
        drafts.push({
          ...value,
          archived: Number(value.archived),
          version: 0,
          title: value.title || 'Untitled draft',
          created_at: '',
          updated_at: '',
        });
    }
  } catch {
    /* The editor reports storage failures while retaining its open draft. */
  }
  const note =
    state.notes.find((item) => item.id === selected) ??
    (newNote?.id === selected
      ? newNote
      : (drafts.find((item) => item.id === selected) ?? null));
  const shown = state.notes.filter(
    (item) =>
      (archived || !item.archived) &&
      labelMatches(item.tags, tag) &&
      query
        .toLowerCase()
        .split(/\s+/)
        .every((word) =>
          (item.title + ' ' + item.body + ' ' + item.tags)
            .toLowerCase()
            .includes(word),
        ),
  );
  return (
    <section className="notes-section">
      <div className="section-heading">
        <h1>Notes</h1>
        <button className="secondary" onClick={() => create()}>
          New note
        </button>
      </div>
      <div className="daily-controls">
        <label>
          Daily note date
          <input
            type="date"
            value={daily}
            required
            onChange={(e) => setDaily(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={!daily}
          onClick={() => create(daily)}
        >
          Open Daily Note
        </button>
        <button
          className="text-button"
          onClick={() => {
            setDaily(localDay());
            create(localDay());
          }}
        >
          Today
        </button>
      </div>
      <div className="notes-layout">
        <div className="note-library">
          <label>
            Search notes
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Label
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">All labels</option>
              {labelTree(state.notes.map((item) => item.tags)).map((label) => (
                <option key={label} value={label}>
                  {label.replaceAll('/', ' / ')}
                </option>
              ))}
            </select>
          </label>
          <label className="checklist-item">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Include archived
          </label>
          {drafts.map((item) => (
            <button
              key={item.id}
              className="note-choice"
              aria-current={selected === item.id}
              onClick={() => onSelect(item.id)}
            >
              <strong>{item.title}</strong>
              <span>Unsaved draft on this device</span>
            </button>
          ))}
          {shown.map((item) => (
            <button
              key={item.id}
              className="note-choice"
              aria-current={selected === item.id}
              onClick={() => onSelect(item.id)}
            >
              <strong>{item.title}</strong>
              <span>
                {item.daily_on
                  ? 'Daily Note · ' + item.daily_on
                  : item.tags || item.body.slice(0, 90) || 'Empty note'}
                {item.archived ? ' · Archived' : ''}
              </span>
            </button>
          ))}
          {!shown.length && (
            <p className="meta">
              {state.notes.length
                ? 'No notes match these filters.'
                : 'Keep briefs and reference notes here. Link a note to any tasks or projects that need it.'}
            </p>
          )}
        </div>
        <div>
          {note ? (
            <NoteEditor
              key={note.id}
              note={note}
              state={state}
              tasks={tasks}
              viewerKey={viewerKey}
              onSaved={onSaved}
              onSelect={onSelect}
              onTask={onTask}
              onProject={onProject}
            />
          ) : (
            <p className="lead">Open a note or start a Daily Note.</p>
          )}
        </div>
      </div>
    </section>
  );
}
