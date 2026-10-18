'use client';
import { useRef, useState } from 'react';
import { Task, isDone } from '../../lib/task-model';
import {
  TimeBlock,
  addDays,
  blocksOverlap,
  localDay,
  weekDays,
} from '../../lib/planning-model';
import { savePlanning } from './planning-client';
function localInput(iso: string) {
  const date = new Date(iso);
  return (
    localDay(date) +
    'T' +
    String(date.getHours()).padStart(2, '0') +
    ':' +
    String(date.getMinutes()).padStart(2, '0')
  );
}
type BlockDraft = {
  id: string;
  task_key: string;
  local_start: string;
  duration_minutes: number;
  expected_version: number;
  archived: boolean;
};
export function Week({
  tasks,
  blocks,
  onTask,
  onSaved,
}: {
  tasks: Task[];
  blocks: TimeBlock[];
  onTask: (task: Task) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [anchor, setAnchor] = useState(localDay());
  const days = weekDays(anchor);
  const [taskKey, setTaskKey] = useState('');
  const [planDay, setPlanDay] = useState(localDay());
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{
    kind: 'block' | 'plan';
    body: Record<string, unknown>;
  } | null>(null);
  const drag = useRef<{ task: string; block?: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const active = tasks.filter((task) => !isDone(task));
  async function commit(kind: 'block' | 'plan', body: Record<string, unknown>) {
    if (busy) return;
    const attempt = pending ?? { kind, body };
    setPending(attempt);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (attempt.kind === 'block') await savePlanning('block', attempt.body);
      else {
        const response = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attempt.body),
          signal: AbortSignal.timeout(15000),
        });
        const value = (await response.json()) as { error?: string };
        if (!response.ok)
          throw Object.assign(
            new Error(value.error || 'Planning save not confirmed.'),
            { status: response.status },
          );
      }
      setPending(null);
      setDraft(null);
      setMessage(
        attempt.kind === 'plan'
          ? 'Planned day saved.'
          : attempt.body.archived
            ? 'Time block removed.'
            : 'Time block saved.',
      );
      await onSaved();
    } catch (failure) {
      if (
        (failure as { status?: number }).status &&
        (failure as { status: number }).status < 500
      )
        setPending(null);
      setError(
        (failure as Error).message + ' Your planning fields are retained.',
      );
    } finally {
      setBusy(false);
    }
  }
  function startDrag(
    event: React.DragEvent,
    source: { task: string; block?: string },
  ) {
    drag.current = source;
    event.dataTransfer.setData(
      'application/x-dot-desk-plan',
      JSON.stringify(source),
    );
    event.dataTransfer.effectAllowed = 'move';
  }
  function plan(task: Task, day: string | null) {
    void commit('plan', {
      task_key: task.task_key,
      planned_on: day,
      expected_version: task.version,
      event_id: crypto.randomUUID(),
    });
  }
  function edit(block?: TimeBlock, day = anchor) {
    setDraft(
      block
        ? {
            id: block.id,
            task_key: block.task_key,
            local_start: localInput(block.starts_at),
            duration_minutes: block.duration_minutes,
            expected_version: block.version,
            archived: false,
          }
        : {
            id: 'block-' + crypto.randomUUID(),
            task_key: taskKey || active[0]?.task_key || '',
            local_start: day + 'T09:00',
            duration_minutes: 60,
            expected_version: 0,
            archived: false,
          },
    );
    setError('');
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }
  function blockBody(value: BlockDraft) {
    const date = new Date(value.local_start);
    if (
      !Number.isFinite(date.getTime()) ||
      localInput(date.toISOString()) !== value.local_start
    )
      throw new Error('This local time does not exist. Choose another time.');
    return {
      id: value.id,
      task_key: value.task_key,
      starts_at: date.toISOString(),
      duration_minutes: value.duration_minutes,
      timezone,
      expected_version: value.expected_version,
      archived: value.archived,
      event_id: crypto.randomUUID(),
    };
  }
  const visibleBlocks = blocks.filter((block) => !block.archived);
  return (
    <section className="week-section">
      <div className="section-heading">
        <h1>Week</h1>
        <button
          className="secondary"
          disabled={!active.length || busy || !!pending}
          onClick={() => edit()}
        >
          Add time block
        </button>
      </div>
      <div className="week-navigation">
        <button
          className="secondary"
          aria-label="Previous week"
          onClick={() => setAnchor(addDays(anchor, -7))}
        >
          Previous
        </button>
        <h2>
          {new Date(days[0] + 'T12:00:00').toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}{' '}
          to{' '}
          {new Date(days[6] + 'T12:00:00').toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </h2>
        <button
          className="secondary"
          aria-label="Next week"
          onClick={() => setAnchor(addDays(anchor, 7))}
        >
          Next
        </button>
        <button className="text-button" onClick={() => setAnchor(localDay())}>
          This week
        </button>
      </div>
      <p className="meta">
        Times in {timezone.replaceAll('_', ' ')}. Drag tasks between days, or
        use Plan a day below. Deadlines stay fixed when you move a plan.
      </p>
      <div className="week-grid">
        {days.map((day) => {
          const planned = active.filter((task) => task.planned_on === day);
          const due = active.filter((task) => task.deadline === day);
          const dayBlocks = visibleBlocks.filter(
            (block) => localDay(new Date(block.starts_at)) === day,
          );
          return (
            <section
              key={day}
              className={'week-day' + (day === localDay() ? ' is-today' : '')}
              aria-label={day}
              onDragOver={(event) => {
                if (drag.current && !busy && !pending) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = drag.current;
                drag.current = null;
                if (!source || busy || pending) return;
                const task = tasks.find(
                  (item) => item.task_key === source.task,
                );
                if (!task) return;
                if (source.block) {
                  const block = visibleBlocks.find(
                    (item) => item.id === source.block,
                  );
                  if (!block) return;
                  try {
                    void commit(
                      'block',
                      blockBody({
                        id: block.id,
                        task_key: block.task_key,
                        local_start:
                          day + localInput(block.starts_at).slice(10),
                        duration_minutes: block.duration_minutes,
                        expected_version: block.version,
                        archived: false,
                      }),
                    );
                  } catch (failure) {
                    setError((failure as Error).message);
                  }
                } else plan(task, day);
              }}
            >
              <h3>
                <span>
                  {new Date(day + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'short',
                  })}
                </span>
                <time dateTime={day}>
                  {new Date(day + 'T12:00:00').getDate()}
                </time>
              </h3>
              {due.map((task) => (
                <button
                  key={'due:' + task.task_key}
                  className="calendar-deadline"
                  onClick={() => onTask(task)}
                >
                  Due · {task.title}
                </button>
              ))}
              {planned.map((task) => (
                <button
                  draggable={!busy && !pending}
                  onDragStart={(event) =>
                    startDrag(event, { task: task.task_key })
                  }
                  onDragEnd={() => {
                    drag.current = null;
                  }}
                  className="calendar-task"
                  key={task.task_key}
                  onClick={() => onTask(task)}
                >
                  {task.title}
                </button>
              ))}
              {dayBlocks.map((block) => {
                const task = tasks.find(
                  (item) => item.task_key === block.task_key,
                );
                const overlap = visibleBlocks.some((other) =>
                  blocksOverlap(block, other),
                );
                return (
                  <div
                    key={block.id}
                    className={'calendar-block' + (overlap ? ' overlaps' : '')}
                    draggable={!busy && !pending}
                    onDragStart={(event) =>
                      startDrag(event, {
                        task: block.task_key,
                        block: block.id,
                      })
                    }
                    onDragEnd={() => {
                      drag.current = null;
                    }}
                  >
                    <button onClick={() => edit(block)}>
                      <span>
                        {new Date(block.starts_at).toLocaleTimeString(
                          undefined,
                          { hour: 'numeric', minute: '2-digit' },
                        )}{' '}
                        · {block.duration_minutes}m
                      </span>
                      <strong>
                        {task?.title || 'Unavailable task'}
                        {task && isDone(task)
                          ? ' · ' +
                            (task.status === 'completed'
                              ? 'Completed'
                              : 'Cancelled')
                          : ''}
                      </strong>
                      {overlap && (
                        <span className="report-concern">
                          Overlaps another block
                        </span>
                      )}
                    </button>
                    <button
                      className="text-button"
                      disabled={!task}
                      onClick={() => task && onTask(task)}
                    >
                      Open task
                    </button>
                  </div>
                );
              })}
              {!planned.length && !dayBlocks.length && !due.length && (
                <p className="calendar-empty">No plan</p>
              )}
              <button
                className="text-button"
                disabled={!active.length || busy || !!pending}
                aria-label={'Add time block on ' + day}
                onClick={() => edit(undefined, day)}
              >
                Add block
              </button>
            </section>
          );
        })}
      </div>
      <div ref={formRef} className="week-forms">
        <form
          className="plan-day"
          onSubmit={(event) => {
            event.preventDefault();
            const task = tasks.find((item) => item.task_key === taskKey);
            if (task) plan(task, planDay || null);
          }}
        >
          <h2>Plan a day</h2>
          <fieldset disabled={busy || !!pending}>
            <label>
              Task to plan
              <select
                required
                value={taskKey}
                onChange={(event) => setTaskKey(event.target.value)}
              >
                <option value="">Choose a task</option>
                {active.map((task) => (
                  <option key={task.task_key} value={task.task_key}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Planned day
              <input
                type="date"
                value={planDay}
                onChange={(event) => setPlanDay(event.target.value)}
              />
            </label>
            <div className="button-row">
              <button className="secondary" disabled={!taskKey || !planDay}>
                Save planned day
              </button>
              <button
                className="text-button"
                type="button"
                disabled={!taskKey}
                onClick={() => {
                  const task = tasks.find((item) => item.task_key === taskKey);
                  if (task) plan(task, null);
                }}
              >
                Clear planned day
              </button>
            </div>
          </fieldset>
        </form>
        {draft && (
          <form
            className="time-block-form"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                void commit('block', blockBody(draft));
              } catch (failure) {
                setError((failure as Error).message);
              }
            }}
          >
            <h2>
              {draft.expected_version ? 'Edit time block' : 'New time block'}
            </h2>
            <fieldset disabled={busy || !!pending}>
              <label>
                Task for time block
                <select
                  required
                  value={draft.task_key}
                  onChange={(event) =>
                    setDraft({ ...draft, task_key: event.target.value })
                  }
                >
                  <option value="">Choose a task</option>
                  {tasks
                    .filter(
                      (task) =>
                        !isDone(task) || task.task_key === draft.task_key,
                    )
                    .map((task) => (
                      <option key={task.task_key} value={task.task_key}>
                        {task.title}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Start time
                <input
                  required
                  type="datetime-local"
                  value={draft.local_start}
                  onChange={(event) =>
                    setDraft({ ...draft, local_start: event.target.value })
                  }
                />
              </label>
              <label>
                Minutes
                <input
                  required
                  type="number"
                  min={15}
                  max={720}
                  step={15}
                  value={draft.duration_minutes}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      duration_minutes: Number(event.target.value),
                    })
                  }
                />
              </label>
              <div className="button-row">
                <button className="primary">Save time block</button>
                {draft.expected_version > 0 && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      try {
                        void commit(
                          'block',
                          blockBody({ ...draft, archived: true }),
                        );
                      } catch (failure) {
                        setError((failure as Error).message);
                      }
                    }}
                  >
                    Remove time block
                  </button>
                )}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          </form>
        )}
      </div>
      {pending && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void commit(pending.kind, pending.body)}
        >
          {busy ? 'Saving…' : 'Retry planning save'}
        </button>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="meta" role="status">
          {message}
        </p>
      )}
      <details className="unplanned">
        <summary>
          Unplanned tasks{' '}
          <span>
            {
              active.filter(
                (task) =>
                  !task.planned_on &&
                  !visibleBlocks.some(
                    (block) => block.task_key === task.task_key,
                  ),
              ).length
            }
          </span>
        </summary>
        {active
          .filter(
            (task) =>
              !task.planned_on &&
              !visibleBlocks.some((block) => block.task_key === task.task_key),
          )
          .map((task) => (
            <button
              className="calendar-task"
              draggable={!busy && !pending}
              onDragStart={(event) => startDrag(event, { task: task.task_key })}
              onDragEnd={() => {
                drag.current = null;
              }}
              key={task.task_key}
              onClick={() => onTask(task)}
            >
              {task.title}
            </button>
          ))}
      </details>
      <p className="meta">
        Time blocks reserve planning time. Agent work starts with an explicit
        request. Reminders and external calendar sync are not connected.
      </p>
    </section>
  );
}
