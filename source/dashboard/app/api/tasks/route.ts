import { identity, listTasks, history, putTask, fail, writeGuard } from '../../../lib/tasks';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const owner = await identity(request);
    const key = new URL(request.url).searchParams.get('history');
    // Scope device-only drafts and view preferences without exposing the raw identity.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner));
    const viewerKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const body = key ? { events: await history(owner, key) } : {
      tasks: await listTasks(owner), checked_at: new Date().toISOString(), viewer_key: viewerKey,
    };
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    writeGuard(request);
    const owner = await identity(request);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 128000) {
      return Response.json({ error: 'Request too large' }, { status: 413 });
    }
    return Response.json(await putTask(owner, JSON.parse(text), 'You'), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) { return fail(error); }
}
