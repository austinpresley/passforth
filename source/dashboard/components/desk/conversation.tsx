'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { absoluteTime } from '../../lib/task-model';

interface Comment {
  id: string;
  body: string;
  kind: string;
  author: string;
  author_kind: string;
  created_at: string;
  request_state?: string;
  request_id?: string;
}
interface Attachment {
  id: string;
  filename: string;
  byte_size: number;
}
type Attempt = {
  action: 'comment';
  target_type: 'task' | 'project' | 'note';
  target_key: string;
  body: string;
  kind: 'reference' | 'request';
  event_id: string;
};
export function Conversation({
  type,
  targetKey,
  viewerKey,
  onSaved,
}: {
  type: 'task' | 'project' | 'note';
  targetKey: string;
  viewerKey: string;
  onSaved: () => void | Promise<void>;
}) {
  const storageKey =
    'dot-desk:conversation:' + viewerKey + ':' + type + ':' + targetKey;
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Attempt | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const active = useRef(true);
  const uploadRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      setDraft(typeof saved.draft === 'string' ? saved.draft : '');
      const attempt = saved.pending;
      if (
        attempt?.action === 'comment' &&
        attempt.target_type === type &&
        attempt.target_key === targetKey &&
        typeof attempt.body === 'string' &&
        typeof attempt.event_id === 'string' &&
        ['reference', 'request'].includes(attempt.kind)
      )
        setPending(attempt);
    } catch {
      setError(
        'Device storage is unavailable. Keep this page open to retain the draft.',
      );
    }
    return () => {
      active.current = false;
    };
  }, [storageKey, type, targetKey]);
  const persist = (text: string, attempt: Attempt | null) => {
    setDraft(text);
    setPending(attempt);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ draft: text, pending: attempt }),
      );
    } catch {
      setError('Could not save this draft on your device.');
    }
  };
  const load = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/workspace?target_type=' +
          type +
          '&target_key=' +
          encodeURIComponent(targetKey),
        { cache: 'no-store', signal: AbortSignal.timeout(12000) },
      );
      if (!response.ok) throw new Error('Could not read this conversation.');
      const data = (await response.json()) as {
        comments: Comment[];
        attachments: Attachment[];
      };
      if (active.current) {
        setComments(data.comments);
        setFiles(data.attachments);
        setLoaded(true);
      }
    } catch (failure) {
      if (active.current) setError((failure as Error).message);
    }
  }, [type, targetKey]);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);
  async function save(kind: 'reference' | 'request') {
    if (busy || !draft.trim()) return;
    const attempt = pending ?? {
      action: 'comment',
      target_type: type,
      target_key: targetKey,
      body: draft.trim(),
      kind,
      event_id: crypto.randomUUID(),
    };
    persist(draft, attempt);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt),
        signal: AbortSignal.timeout(20000),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429)
          persist(draft, null);
        throw new Error(result.error || 'Save was not confirmed.');
      }
      if (active.current) {
        persist('', null);
        setMessage(
          attempt.kind === 'request'
            ? 'Saved and queued. Awaiting an agent acknowledgement.'
            : 'Reference note saved. No action requested.',
        );
        await load();
        await onSaved();
      }
    } catch (failure) {
      if (active.current)
        setError('Save not confirmed. ' + (failure as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    const reconnect = () => {
      if (pending && !busy) void save(pending.kind);
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [pending, busy]);
  async function cancel(requestId: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel_request',
          request_id: requestId,
        }),
      });
      if (!response.ok) throw new Error('Could not cancel this request.');
      await load();
      await onSaved();
      setMessage(
        'Request cancelled here. Work already started may need a separate stop instruction.',
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('target_type', type);
      form.set('target_key', targetKey);
      const response = await fetch('/api/files', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Upload failed.');
      await load();
      setMessage('File attached. Send a request when you want Dot to use it.');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  }
  const receipt: Record<string, string> = {
    queued: 'Saved, awaiting acknowledgement',
    acknowledged: 'Acknowledged by agent',
    answered: 'Agent replied',
    cancelled: 'Request cancelled',
  };
  return (
    <section
      className="conversation"
      aria-label="Conversation and reference notes"
    >
      <h3>Conversation &amp; notes</h3>
      {!loaded && !error && <p className="meta">Reading conversation…</p>}
      {loaded && !comments.length && (
        <p className="meta">
          Leave context here, or send Dot a request about this {type}.
        </p>
      )}
      <ol className="comment-list">
        {comments.map((comment) => (
          <li key={comment.id} className={'comment ' + comment.author_kind}>
            <p className="comment-author">
              {comment.author_kind === 'user' ? 'You' : comment.author}
              <span>
                {comment.kind === 'reference'
                  ? 'Reference note'
                  : comment.kind === 'reply'
                    ? 'Reply'
                    : 'Request'}{' '}
                · {absoluteTime(comment.created_at)}
              </span>
            </p>
            <p className="comment-body">{comment.body}</p>
            {comment.request_state && (
              <p className="receipt">
                {receipt[comment.request_state] || comment.request_state}
                {comment.author_kind === 'user' &&
                  ['queued', 'acknowledged'].includes(
                    comment.request_state,
                  ) && (
                    <button
                      disabled={busy}
                      className="text-button"
                      onClick={() => cancel(comment.request_id!)}
                    >
                      Cancel request
                    </button>
                  )}
              </p>
            )}
          </li>
        ))}
      </ol>
      {!!files.length && (
        <ul className="attachment-list">
          {files.map((file) => (
            <li key={file.id}>
              <a href={'/api/files?id=' + encodeURIComponent(file.id)}>
                {file.filename}
              </a>{' '}
              <span className="meta">
                {Math.ceil(file.byte_size / 1024)} KB
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="comment-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void save('request');
        }}
      >
        <label htmlFor={'comment-' + targetKey}>
          Reply or add context
          <textarea
            id={'comment-' + targetKey}
            maxLength={20000}
            rows={3}
            value={draft}
            disabled={busy || !!pending}
            placeholder="What should Dot know or do?"
            onChange={(event) => persist(event.target.value, null)}
          />
        </label>
        <div className="button-row">
          <button className="primary" disabled={busy || !draft.trim()}>
            {busy ? 'Saving…' : pending ? 'Retry saved message' : 'Send to Dot'}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={busy || !!pending || !draft.trim()}
            onClick={() => save('reference')}
          >
            Save as reference
          </button>
          <label className="secondary file-label">
            Attach file
            <input
              ref={uploadRef}
              type="file"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        </div>
        <p className="meta">
          Reference notes provide context. Send to Dot queues a request for a
          response.
        </p>
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}{' '}
            <button type="button" className="text-button" onClick={load}>
              Refresh conversation
            </button>
          </p>
        )}
      </form>
    </section>
  );
}
