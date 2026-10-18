import assert from 'node:assert/strict';
const base = process.env.PASSFORTH_TEST_URL || 'http://127.0.0.1:5173';
const login = await fetch(base + '/signin-with-chatgpt?return_to=/', { redirect: 'manual' });
const cookie = login.headers.get('set-cookie').split(';')[0];
const suffix = Date.now(); let checks = 0;
async function call(path, body) { const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, data: await response.json() }; }
async function rpc(name, args) { const result = await call('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }); assert.equal(result.status, 200); assert.ok(!result.data.result.isError, JSON.stringify(result.data)); return JSON.parse(result.data.result.content[0].text); }
const task_key = 'qa-plan-' + suffix;
await call('/api/tasks', { task_key, title: 'QA planning task', status: 'paused', summary: 'Local planning verification.', deadline: '2026-10-23', next_check_at: '2026-10-20T09:00:00Z', event_id: 'planning-task-' + suffix, expected_version: 0 });
const note = { id: 'qa-note-' + suffix, title: 'QA reusable context', body: '# Brief\nHeliotrope backdrop, morning slot.', tags: 'studio/portraits', daily_on: null, archived: false, links: [{ target_type: 'task', target_key: task_key }], event_id: 'planning-note-' + suffix, expected_version: 0 };
const saved = await rpc('save_note', note); assert.equal(saved.record.version, 1); checks++;
assert.equal((await rpc('save_note', note)).duplicate, true); checks++;
assert.equal((await call('/api/workspace', { action: 'note', ...note, body: 'Changed retry' })).status, 409); checks++;
const context = await rpc('get_context', { target_type: 'task', target_key: task_key }); assert.ok(context.linked_notes.some(item => item.id === saved.record.id)); checks++;
assert.ok((await call('/api/tasks')).data.tasks.find(task => task.task_key === task_key).note_search.includes('Heliotrope')); checks++;
const filters = { query: 'Heliotrope', view: 'all', area_id: '', project_id: '', label: 'studio', scope: 'all', priority_min: 0 };
await rpc('save_view', { id: 'qa-view-' + suffix, title: 'QA studio view', filters, archived: false, event_id: 'planning-view-' + suffix, expected_version: 0 }); checks++;
const block = { id: 'qa-block-' + suffix, task_key, starts_at: '2026-10-19T09:00:00-04:00', duration_minutes: 60, timezone: 'America/New_York', archived: false, event_id: 'planning-block-' + suffix, expected_version: 0 };
const blocked = await rpc('save_time_block', block); assert.equal(blocked.record.starts_at, '2026-10-19T13:00:00.000Z'); checks++;
const workspace = (await call('/api/workspace')).data; assert.ok(workspace.saved_views.some(item => item.title === 'QA studio view')); assert.ok(workspace.time_blocks.some(item => item.id === blocked.record.id)); checks++;
const task = (await call('/api/tasks')).data.tasks.find(task => task.task_key === task_key); assert.equal(task.deadline, '2026-10-23'); assert.equal(task.next_check_at, '2026-10-20T09:00:00.000Z'); checks++;
const request = (await call('/api/workspace', { action: 'comment', target_type: 'note', target_key: saved.record.id, kind: 'request', body: 'Local verification only.', event_id: 'planning-request-' + suffix, agent_id: 'planning-test' })).data;
await rpc('acknowledge_request', { request_id: request.comment.id, agent_id: 'planning-test' });
await rpc('reply_request', { request_id: request.comment.id, agent_id: 'planning-test', body: 'Verified saved note context.', event_id: 'planning-reply-' + suffix });
assert.equal((await rpc('get_context', { target_type: 'note', target_key: saved.record.id })).comments.length, 2); checks++;
const exported = (await call('/api/workspace?export=1')).data; assert.equal(exported.schema_version, 4); for (const name of ['notes','note_links','saved_views','time_blocks','planning_changes']) assert.ok(exported.tables[name].length); checks++;
const backup = await rpc('backup_workspace', {}); assert.ok(backup.record_counts.notes); assert.ok(backup.record_counts.planning_changes); checks++;
console.log(checks + ' planning HTTP/MCP checks passed, including linked context, search, safe retries, synced filters, time blocks, note requests/replies and full backups. Local data only.');
