import { identity, writeGuard, fail } from '../../../lib/tasks';
import { maintainWorkspace } from '../../../lib/maintenance';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    writeGuard(request);
    return Response.json(await maintainWorkspace(await identity(request)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return fail(error);
  }
}
