import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {z} from 'zod';
import ts from 'typescript';
const sqlite=new DatabaseSync(':memory:');for (const file of readdirSync('drizzle').filter(file => file.endsWith('.sql')).sort()) sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
// Upgrade populated v1 storage, preserving every old value and history entry.
const upgrade = new DatabaseSync(':memory:');
upgrade.exec(readFileSync('drizzle/0000_bent_johnny_blaze.sql', 'utf8'));
upgrade.exec(`INSERT INTO tasks(id,owner,task_key,title,status,summary,updated_at,created_at,reporter,version)
 VALUES('old:task','old','task','Existing responsibility','waiting','Saved progress','2026-10-17','2026-10-16','Dot',7);
 INSERT INTO events VALUES('old:event','old','old:task','waiting','Saved history','Dot','2026-10-17');`);
const oldTask = upgrade.prepare('SELECT * FROM tasks').get();
const oldEvent = upgrade.prepare('SELECT * FROM events').get();
upgrade.exec(readFileSync('drizzle/0001_action-owner.sql', 'utf8'));
assert.deepEqual({ ...upgrade.prepare('SELECT * FROM tasks').get() }, { ...oldTask, action_owner: 'unknown' });
assert.deepEqual({ ...upgrade.prepare('SELECT * FROM events').get() }, { ...oldEvent, action_owner: 'unknown' });
upgrade.exec(readFileSync('drizzle/0002_kind_bug.sql', 'utf8'));
const migrated = upgrade.prepare('SELECT * FROM tasks').get();
assert.equal(migrated.summary, oldTask.summary);
assert.equal(migrated.version, oldTask.version);
assert.equal(migrated.progress_at, oldTask.updated_at);
assert.equal(migrated.progress_reporter, oldTask.reporter);
assert.equal(migrated.details, '');
assert.equal(upgrade.prepare('SELECT read_version FROM task_reads').get().read_version, 1);
assert.equal(upgrade.prepare('SELECT summary FROM events').get().summary, oldEvent.summary);
upgrade.close();
console.log('Populated v1 migration preserves task values, versions, and history; ownership defaults to unknown.');
class Statement{constructor(sql,params=[]){this.sql=sql;this.params=params;}bind(...p){return new Statement(this.sql,p);}async first(){return sqlite.prepare(this.sql).get(...this.params)??null;}async all(){return {results:sqlite.prepare(this.sql).all(...this.params)};}run(){const r=sqlite.prepare(this.sql).run(...this.params);return {meta:{changes:r.changes}};}}
globalThis.__testEnv={DB:{prepare:s=>new Statement(s),async batch(stmts){sqlite.exec('BEGIN');try{const out=stmts.map(s=>s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}}};globalThis.__testZod=z;
const src=readFileSync('lib/tasks.ts','utf8').replace("import { env } from 'cloudflare:workers';","const env=globalThis.__testEnv;").replace("import { database } from './database';","const database=()=>globalThis.__testEnv.DB;").replace("import { resolveIdentity,authConfig } from './auth';","const resolveIdentity=()=>null;const authConfig=()=>({});").replace("import { z } from 'zod';","const z=globalThis.__testZod;");
const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {putTask,listTasks,history,markRead}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const task={task_key:'shared-name',title:'Owner isolation',status:'working',summary:'Test',event_id:'same-id',expected_version:0};
await putTask('owner-a',task,'Dot');assert.equal((await listTasks('owner-b')).length,0);
await putTask('owner-b',task,'Dot');assert.equal((await listTasks('owner-b')).length,1);assert.equal((await listTasks('owner-a')).length,1);
await putTask('owner-a',{...task,status:'completed',event_id:'second',expected_version:1},'Dot');assert.equal((await listTasks('owner-b'))[0].status,'working');assert.equal((await history('owner-b','shared-name')).length,1);assert.equal((await history('owner-a','shared-name')).length,2);
await assert.rejects(putTask('owner-a',{...task,event_id:'third',expected_version:1},'Dot'),/changed/);
assert.equal((await history('owner-a','shared-name')).length,2);
console.log('Original storage checks passed: owner isolation, independent keys, atomic history, and version conflicts.');

// Partial updates retain fields and enforce the final record's constraints.
const key='partial';
await putTask('owner-a',{task_key:key,title:'Review choices',status:'waiting',summary:'Two choices ready',blocker:'Choose one',source_url:'https://example.com/result',action_owner:'user',event_id:'p1'},'Dot');
const partial=await putTask('owner-a',{task_key:key,summary:'Three choices ready',event_id:'p2'},'Dot');
assert.equal(partial.task.title,'Review choices');
assert.equal(partial.task.blocker,'Choose one');
assert.equal(partial.task.action_owner,'user');
assert.equal(partial.task.source_url,'https://example.com/result');
assert.equal(partial.task.next_check_at,null);
await assert.rejects(putTask('owner-a',{task_key:key,blocker:'',event_id:'p3'},'Dot'),/Explain/);
await assert.rejects(putTask('owner-a',{task_key:key,status:'scheduled',event_id:'p4'},'Dot'),/check time/);
await assert.rejects(putTask('owner-a',{task_key:'missing',summary:'Only this',event_id:'p5'},'Dot'));
await assert.rejects(putTask('owner-a',{task_key:key,action_owner:'everyone',event_id:'p6'},'Dot'));
await assert.rejects(putTask('owner-a',{task_key:'other-key',event_id:'p2'},'Dot'),/another task/);
const retry=await putTask('owner-a',{task_key:key,summary:'Three choices ready',event_id:'p2'},'Dot');
assert.equal(retry.duplicate,true);
assert.equal((await history('owner-a',key)).length,2);
// An expected version is enforced even when changing only action ownership.
await assert.rejects(putTask('owner-a',{task_key:key,action_owner:'external',expected_version:1,event_id:'p7'},'You'),/changed/);
const ownership=await putTask('owner-a',{task_key:key,action_owner:'external',expected_version:2,event_id:'p8'},'You');
assert.equal(ownership.task.action_owner,'external');
assert.equal((await history('owner-a',key))[0].action_owner,'external');
// Implicit optimistic concurrency prevents lost updates during read/merge/write.
const race=await Promise.allSettled([
 putTask('owner-a',{task_key:key,summary:'Concurrent A',event_id:'race-a'},'Dot'),
 putTask('owner-a',{task_key:key,summary:'Concurrent B',event_id:'race-b'},'Dot'),
]);
assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
assert.equal(race.filter(x=>x.status==='rejected').length,1);
assert.equal((await history('owner-a',key)).length,4);
// Legacy records never infer an action owner, and work receives no made-up deadline.
const legacy=await putTask('owner-a',{...task,task_key:'legacy',event_id:'legacy'},'Dot');
assert.equal(legacy.task.action_owner,'unknown');
assert.equal(legacy.task.next_check_at,null);
const scheduled=await putTask('owner-a',{task_key:'schedule',title:'Follow up',summary:'Later',status:'scheduled',next_check_at:'2030-01-01T12:00:00Z',event_id:'s1'},'Dot');
const resumed=await putTask('owner-a',{task_key:'schedule',status:'working',event_id:'s2'},'Dot');
assert.equal(resumed.task.next_check_at,scheduled.task.next_check_at);
const cleared=await putTask('owner-a',{task_key:'schedule',next_check_at:null,event_id:'s3'},'Dot');
assert.equal(cleared.task.next_check_at,null);
console.log('V2 storage checks passed: partial updates, validation, ownership, idempotency, concurrent merges, and explicit check-ins.');

// Evidence and read state are tested through the storage API.
const original = 'Original detailed evidence. '.repeat(100);
const detailed = await putTask('owner-a', {
 task_key:'evidence',title:'Review invoice',status:'waiting',summary:original,blocker:'Who is the payer?',
 details:'Verified amount: $1,234. Sending requires approval.',action_owner:'unknown',
 source_url:'https://example.com/invoice',source_label:'Review invoice',conversation_url:'https://example.com/conversation',
 event_id:'evidence-1',expected_version:0,
}, 'Dot');
assert.equal(detailed.task.attention_version,1);
assert.equal((await listTasks('owner-a')).find(t=>t.task_key==='evidence').read_version,0);
await markRead('owner-a',{task_key:'evidence',attention_version:1});
await assert.rejects(markRead('owner-b',{task_key:'evidence',attention_version:1}),/no longer/);
await assert.rejects(markRead('owner-a',{task_key:'evidence',attention_version:2}),/no longer/);
const metadata=await putTask('owner-a',{task_key:'evidence',action_owner:'user',event_id:'evidence-owner',expected_version:1},'You');
assert.equal(metadata.task.attention_version,1);
assert.equal(metadata.task.progress_at,detailed.task.progress_at);
assert.equal(metadata.task.progress_reporter,'Dot');
assert.equal((await history('owner-a','evidence'))[0].kind,'metadata');
assert.equal((await history('owner-a','evidence'))[0].change_note,'action owner updated.');
const short=await putTask('owner-a',{task_key:'evidence',summary:'Draft ready. Payer unconfirmed.',details:original+'\nVerified amount: $1,234. Sending requires approval.',change_note:'Draft prepared; payer still needs confirmation.',event_id:'evidence-short',expected_version:2},'Dot');
assert.equal(short.task.attention_version,2);
assert.equal(short.task.source_label,'Review invoice');
assert.equal(short.task.conversation_url,'https://example.com/conversation');
assert.ok(short.task.details.includes(original));
assert.ok((await history('owner-a','evidence')).some(event=>event.summary===original.trim()));
assert.equal((await listTasks('owner-a')).find(t=>t.task_key==='evidence').read_version,1);
await markRead('owner-a',{task_key:'evidence',attention_version:2});
await markRead('owner-a',{task_key:'evidence',attention_version:1});
assert.equal((await listTasks('owner-a')).find(t=>t.task_key==='evidence').read_version,2);
const heartbeat=await putTask('owner-a',{task_key:'evidence',summary:short.task.summary,event_id:'evidence-check',expected_version:3},'Dot');
assert.equal(heartbeat.task.attention_version,2);
assert.equal((await history('owner-a','evidence'))[0].kind,'checkin');
const retryCount=(await history('owner-a','evidence')).length;
await putTask('owner-a',{task_key:'evidence',summary:short.task.summary,event_id:'evidence-check'},'Dot');
assert.equal((await history('owner-a','evidence')).length,retryCount);
await assert.rejects(putTask('owner-a',{task_key:'evidence',conversation_url:'javascript:alert(1)',event_id:'bad-link'},'Dot'),/https/);
await assert.rejects(putTask('owner-a',{task_key:'evidence',related_task_key:'evidence',event_id:'self-link'},'Dot'),/itself/);
await assert.rejects(putTask('owner-b',{...task,task_key:'separate',related_task_key:'evidence',event_id:'cross-link'},'Dot'),/your register/);
const relation=await putTask('owner-a',{task_key:'partial',related_task_key:'evidence',event_id:'related'},'You');
assert.equal(relation.task.related_task_key,'evidence');
console.log('Structured reporting checks passed: populated migration, preserved evidence, delta history, read isolation, stale reads, quiet metadata/check-ins, safe links, and related work.');
const formatted=await putTask('owner-a',{task_key:'evidence',summary:'Draft ready; payer unknown.',presentation_only:true,change_note:'Shortened report; evidence retained.',event_id:'format',expected_version:4},'Dot');
assert.equal(formatted.task.attention_version,heartbeat.task.attention_version);
assert.equal(formatted.task.progress_at,heartbeat.task.progress_at);
assert.equal((await history('owner-a','evidence'))[0].kind,'formatting');
await assert.rejects(putTask('owner-a',{task_key:'evidence',status:'completed',presentation_only:true,event_id:'hide-progress'},'Dot'),/Presentation-only/);
console.log('Formatting-only edits preserve read state and reporting freshness without hiding status changes.');
