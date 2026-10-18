import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
const key = Buffer.alloc(32, 7);
const secret = 'whsec_' + key.toString('base64');
const bundled = await build({
  stdin: {
    contents: `import {subscribe,dispatch} from './lib/event-delivery.ts'; export default {async fetch(request){const url=new URL(request.url);const owner=url.searchParams.get('owner')||'runtime-owner';try {const value=url.pathname==='/dispatch'?await dispatch(owner):await subscribe(owner,{name:'request.created',arguments:{agent_id:'dot'},delivery:{mode:'webhook',url:'https://connectors.api.openai.com/runtime-test',secret:'${secret}'},ttlMs:null});return Response.json({ok:true,value});}catch(error){return Response.json({ok:false,reason:error.reason,stage:error.stage,message:error.message},{status:500});}}};`,
    resolveDir: resolve('.'),
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  write: false,
  external: ['cloudflare:workers'],
  plugins: [
    {
      name: 'native-test-database',
      setup(b) {
        b.onResolve({ filter: /^\.\/tasks$/ }, (args) =>
          args.importer.endsWith('/lib/event-delivery.ts')
            ? { path: 'native-database', namespace: 'test-database' }
            : undefined,
        );
        b.onLoad({ filter: /.*/, namespace: 'test-database' }, () => ({
          contents:
            "import {env} from 'cloudflare:workers';export function db(){return env.DB;}",
          loader: 'js',
        }));
      },
    },
  ],
});
let mode = 'success';
let callbacks = [];
const runtime = new Miniflare({
  cf: false,
  modules: true,
  compatibilityDate: '2026-05-15',
  compatibilityFlags: ['nodejs_compat'],
  script: bundled.outputFiles[0].text,
  d1Databases: ['DB'],
  outboundService: async (request) => {
    const url = new URL(request.url);
    callbacks.push({ host: url.hostname, path: url.pathname });
    assert.equal(url.hostname, 'connectors.api.openai.com');
    assert.equal(
      url.pathname,
      '/runtime-test',
      'A callback redirect must never be followed.',
    );
    const body = await request.text();
    const id = request.headers.get('webhook-id');
    const stamp = request.headers.get('webhook-timestamp');
    assert.equal(
      request.headers.get('webhook-signature'),
      'v1,' +
        createHmac('sha256', key)
          .update(id + '.' + stamp + '.' + body)
          .digest('base64'),
    );
    assert.ok(request.headers.get('x-mcp-subscription-id'));
    if (mode === 'redirect')
      return new Response(null, {
        status: 307,
        headers: { Location: 'https://openai.com/must-not-follow' },
      });
    const data = JSON.parse(body);
    if (data.type === 'verification')
      return Response.json({ challenge: data.challenge });
    assert.equal(data.eventId, id);
    assert.equal(data.name, 'request.created');
    return new Response(null, { status: 204 });
  },
});
try {
  const database = await runtime.getD1Database('DB');
  for (const file of readdirSync('drizzle')
    .filter((file) => file.endsWith('.sql'))
    .sort())
    for (const sql of readFileSync('drizzle/' + file, 'utf8')
      .replaceAll('--> statement-breakpoint', '')
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean))
      await database.prepare(sql).run();
  async function call(path) {
    const response = await runtime.dispatchFetch('http://local' + path);
    const body = await response.json();
    return { status: response.status, ...body };
  }
  const first = await call('/subscribe');
  console.log(
    JSON.stringify({
      runtime: 'workerd',
      status: first.status,
      ok: first.ok,
      reason: first.reason,
      callbacks: callbacks.length,
    }),
  );
  assert.equal(
    first.ok,
    true,
    'The real Cloudflare callback handshake must reach the receiver and save the subscription.',
  );
  assert.equal(callbacks.length, 1);
  assert.equal(
    (
      await database
        .prepare('SELECT COUNT(*) AS count FROM subscriptions')
        .first()
    ).count,
    1,
  );
  const again = await call('/subscribe');
  assert.equal(again.value.id, first.value.id);
  mode = 'redirect';
  callbacks = [];
  const redirect = await call('/subscribe?owner=redirect-owner');
  assert.equal(redirect.reason, 'http_error');
  assert.equal(callbacks.length, 1);
  assert.equal(
    (
      await database
        .prepare('SELECT COUNT(*) AS count FROM subscriptions')
        .first()
    ).count,
    1,
  );
  mode = 'success';
  callbacks = [];
  await database
    .prepare(
      "INSERT INTO comments(id,owner,target_type,target_key,kind,body,author,author_kind,request_id,created_at) VALUES('request-1','runtime-owner','task','test-task','request','Runtime verification only.','You','user','request-1','2026-10-18T00:00:00Z')",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO requests(id,owner,comment_id,target_type,target_key,agent_id,state,created_at) VALUES('request-1','runtime-owner','request-1','task','test-task','dot','queued','2026-10-18T00:00:00Z')",
    )
    .run();
  const delivered = await call('/dispatch');
  assert.equal(delivered.value.delivered, 1);
  assert.equal(callbacks.length, 1);
  assert.equal((await call('/dispatch')).value.attempted, 0);
  await database
    .prepare(
      "INSERT INTO comments(id,owner,target_type,target_key,kind,body,author,author_kind,request_id,created_at) VALUES('request-2','runtime-owner','task','test-task','request','Redirect verification only.','You','user','request-2','2026-10-18T00:00:00Z')",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO requests(id,owner,comment_id,target_type,target_key,agent_id,state,created_at) VALUES('request-2','runtime-owner','request-2','task','test-task','dot','queued','2026-10-18T00:00:00Z')",
    )
    .run();
  mode = 'redirect';
  callbacks = [];
  assert.equal((await call('/dispatch')).value.delivered, 0);
  assert.equal(callbacks.length, 1);
  const rejected = await database
    .prepare(
      "SELECT state,last_error FROM deliveries WHERE request_id='request-2'",
    )
    .first();
  assert.equal(rejected.state, 'pending');
  assert.equal(rejected.last_error, 'Notification endpoint returned 307');
  console.log(
    'Cloudflare runtime checks passed: signed callback challenge, durable subscription, idempotent refresh, no redirect following, signed event delivery and no duplicate notification.',
  );
} finally {
  await runtime.dispose();
}
