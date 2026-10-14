// MIGRATION.md is followed word for word by AI assistants on the connector
// path, so its questions must match what the CLI asks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_QUESTIONS, LIST_QUESTION } from '../src/ask.mjs';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('MIGRATION.md lists the same questions the CLI asks', async () => {
  const guide = await read('MIGRATION.md');
  const rows = [...guide.matchAll(/^\| `([a-z-]+)` \| (.+) \|$/gm)].map((m) => ({ id: m[1], question: m[2] }));
  assert.deepEqual(rows, DEFAULT_QUESTIONS);
  assert.ok(guide.includes(`"${LIST_QUESTION}"`));
});

test('README, MIGRATION.md and the skill state that the export is partial', async () => {
  for (const file of ['README.md', 'MIGRATION.md', 'skills/migrate-from-crayon/SKILL.md', 'llms.txt']) {
    assert.match(await read(file), /partial/, file);
  }
});

test('the docs use no em or en dashes', async () => {
  for (const file of ['README.md', 'MIGRATION.md', 'AGENTS.md', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', 'llms.txt', 'docs/schema.md', 'skills/migrate-from-crayon/SKILL.md']) {
    assert.doesNotMatch(await read(file), /[–—]/, file);
  }
});
