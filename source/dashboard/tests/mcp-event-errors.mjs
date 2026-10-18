import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import ts from 'typescript';
const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle')
  .filter((file) => file.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync('drizzle/' + file, 'utf8'));
class Statement {
  constructor(sql, params = []) {
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.sql, params);
  }
  async first() {
    return sqlite.prepare(this.sql).get(...this.params) ?? null;
  }
  async run() {
    return {
      meta: { changes: sqlite.prepare(this.sql).run(...this.params).changes },
    };
  }
}
const runtime = { DB: { prepare: (sql) => new Statement(sql) } };
globalThis.__eventErrorRuntime = runtime;
globalThis.__eventErrorZod = z;
const urls = new Map();
function moduleUrl(filename) {
  filename = resolve(filename);
  if (urls.has(filename)) return urls.get(filename);
  if (filename.endsWith(".json")) return "data:text/javascript;base64," + Buffer.from("export default " + readFileSync(filename, "utf8")).toString("base64");
  let source = readFileSync(filename, 'utf8')
    .replace(
      /import \{ env \} from ['"]cloudflare:workers['"];?/g,
      'const env=globalThis.__eventErrorRuntime;',
    )
    .replace(
      /import \{ z \} from ['"]zod['"];?/g,
      'const z=globalThis.__eventErrorZod;',
    );
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)])
    source = source.replace(
      match[0],
      "from '" + moduleUrl(resolve(dirname(filename), match[1] + (match[1].endsWith('.json') ? '' : '.ts'))) + "'",
    );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const url =
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
  urls.set(filename, url);
  return url;
}
const { POST } = await import(moduleUrl('app/mcp/route.ts'));
const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
const params = {
  name: 'request.created',
  arguments: { agent_id: 'dot' },
  delivery: {
    mode: 'webhook',
    url: 'https://events.openai.com/callback',
    secret,
  },
  cursor: null,
};
function rpc(
  value = params,
  headers = { 'oai-authenticated-user-id': 'test-owner' },
) {
  return POST(
    new Request('https://desk.example/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'events/subscribe',
        params: value,
      }),
    }),
  );
}
let fetches = 0,
  mode = 'challenge';
const logs = [];
const originalError = console.error;
console.error = (value) => logs.push(String(value));
globalThis.fetch = async (url, options) => {
  fetches++;
  assert.equal(options.redirect, 'manual');
  assert.equal(new URL(url).hostname, 'events.openai.com');
  if (mode === 'http')
    return new Response('Private response body must never be logged.', {
      status: 403,
    });
  if (mode === 'timeout')
    throw new DOMException(
      'Private callback URL must never be logged.',
      'TimeoutError',
    );
  if (mode === 'network')
    throw new TypeError('Private callback URL must never be logged.');
  return Response.json({
    challenge:
      mode === 'success'
        ? JSON.parse(options.body).challenge
        : 'wrong-challenge',
  });
};
async function rejected(reason, options = {}) {
  const response = await rpc(options.params ?? params);
  const body = await response.json();
  assert.equal(
    response.status,
    200,
    'A valid JSON-RPC request must return its application error over HTTP 200 so the MCP client can read the reason, rather than a generic transport failure.',
  );
  assert.equal(body.error.data.reason, reason);
  assert.ok(body.error.data.stage);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM subscriptions').get().count,
    0,
    'A failed attempt must not activate a subscription.',
  );
  assert.ok(!JSON.stringify(body).includes(secret));
  return body;
}
await rejected('challenge_failed');
mode = 'http';
assert.equal((await rejected('http_error')).error.data.callback_status, 403);
mode = 'timeout';
await rejected('timeout');
mode = 'network';
await rejected('unreachable');
const before = fetches;
await rejected('unsupported_host', {
  params: {
    ...params,
    delivery: {
      ...params.delivery,
      url: 'https://receiver.example.com/private-path?secret=private-token',
    },
  },
});
await rejected('invalid_url', {
  params: {
    ...params,
    delivery: {
      ...params.delivery,
      url: 'https://user:private-password@events.openai.com/callback',
    },
  },
});
await rejected('invalid_signing_secret', {
  params: {
    ...params,
    delivery: { ...params.delivery, secret: 'private-invalid-signing-secret' },
  },
});
assert.equal(
  (
    await rejected('invalid_arguments', {
      params: { ...params, arguments: { agent_id: 'invalid agent' } },
    })
  ).error.code,
  -32602,
);
await rejected('invalid_lifetime', { params: { ...params, ttlMs: 1 } });
assert.equal(
  fetches,
  before,
  'Reject invalid subscription parameters before contacting a callback.',
);
assert.equal(
  (await rpc(params, {})).status,
  401,
  'Unauthenticated callers still receive an HTTP authentication failure.',
);
assert.equal(
  (
    await rpc(params, {
      'oai-authenticated-user-id': 'test-owner',
      origin: 'https://other.example',
    })
  ).status,
  403,
);
mode = 'success';
const accepted = await rpc();
const result = await accepted.json();
assert.equal(accepted.status, 200);
assert.ok(result.result.id);
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM subscriptions').get().count,
  1,
);
const duplicate = await (await rpc()).json();
assert.equal(duplicate.result.id, result.result.id);
for (const value of logs)
  for (const forbidden of [
    secret,
    'private-token',
    'private-path',
    'private-password',
    'private-invalid-signing-secret',
    'Private response body',
    'Private callback URL',
  ])
    assert.ok(
      !value.includes(forbidden),
      'Diagnostics must not log credentials, callback paths or response bodies.',
    );
console.error = originalError;
sqlite.close();
console.log(
  'MCP event error checks passed: readable protocol errors, categorized host/HTTP/challenge/network/timeout failures, invalid-parameter rejection before fetch, no failed activation, authentication preserved, successful retry, and secret-free diagnostics.',
);
