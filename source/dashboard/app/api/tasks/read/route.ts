import { identity, markRead, fail, writeGuard } from '../../../../lib/tasks';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    writeGuard(request);
    const owner = await identity(request);
    const text = await request.text();
    if (text.length > 1000) return Response.json({ error: 'Request too large' }, { status: 413 });
    return Response.json(await markRead(owner, JSON.parse(text)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return fail(error); }
}
