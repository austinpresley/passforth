import { identity, writeGuard, fail } from '../../../lib/tasks';
import { uploadFile, readFile } from '../../../lib/files';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    writeGuard(request);
    const owner = await identity(request);
    const length = Number(request.headers.get('content-length'));
    if (length > 11 * 1024 * 1024)
      throw new Error('Choose a file smaller than 10 MB.');
    const form = await request.formData();
    const type = form.get('target_type');
    const file = form.get('file');
    if ((type !== 'task' && type !== 'project' && type !== 'note') || !(file instanceof File))
      throw new Error('Choose a task, project or note and a file.');
    return Response.json(
      await uploadFile(owner, type, String(form.get('target_key') || ''), file),
    );
  } catch (error) {
    return fail(error);
  }
}
export async function GET(request: Request) {
  try {
    const { record, object } = await readFile(
      await identity(request),
      new URL(request.url).searchParams.get('id') || '',
    );
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition':
          "attachment; filename*=UTF-8''" +
          encodeURIComponent(String(record.filename)),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return fail(error);
  }
}
