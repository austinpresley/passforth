'use client';
import { useState } from 'react';
import type { SavedView, ViewFilter } from '../../lib/planning-model';
import { savePlanning } from './planning-client';
export function SavedViews({
  views,
  filter,
  selected,
  onSelect,
  onSaved,
}: {
  views: SavedView[];
  filter: ViewFilter;
  selected: string;
  onSelect: (view: SavedView) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('');
  async function save(value: Record<string, unknown>) {
    if (busy) return;
    const body = attempt ?? value;
    setAttempt(body);
    setBusy(true);
    setError('');
    try {
      await savePlanning('view', body);
      setAttempt(null);
      setTitle('');
      setMessage(body.archived ? 'Saved view removed.' : 'View saved.');
      await onSaved();
    } catch (failure) {
      if (
        (failure as { status?: number }).status &&
        (failure as { status: number }).status < 500
      )
        setAttempt(null);
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="saved-views" aria-label="Saved views">
      <div className="work-filters">
        {views
          .filter((view) => !view.archived)
          .map((view) => (
            <button
              key={view.id}
              aria-pressed={selected === view.id}
              disabled={busy || !!attempt}
              onClick={() => onSelect(view)}
            >
              {view.title}
            </button>
          ))}
      </div>
      <details>
        <summary>Save or manage views</summary>
        <form
          className="saved-view-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save({
              id: 'view-' + crypto.randomUUID(),
              title: title.trim(),
              filters: filter,
              expected_version: 0,
              archived: false,
              event_id: crypto.randomUUID(),
            });
          }}
        >
          <label>
            Name this view
            <input
              maxLength={100}
              required
              value={title}
              disabled={busy || !!attempt}
              placeholder="e.g. Studio work this week"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || (!attempt && !title.trim())}
          >
            {busy
              ? 'Saving…'
              : attempt
                ? 'Retry view save'
                : 'Save current filters'}
          </button>
        </form>
        {selected &&
          views.some((view) => view.id === selected && !view.archived) && (
            <button
              className="text-button"
              disabled={busy || !!attempt}
              onClick={() => {
                const view = views.find((item) => item.id === selected)!;
                void save({
                  id: view.id,
                  title: view.title,
                  filters: JSON.parse(view.filters),
                  archived: true,
                  expected_version: view.version,
                  event_id: crypto.randomUUID(),
                });
              }}
            >
              Remove selected saved view
            </button>
          )}
      </details>
      {attempt && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void save(attempt)}
        >
          Retry pending view save
        </button>
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
    </section>
  );
}
