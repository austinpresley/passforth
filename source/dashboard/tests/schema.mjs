import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';
import * as schema from '../db/schema.ts';
const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
for (const entry of journal.entries)
  assert.ok(
    readFileSync(
      'drizzle/meta/' + String(entry.idx).padStart(4, '0') + '_snapshot.json',
      'utf8',
    ),
  );
const latest = JSON.parse(
  readFileSync(
    'drizzle/meta/' +
      String(journal.entries.at(-1).idx).padStart(4, '0') +
      '_snapshot.json',
    'utf8',
  ),
);
const fresh = await generateSQLiteDrizzleJson(schema, latest.id);
assert.deepEqual(await generateSQLiteMigration(latest, fresh), []);
console.log(
  'Migration metadata matches the current schema; future generation does not duplicate applied tables or columns.',
);
