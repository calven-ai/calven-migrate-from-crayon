// Optional second source: Crayon's read-only Insights API (announced
// 2026-10-01). Crayon has not published endpoint reference docs, so this is an
// adapter: the customer passes the list URL their Crayon admin or CSM gives
// them, and the pager follows whatever paging the responses carry (a next URL,
// a cursor, or page numbers). No endpoint is assumed.

import { createHash } from 'node:crypto';
import { assertSafeUrl } from './oauth.mjs';
import { extractItems, itemId, nextCursorOf, nextUrlOf, totalsOf } from './parse.mjs';

const MAX_PAGES = 5_000;
const CURSOR_PARAMS = ['cursor', 'page_token', 'pageToken', 'next_cursor', 'after', 'starting_after'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const INSIGHTS_PENDING =
  'Crayon has not published reference docs for the Insights API yet, so this tool does not guess its endpoints. ' +
  'Ask your Crayon admin or CSM for the URL that lists insights and pass it with --insights-url <url>.';

async function getPage(url, key, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
      throw new Error(`Insights API request failed: ${err.message}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await res.body?.cancel();
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt, 60_000));
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Insights API answered ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Insights API did not answer with JSON: ${text.slice(0, 120)}`);
    }
  }
}

export async function exportInsights({ url, key, log = () => {}, onPage = () => {} }) {
  if (!url) throw new Error(INSIGHTS_PENDING);
  const start = assertSafeUrl(url, 'Insights API URL');
  const items = [];
  const seen = new Set();
  const signatures = new Set();
  const warnings = [];
  let next = new URL(start);
  const cursorParam = CURSOR_PARAMS.find((p) => next.searchParams.has(p)) || 'cursor';
  let page = Number(next.searchParams.get('page')) || 1;
  let reportedTotal;
  let stopped = false;

  for (let n = 1; n <= MAX_PAGES; n++) {
    const payload = await getPage(next.toString(), key);
    await onPage(n, next.toString(), payload);
    const batch = extractItems(payload, 'insight').filter((i) => typeof i === 'object');
    const signature = createHash('sha256').update(JSON.stringify(batch)).digest('hex');
    if (batch.length && signatures.has(signature)) {
      warnings.push(`Insights API: page ${n} repeated an earlier page, so paging stopped there`);
      stopped = true;
      break;
    }
    signatures.add(signature);
    let fresh = 0;
    for (const item of batch) {
      const id = itemId(item);
      if (id !== undefined && seen.has(id)) continue;
      if (id !== undefined) seen.add(id);
      items.push(item);
      fresh++;
    }
    log(`  insights: page ${n}, ${batch.length} items (${items.length} total)`);
    const { total, totalPages, hasMore } = totalsOf(payload);
    if (total !== undefined) reportedTotal = total;
    if (!batch.length || hasMore === false || (fresh === 0 && batch.length)) { stopped = true; break; }

    const nextUrl = nextUrlOf(payload);
    const cursor = nextCursorOf(payload);
    if (nextUrl) {
      const candidate = new URL(nextUrl, next);
      // the key travels with every request, so it never leaves the first origin
      if (candidate.origin !== start.origin) {
        warnings.push(`Insights API: the next page is on another host (${candidate.origin}), so paging stopped there`);
        stopped = true;
        break;
      }
      next = candidate;
    } else if (cursor !== undefined) {
      next = new URL(next);
      next.searchParams.set(cursorParam, String(cursor));
    } else if (hasMore === true || (total !== undefined && items.length < total) || (totalPages !== undefined && page < totalPages)) {
      page++;
      next = new URL(next);
      next.searchParams.set('page', String(page));
    } else {
      stopped = true;
      break;
    }
  }
  if (!stopped) warnings.push(`Insights API: stopped at the ${MAX_PAGES}-page safety limit`);
  if (reportedTotal !== undefined && items.length < reportedTotal) {
    warnings.push(`Insights API: the server reported ${reportedTotal} insights but ${items.length} were exported`);
  }
  return { items, warnings };
}
