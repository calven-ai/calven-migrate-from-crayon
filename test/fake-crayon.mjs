// A stand-in for Crayon's MCP server, OAuth server and Insights API, used by
// the tests. The OAuth side mirrors the published metadata of mcp.crayon.co
// and app.crayon.co (401 challenge, RFC 9728 resource metadata with a trailing
// slash, dynamic registration, PKCE, scope mcp:read, auth method none).
// Crayon has not published its tool schemas or Insights API endpoints, so the
// tool names, answer shapes and paging styles here are guesses, and each
// option is tested.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

export const COMPETITORS = ['Acme Analytics', 'Globex', 'Initech & Co'];

export function makeInsights(n = 230) {
  const types = ['review', 'news', 'win_loss', 'call_clip'];
  return Array.from({ length: n }, (_, i) => {
    const type = types[i % types.length];
    const base = {
      id: `ins-${i}`,
      type,
      title: `Insight ${i + 1}`,
      summary: `Summary ${i + 1}`,
      date: '2026-09-01',
      competitors: [{ id: 10 + (i % 3), name: COMPETITORS[i % 3] }],
    };
    if (type === 'review') Object.assign(base, { rating: 4, pros: 'Fast', cons: 'Pricey', reviewer_role: 'PMM' });
    if (type === 'win_loss') Object.assign(base, { opportunity: `Opp ${i}`, amount: 12000, owner: 'Rep', lost_to: COMPETITORS[i % 3] });
    return base;
  });
}

export async function startFakeCrayon(options = {}) {
  const opts = {
    transport: 'json', // json | sse
    askTool: 'ask_crayon',
    askDescription: 'Ask Crayon a question about your competitors',
    askProps: { question: { type: 'string', description: 'The question' } },
    askRequired: ['question'],
    competitorArg: false, // the ask tool also takes a competitor argument
    listTool: 'list_competitors', // null: no competitor list tool
    listShape: 'structured', // structured | text | empty | error
    competitors: COMPETITORS,
    answerShape: 'text', // text | structured | links | html
    noContentFor: null, // competitor whose answers say there is nothing
    errorFor: null, // question id fragment whose answers are tool errors
    failAll: false, // every tools/call is a tool error
    listAnswer: null, // the ask tool's reply to the list question
    invalidTokens: 0,
    flaky: false,
    required: [],
    extraTools: [],
    insightsPaging: 'next-url', // next-url | cursor | page | single | foreign
    insightsKey: 'ik_test',
    insights: makeInsights(),
    ...options,
  };
  const state = { clients: new Map(), codes: new Map(), tokens: new Set(), refresh: new Set(), revoked: [], calls: [], issued: 0, sessions: 0, tokenAuth: [], insightRequests: [], flakyLeft: opts.flaky ? 1 : 0 };
  let base;

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((r) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => r(b));
  });

  function issueTokens() {
    state.issued++;
    const access = `at_${randomBytes(8).toString('hex')}`;
    if (state.issued > opts.invalidTokens) state.tokens.add(access);
    const refresh = `rt_${randomBytes(8).toString('hex')}`;
    state.refresh.add(refresh);
    return { access_token: access, token_type: 'Bearer', expires_in: 3600, scope: 'mcp:read', refresh_token: refresh };
  }

  const tools = () => {
    const ask = {
      name: opts.askTool,
      description: opts.askDescription,
      inputSchema: {
        type: 'object',
        properties: { ...opts.askProps, ...(opts.competitorArg ? { competitor: { type: 'string' } } : {}), ...Object.fromEntries(opts.required.map((r) => [r, { type: 'string', description: `required ${r}` }])) },
        required: [...opts.askRequired, ...opts.required],
      },
    };
    const list = opts.listTool ? [{ name: opts.listTool, description: 'List tracked competitors', inputSchema: { type: 'object', properties: {} } }] : [];
    return [{ name: 'get_alerts', description: 'Recent alerts', inputSchema: { type: 'object', properties: { since: { type: 'string' } }, required: ['since'] } }, ...list, ask, ...opts.extraTools];
  };

  function answer(args) {
    const question = Object.values(args).find((v) => typeof v === 'string' && v.length > 20) || '';
    if (opts.failAll) return { content: [{ type: 'text', text: 'internal error' }], isError: true };
    if (/List the name of every competitor/.test(question)) {
      return { content: [{ type: 'text', text: opts.listAnswer ?? `Here are your competitors:\n\n${opts.competitors.map((c, i) => `${i + 1}. **${c}**`).join('\n')}` }] };
    }
    const competitor = args.competitor || opts.competitors.find((c) => question.includes(c)) || 'unknown';
    if (opts.errorFor && question.toLowerCase().includes(opts.errorFor)) return { content: [{ type: 'text', text: 'Answer service unavailable' }], isError: true };
    if (opts.noContentFor === competitor) return { content: [{ type: 'text', text: "I couldn't find any information about that in your Crayon account." }] };
    const text = `## ${competitor}\n\nAnswer to: ${question}\n\n- Point one\n- Point two\n\nSee [Win report](https://app.crayon.co/intel/1) and https://example.com/review.`;
    if (opts.answerShape === 'structured') {
      return { content: [{ type: 'text', text: JSON.stringify({ answer: text, citations: [{ title: 'Battlecard', url: 'https://app.crayon.co/battlecards/9' }] }) }], structuredContent: { answer: text, citations: [{ title: 'Battlecard', url: 'https://app.crayon.co/battlecards/9' }] } };
    }
    if (opts.answerShape === 'links') {
      return { content: [{ type: 'text', text }, { type: 'resource_link', uri: 'https://app.crayon.co/battlecards/9', name: 'Battlecard' }] };
    }
    if (opts.answerShape === 'html') {
      return { content: [{ type: 'text', text: `<h2>${competitor}</h2><p>Talk about <strong>value</strong> &amp; proof.</p>` }] };
    }
    return { content: [{ type: 'text', text }] };
  }

  function listResult() {
    if (opts.listShape === 'error') return { content: [{ type: 'text', text: 'not allowed' }], isError: true };
    if (opts.listShape === 'empty') return { content: [{ type: 'text', text: JSON.stringify({ competitors: [] }) }] };
    if (opts.listShape === 'text') return { content: [{ type: 'text', text: opts.competitors.map((c) => `- ${c}`).join('\n') }] };
    const items = opts.competitors.map((name, i) => ({ id: i + 1, name }));
    return { content: [{ type: 'text', text: JSON.stringify({ competitors: items }) }], structuredContent: { competitors: items } };
  }

  async function handleMcp(req, res) {
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!state.tokens.has(auth)) {
      await readBody(req);
      res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp/"` });
      return res.end();
    }
    if (req.method === 'DELETE') return res.writeHead(200).end();
    const msg = JSON.parse(await readBody(req));
    if (!msg.id && msg.id !== 0) return res.writeHead(202).end();

    let result;
    const headers = {};
    if (msg.method === 'initialize') {
      state.sessions++;
      headers['Mcp-Session-Id'] = `sess-${state.sessions}`;
      result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-crayon', version: '0' } };
    } else if (msg.method === 'tools/list') {
      result = { tools: tools() };
    } else if (msg.method === 'tools/call') {
      if (state.flakyLeft > 0) {
        state.flakyLeft--;
        return json(res, 429, { error: 'slow down' }, { 'Retry-After': '0' });
      }
      const { name, arguments: args = {} } = msg.params;
      state.calls.push({ name, args });
      if (name === opts.askTool) result = answer(args);
      else if (name === opts.listTool) result = listResult();
      else result = { content: [{ type: 'text', text: 'unknown tool' }], isError: true };
    } else {
      return json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
    const reply = { jsonrpc: '2.0', id: msg.id, result };
    if (opts.transport === 'sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers });
      res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
    } else {
      json(res, 200, reply, headers);
    }
  }

  function handleInsights(req, res, url) {
    state.insightRequests.push(url.search);
    if (req.headers.authorization !== `Bearer ${opts.insightsKey}`) return json(res, 401, { error: 'invalid key' });
    const list = opts.insights;
    const size = 50;
    const mode = opts.insightsPaging;
    if (mode === 'single') return json(res, 200, { insights: list });
    if (mode === 'page') {
      const p = Number(url.searchParams.get('page') || 1);
      return json(res, 200, { data: list.slice((p - 1) * size, p * size), meta: { total: list.length, page: p } });
    }
    if (mode === 'cursor') {
      const start = Number(url.searchParams.get('cursor') || 0);
      const end = start + size;
      return json(res, 200, { insights: list.slice(start, end), next_cursor: end < list.length ? String(end) : null });
    }
    const start = Number(url.searchParams.get('offset') || 0);
    const end = start + size;
    const nextBase = mode === 'foreign' ? 'https://elsewhere.example' : base;
    return json(res, 200, { results: list.slice(start, end), next: end < list.length ? `${nextBase}/v1/insights?offset=${end}` : null });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    try {
      if (url.pathname === '/mcp/') return await handleMcp(req, res);
      if (url.pathname === '/v1/insights') return handleInsights(req, res, url);
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp/') {
        return json(res, 200, { resource: `${base}/mcp/`, authorization_servers: [`${base}/`], scopes_supported: [], bearer_methods_supported: ['header'] });
      }
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return json(res, 200, {
          issuer: base,
          authorization_endpoint: `${base}/oauth/authorize/`,
          token_endpoint: `${base}/oauth/token/`,
          revocation_endpoint: `${base}/oauth/revoke_token/`,
          registration_endpoint: `${base}/oauth/register/`,
          scopes_supported: ['mcp:read'],
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url.pathname === '/oauth/register/') {
        const body = JSON.parse(await readBody(req));
        if (!body.redirect_uris?.length) return json(res, 400, { error: 'invalid_redirect_uri' });
        const client = { client_id: `c_${randomBytes(4).toString('hex')}`, ...body };
        if (body.token_endpoint_auth_method !== 'none') client.client_secret = `s_${randomBytes(8).toString('hex')}`;
        state.clients.set(client.client_id, client);
        return json(res, 201, client);
      }
      if (url.pathname === '/oauth/authorize/') {
        const p = url.searchParams;
        const client = state.clients.get(p.get('client_id'));
        if (!client || !client.redirect_uris.includes(p.get('redirect_uri')) || p.get('code_challenge_method') !== 'S256' || p.get('scope') !== 'mcp:read') {
          return json(res, 400, { error: 'invalid_request' });
        }
        const code = `code_${randomBytes(6).toString('hex')}`;
        state.codes.set(code, { client: client.client_id, challenge: p.get('code_challenge'), redirect: p.get('redirect_uri') });
        res.writeHead(302, { Location: `${p.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(p.get('state'))}` });
        return res.end();
      }
      if (url.pathname === '/oauth/token/' || url.pathname === '/oauth/revoke_token/') {
        const p = new URLSearchParams(await readBody(req));
        const client = state.clients.get(p.get('client_id'));
        if (!client) return json(res, 401, { error: 'invalid_client' });
        if (client.token_endpoint_auth_method !== 'none' && client.client_secret !== p.get('client_secret')) return json(res, 401, { error: 'invalid_client' });
        state.tokenAuth.push(client.token_endpoint_auth_method);
        if (url.pathname === '/oauth/revoke_token/') {
          state.revoked.push(p.get('token_type_hint'));
          state.tokens.delete(p.get('token'));
          state.refresh.delete(p.get('token'));
          return res.writeHead(200).end();
        }
        if (p.get('grant_type') === 'authorization_code') {
          const entry = state.codes.get(p.get('code'));
          state.codes.delete(p.get('code'));
          const challenge = createHash('sha256').update(p.get('code_verifier') || '').digest('base64url');
          if (!entry || entry.challenge !== challenge || entry.redirect !== p.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant' });
          return json(res, 200, issueTokens());
        }
        if (p.get('grant_type') === 'refresh_token' && state.refresh.has(p.get('refresh_token'))) {
          state.refresh.delete(p.get('refresh_token'));
          return json(res, 200, issueTokens());
        }
        return json(res, 400, { error: 'invalid_grant' });
      }
      res.writeHead(404).end();
    } catch (err) {
      json(res, 500, { error: String(err) });
    }
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${base}/mcp/`,
    insightsUrl: `${base}/v1/insights`,
    state,
    issueStaticToken() {
      const t = `tok_${randomBytes(6).toString('hex')}`;
      state.tokens.add(t);
      return t;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
