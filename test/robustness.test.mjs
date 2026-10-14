// Unknown tool shapes and failure modes: each one must degrade to a clear
// message or a flagged gap, never a silent loss or an unexplained crash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.mjs';
import { startLoopback, assertSafeUrl } from '../src/oauth.mjs';
import { namesFromText, planAsk } from '../src/ask.mjs';
import { startFakeCrayon } from './fake-crayon.mjs';
import { run, readJson } from './helpers.mjs';

test('finds the ask tool by name and argument, whatever it is called', () => {
  const t = (name, properties, required = [], description = '') => ({ name, description, inputSchema: { type: 'object', properties, required } });
  const tools = [
    t('get_alerts', { since: { type: 'string' } }, ['since']),
    t('crayon_search', { query: { type: 'string' } }),
    t('answers.ask', { prompt: { type: 'string' }, limit: { type: 'integer' } }),
  ];
  assert.deepEqual(planAsk(tools), { tool: tools[2], questionKey: 'prompt' });
  assert.equal(planAsk(tools.slice(0, 2)).tool.name, 'crayon_search');
  // an unusual argument name is used when it is the tool's only required string
  const odd = [t('ask_crayon', { utterance: { type: 'string' }, top_k: { type: 'integer' } }, ['utterance'])];
  assert.deepEqual(planAsk(odd), { tool: odd[0], questionKey: 'utterance' });
  assert.throws(() => planAsk([tools[0]]), /Could not find a tool on the server that takes a question\. Tools available: get_alerts/);
  assert.throws(() => planAsk(tools, { askTool: 'nope' }), /no tool named nope/);
  assert.equal(planAsk(tools, { askTool: 'ask' }).tool.name, 'answers.ask');
});

test('--ask-tool and --question-arg override discovery', async () => {
  const { meta, fake, out } = await run(
    { askTool: 'converse', askDescription: 'Talk', askProps: { utterance: { type: 'string' }, mode: { type: 'string' } }, askRequired: [] },
    ['--ask-tool', 'converse', '--question-arg', 'utterance', '--competitors', 'Globex'],
    { token: true },
  );
  assert.equal(meta.ask_tool, 'converse');
  assert.equal(meta.question_argument, 'utterance');
  assert.equal(meta.coverage.answered, 5);
  assert.ok(fake.state.calls.every((c) => typeof c.args.utterance === 'string'));
  await rm(out, { recursive: true });
});

test('a competitor argument on the ask tool is filled in', async () => {
  const { fake, out } = await run({ competitorArg: true }, ['--competitors', 'Globex'], { token: true });
  assert.ok(fake.state.calls.every((c) => c.args.competitor === 'Globex'));
  await rm(out, { recursive: true });
});

test('a server without an ask tool fails, names its tools, and keeps tools.json', async () => {
  const out = await mkdtemp(join(tmpdir(), 'mfc-'));
  await assert.rejects(
    run({ askTool: 'get_report', askDescription: 'Report', askProps: { id: { type: 'integer' } }, askRequired: ['id'] }, [], { token: true, out }),
    /Could not find a tool on the server that takes a question\. Tools available: get_alerts, list_competitors, get_report/,
  );
  assert.equal((await readJson(join(out, 'tools.json'))).length, 3);
  await rm(out, { recursive: true });
});

test('an unknown required argument stops with a clear message, and --arg fills it', async () => {
  await assert.rejects(run({ required: ['dashboard_id'] }, [], { token: true }), /needs arguments this tool does not fill in: dashboard_id/);
  const { meta, fake, out } = await run({ required: ['dashboard_id'] }, ['--arg', 'ask_crayon.dashboard_id=7'], { token: true });
  assert.equal(meta.coverage.answered, 15);
  assert.ok(fake.state.calls.filter((c) => c.name === 'ask_crayon').every((c) => c.args.dashboard_id === 7));
  assert.ok(fake.state.calls.filter((c) => c.name === 'list_competitors').every((c) => c.args.dashboard_id === undefined));
  await rm(out, { recursive: true });
});

test('an answer that says there is nothing is flagged as no content', async () => {
  const { meta, out } = await run({ noContentFor: 'Globex' }, [], { token: true });
  assert.equal(meta.coverage.no_content, 5);
  assert.equal(meta.coverage.answered, 10);
  const coverage = await readFile(join(out, 'coverage.md'), 'utf8');
  assert.match(coverage, /\| Globex \| no content \| no content \| no content \| no content \| no content \|/);
  const index = await readFile(join(out, 'markdown', 'index.md'), 'utf8');
  assert.match(index, /Globex: Battlecard\]\([^)]+\) \(no content\)/);
  await rm(out, { recursive: true });
});

test('a failing question is recorded and the export goes on', async () => {
  const { meta, out } = await run({ errorFor: 'proof points' }, [], { token: true });
  assert.equal(meta.coverage.error, 3);
  assert.equal(meta.coverage.answered, 12);
  assert.deepEqual(meta.coverage.by_question['proof-points'], { answered: 0, no_content: 0, error: 3 });
  assert.match(meta.warnings.join('\n'), /Globex \/ proof-points: Tool returned an error: Answer service unavailable/);
  const md = await readFile(join(out, 'markdown', 'answers', 'globex', 'proof-points.md'), 'utf8');
  assert.match(md, /status: "error"/);
  assert.match(md, /The question failed: Tool returned an error/);
  await rm(out, { recursive: true });
});

test('five failures in a row stop asking but keep what was asked', async () => {
  const { meta, fake, out } = await run({ failAll: true }, ['--competitors', 'A,B,C'], { token: true });
  assert.equal(fake.state.calls.length, 5);
  assert.equal(meta.coverage.error, 5);
  assert.match(meta.warnings.join('\n'), /5 questions in a row failed, so asking stopped there/);
  assert.match(await readFile(join(out, 'coverage.md'), 'utf8'), /\| B \| not asked/);
  await rm(out, { recursive: true });
});

test('a list tool that fails or returns nothing falls back to asking', async () => {
  for (const listShape of ['error', 'empty']) {
    const { meta, out } = await run({ listShape }, [], { token: true });
    assert.equal(meta.competitor_source, 'asked', listShape);
    assert.equal(meta.competitors.length, 3);
    await rm(out, { recursive: true });
  }
  const { meta, out } = await run({ listShape: 'text' }, [], { token: true });
  assert.equal(meta.competitor_source, 'tool:list_competitors');
  assert.deepEqual(meta.competitors.length, 3);
  await rm(out, { recursive: true });
});

test('no competitor list anywhere asks for --competitors', async () => {
  await assert.rejects(
    run({ listTool: null, listAnswer: "I couldn't find any competitors." }, [], { token: true }),
    /did not return a competitor list\. Pass the names with --competitors/,
  );
});

test('competitor names are read from list-shaped prose', () => {
  assert.deepEqual(namesFromText('Here are the competitors you track:\n\n1. **Acme**\n2) Globex\n- Initech & Co\n* Acme\n\nLet me know if you need anything else.'), ['Acme', 'Globex', 'Initech & Co']);
});

test('--questions-file replaces the question set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mfc-'));
  const file = join(dir, 'q.json');
  await writeFile(file, JSON.stringify([{ id: 'Pricing', question: 'What does {competitor} charge?' }]));
  const { meta, fake, out } = await run({}, ['--questions-file', file, '--competitors', 'Globex'], { token: true });
  assert.equal(meta.counts.answers, 1);
  assert.equal(fake.state.calls[0].args.question, 'What does Globex charge?');
  assert.ok(await readFile(join(out, 'markdown', 'answers', 'globex', 'pricing.md'), 'utf8'));
  await writeFile(file, '{"id":"x"}');
  await assert.rejects(run({}, ['--questions-file', file], { token: true }), /must be a JSON array of/);
  await rm(out, { recursive: true });
  await rm(dir, { recursive: true });
});

test('an Insights key without a URL says the docs are pending, before signing in', async () => {
  const fake = await startFakeCrayon({});
  const out = await mkdtemp(join(tmpdir(), 'mfc-'));
  await assert.rejects(main(['--server', fake.url, '--out', out, '--insights-key', 'ik_test', '--no-browser'], () => {}), /has not published reference docs for the Insights API/);
  assert.equal(fake.state.clients.size, 0);
  assert.deepEqual(await readdir(out), []);
  await fake.close();
  await rm(out, { recursive: true });
});

test('the Insights key never follows a next link to another host', async () => {
  const { meta } = await run({ insightsPaging: 'foreign' }, ['--skip-answers'], { insights: true });
  assert.equal(meta.counts.insights, 50);
  assert.match(meta.warnings.join('\n'), /next page is on another host/);
});

test('a refused Insights key fails the Insights-only export, but not the answers', async () => {
  await assert.rejects(run({ insightsKey: 'other' }, ['--skip-answers'], { insights: true }), /Insights API answered 401/);
  const { meta, out } = await run({ insightsKey: 'other' }, ['--competitors', 'Globex'], { token: true, insights: true });
  assert.equal(meta.coverage.answered, 5);
  assert.match(meta.warnings.join('\n'), /Insights API: Insights API answered 401.*The answers were still exported/);
  await rm(out, { recursive: true });
});

test('an Insights URL must be https or on this machine', async () => {
  await assert.rejects(main(['--skip-answers', '--insights-url', 'http://insights.example/v1', '--insights-key', 'k', '--out', await mkdtemp(join(tmpdir(), 'mfc-'))], () => {}), /must use https/);
});

test('a refused static token fails clearly', async () => {
  const fake = await startFakeCrayon({});
  await assert.rejects(main(['--server', fake.url, '--token', 'wrong', '--out', await mkdtemp(join(tmpdir(), 'mfc-'))], () => {}), /failed with 401/);
  await fake.close();
});

test('refuses to write into a folder that is not empty', async () => {
  const fake = await startFakeCrayon({});
  const out = await mkdtemp(join(tmpdir(), 'mfc-'));
  await writeFile(join(out, 'keep.txt'), 'x');
  await assert.rejects(main(['export', '--server', fake.url, '--out', out, '--token', fake.issueStaticToken()], () => {}), /is not empty/);
  await fake.close();
  await rm(out, { recursive: true });
});

test('--force replaces an earlier export instead of mixing with it', async () => {
  const out = await mkdtemp(join(tmpdir(), 'mfc-'));
  await run({}, [], { token: true, out });
  await writeFile(join(out, 'notes.txt'), 'mine');
  const { meta } = await run({}, ['--competitors', 'Globex'], { token: true, out });
  assert.equal(meta.counts.answers, 5);
  assert.deepEqual(await readdir(join(out, 'raw', 'answers')), ['globex']);
  assert.deepEqual(await readdir(join(out, 'markdown', 'answers')), ['globex']);
  assert.equal(await readFile(join(out, 'notes.txt'), 'utf8'), 'mine');
  await rm(out, { recursive: true });
});

test('--force never clears a folder this tool did not export to', async () => {
  const out = await mkdtemp(join(tmpdir(), 'mfc-'));
  await mkdir(join(out, 'markdown'));
  await writeFile(join(out, 'markdown', 'notes.md'), 'mine');
  const fake = await startFakeCrayon({});
  await assert.rejects(main(['--server', fake.url, '--token', fake.issueStaticToken(), '--out', out, '--force'], () => {}), /does not hold an earlier export/);
  assert.equal(await readFile(join(out, 'markdown', 'notes.md'), 'utf8'), 'mine');
  assert.equal(fake.state.calls.length, 0);
  await fake.close();
  await rm(out, { recursive: true });
});

test('competitor names cannot steer a path outside the export', async () => {
  const { out } = await run({}, ['--competitors', '../../escape'], { token: true });
  assert.deepEqual(await readdir(join(out, 'raw', 'answers')), ['escape']);
  await rm(out, { recursive: true });
});

test('front matter quotes titles safely', async () => {
  const { out } = await run({}, ['--competitors', 'Pricing: "Enterprise"'], { token: true });
  const md = await readFile(join(out, 'markdown', 'answers', 'pricing-enterprise', 'battlecard.md'), 'utf8');
  assert.match(md, /^title: "Pricing: \\"Enterprise\\": Battlecard"$/m);
  await rm(out, { recursive: true });
});

test('inspect will not overwrite a tool list without --force', async () => {
  const fake = await startFakeCrayon({});
  const out = await mkdtemp(join(tmpdir(), 'mfc-'));
  await writeFile(join(out, 'crayon-tools.json'), '{}');
  await assert.rejects(main(['inspect', '--server', fake.url, '--out', out, '--token', fake.issueStaticToken()], () => {}), /already exists/);
  await fake.close();
  await rm(out, { recursive: true });
});

test('the loopback page is plain text, ignores stray requests and waits for the real one', async () => {
  const loop = await startLoopback({ timeoutMs: 5000 });
  const code = loop.waitForCode('good');
  const base = `http://127.0.0.1:${loop.port}/callback`;
  const stray = await fetch(`${base}?state=bad&error=%3Cscript%3Ealert(1)%3C%2Fscript%3E`);
  assert.equal(stray.status, 400);
  assert.match(stray.headers.get('content-type'), /^text\/plain/);
  assert.doesNotMatch(await stray.text(), /<script>/);
  await fetch(`${base}?state=good&code=abc`);
  assert.equal(await code, 'abc');
});

test('only https sign-in links, or http on this machine, are opened', () => {
  assert.ok(assertSafeUrl('https://app.crayon.co/oauth/authorize/', 'x'));
  assert.ok(assertSafeUrl('http://127.0.0.1:5000/a', 'x'));
  assert.throws(() => assertSafeUrl('http://evil.example/a', 'x'), /must use https/);
  assert.throws(() => assertSafeUrl('file:///etc/passwd', 'x'), /must use https/);
  assert.throws(() => assertSafeUrl('javascript:alert(1)', 'x'), /must use https/);
});
