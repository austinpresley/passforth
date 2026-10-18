import assert from 'node:assert/strict';
const base = process.env.PASSFORTH_TEST_URL || 'http://127.0.0.1:5173';
const login=await fetch(base+'/signin-with-chatgpt?return_to=/',{redirect:'manual'});
const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
const suffix=Date.now().toString();let checks=0;
async function call(path,body){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {response,data:await response.json()};}
async function rpc(name,args={}){const {response,data}=await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});assert.equal(response.status,200);assert.ok(!data.result.isError,JSON.stringify(data));try{return JSON.parse(data.result.content[0].text);}catch{return data.result.content[0].text;}}
for(const path of ['/api/workspace','/api/workspace?export=1','/api/files?id=missing']){assert.equal((await fetch(base+path)).status,401);checks++;}
for(const headers of [{cookie},{cookie,'x-desk-agent-token':'invalid'}]){const denied=await fetch(base+'/api/agent',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({action:'acknowledge_request',arguments:{request_id:'fake'}})});assert.equal(denied.status,401);checks++;}
let {data:discovery}=await call('/mcp',{jsonrpc:'2.0',id:1,method:'server/discover'});assert.ok(discovery.result.capabilities.events);checks++;
let {data:eventList}=await call('/mcp',{jsonrpc:'2.0',id:2,method:'events/list'});assert.equal(eventList.result.events[0].name,'request.created');checks++;
const {data:area}=await call('/api/workspace',{action:'entity',type:'area',id:'qa-'+suffix,title:'QA photography '+suffix,expected_version:0});
const {data:project}=await call('/api/workspace',{action:'entity',type:'project',id:'qa-'+suffix,title:'QA shoot '+suffix,area_id:area.id,notes:'Morning light only.',expected_version:0});assert.equal(project.version,1);checks++;
const taskKey='qa-thread-'+suffix;
let {response,data:created}=await call('/api/tasks',{task_key:taskKey,title:'QA task conversation',status:'waiting',summary:'Local verification only.',blocker:'Which slot?',project_id:project.id,planned_on:'2026-10-19',deadline:'2026-10-23',event_id:'task-'+suffix,expected_version:0});assert.equal(response.status,200,JSON.stringify(created));assert.equal(created.task.area_id,area.id);checks++;
const reference={action:'comment',target_type:'task',target_key:taskKey,kind:'reference',body:'Reference zebra context for search.',event_id:'note-'+suffix};
await call('/api/workspace',reference);assert.ok(!(await rpc('list_requests')).some(item=>item.target_key===taskKey));checks++;
const request={...reference,kind:'request',body:'Use the morning slot and keep the draft here.',event_id:'request-'+suffix};
const {data:saved}=await call('/api/workspace',request);assert.equal((await call('/api/workspace',request)).data.duplicate,true);checks++;
const list=await rpc('list_requests');assert.ok(list.some(item=>item.id===saved.comment.id&&item.state==='queued'));checks++;
const context=await rpc('get_context',{target_type:'task',target_key:taskKey});assert.equal(context.project.notes,'Morning light only.');assert.equal(context.comments.length,2);checks++;
await rpc('acknowledge_request',{request_id:saved.comment.id});checks++;
await rpc('reply_request',{request_id:saved.comment.id,body:'Local test agent: morning draft prepared for review.',event_id:'answer-'+suffix});
assert.ok(!(await rpc('list_requests')).some(item=>item.id===saved.comment.id));checks++;
const {data:thread}=await call('/api/workspace?target_type=task&target_key='+taskKey);assert.equal(thread.comments.length,3);assert.equal(thread.comments[1].request_state,'answered');checks++;
const form=new FormData();form.set('target_type','task');form.set('target_key',taskKey);form.set('file',new File(['Local attachment evidence.'],'evidence.txt',{type:'text/plain'}));
const uploaded=await fetch(base+'/api/files',{method:'POST',headers:{cookie},body:form});const file=await uploaded.json();assert.equal(uploaded.status,200,JSON.stringify(file));checks++;
const downloaded=await fetch(base+'/api/files?id='+encodeURIComponent(file.id),{headers:{cookie}});assert.equal(await downloaded.text(),'Local attachment evidence.');assert.ok(downloaded.headers.get('content-disposition').startsWith('attachment;'));checks++;
assert.equal(await rpc('read_attachment',{id:file.id}),'Local attachment evidence.');checks++;
const backup=await rpc('backup_workspace');assert.match(backup.sha256,/^[0-9a-f]{64}$/);assert.ok(backup.record_counts.comments>=3);checks++;
const {data:exported}=await call('/api/workspace?export=1');assert.ok(exported.tables.comments.some(item=>item.id===saved.comment.id));assert.ok(exported.tables.attachments.some(item=>item.id===file.id));assert.ok(!exported.tables.subscriptions);checks++;
const {data:tasks}=await call('/api/tasks');assert.ok(tasks.tasks.find(item=>item.task_key===taskKey).conversation_search.includes('zebra'));checks++;
const denied=await fetch(base+'/api/workspace',{method:'POST',headers:{cookie,origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify(reference)});assert.equal(denied.status,403);checks++;
console.log(checks+' workspace HTTP/MCP checks passed: discovery, private records, areas/projects, messages, real acknowledgements/replies, private file upload/download, backup readback and contextual search. Local data only.');
