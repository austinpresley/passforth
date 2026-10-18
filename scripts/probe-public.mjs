#!/usr/bin/env node
// Anonymous probes deliberately carry no session or API credential.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
assert(args.includes('--profile') && args.includes('--out'), 'Use --profile profile.json --out evidence/public.json');
const profile = JSON.parse(await readFile(option('--profile'), 'utf8'));
const base = new URL(profile.site_url);
assert(base.protocol === 'https:' && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'Use the provider-returned HTTPS origin');
const denied = new Set([401, 403, 302, 303, 307, 308]);
const paths = ['/api/tasks', '/api/workspace', '/api/workspace?export=1', '/api/files?id=missing'];
const results = [];
for (const path of paths) {
  for (const spoof of [false, true]) {
    try {
      const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: spoof ? { 'oai-authenticated-user-id': 'forged-visitor', 'oai-authenticated-user-email': 'forged@example.com' } : {} });
      results.push({ path, spoofed_identity: spoof, http_status: response.status, passed: denied.has(response.status) });
    } catch { results.push({ path, spoofed_identity: spoof, passed: false, reason: 'Network or TLS failure' }); }
  }
}
const report = { schema_version: 1, gate: 'H01', site_url: base.origin, status: results.every(r => r.passed) ? 'PASS' : 'FAIL', results, checked_at: new Date().toISOString() };
await mkdir(dirname(option('--out')), { recursive: true, mode: 0o700 });
await chmod(dirname(option('--out')), 0o700);
await writeFile(option('--out'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 1;
