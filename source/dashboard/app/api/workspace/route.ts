import { identity, fail, writeGuard } from '../../../lib/tasks';
import {
  workspace,
  conversation,
  addComment,
  saveEntity,
  exportWorkspace,
  cancelRequest,
} from '../../../lib/workspace';
import { backupWorkspace } from '../../../lib/backups';
import { dispatch, retryDeliveries } from '../../../lib/event-delivery';
import { saveNote, saveView, saveBlock } from '../../../lib/planning';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const owner = await identity(request);
    const query = new URL(request.url).searchParams;
    if (query.get('export') === '1')
      return Response.json(await exportWorkspace(owner), {
        headers: {
          'Content-Disposition': 'attachment; filename="dot-desk-backup.json"',
          'Cache-Control': 'no-store',
        },
      });
    const type = query.get('target_type');
    if (type === 'task' || type === 'project' || type === 'note')
      return Response.json(
        await conversation(owner, type, query.get('target_key') || ''),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    return Response.json(await workspace(owner), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return fail(error);
  }
}
export async function POST(request: Request) {
  try {
    writeGuard(request);
    const owner = await identity(request);
    const text = await request.text();
    if (text.length > 200000) throw new Error('This update is too large.');
    const { action, ...value } = JSON.parse(text);
    if (action === 'comment') {
      const result = await addComment(owner, value);
      // Saving the request is durable even if its notification cannot be delivered.
      if (value.kind === 'request') await dispatch(owner, 1).catch(() => {});
      return Response.json(result);
    }
    if (action === 'entity')
      return Response.json(await saveEntity(owner, value));
    if (action === 'note') return Response.json(await saveNote(owner, value));
    if (action === 'view') return Response.json(await saveView(owner, value));
    if (action === 'block') return Response.json(await saveBlock(owner, value));
    if (action === 'backup') return Response.json(await backupWorkspace(owner));
    if (action === 'retry_delivery')
      return Response.json(await retryDeliveries(owner));
    if (action === 'cancel_request' && typeof value.request_id === 'string')
      return Response.json(await cancelRequest(owner, value.request_id));
    throw new Error('Unknown workspace action.');
  } catch (error) {
    return fail(error);
  }
}
