import { authConfig, equalSecret } from '../../../lib/auth';
import {
  identity,
  writeGuard,
  fail,
  listTasks,
  putTask,
  history,
} from '../../../lib/tasks';
import {
  workspace,
  contextForAgent,
  inbox,
  acknowledge,
  reply,
  saveEntity,
} from '../../../lib/workspace';
import { maintainWorkspace } from '../../../lib/maintenance';
import { backupWorkspace } from '../../../lib/backups';
import { retryDeliveries } from '../../../lib/event-delivery';
import { saveNote, saveView, saveBlock } from '../../../lib/planning';

export const dynamic = 'force-dynamic';

/** Static-token HTTP transport for trusted headless clients. Browser identity alone cannot author agent receipts. */
export async function POST(request: Request) {
  try {
    writeGuard(request);
    const config = authConfig();
    const token =
      request.headers.get('x-desk-agent-token') ||
      request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (
      !token ||
      !config.DESK_AGENT_TOKEN ||
      !(await equalSecret(token, config.DESK_AGENT_TOKEN))
    )
      throw Object.assign(new Error('An agent credential is required.'), {
        status: 401,
      });
    const owner = await identity(request);
    const text = await request.text();
    if (text.length > 200000)
      throw Object.assign(new Error('This agent update is too large.'), {
        status: 413,
      });
    const body = JSON.parse(text) as {
      action?: unknown;
      arguments?: Record<string, unknown>;
      agent_name?: unknown;
    };
    const args = body.arguments || {};
    let result: unknown;
    switch (body.action) {
      case 'list_tasks':
        result = { tasks: await listTasks(owner) };
        break;
      case 'update_task':
        result = await putTask(
          owner,
          args,
          typeof body.agent_name === 'string'
            ? body.agent_name.slice(0, 80)
            : 'Agent',
        );
        break;
      case 'task_history':
        if (typeof args.task_key !== 'string')
          throw new Error('task_key is required.');
        result = { events: await history(owner, args.task_key) };
        break;
      case 'get_workspace':
        result = await workspace(owner);
        break;
      case 'get_context':
        if (
          !['task', 'project', 'note'].includes(String(args.target_type)) ||
          typeof args.target_key !== 'string'
        )
          throw new Error('Choose a task or project.');
        result = await contextForAgent(
          owner,
          args.target_type as 'task' | 'project' | 'note',
          args.target_key,
        );
        break;
      case 'list_requests':
        result = await inbox(owner, String(args.agent_id || 'dot'));
        break;
      case 'acknowledge_request':
        result = await acknowledge(owner, args);
        break;
      case 'reply_request':
        result = await reply(owner, args);
        break;
      case 'save_entity':
        result = await saveEntity(owner, args);
        break;
      case 'save_note':
        result = await saveNote(owner, args);
        break;
      case 'save_view':
        result = await saveView(owner, args);
        break;
      case 'save_time_block':
        result = await saveBlock(owner, args);
        break;
      case 'backup_workspace':
        result = await backupWorkspace(owner);
        break;
      case 'maintain_workspace':
        result = await maintainWorkspace(owner);
        break;
      case 'retry_deliveries':
        result = await retryDeliveries(owner);
        break;
      default:
        throw Object.assign(new Error('Unknown agent action.'), {
          status: 400,
        });
    }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return fail(error);
  }
}
