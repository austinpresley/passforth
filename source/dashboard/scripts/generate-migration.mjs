import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const journalPath = 'drizzle/meta/_journal.json';
const previous = JSON.parse(readFileSync(journalPath, 'utf8'));
const result = spawnSync(
  process.execPath,
  ['node_modules/drizzle-kit/bin.cjs', 'generate', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const next = JSON.parse(readFileSync(journalPath, 'utf8'));
// Never edit applied history. Only newly generated entries receive monotonic ordering.
for (let index = previous.entries.length; index < next.entries.length; index++)
  next.entries[index].when = Math.max(
    next.entries[index].when,
    (next.entries[index - 1]?.when || 0) + 1,
  );
if (next.entries.length !== previous.entries.length)
  writeFileSync(journalPath, JSON.stringify(next, null, 2) + '\n');
