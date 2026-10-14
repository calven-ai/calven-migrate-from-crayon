// Crayon's MCP server answers questions; it does not list or extract cards.
// This module finds the tool that takes a question, finds the competitors,
// asks a fixed set of questions about each one, and keeps every answer
// verbatim with the citations Crayon returns. Tool names and argument names
// are read from the server at runtime, since Crayon has not published them.

import { dig, extractItems, isObj, parseToolResult } from './parse.mjs';

const QUESTION_KEYS = ['question', 'query', 'prompt', 'q', 'input', 'message', 'text', 'ask'];
const COMPETITOR_KEYS = ['competitor', 'competitor_name', 'competitorName', 'company', 'company_name', 'rival', 'rival_name'];
const MAX_CONSECUTIVE_ERRORS = 5;

export const DEFAULT_QUESTIONS = [
  { id: 'battlecard', question: 'Give me the full battlecard for {competitor}: every section and talking point, as written in Crayon.' },
  { id: 'objection-handling', question: 'What objections do prospects raise when they compare us with {competitor}, and how should a rep handle each one?' },
  { id: 'proof-points', question: 'What customer proof points, case studies and quotes do we have against {competitor}?' },
  { id: 'win-loss-stories', question: 'What win and loss stories do we have against {competitor}? Include the deal, the outcome and the reasons.' },
  { id: 'profile', question: 'Give me the competitor profile for {competitor}: overview, products, pricing, positioning, strengths, weaknesses and recent news.' },
];

export const LIST_QUESTION = 'List the name of every competitor tracked in this Crayon account. Reply with one competitor name per line and nothing else.';

export class MissingArgumentsError extends Error {
  constructor(tool, missing) {
    super(
      `${tool.name} needs arguments this tool does not fill in: ${missing.map((m) => m.name).join(', ')}. ` +
        'Run `calven-migrate-from-crayon inspect` and pass them with --arg name=value.',
    );
    this.missing = missing;
  }
}

const props = (tool) => tool.inputSchema?.properties || {};
const required = (tool) => tool.inputSchema?.required || [];
const isString = (schema) => !schema?.type || schema.type === 'string' || (Array.isArray(schema.type) && schema.type.includes('string'));
const nameMatches = (toolName, wanted) => toolName === wanted || [ '_', '.', '-', '/' ].some((s) => toolName.endsWith(`${s}${wanted}`));

function questionKeyOf(tool) {
  const p = props(tool);
  const named = QUESTION_KEYS.find((k) => p[k] && isString(p[k]));
  if (named) return { key: named, named: true };
  const strings = Object.keys(p).filter((k) => isString(p[k]));
  const requiredStrings = required(tool).filter((k) => strings.includes(k));
  if (requiredStrings.length === 1) return { key: requiredStrings[0], named: false };
  if (strings.length === 1) return { key: strings[0], named: false };
  return null;
}

function nameScore(tool) {
  const n = tool.name.toLowerCase();
  let s = /ask|answer/.test(n) ? 3 : /question|chat|query|assistant/.test(n) ? 2 : /search/.test(n) ? 1 : 0;
  if (/question|answer/i.test(tool.description || '')) s += 1;
  return s;
}

// Returns { tool, questionKey } or throws with the tool list.
export function planAsk(tools, { askTool, questionArg } = {}) {
  let tool;
  let q;
  if (askTool) {
    tool = tools.find((t) => nameMatches(t.name, askTool));
    if (!tool) throw new Error(`The server has no tool named ${askTool}. Tools available: ${tools.map((t) => t.name).join(', ') || 'none'}.`);
    q = questionArg ? { key: questionArg } : questionKeyOf(tool);
    if (!q && !Object.keys(props(tool)).length) q = { key: 'question', named: false };
    if (!q) throw new Error(`Could not tell which argument of ${tool.name} takes the question. Pass it with --question-arg <name>.`);
  } else {
    const ranked = tools
      .map((t) => ({ t, q: questionKeyOf(t) }))
      .filter((c) => c.q)
      .map((c) => ({ ...c, rank: nameScore(c.t) + (c.q.named ? 2 : 0) }))
      .filter((c) => c.rank >= 2)
      .sort((a, b) => b.rank - a.rank);
    if (!ranked.length) {
      throw new Error(
        `Could not find a tool on the server that takes a question. Tools available: ${tools.map((t) => t.name).join(', ') || 'none'}. ` +
          'Pick one with --ask-tool <name>, and open an issue with the output of `calven-migrate-from-crayon inspect`.',
      );
    }
    ({ t: tool, q } = ranked[0]);
    if (questionArg) q = { key: questionArg };
  }
  return { tool, questionKey: q.key };
}

export function finishPlan(tool, questionKey, extraArgs = {}) {
  const p = props(tool);
  const competitorKey = COMPETITOR_KEYS.find((k) => p[k] && k !== questionKey);
  const handled = new Set([questionKey, competitorKey, ...Object.keys(extraArgs)]);
  const missing = required(tool).filter((n) => !handled.has(n)).map((name) => ({ name, schema: p[name] || {} }));
  if (missing.length) throw new MissingArgumentsError(tool, missing);
  return { tool, questionKey, competitorKey: competitorKey || null };
}

// A tool that lists competitors and needs nothing we cannot fill in.
export function findListTool(tools, { listTool, exclude, extraArgsFor = () => ({}) } = {}) {
  if (listTool) {
    const t = tools.find((x) => nameMatches(x.name, listTool));
    if (!t) throw new Error(`The server has no tool named ${listTool}.`);
    return t;
  }
  return tools.find((t) => {
    if (t === exclude) return false;
    const n = t.name.toLowerCase();
    if (!/competitor|rival/.test(n) || !/list|all|get|search|competitors|rivals/.test(n)) return false;
    const extra = extraArgsFor(t.name);
    return required(t).every((r) => r in extra);
  });
}

const cleanLine = (l) =>
  l
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\*\*|__/g, '')
    .trim();

// Turns "1. Acme\n- Globex" into names. Headings and sentences are dropped.
export function namesFromText(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line || line.endsWith(':') || line.startsWith('#') || line.length > 80 || /[.!?]$/.test(line) && line.split(/\s+/).length > 4) continue;
    out.push(line);
  }
  return [...new Set(out)];
}

export function namesFromItems(items) {
  const names = items
    .map((i) => (typeof i === 'string' ? i : isObj(i) ? dig(i, ['name', 'title', 'competitor_name', 'competitorName', 'display_name', 'displayName', 'company']) : undefined))
    .filter((n) => typeof n === 'string' && n.trim())
    .map((n) => n.trim());
  return [...new Set(names)];
}

export async function discoverCompetitors(client, { tools, plan, listTool, extraArgsFor, log, onRaw }) {
  const warnings = [];
  let tool;
  try {
    tool = findListTool(tools, { listTool, exclude: plan.tool, extraArgsFor });
  } catch (err) {
    if (listTool) throw err;
  }
  if (tool) {
    log(`Listing competitors with ${tool.name}...`);
    try {
      const result = await client.callTool(tool.name, { ...extraArgsFor(tool.name) });
      await onRaw('list-competitors', { tool: tool.name, result });
      const { payload, text } = parseToolResult(result);
      let names = namesFromItems(extractItems(payload, 'competitor'));
      if (!names.length && text) names = namesFromText(text);
      if (names.length) return { names, source: `tool:${tool.name}`, warnings };
      warnings.push(`${tool.name} returned no competitor names, so the list was asked for instead`);
    } catch (err) {
      if (err.status === 401 || err.status === 403) throw err;
      warnings.push(`${tool.name} failed (${err.message.slice(0, 120)}), so the list was asked for instead`);
    }
  }

  log('No competitor list tool found. Asking Crayon for the list...');
  const answer = await askOne(client, plan, { id: 'competitor-list', question: LIST_QUESTION }, null, extraArgsFor(plan.tool.name));
  await onRaw('list-competitors-asked', { tool: plan.tool.name, arguments: answer.arguments, result: answer.result });
  const names = answer.status === 'answered' ? namesFromText(answer.text) : [];
  if (!names.length) {
    throw new Error('Crayon did not return a competitor list. Pass the names with --competitors "Acme, Globex" or --competitors-file <file>.');
  }
  warnings.push(`The competitor list (${names.length}) came from asking Crayon a question. Check it against Crayon and pass --competitors if any are missing.`);
  return { names, source: 'asked', warnings };
}

const NO_CONTENT = /^(?:sorry\b|i\s+(?:could\s*n[o']?t|can\s*not|can't|don[’']t|do\s+not)\s+(?:find|have|locate|see)|no\s+(?:relevant\s+)?(?:information|content|data|results|matches)\b|there\s+(?:is|are)\s+no\b)/i;

const urlKey = (u) => String(u).replace(/[).,;]+$/, '');

export function citationsOf(payload, text, links = []) {
  const out = [];
  const add = (c) => {
    if (!c) return;
    if (typeof c === 'string') c = { url: c };
    if (!isObj(c)) return;
    const url = dig(c, ['url', 'link', 'href', 'uri', 'source_url', 'sourceUrl']);
    const entry = {
      title: dig(c, ['title', 'name', 'source', 'label']) ?? null,
      url: typeof url === 'string' ? urlKey(url) : null,
      snippet: dig(c, ['snippet', 'quote', 'excerpt', 'text']) ?? null,
    };
    if (!entry.url && !entry.title) return;
    if (entry.url && out.some((o) => o.url === entry.url)) return;
    out.push(entry);
  };
  const list = isObj(payload) ? dig(payload, ['citations', 'sources', 'references', 'links', 'answer.citations', 'answer.sources']) : undefined;
  if (Array.isArray(list)) list.forEach(add);
  links.forEach(add);
  for (const m of String(text || '').matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) add({ title: m[1], url: m[2] });
  for (const m of String(text || '').matchAll(/(?<![(\w])https?:\/\/[^\s)<>\]]+/g)) add({ url: m[0] });
  return out;
}

export function answerTextOf(payload, text) {
  if (text && text.trim()) return text;
  const v = isObj(payload) ? dig(payload, ['answer', 'answer.text', 'answer.content', 'response', 'text', 'content', 'result', 'output', 'message', 'summary']) : undefined;
  if (typeof v === 'string') return v;
  if (payload !== null && payload !== undefined) return JSON.stringify(payload, null, 2);
  return '';
}

// One question to the ask tool. Never throws for a tool-level failure: the
// answer comes back with status 'error' so the rest of the export goes on.
export async function askOne(client, plan, q, competitor, extraArgs = {}) {
  const text = competitor ? q.question.replaceAll('{competitor}', competitor) : q.question;
  const args = { ...extraArgs, [plan.questionKey]: text };
  if (plan.competitorKey && competitor) args[plan.competitorKey] = competitor;
  let result;
  try {
    result = await client.callTool(plan.tool.name, args);
    const { payload, text: prose, links } = parseToolResult(result);
    const answer = answerTextOf(payload, prose);
    const status = !answer.trim() || NO_CONTENT.test(answer.trim()) ? 'no_content' : 'answered';
    return { status, question: text, text: answer, citations: citationsOf(payload, prose, links), payload, arguments: args, result, error: null };
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw err;
    return { status: 'error', question: text, text: '', citations: [], payload: null, arguments: args, result: result ?? null, error: err.message };
  }
}

export async function askAll(client, plan, { competitors, questions, extraArgs, log, onAnswer }) {
  const answers = [];
  const warnings = [];
  let consecutive = 0;
  for (const competitor of competitors) {
    log(`Asking about ${competitor}...`);
    for (const q of questions) {
      const a = await askOne(client, plan, q, competitor, extraArgs);
      await onAnswer(competitor, q, a);
      answers.push({ competitor, question_id: q.id, ...a });
      if (a.status === 'error') {
        warnings.push(`${competitor} / ${q.id}: ${a.error.slice(0, 160)}`);
        if (++consecutive >= MAX_CONSECUTIVE_ERRORS) {
          warnings.push(`${MAX_CONSECUTIVE_ERRORS} questions in a row failed, so asking stopped there. The answers so far are saved; fix the cause and run again with --force.`);
          return { answers, warnings, stopped: true };
        }
      } else {
        consecutive = 0;
      }
    }
  }
  return { answers, warnings, stopped: false };
}
