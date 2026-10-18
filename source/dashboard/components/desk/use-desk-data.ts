'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Task, needsYou, reportConcern } from '../../lib/task-model';

export function useDeskData() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewerKey, setViewerKey] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const [error, setError] = useState('');
  const [signInPath,setSignInPath] = useState('/signin-with-chatgpt?return_to=%2F');
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => Date.now());
  const [readError, setReadError] = useState('');
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const viewerRef = useRef('');
  const readVersions = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const request = new AbortController();
    controller.current = request;
    const timeout = window.setTimeout(() => request.abort(), 12000);
    try {
      let response = await fetch('/api/tasks', { signal: request.signal, cache: 'no-store' });
      if (controller.current !== request) return;
      if (response.status === 401) {
        const refresh=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refresh'}),signal:request.signal});
        if(refresh.ok)response=await fetch('/api/tasks',{signal:request.signal,cache:'no-store'});
      }
      if (response.status === 401) {
        const failed=await response.json() as {sign_in?:string};
        setSignInPath(failed.sign_in?.startsWith('/login')?'/login':'/signin-with-chatgpt?return_to=%2F');
        setSignedOut(true);
        setTasks([]);
        setViewerKey('');
        viewerRef.current = '';
        readVersions.current = {};
        setReadError('');
        setCheckedAt('');
        throw new Error('Sign in again to read your saved work.');
      }
      if (!response.ok) throw new Error('Could not read saved work. Try again.');
      const data = await response.json() as { tasks: Task[]; viewer_key: string; checked_at: string };
      if (!Array.isArray(data.tasks) || !data.viewer_key || !data.checked_at) {
        throw new Error('The dashboard returned an unreadable update. Try again.');
      }
      if (controller.current !== request) return;
      if (viewerRef.current !== data.viewer_key) readVersions.current = {};
      viewerRef.current = data.viewer_key;
      setTasks(data.tasks.map(task => ({ ...task, read_version: Math.max(task.read_version ?? 0, readVersions.current[task.task_key] ?? 0) })));
      setViewerKey(data.viewer_key);
      setCheckedAt(data.checked_at);
      setError('');
      setSignedOut(false);
    } catch (failure) {
      if (controller.current !== request) return;
      setError((failure as Error).name === 'AbortError'
        ? 'The connection timed out. Try again.' : (failure as Error).message);
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === request) {
        busy.current = false;
        setLoading(false);
        setClock(Date.now());
      }
    }
  }, []);

  useEffect(() => {
    (window as Window & { __dotDeskAppReady?: boolean }).__dotDeskAppReady = true;
    const initial = window.setTimeout(load, 0);
    const timer = window.setInterval(() => { setClock(Date.now()); void load(); }, 30000);
    const visible = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('dotdesk:refresh', load);
    window.addEventListener('online', load);
    document.addEventListener('visibilitychange', visible);
    return () => {
      delete (window as Window & { __dotDeskAppReady?: boolean }).__dotDeskAppReady;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener('dotdesk:refresh', load);
      window.removeEventListener('online', load);
      document.removeEventListener('visibilitychange', visible);
      controller.current?.abort();
      controller.current = null;
      busy.current = false;
    };
  }, [load]);

  const stale = !!checkedAt && clock - Date.parse(checkedAt) > 120000;
  async function markRead(task: Task) {
    if (!task.attention_version || (task.read_version ?? 0) >= task.attention_version) return;
    const viewer = viewerRef.current;
    try {
      const response = await fetch('/api/tasks/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_key: task.task_key, attention_version: task.attention_version }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) { if (response.status === 401) void load(); throw new Error('Could not save read state. Open the task to retry.'); }
      if (viewerRef.current !== viewer) return;
      readVersions.current[task.task_key] = Math.max(readVersions.current[task.task_key] ?? 0, task.attention_version);
      setTasks(current => current.map(item => item.task_key === task.task_key
        ? { ...item, read_version: Math.max(item.read_version ?? 0, task.attention_version ?? 0) } : item));
      setReadError('');
    } catch (error) { if (viewerRef.current === viewer) setReadError((error as Error).message); }
  }
  useEffect(() => {
    const bridge = (window as Window & {
      webkit?: { messageHandlers?: { dotDesk?: { postMessage: (data: unknown) => void } } };
    }).webkit?.messageHandlers?.dotDesk;
    if (!bridge) return;
    bridge.postMessage({
      kind: signedOut ? 'signin' : 'state', protocol: 2,
      needs_you: tasks.filter(needsYou).length,
      unconfirmed: tasks.filter(task => reportConcern(task, clock)).length,
      error: !!error || stale || !checkedAt, checked_at: checkedAt,
    });
  }, [tasks, checkedAt, error, signedOut, stale, clock]);

  return { signInPath, tasks, viewerKey, checkedAt, error, signedOut, loading, stale, clock, load, markRead, readError };
}
