'use client';
import { useEffect, useState } from 'react';
import { Task, statusLabels } from '../../lib/task-model';
import { Conversation } from './conversation';
import { LinkedNotes } from './notes';
import type {
  DeskNote,
  StoredNoteLink,
  SavedView,
  TimeBlock,
} from '../../lib/planning-model';

export interface Area {
  id: string;
  title: string;
  version: number;
  archived: number;
}
export interface Project extends Area {
  area_id: string;
  notes: string;
}
export interface WorkspaceState {
  areas: Area[];
  projects: Project[];
  notes: DeskNote[];
  note_links: StoredNoteLink[];
  saved_views: SavedView[];
  time_blocks: TimeBlock[];
  requests: {
    id: string;
    target_type: string;
    target_key: string;
    state: string;
  }[];
  delivery: {
    subscribed: boolean;
    failed_notifications?: number;
    pending_notifications: number;
  };
}
export const emptyWorkspace: WorkspaceState = {
  areas: [],
  projects: [],
  notes: [],
  note_links: [],
  saved_views: [],
  time_blocks: [],
  requests: [],
  delivery: { subscribed: false, pending_notifications: 0 },
};
export function TaskOrganization({
  task,
  onSaved,
}: {
  task: Task;
  onSaved: () => void | Promise<void>;
}) {
  const [state, setState] = useState(emptyWorkspace);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(() => ({
    area_id: task.area_id || '',
    project_id: task.project_id || '',
    planned_on: task.planned_on || '',
    deadline: task.deadline || '',
    priority: task.priority || 0,
    tags: task.tags || '',
    checklist: task.checklist || '[]',
    status: task.status,
  }));
  const [version, setVersion] = useState(task.version);
  const [attempt, setAttempt] = useState<Record<string, unknown> | null>(null);
  const [newStep, setNewStep] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/workspace', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not read projects.');
        setState((await response.json()) as WorkspaceState);
      })
      .catch((failure) => {
        if (failure.name !== 'AbortError') setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!attempt) {
      setDraft({
        area_id: task.area_id || '',
        project_id: task.project_id || '',
        planned_on: task.planned_on || '',
        deadline: task.deadline || '',
        priority: task.priority || 0,
        tags: task.tags || '',
        checklist: task.checklist || '[]',
        status: task.status,
      });
      setVersion(task.version);
    }
  }, [task.task_key]); // Preserve edits and their original version through refresh.
  let items: { text: string; done: boolean }[] = [];
  try {
    items = JSON.parse(draft.checklist);
  } catch {
    /* server validates before saving */
  }
  return (
    <details className="task-organization">
      <summary>Plan &amp; organize</summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          const body = attempt ?? {
            task_key: task.task_key,
            expected_version: version,
            event_id: crypto.randomUUID(),
            ...draft,
            planned_on: draft.planned_on || null,
            deadline: draft.deadline || null,
          };
          setAttempt(body);
          try {
            const response = await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(12000),
            });
            const result = (await response.json()) as {
              error?: string;
              task: Task;
              id: string;
              version: number;
            };
            if (!response.ok) {
              if (response.status < 500 && response.status !== 429)
                setAttempt(null);
              throw new Error(result.error || 'Save not confirmed.');
            }
            setAttempt(null);
            setVersion(result.task.version);
            await onSaved();
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="planning-fields">
          <label>
            Area
            <select
              disabled={busy || !!attempt}
              value={draft.area_id}
              onChange={(event) =>
                setDraft({ ...draft, area_id: event.target.value })
              }
            >
              <option value="">No area</option>
              {state.areas
                .filter((item) => !item.archived || item.id === draft.area_id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Project
            <select
              disabled={busy || !!attempt}
              value={draft.project_id}
              onChange={(event) => {
                const project = state.projects.find(
                  (item) => item.id === event.target.value,
                );
                setDraft({
                  ...draft,
                  project_id: event.target.value,
                  area_id: project?.area_id || draft.area_id,
                });
              }}
            >
              <option value="">No project</option>
              {state.projects
                .filter(
                  (item) => !item.archived || item.id === draft.project_id,
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Plan for
            <input
              disabled={busy || !!attempt}
              type="date"
              value={draft.planned_on}
              onChange={(event) =>
                setDraft({ ...draft, planned_on: event.target.value })
              }
            />
          </label>
          <label>
            Deadline
            <input
              disabled={busy || !!attempt}
              type="date"
              value={draft.deadline}
              onChange={(event) =>
                setDraft({ ...draft, deadline: event.target.value })
              }
            />
          </label>
          <label>
            Priority
            <select
              disabled={busy || !!attempt}
              value={draft.priority}
              onChange={(event) =>
                setDraft({ ...draft, priority: Number(event.target.value) })
              }
            >
              <option value={0}>Normal</option>
              <option value={1}>Important</option>
              <option value={2}>High</option>
              <option value={3}>Urgent</option>
            </select>
          </label>
          <label>
            Status
            <select
              disabled={busy || !!attempt}
              value={draft.status}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  status: event.target.value as Task['status'],
                })
              }
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Labels
          <input
            disabled={busy || !!attempt}
            value={draft.tags}
            maxLength={1000}
            placeholder="client studio admin"
            onChange={(event) =>
              setDraft({ ...draft, tags: event.target.value })
            }
          />
        </label>
        <fieldset disabled={busy || !!attempt}>
          <legend>Checklist</legend>
          {items.map((item, index) => (
            <label className="checklist-item" key={index}>
              <input
                type="checkbox"
                checked={item.done}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    checklist: JSON.stringify(
                      items.map((step, i) =>
                        i === index
                          ? { ...step, done: event.target.checked }
                          : step,
                      ),
                    ),
                  })
                }
              />
              <span>{item.text}</span>
              <button
                className="text-button"
                type="button"
                aria-label={'Remove ' + item.text}
                onClick={() =>
                  setDraft({
                    ...draft,
                    checklist: JSON.stringify(
                      items.filter((_, i) => i !== index),
                    ),
                  })
                }
              >
                Remove
              </button>
            </label>
          ))}
          <label>
            Add a step
            <input
              maxLength={500}
              value={newStep}
              onChange={(event) => setNewStep(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!newStep.trim() || items.length >= 100}
            onClick={() => {
              setDraft({
                ...draft,
                checklist: JSON.stringify([
                  ...items,
                  { text: newStep.trim(), done: false },
                ]),
              });
              setNewStep('');
            }}
          >
            Add step
          </button>
        </fieldset>
        <p className="meta">
          Planning, deadlines and promised check-ins are separate. Changing a
          saved status does not start or stop an agent.
        </p>
        <div className="button-row">
          <button className="secondary" disabled={busy}>
            {busy ? 'Saving…' : attempt ? 'Retry plan' : 'Save plan'}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={busy || !!attempt}
            onClick={() => {
              setDraft({
                area_id: task.area_id || '',
                project_id: task.project_id || '',
                planned_on: task.planned_on || '',
                deadline: task.deadline || '',
                priority: task.priority || 0,
                tags: task.tags || '',
                checklist: task.checklist || '[]',
                status: task.status,
              });
              setVersion(task.version);
              setError('');
            }}
          >
            Reload saved plan
          </button>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
export function ProjectManager({
  state,
  viewerKey,
  onSaved,
  onSelectProject,
  onOpenNote,
}: {
  state: WorkspaceState;
  viewerKey: string;
  onSaved: () => void | Promise<void>;
  onSelectProject: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const project = state.projects.find((item) => item.id === selected);
  const [draft, setDraft] = useState({
    type: 'project',
    id: crypto.randomUUID(),
    title: '',
    notes: '',
    area_id: '',
    expected_version: 0,
    archived: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <details className="project-manager">
      <summary>Areas &amp; projects</summary>
      <div className="project-links">
        {state.projects
          .filter((item) => !item.archived)
          .map((item) => (
            <button
              disabled={busy}
              className="related-task"
              key={item.id}
              onClick={() => {
                setSelected(item.id);
                setDraft({
                  type: 'project',
                  id: item.id,
                  title: item.title,
                  notes: item.notes,
                  area_id: item.area_id,
                  expected_version: item.version,
                  archived: !!item.archived,
                });
              }}
            >
              {item.title}
            </button>
          ))}
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const response = await fetch('/api/workspace', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'entity', ...draft }),
              signal: AbortSignal.timeout(12000),
            });
            const result = (await response.json()) as {
              error?: string;
              task: Task;
              id: string;
              version: number;
            };
            if (!response.ok) throw new Error(result.error || 'Save failed.');
            setDraft({
              ...draft,
              id: result.id,
              expected_version: result.version,
            });
            if (draft.type === 'project') setSelected(result.id);
            await onSaved();
          } catch (failure) {
            setError((failure as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="button-row">
          <button
            disabled={busy}
            type="button"
            className="secondary"
            onClick={() => {
              setSelected('');
              setDraft({
                type: 'project',
                id: crypto.randomUUID(),
                title: '',
                notes: '',
                area_id: '',
                expected_version: 0,
                archived: false,
              });
            }}
          >
            New project
          </button>
          <button
            disabled={busy}
            type="button"
            className="secondary"
            onClick={() => {
              setSelected('');
              setDraft({
                type: 'area',
                id: crypto.randomUUID(),
                title: '',
                notes: '',
                area_id: '',
                expected_version: 0,
                archived: false,
              });
            }}
          >
            New area
          </button>
        </div>
        <fieldset className="entity-fields" disabled={busy}>
          <label>
            {draft.type === 'area' ? 'Area name' : 'Project outcome'}
            <input
              required
              maxLength={200}
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
            />
          </label>
          {draft.type === 'project' && (
            <>
              <label>
                Area
                <select
                  value={draft.area_id}
                  onChange={(event) =>
                    setDraft({ ...draft, area_id: event.target.value })
                  }
                >
                  <option value="">No area</option>
                  {state.areas
                    .filter((item) => !item.archived)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Brief &amp; reference notes
                <textarea
                  rows={4}
                  value={draft.notes}
                  maxLength={20000}
                  onChange={(event) =>
                    setDraft({ ...draft, notes: event.target.value })
                  }
                />
              </label>
            </>
          )}
          <label className="checklist-item">
            <input
              type="checkbox"
              checked={draft.archived}
              onChange={(event) =>
                setDraft({ ...draft, archived: event.target.checked })
              }
            />
            Archive this {draft.type}
          </label>
          <button className="secondary" disabled={busy}>
            {busy ? 'Saving…' : 'Save ' + draft.type}
          </button>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </fieldset>
      </form>
      <details>
        <summary>Manage areas &amp; archived projects</summary>
        {state.areas.map((item) => (
          <button
            disabled={busy}
            key={item.id}
            className="related-task"
            onClick={() => {
              setSelected('');
              setDraft({
                type: 'area',
                id: item.id,
                title: item.title,
                notes: '',
                area_id: '',
                expected_version: item.version,
                archived: !!item.archived,
              });
            }}
          >
            {item.title}
            {item.archived ? ' · Archived' : ''}
          </button>
        ))}
        {state.projects
          .filter((item) => item.archived)
          .map((item) => (
            <button
              disabled={busy}
              key={item.id}
              className="related-task"
              onClick={() => {
                setSelected(item.id);
                setDraft({
                  type: 'project',
                  id: item.id,
                  title: item.title,
                  notes: item.notes,
                  area_id: item.area_id,
                  expected_version: item.version,
                  archived: true,
                });
              }}
            >
              {item.title} · Archived
            </button>
          ))}
      </details>
      {project && (
        <section>
          <h3>{project.title}</h3>
          <button
            disabled={busy}
            className="secondary"
            onClick={() => onSelectProject(project.id)}
          >
            Show project tasks
          </button>
          <LinkedNotes
            state={state}
            type="project"
            targetKey={project.id}
            onOpen={onOpenNote}
          />
          <Conversation
            key={project.id}
            type="project"
            targetKey={project.id}
            viewerKey={viewerKey}
            onSaved={onSaved}
          />
        </section>
      )}
    </details>
  );
}
