import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.mjs';
import { startFakeCrayon, COMPETITORS } from './fake-crayon.mjs';
import { run, readJson } from './helpers.mjs';

async function countFiles(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await countFiles(join(dir, e.name)) : e.name.endsWith('.md') && e.name !== 'index.md' ? 1 : 0;
  }
  return n;
}

test('signs in with OAuth, PKCE and dynamic registration as a public client, then revokes', async () => {
  const { fake, lines, meta, out } = await run({});
  assert.equal(fake.state.clients.size, 1);
  assert.equal([...fake.state.clients.values()][0].token_endpoint_auth_method, 'none');
  assert.equal([...fake.state.clients.values()][0].client_name, 'calven-migrate-from-crayon');
  assert.ok(lines.some((l) => l.includes('Signed in.')));
  assert.ok(lines.some((l) => l.includes('Access token revoked.')));
  assert.deepEqual(fake.state.revoked.sort(), ['access_token', 'refresh_token']);
  assert.equal(meta.partial, true);
  await rm(out, { recursive: true });
});

test('asks every question about every listed competitor and keeps answers verbatim', async () => {
  const { meta, out, fake } = await run({});
  assert.equal(meta.ask_tool, 'ask_crayon');
  assert.equal(meta.question_argument, 'question');
  assert.equal(meta.competitor_source, 'tool:list_competitors');
  assert.deepEqual(meta.competitors, COMPETITORS);
  assert.equal(meta.counts.answers, 15);
  assert.equal(meta.coverage.answered, 15);
  assert.deepEqual(Object.keys(meta.coverage.by_question), ['battlecard', 'objection-handling', 'proof-points', 'win-loss-stories', 'profile']);
  assert.equal(fake.state.calls.filter((c) => c.name === 'ask_crayon').length, 15);
  const answers = await readJson(join(out, 'answers.json'));
  const a = answers.find((x) => x.id === 'globex--battlecard');
  assert.equal(a.schema, 'calven-export/v1');
  assert.equal(a.source_system, 'crayon');
  assert.equal(a.kind, 'answer');
  assert.equal(a.origin, 'crayon_output');
  assert.match(a.question, /full battlecard for Globex/);
  assert.equal(a.body_markdown, `## Globex\n\nAnswer to: ${a.question}\n\n- Point one\n- Point two\n\nSee [Win report](https://app.crayon.co/intel/1) and https://example.com/review.`);
  assert.deepEqual(a.citations.map((c) => c.url), ['https://app.crayon.co/intel/1', 'https://example.com/review']);
  assert.equal(await countFiles(join(out, 'markdown')), 15);
  await rm(out, { recursive: true });
});

test('Markdown, index and coverage report', async () => {
  const { out } = await run({});
  const md = await readFile(join(out, 'markdown', 'answers', 'initech-co', 'objection-handling.md'), 'utf8');
  assert.match(md, /^---\nschema: "calven-export\/v1"/);
  assert.match(md, /competitor: "Initech & Co"/);
  assert.match(md, /origin: "crayon_output"/);
  assert.match(md, /^# Initech & Co: Objection handling$/m);
  assert.match(md, /^> Asked Crayon: What objections/m);
  assert.match(md, /## Citations\n\n- \[Win report\]\(https:\/\/app\.crayon\.co\/intel\/1\)/);
  const index = await readFile(join(out, 'markdown', 'index.md'), 'utf8');
  assert.match(index, /A Crayon export is partial/);
  assert.match(index, /## Answers \(15\)/);
  assert.match(index, /### Initech & Co/);
  const coverage = await readFile(join(out, 'coverage.md'), 'utf8');
  assert.match(coverage, /not the raw cards/);
  assert.match(coverage, /15 of 15 questions answered/);
  assert.match(coverage, /\| Globex \| answered \| answered \| answered \| answered \| answered \|/);
  await rm(out, { recursive: true });
});

test('archives every raw answer with the arguments sent', async () => {
  const { out } = await run({});
  const raw = await readJson(join(out, 'raw', 'answers', 'acme-analytics', 'profile.json'));
  assert.match(raw.arguments.question, /competitor profile for Acme Analytics/);
  assert.match(raw.result.content[0].text, /## Acme Analytics/);
  assert.ok((await readJson(join(out, 'raw', 'list-competitors.json'))).result);
  const tools = await readJson(join(out, 'tools.json'));
  assert.ok(tools.some((t) => t.name === 'ask_crayon'));
  await rm(out, { recursive: true });
});

test('--competitors skips discovery', async () => {
  const { meta, fake, out } = await run({}, ['--competitors', 'Globex, Umbrella'], { token: true });
  assert.equal(meta.competitor_source, 'flag');
  assert.deepEqual(meta.competitors, ['Globex', 'Umbrella']);
  assert.equal(fake.state.calls.filter((c) => c.name === 'list_competitors').length, 0);
  assert.equal(meta.counts.answers, 10);
  await rm(out, { recursive: true });
});

test('--competitors-file reads one name per line and skips comments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mfc-'));
  const file = join(dir, 'names.txt');
  await writeFile(file, '# ours\nGlobex\n\nAcme Analytics\nGlobex\n');
  const { meta, out } = await run({}, ['--competitors-file', file], { token: true });
  assert.equal(meta.competitor_source, 'file');
  assert.deepEqual(meta.competitors, ['Globex', 'Acme Analytics']);
  await rm(out, { recursive: true });
  await rm(dir, { recursive: true });
});

test('without a list tool, the competitor list is asked for and flagged', async () => {
  const { meta, out } = await run({ listTool: null }, [], { token: true });
  assert.equal(meta.competitor_source, 'asked');
  assert.deepEqual(meta.competitors, COMPETITORS);
  assert.match(meta.warnings.join('\n'), /came from asking Crayon a question/);
  assert.ok(await readJson(join(out, 'raw', 'list-competitors-asked.json')));
  await rm(out, { recursive: true });
});

test('a personal token skips the browser and is not revoked', async () => {
  const { meta, fake, out } = await run({}, [], { token: true });
  assert.equal(meta.counts.answers, 15);
  assert.equal(fake.state.clients.size, 0);
  assert.deepEqual(fake.state.revoked, []);
  await rm(out, { recursive: true });
});

test('handles SSE, a 429 and an expired token', async () => {
  const { meta, fake, out } = await run({ transport: 'sse', flaky: true, invalidTokens: 1 });
  assert.equal(meta.counts.answers, 15);
  assert.ok(fake.state.issued >= 2, 'refreshed the token');
  await rm(out, { recursive: true });
});

test('structured answers and resource links keep their citations', async () => {
  for (const answerShape of ['structured', 'links']) {
    const { out } = await run({ answerShape }, [], { token: true });
    const [a] = await readJson(join(out, 'answers.json'));
    assert.match(a.body_markdown, /^## Acme Analytics/);
    assert.ok(a.citations.some((c) => c.url === 'https://app.crayon.co/battlecards/9' && c.title === 'Battlecard'), answerShape);
    await rm(out, { recursive: true });
  }
});

test('HTML answers keep the HTML and get Markdown', async () => {
  const { out } = await run({ answerShape: 'html' }, [], { token: true });
  const [a] = await readJson(join(out, 'answers.json'));
  assert.equal(a.body_html, '<h2>Acme Analytics</h2><p>Talk about <strong>value</strong> &amp; proof.</p>');
  assert.equal(a.body_markdown, '## Acme Analytics\n\nTalk about **value** & proof.');
  await rm(out, { recursive: true });
});

test('inspect writes the tool list and asks nothing', async () => {
  const fake = await startFakeCrayon({});
  const out = await mkdtemp(join(tmpdir(), 'mfc-'));
  const tools = await main(['inspect', '--server', fake.url, '--out', out, '--token', fake.issueStaticToken()], () => {});
  assert.equal(tools.length, 3);
  const file = await readJson(join(out, 'crayon-tools.json'));
  assert.deepEqual(file.tools.map((t) => t.name), ['get_alerts', 'list_competitors', 'ask_crayon']);
  assert.equal(fake.state.calls.length, 0);
  await fake.close();
  await rm(out, { recursive: true });
});

for (const paging of ['next-url', 'cursor', 'page', 'single']) {
  test(`Insights API: exports every insight with ${paging} paging`, async () => {
    const { meta, out } = await run({ insightsPaging: paging }, ['--competitors', 'Globex'], { token: true, insights: true });
    assert.equal(meta.counts.insights, 230);
    assert.deepEqual(meta.origin.insights, { crayon_or_third_party: 116, customer: 114 });
    const insights = await readJson(join(out, 'insights.json'));
    assert.equal(new Set(insights.map((i) => i.id)).size, 230);
    const wl = insights.find((i) => i.section === 'win_loss');
    assert.equal(wl.origin, 'customer');
    assert.equal(wl.source.amount, 12000);
    assert.ok((await readdir(join(out, 'markdown', 'insights', 'win-loss'))).length > 50);
    assert.ok((await readdir(join(out, 'raw', 'insights'))).length >= 1);
    await rm(out, { recursive: true });
  });
}

test('--skip-answers exports the Insights API alone, without signing in', async () => {
  const { meta, fake, out } = await run({}, ['--skip-answers'], { insights: true });
  assert.equal(meta.counts.insights, 230);
  assert.equal(meta.counts.answers, undefined);
  assert.equal(fake.state.clients.size, 0);
  assert.equal(fake.state.calls.length, 0);
  await rm(out, { recursive: true });
});
