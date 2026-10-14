import { parseArgs } from 'node:util';
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { authorize, refresh, revoke } from './oauth.mjs';
import { McpClient } from './mcp.mjs';
import { askAll, DEFAULT_QUESTIONS, discoverCompetitors, finishPlan, MissingArgumentsError, planAsk } from './ask.mjs';
import { exportInsights, INSIGHTS_PENDING } from './insights.mjs';
import { label, normalizeAnswer, normalizeInsight, slug, toMarkdown, SCHEMA } from './normalize.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const DEFAULT_SERVER = 'https://mcp.crayon.co/mcp/';
const DEFAULT_SCOPE = 'mcp:read';

export const DISCLAIMER = `This is an independent open-source project by Calven AI, LLC. It is not affiliated with, endorsed by or sponsored by Crayon, Inc. Crayon is a trademark of Crayon, Inc., used here only to identify the service this tool works with. The tool runs on your machine, signs in with your own Crayon account through Crayon's official MCP server (and, if you choose, Crayon's Insights API with your own key), and writes files only to your computer. Nothing is sent to Calven. Use it in line with your agreement with Crayon: answers from Crayon's AI tools are Outputs you may use for internal business purposes, and material Crayon collected from third parties (for example news and reviews) is licensed to you, not owned by you. Provided under the MIT License, without warranty; check the export against your Crayon workspace before relying on it.`;

export const PARTIAL_NOTE = 'A Crayon export is partial. Crayon\'s MCP server answers questions and has no documented tool to list or extract battlecards, so this export holds Crayon\'s answers to a fixed set of questions per competitor, with their citations, not the raw cards. coverage.md shows which questions got an answer.';

const HELP = `calven-migrate-from-crayon ${pkg.version}

Migrate from Crayon: export what Crayon knows about each competitor (battlecard, objection handling, proof points, win/loss stories, profile) to Markdown and JSON files on your own machine.

Usage
  calven-migrate-from-crayon [export] [options]   export everything (default)
  calven-migrate-from-crayon inspect [options]    write the server's tool list to a file, export nothing

Options
  --out <dir>               output folder (default ./crayon-export-<date>)
  --competitors <names>     comma-separated competitor names; skips discovery
  --competitors-file <file> one competitor name per line
  --questions-file <file>   JSON array of {"id", "question"} to ask instead of the default set;
                            {competitor} in a question is replaced with the name
  --ask-tool <name>         the tool that answers questions (default: found from the tool list)
  --question-arg <name>     the argument of that tool that takes the question
  --list-tool <name>        the tool that lists competitors (default: found, or asked for)
  --arg <name=value>        extra tool argument; prefix with a tool name to target one tool,
                            e.g. --arg ask.dashboard=Sales (repeatable)
  --insights-key <key>      also export every insight and win/loss record from Crayon's
                            Insights API; prefer setting CRAYON_INSIGHTS_KEY
  --insights-url <url>      the Insights API list URL (Crayon has not published one yet)
  --skip-answers            export only the Insights API, without the MCP server
  --token <token>           an access token you already hold for Crayon's MCP server;
                            prefer setting CRAYON_TOKEN, which stays out of shell history
  --no-browser              print the sign-in URL instead of opening it
  --server <url>            MCP server URL (default ${DEFAULT_SERVER})
  --scope <scopes>          OAuth scopes (default ${DEFAULT_SCOPE})
  --force                   replace an earlier export in the --out folder, or an existing crayon-tools.json
  -h, --help                show this help
  -v, --version             show the version

${PARTIAL_NOTE}

${DISCLAIMER}
`;

function parseExtraArgs(list) {
  const shared = Object.create(null);
  const perTool = Object.create(null);
  for (const entry of list || []) {
    const eq = entry.indexOf('=');
    if (eq < 1) throw new Error(`--arg expects name=value, got "${entry}"`);
    const key = entry.slice(0, eq);
    const raw = entry.slice(eq + 1);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    const dot = key.lastIndexOf('.');
    if (dot > 0) (perTool[key.slice(0, dot)] ||= Object.create(null))[key.slice(dot + 1)] = value;
    else shared[key] = value;
  }
  const matches = (toolName, t) => toolName === t || toolName.endsWith(`_${t}`) || toolName.endsWith(`.${t}`) || toolName.endsWith(`-${t}`);
  return (toolName) =>
    Object.entries(perTool)
      .filter(([t]) => matches(toolName, t))
      .reduce((acc, [, values]) => ({ ...acc, ...values }), { ...shared });
}

const OUTPUTS = ['raw', 'markdown', 'answers.json', 'insights.json', 'coverage.md', 'manifest.json', 'tools.json'];
const MARKER = '.calven-migrate-from-crayon';

// --force replaces only an earlier export, recognised by the marker file this
// tool writes first, so stale pages cannot mix with a new run and an unrelated
// folder is never touched.
async function prepareOutDir(dir, force) {
  await mkdir(dir, { recursive: true });
  const entries = (await readdir(dir)).filter((e) => e !== MARKER && e !== '.DS_Store');
  if (entries.length) {
    const ours = await stat(join(dir, MARKER)).catch(() => null);
    if (!force || !ours) {
      throw new Error(
        ours
          ? `${dir} holds an earlier export. Pass --force to replace it, or choose another --out folder.`
          : `${dir} is not empty and does not hold an earlier export. Choose another --out folder.`,
      );
    }
    for (const name of OUTPUTS) await rm(join(dir, name), { recursive: true, force: true });
  }
  await writeFile(join(dir, MARKER), 'Written by calven-migrate-from-crayon. --force may replace this folder\'s export.\n');
}

const writeJson = (path, data) => writeFile(path, `${JSON.stringify(data, null, 2)}\n`);

// One record at a time, so a large workspace never builds one giant string.
async function writeJsonArray(path, records) {
  const fh = await open(path, 'w');
  try {
    await fh.write('[\n');
    for (let i = 0; i < records.length; i++) {
      const json = JSON.stringify(records[i], null, 2).replace(/^/gm, '  ');
      await fh.write(`${json}${i < records.length - 1 ? ',' : ''}\n`);
    }
    await fh.write(']\n');
  } finally {
    await fh.close();
  }
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

async function readCompetitors(opts) {
  const names = [];
  if (opts.competitors) names.push(...opts.competitors.split(','));
  if (opts['competitors-file']) {
    const text = await readFile(opts['competitors-file'], 'utf8');
    names.push(...text.split(/\r?\n/).filter((l) => !l.trim().startsWith('#')));
  }
  const clean = [...new Set(names.map(oneLine).filter(Boolean))];
  if ((opts.competitors || opts['competitors-file']) && !clean.length) throw new Error('No competitor names found in --competitors or --competitors-file.');
  return clean.length ? clean : null;
}

async function readQuestions(file) {
  if (!file) return DEFAULT_QUESTIONS;
  let list;
  try {
    list = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new Error(`--questions-file must be a JSON array: ${err.message}`);
  }
  if (!Array.isArray(list) || !list.length || !list.every((q) => q && typeof q.id === 'string' && typeof q.question === 'string')) {
    throw new Error('--questions-file must be a JSON array of {"id": "...", "question": "..."} objects.');
  }
  const ids = list.map((q) => slug(q.id));
  if (new Set(ids).size !== ids.length) throw new Error('--questions-file has two questions with the same id.');
  return list.map((q, i) => ({ id: ids[i], question: q.question }));
}

async function connect(opts, log) {
  let session = null;
  const staticToken = opts.token || process.env.CRAYON_TOKEN || null;
  if (!staticToken) {
    session = await authorize({
      serverUrl: opts.server,
      scope: opts.scope,
      clientName: 'calven-migrate-from-crayon',
      browser: opts.browser,
      log,
    });
    log('Signed in.');
  }
  const client = new McpClient({
    url: opts.server,
    clientInfo: { name: 'calven-migrate-from-crayon', version: pkg.version },
    getToken: () => staticToken || session?.token?.access_token,
    onUnauthorized: async () => {
      if (!session) return false;
      try {
        return Boolean(await refresh(session));
      } catch (err) {
        log(`Refreshing the access token failed: ${err.message}`);
        return false;
      }
    },
  });
  try {
    await client.initialize();
  } catch (err) {
    await disconnect({ client, session }, log);
    throw err;
  }
  return { client, session };
}

async function disconnect({ client, session }, log) {
  await client?.close();
  if (!session) return;
  const outcome = await revoke(session);
  if (outcome === 'revoked') log('Access token revoked.');
  else if (outcome === 'unsupported') log('Note: the server offers no way to revoke the access token; it expires on its own.');
  else log('Note: revoking the access token failed; it expires on its own.');
}

async function writeGroup(mdRoot, folder, records, groupOf, nameOf, index, usedPaths) {
  const groups = new Map();
  for (const r of records) {
    const g = oneLine(groupOf(r));
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  for (const [group, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const dir = join(mdRoot, folder, slug(group));
    await mkdir(dir, { recursive: true });
    index.push(`### ${group}`, '');
    for (const r of list) {
      const name = nameOf(r);
      let rel = join(folder, slug(group), `${name}.md`);
      for (let i = 2; usedPaths.has(rel); i++) rel = join(folder, slug(group), `${name}-${i}.md`);
      usedPaths.add(rel);
      await writeFile(join(mdRoot, rel), toMarkdown(r));
      const status = r.kind === 'answer' && r.status !== 'answered' ? ` (${r.status.replace('_', ' ')})` : '';
      index.push(`- [${oneLine(r.title || `Untitled ${r.kind}`).replace(/[[\]]/g, '')}](${rel.split('\\').join('/')})${status}`);
    }
    index.push('');
  }
}

async function writeExport(outDir, { answers, insights }, meta) {
  const mdRoot = join(outDir, 'markdown');
  await mkdir(mdRoot, { recursive: true });
  const usedPaths = new Set();
  const index = ['# Crayon export', '', `Exported ${meta.exported_at} with calven-migrate-from-crayon ${pkg.version}.`, ''];
  if (answers) {
    index.push(`> ${PARTIAL_NOTE}`, '');
    await writeJsonArray(join(outDir, 'answers.json'), answers);
    index.push(`## Answers (${answers.length})`, '');
    await writeGroup(mdRoot, 'answers', answers, (r) => r.competitor.name, (r) => r.section, index, usedPaths);
  }
  if (insights) {
    await writeJsonArray(join(outDir, 'insights.json'), insights);
    index.push(`## Insights (${insights.length})`, '');
    await writeGroup(mdRoot, 'insights', insights, (r) => r.section || 'Other', (r) => `${slug(r.title || 'insight')}${r.id ? `-${slug(r.id, 40)}` : ''}`, index, usedPaths);
  }
  await writeFile(join(mdRoot, 'index.md'), `${index.join('\n')}\n`);
}

export function coverageOf(answers, competitors, questions) {
  const statuses = ['answered', 'no_content', 'error'];
  const count = (list) => Object.fromEntries(statuses.map((s) => [s, list.filter((a) => a.status === s).length]));
  return {
    competitors: competitors.length,
    questions: questions.length,
    asked: answers.length,
    ...count(answers),
    by_question: Object.fromEntries(questions.map((q) => [q.id, count(answers.filter((a) => a.section === q.id))])),
  };
}

function coverageMarkdown(answers, competitors, questions, coverage) {
  const cell = { answered: 'answered', no_content: 'no content', error: 'error' };
  const lines = [
    '# Crayon export coverage',
    '',
    PARTIAL_NOTE,
    '',
    `${coverage.answered} of ${coverage.asked} questions answered, ${coverage.no_content} with no content, ${coverage.error} failed, across ${coverage.competitors} competitors.`,
    '',
    '"no content" means Crayon replied that it had nothing on the question; check those in Crayon before you cancel.',
    '',
    `| competitor | ${questions.map((q) => label(q.id)).join(' | ')} |`,
    `| --- | ${questions.map(() => '---').join(' | ')} |`,
  ];
  for (const c of competitors) {
    const row = questions.map((q) => {
      const a = answers.find((x) => x.competitor.name === c && x.section === q.id);
      return a ? cell[a.status] : 'not asked';
    });
    lines.push(`| ${c.replace(/\|/g, '/')} | ${row.join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function runAnswers(opts, outDir, argsFor, log) {
  const competitorsGiven = await readCompetitors(opts);
  const questions = await readQuestions(opts['questions-file']);
  const conn = await connect(opts, log);
  try {
    const tools = await conn.client.listTools();
    await writeJson(join(outDir, 'tools.json'), tools);

    const found = planAsk(tools, { askTool: opts['ask-tool'], questionArg: opts['question-arg'] });
    const plan = finishPlan(found.tool, found.questionKey, argsFor(found.tool.name));
    log(`Asking questions with ${plan.tool.name} (argument "${plan.questionKey}")...`);

    const rawDir = join(outDir, 'raw');
    await mkdir(join(rawDir, 'answers'), { recursive: true });
    const warnings = [];
    let competitors = competitorsGiven;
    let competitorSource = opts.competitors ? 'flag' : 'file';
    if (!competitors) {
      const found = await discoverCompetitors(conn.client, {
        tools,
        plan,
        listTool: opts['list-tool'],
        extraArgsFor: argsFor,
        log,
        onRaw: (name, data) => writeJson(join(rawDir, `${name}.json`), data),
      });
      competitors = found.names;
      competitorSource = found.source;
      warnings.push(...found.warnings);
    }
    log(`${competitors.length} competitors, ${questions.length} questions each.`);

    const askedAt = new Date().toISOString();
    const result = await askAll(conn.client, plan, {
      competitors,
      questions,
      extraArgs: argsFor(plan.tool.name),
      log,
      onAnswer: async (competitor, q, a) => {
        const dir = join(rawDir, 'answers', slug(competitor));
        await mkdir(dir, { recursive: true });
        await writeJson(join(dir, `${q.id}.json`), { arguments: a.arguments, result: a.result, error: a.error });
      },
    });
    warnings.push(...result.warnings);
    const answers = result.answers.map((a) => normalizeAnswer(a, askedAt));
    const coverage = coverageOf(answers, competitors, questions);
    await writeFile(join(outDir, 'coverage.md'), coverageMarkdown(answers, competitors, questions, coverage));
    return {
      answers,
      warnings,
      meta: {
        server: opts.server,
        server_info: conn.client.serverInfo || null,
        ask_tool: plan.tool.name,
        question_argument: plan.questionKey,
        competitor_argument: plan.competitorKey,
        competitor_source: competitorSource,
        competitors,
        questions,
        coverage,
      },
    };
  } finally {
    await disconnect(conn, log);
  }
}

async function runExport(opts, log) {
  const insightsKey = opts['insights-key'] || process.env.CRAYON_INSIGHTS_KEY || null;
  if (insightsKey && !opts['insights-url']) throw new Error(INSIGHTS_PENDING);
  if (opts['insights-url'] && !insightsKey) throw new Error('--insights-url needs a key: set CRAYON_INSIGHTS_KEY or pass --insights-key.');
  if (opts['skip-answers'] && !insightsKey) throw new Error('--skip-answers leaves nothing to export without an Insights API key.');

  const outDir = resolve(opts.out || `crayon-export-${new Date().toISOString().slice(0, 10)}`);
  await prepareOutDir(outDir, opts.force);
  const argsFor = parseExtraArgs(opts.arg);
  const warnings = [];
  let answers = null;
  let answersMeta = null;

  if (!opts['skip-answers']) {
    const r = await runAnswers(opts, outDir, argsFor, log);
    answers = r.answers;
    answersMeta = r.meta;
    warnings.push(...r.warnings);
  }

  let insights = null;
  if (insightsKey) {
    log('Exporting insights from the Insights API...');
    const rawDir = join(outDir, 'raw', 'insights');
    await mkdir(rawDir, { recursive: true });
    try {
      const r = await exportInsights({
        url: opts['insights-url'],
        key: insightsKey,
        log,
        onPage: (n, url, response) => writeJson(join(rawDir, `page-${String(n).padStart(4, '0')}.json`), { url, response }),
      });
      insights = r.items.map(normalizeInsight);
      warnings.push(...r.warnings);
    } catch (err) {
      if (!answers) throw err;
      warnings.push(`Insights API: ${err.message}. The answers were still exported.`);
    }
  }

  const meta = {
    schema: SCHEMA,
    exporter: `calven-migrate-from-crayon ${pkg.version}`,
    exported_at: new Date().toISOString(),
    partial: true,
    note: PARTIAL_NOTE,
    counts: {
      ...(answers ? { answers: answers.length, competitors: answersMeta.competitors.length } : {}),
      ...(insights ? { insights: insights.length } : {}),
    },
    ...(answersMeta || {}),
    insights_api: insightsKey ? { url: opts['insights-url'], exported: insights ? insights.length : null } : null,
    origin: Object.fromEntries(
      [['answers', answers], ['insights', insights]]
        .filter(([, list]) => list)
        .map(([name, list]) => [name, list.reduce((acc, r) => ({ ...acc, [r.origin]: (acc[r.origin] || 0) + 1 }), {})]),
    ),
    warnings,
  };
  await writeExport(outDir, { answers, insights }, meta);
  await writeJson(join(outDir, 'manifest.json'), meta);

  const summary = [];
  if (answers) summary.push(`${meta.coverage.answered} of ${answers.length} answers for ${answersMeta.competitors.length} competitors`);
  if (insights) summary.push(`${insights.length} insights`);
  log(`\nDone. ${summary.join(', ')} written to ${outDir}`);
  if (answers) log('This is a partial export: answers to fixed questions, not the raw cards. See coverage.md.');
  for (const w of warnings) log(`Warning: ${w}`);
  return meta;
}

async function runInspect(opts, log) {
  const outDir = resolve(opts.out || '.');
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, 'crayon-tools.json');
  if (!opts.force && (await stat(file).catch(() => null))) {
    throw new Error(`${file} already exists. Pass --force to replace it.`);
  }
  const conn = await connect(opts, log);
  try {
    const tools = await conn.client.listTools();
    await writeJson(file, { server: opts.server, server_info: conn.client.serverInfo || null, tools });
    log(`${tools.length} tools written to ${file}. It holds tool names and argument schemas, no Crayon content.`);
    return tools;
  } finally {
    await disconnect(conn, log);
  }
}

export async function main(argv = process.argv.slice(2), log = (m) => process.stderr.write(`${m}\n`)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      competitors: { type: 'string' },
      'competitors-file': { type: 'string' },
      'questions-file': { type: 'string' },
      'ask-tool': { type: 'string' },
      'question-arg': { type: 'string' },
      'list-tool': { type: 'string' },
      arg: { type: 'string', multiple: true },
      'insights-key': { type: 'string' },
      'insights-url': { type: 'string' },
      'skip-answers': { type: 'boolean', default: false },
      token: { type: 'string' },
      browser: { type: 'boolean', default: true },
      'no-browser': { type: 'boolean' },
      server: { type: 'string', default: DEFAULT_SERVER },
      scope: { type: 'string', default: DEFAULT_SCOPE },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values['no-browser']) values.browser = false;
  if (values.help) return log(HELP);
  if (values.version) return log(pkg.version);

  const args = [...positionals];
  if (args[0] === 'crayon') args.shift(); // accepted for symmetry with the vendor name
  const command = args[0] || 'export';
  try {
    if (command === 'export') return await runExport(values, log);
    if (command === 'inspect') return await runInspect(values, log);
    throw new Error(`Unknown command "${command}". Run with --help.`);
  } catch (err) {
    if (err instanceof MissingArgumentsError) {
      for (const m of err.missing) log(`  ${m.name}: ${m.schema.description || JSON.stringify(m.schema)}`);
    }
    throw err;
  }
}
