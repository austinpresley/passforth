import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const filename = process.argv[2];
if (!filename)
  throw new Error(
    'Usage: node scripts/migrate-postgres.mjs SNAPSHOT.json [--apply | --verify-only] [--files DIRECTORY]',
  );
const snapshot = JSON.parse(await readFile(resolve(filename), 'utf8'));
const legacyTables = [
  'tasks',
  'events',
  'task_reads',
  'areas',
  'projects',
  'comments',
  'requests',
  'attachments',
];
const addedTables = ['notes', 'note_links', 'saved_views', 'time_blocks', 'planning_changes'];
const tables = [...legacyTables, ...addedTables];
if (snapshot.schema_version === 3 && Object.keys(snapshot.tables || {}).sort().join() === [...legacyTables].sort().join()) {
  for (const table of addedTables) snapshot.tables[table] = [];
}
if (
  snapshot.format !== 'dot-desk' ||
  ![3, 4].includes(snapshot.schema_version) ||
  !snapshot.tables
)
  throw new Error('Use a complete version 3 or 4 Passforth record export.');
if (Object.keys(snapshot.tables).sort().join() !== [...tables].sort().join())
  throw new Error('The backup contains missing or unexpected tables.');
const owners = new Set();
for (const table of tables) {
  if (!Array.isArray(snapshot.tables[table]))
    throw new Error('Invalid backup table.');
  for (const row of snapshot.tables[table]) {
    if (
      typeof row.id !== 'string' ||
      typeof row.owner !== 'string' ||
      Object.keys(row).some((key) => !/^[_a-z][_a-z0-9]*$/.test(key))
    )
      throw new Error('Invalid backup row.');
    owners.add(row.owner);
  }
}
if (owners.size > 1)
  throw new Error('A private app migration must contain one owner.');
const counts = Object.fromEntries(
  tables.map((table) => [table, snapshot.tables[table].length]),
);
const filesOption = process.argv.indexOf('--files');
const filesDirectory =
  filesOption < 0 ? null : resolve(process.argv[filesOption + 1] || '');
if (snapshot.tables.attachments.length && !filesDirectory)
  throw new Error(
    'Export the private attachment bytes and pass their directory with --files. Record-only migration is refused when files exist.',
  );
const blobs = [];
for (const file of snapshot.tables.attachments) {
  const path = join(filesDirectory, encodeURIComponent(file.id));
  if ((await stat(path)).size !== file.byte_size)
    throw new Error('Attachment size mismatch: ' + file.filename);
  blobs.push({ record: file, path });
}
const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(
  JSON.stringify({
    mode: process.argv.includes('--apply')
      ? 'import'
      : process.argv.includes('--verify-only')
        ? 'verify'
        : 'validate',
    record_counts: counts,
    attachment_count: blobs.length,
  }),
);
if (
  !process.argv.includes('--apply') &&
  !process.argv.includes('--verify-only')
)
  process.exit(0);
if (!url?.startsWith('https://') || !secret)
  throw new Error(
    'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the process environment. Never pass keys as command arguments.',
  );
const headers = {
  apikey: secret,
  Authorization: 'Bearer ' + secret,
  'Content-Type': 'application/json',
};
async function query(statements) {
  const response = await fetch(new URL('/rest/v1/rpc/desk_query', url), {
    method: 'POST',
    headers,
    body: JSON.stringify({ statements }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error(
      'The target database rejected the operation (' +
        response.status +
        '). No successful import is assumed.',
    );
  return response.json();
}
const readback = await query(
  tables.map((table) => ({
    sql: 'SELECT * FROM ' + table + ' ORDER BY id',
    params: [],
  })),
);
if (process.argv.includes('--apply')) {
  if (readback.some((result) => result.results.length))
    throw new Error(
      'The target is not empty. Existing records will not be overwritten.',
    );
  for (const file of blobs) {
    const body = await readFile(file.path);
    const endpoint = new URL(
      '/storage/v1/object/desk-files/' +
        file.record.object_key.split('/').map(encodeURIComponent).join('/'),
      url,
    );
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      body,
    });
    if (!response.ok && response.status !== 409 && response.status !== 400)
      throw new Error('Attachment copy failed.');
    const copy = await fetch(endpoint, { headers });
    if (!copy.ok) throw new Error('Attachment readback failed.');
    if (
      createHash('sha256')
        .update(Buffer.from(await copy.arrayBuffer()))
        .digest('hex') !== createHash('sha256').update(body).digest('hex')
    )
      throw new Error('Attachment checksum mismatch.');
  }
  const statements = [];
  for (const table of tables)
    for (const row of snapshot.tables[table]) {
      const keys = Object.keys(row);
      statements.push({
        sql:
          'INSERT INTO ' +
          table +
          '(' +
          keys.join(',') +
          ') VALUES(' +
          keys.map(() => '?').join(',') +
          ')',
        params: keys.map((key) => row[key]),
      });
    }
  if (statements.length > 10000)
    throw new Error(
      'This snapshot exceeds the single-transaction import limit. Use a direct PostgreSQL import; nothing has been inserted.',
    );
  if (statements.length) await query(statements);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const restored = await query(
  tables.map((table) => ({
    sql: 'SELECT * FROM ' + table + ' ORDER BY id',
    params: [],
  })),
);
for (let i = 0; i < tables.length; i++) {
  const expected = [...snapshot.tables[tables[i]]].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const actual = [...restored[i].results].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(actual)))
    throw new Error(
      'Full readback differs for ' +
        tables[i] +
        '. Keep the old installation read-only and investigate.',
    );
}
console.log(
  'Every exported record and attachment was verified. Change the runtime storage configuration only after this successful check.',
);
