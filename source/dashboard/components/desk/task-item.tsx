'use client';
import { useEffect, useState } from 'react';
import { Conversation } from './conversation';
import { TaskOrganization } from './organization';
import {
  Task, ActionOwner, absoluteTime, relativeTime, statusLabels, ownerLabels, reportConcern,
  isWaiting, needsYou, taskLine, sourceLabel, reportTime, unread,
} from '../../lib/task-model';

type Change = Record<string, string | number | null>;
type Saved = () => void | Promise<void>;
function useTaskMutation(task: Task, onSaved: Saved) {
  const [pending, setPending] = useState<Change | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(fields: Change = {}) {
    if (saving) return false;
    const attempt = pending ?? { task_key: task.task_key, expected_version: task.version, ...fields, event_id: crypto.randomUUID() };
    const focused = document.activeElement as HTMLElement | null;
    setPending(attempt); setSaving(true); setError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(attempt), signal: AbortSignal.timeout(12000),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) setPending(null);
        if (response.status === 409 || response.status === 401) await onSaved();
        throw new Error(result.error || 'Save was not confirmed.');
      }
      setPending(null); await onSaved(); return true;
    } catch (failure) { setError((failure as Error).message); return false; }
    finally {
      setSaving(false);
      requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        const enabled = focused?.isConnected && !focused.matches(':disabled');
        const target = enabled ? focused : focused?.closest('form')?.querySelector<HTMLElement>('select:not(:disabled),input:not(:disabled),textarea:not(:disabled)');
        (target || document.querySelector<HTMLElement>('.detail-pane'))?.focus();
      });
    }
  }
  return { save, pending, saving, error };
}

export function TaskLinks({ task, primary = false }: { task: Task; primary?: boolean }) {
  return <div className="task-links">
    {task.conversation_url && <a className={primary && needsYou(task) ? 'primary' : 'secondary'} href={task.conversation_url} target="_blank" rel="noreferrer">
      {needsYou(task) ? 'Answer in Dot' : 'Open conversation'}</a>}
    {task.source_url && task.source_url !== task.conversation_url && <a className={primary && (!needsYou(task) || !task.conversation_url) ? 'primary' : 'secondary'} href={task.source_url} target="_blank" rel="noreferrer">{sourceLabel(task)}</a>}
  </div>;
}

type ProgressEvent = { id: string; status: Task['status']; summary: string; details?: string; kind?: string; change_note?: string; created_at: string; reporter: string; action_owner: ActionOwner };
function History({ task }: { task: Task }) {
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/tasks?history=' + encodeURIComponent(task.task_key), { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Could not read history.');
        const data = await response.json() as { events: ProgressEvent[] };
        setEvents(data.events); setError(''); setLoaded(true);
      }).catch(failure => { if (failure.name !== 'AbortError') setError(failure.message); });
    return () => controller.abort();
  }, [task.task_key, task.version, attempt]);
  return <>
    {error && <p role="alert">{error} <button className="text-button" onClick={() => setAttempt(attempt + 1)}>Try again</button></p>}
    {!loaded && !error && <p className="meta">Reading history…</p>}
    {loaded && !events.length && <p className="meta">No history recorded.</p>}
    <ol className="history">{events.map(event => <li key={event.id}>
      <p className="meta">{event.kind === 'metadata' ? 'Record updated' : event.kind === 'formatting' ? 'Report formatted' : event.kind === 'checkin' ? 'Check-in' : statusLabels[event.status]} <time dateTime={event.created_at}>{absoluteTime(event.created_at)}</time></p>
      <p>{event.change_note || event.summary}</p>
      {(event.details || (event.change_note && event.change_note !== event.summary)) && <details><summary>Full saved report</summary><p>{event.summary}</p>{event.details && <p>{event.details}</p>}</details>}
      <p className="meta">{event.reporter}{isWaiting(event) ? ', needs ' + (ownerLabels[event.action_owner] || 'clarification').toLowerCase() : ''}</p>
    </li>)}</ol>
  </>;
}

function EditReport({ task, tasks, mutation, onClose }: { task: Task; tasks: Task[]; mutation: ReturnType<typeof useTaskMutation>; onClose: () => void }) {
  const initial = () => ({
    title: task.title, summary: task.summary, details: task.details || '', next_step: task.next_step, blocker: task.blocker,
    source_url: task.source_url, source_label: task.source_label || '', conversation_url: task.conversation_url || '',
    related_task_key: task.related_task_key || '', expected_version: task.version,
  });
  const [draft, setDraft] = useState(initial);
  const fields = [
    ['title', 'Task name', 200], ['summary', 'Short update', 4000], ['blocker', 'Question or missing dependency', 2000],
    ['next_step', 'Distinct next action', 2000], ['details', 'Evidence and context', 20000],
    ['source_label', 'Result link label', 60], ['source_url', 'Result or evidence URL', 1500], ['conversation_url', 'Source conversation URL', 1500],
  ] as const;
  return <form className="edit-report" onSubmit={async event => { event.preventDefault(); if (await mutation.save(draft)) onClose(); }}>
    <p className="meta">Keep uncertainties and approval requirements. Editing a report does not instruct Dot.</p>
    {fields.map(([field,label,max]) => <label key={field}>{label}
      {['summary','blocker','next_step','details'].includes(field)
        ? <textarea value={draft[field]} maxLength={max} disabled={mutation.saving || !!mutation.pending} rows={field === 'details' ? 6 : 2}
          onChange={event => setDraft({ ...draft, [field]: event.target.value })} />
        : <input value={draft[field]} maxLength={max} required={field === 'title'} type={field.endsWith('_url') ? 'url' : 'text'} disabled={mutation.saving || !!mutation.pending}
          onChange={event => setDraft({ ...draft, [field]: event.target.value })} />}
    </label>)}
    <label>Related responsibility<select value={draft.related_task_key} disabled={mutation.saving || !!mutation.pending} onChange={event => setDraft({ ...draft, related_task_key: event.target.value })}>
      <option value="">None</option>{tasks.filter(item => item.task_key !== task.task_key).map(item => <option key={item.task_key} value={item.task_key}>{item.title}</option>)}
    </select></label>
    <div className="button-row"><button className="primary" disabled={mutation.saving}>{mutation.saving ? 'Saving…' : mutation.pending ? 'Retry save' : 'Save report'}</button>
      <button type="button" className="secondary" disabled={mutation.saving || !!mutation.pending} onClick={onClose}>Cancel</button>
      <button type="button" className="text-button" disabled={mutation.saving || !!mutation.pending} onClick={() => setDraft(initial())}>Reload saved values</button></div>
  </form>;
}

export function TaskDetails({ task, tasks, now, onSaved, onSelect, onRead, viewerKey }: { task: Task; tasks: Task[]; now: number; onSaved: Saved; onSelect: (task: Task) => void; onRead: (task: Task) => void; viewerKey: string }) {
  const mutation = useTaskMutation(task, onSaved);
  const [ownerDraft, setOwner] = useState<{ owner: ActionOwner; version: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const related = tasks.filter(item => item.task_key === task.related_task_key || item.related_task_key === task.task_key);
  return <div className="task-details">
    <p className="detail-status">{statusLabels[task.status]}{isWaiting(task) ? task.action_owner === 'unknown' || !task.action_owner ? ', owner not specified' : ', needs ' + ownerLabels[task.action_owner].toLowerCase() : ''}</p>
    <h2>{task.title}</h2>
    <TaskLinks task={task} primary />
    <p className="detail-summary">{task.summary}</p>
    {task.blocker && <section><h3>{needsYou(task) ? 'Your next action' : 'What is needed'}</h3><p>{task.blocker}</p></section>}
    {task.next_step && task.next_step.trim() !== task.blocker.trim() && <section><h3>Next step</h3><p>{task.next_step}</p></section>}
    {task.details && <details className="evidence-details"><summary>Evidence and context</summary><p>{task.details}</p></details>}
    <p className="meta" title={absoluteTime(reportTime(task))}>Reported {relativeTime(reportTime(task), now)} by {task.progress_reporter || task.reporter}</p>
    {task.next_check_at && <p className="meta">Next promised check-in {absoluteTime(task.next_check_at)}</p>}
    {reportConcern(task, now) && <p className="report-concern">{reportConcern(task, now)}</p>}
    {unread(task) && <button className="secondary" onClick={() => onRead(task)}>Mark this update as read</button>}
    <Conversation key={task.task_key} type="task" targetKey={task.task_key} viewerKey={viewerKey} onSaved={onSaved} />
    <TaskOrganization key={'plan:'+task.task_key} task={task} onSaved={onSaved} />
    {isWaiting(task) && <form className="ownership" onSubmit={async event => {
      event.preventDefault();
      await mutation.save({ action_owner: ownerDraft?.owner || task.action_owner, expected_version: ownerDraft?.version ?? task.version });
      setOwner(null);
    }}>
      <label>Who can resolve this request?<select value={ownerDraft?.owner || task.action_owner || 'unknown'} disabled={mutation.saving || !!mutation.pending}
        onChange={event => setOwner({ owner: event.target.value as ActionOwner, version: ownerDraft?.version ?? task.version })}>
        {Object.entries(ownerLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button className="secondary" disabled={mutation.saving || (!ownerDraft && !mutation.pending)}>{mutation.saving ? 'Saving…' : mutation.pending ? 'Retry save' : 'Save owner'}</button>
    </form>}
    {!!related.length && <section><h3>Related work</h3>{related.map(item => <button className="related-task" key={item.task_key} onClick={() => onSelect(item)}>{item.title}</button>)}</section>}
    <details className="task-actions"><summary>Actions</summary>
      <button className="secondary" disabled={mutation.saving || !!mutation.pending} onClick={() => setEditing(!editing)}>{editing ? 'Close editor' : 'Edit report'}</button>
      {['working','waiting','blocked'].includes(task.status) && <>
        <button className="secondary" disabled={mutation.saving || !!mutation.pending} onClick={() => mutation.save({ status: 'paused', action_owner: 'unknown', blocker: '', next_check_at: null })}>Move report to Later</button>
        <p className="meta">Moving a report does not stop Dot or cancel an external schedule.</p>
      </>}
    </details>
    {editing && <EditReport task={task} tasks={tasks} mutation={mutation} onClose={() => setEditing(false)} />}
    {mutation.error && <div role="alert" className="error-text"><p>{mutation.error}</p>{mutation.pending && <button className="secondary" disabled={mutation.saving} onClick={() => mutation.save()}>Retry pending save</button>}</div>}
    <details className="report-history" open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)}>
      <summary>Report history</summary>{historyOpen && <History task={task} />}
    </details>
  </div>;
}

export function TaskItem({ task, now, selected, onSelect }: { task: Task; now: number; selected: boolean; onSelect: (task: Task) => void }) {
  const concern = reportConcern(task, now);
  return <button className="task-row" data-task-row={task.task_key} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(task)}>
    <span className="row-title">{unread(task) && <><span className="unread-dot" aria-hidden="true" /><span className="sr-only">New update. </span></>}{task.title}</span>
    <span className="row-line">{taskLine(task)}</span>
    <span className="row-meta"><span>{task.status === 'scheduled' && task.next_check_at ? 'Next report ' + absoluteTime(task.next_check_at) : statusLabels[task.status]}</span><time dateTime={reportTime(task)} title={absoluteTime(reportTime(task))}>Reported {relativeTime(reportTime(task), now)}</time></span>
    {(task.planned_on || task.deadline) && <span className="row-meta">{task.planned_on ? 'Planned '+task.planned_on : ''}{task.deadline ? ' · Due '+task.deadline : ''}</span>}
    {concern && <span className="report-concern">{concern}</span>}
  </button>;
}
