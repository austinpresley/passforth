import { identity, fail } from '../../../lib/tasks';
import { instanceMetadata } from '../../../lib/instance';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    await identity(request);
    return Response.json(instanceMetadata(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return fail(error); }
}
