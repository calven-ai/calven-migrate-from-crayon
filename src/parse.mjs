// Reads tool results and API pages without knowing their exact shape ahead of
// time: JSON may arrive as structuredContent, as text blocks or as prose, and
// lists and paging hints sit under whichever key the vendor chose.

const LIST_KEYS = ['items', 'data', 'results', 'records', 'entries', 'nodes'];
const ID_KEYS = ['id', 'uuid', 'insight_id', 'insightId', 'competitor_id', 'competitorId'];

export const has = (obj, k) => obj && Object.prototype.hasOwnProperty.call(obj, k);
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function dig(obj, paths) {
  for (const path of paths) {
    let v = obj;
    for (const k of path.split('.')) v = isObj(v) ? v[k] : undefined;
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

// A tool result carries JSON as structuredContent or as text blocks. Prose is
// kept apart from JSON, since an answer tool replies mostly in prose.
export function parseToolResult(result) {
  if (result?.isError) {
    const text = (result.content || []).map((c) => c.text).filter(Boolean).join('\n');
    const err = new Error(`Tool returned an error: ${text || 'no detail'}`);
    err.toolError = true;
    throw err;
  }
  const json = [];
  const prose = [];
  const links = [];
  for (const block of result?.content || []) {
    if (block.type === 'resource_link' && block.uri) {
      links.push({ title: block.name || block.title || null, url: block.uri });
      continue;
    }
    const text = block.type === 'text' ? block.text : block.type === 'resource' ? block.resource?.text : undefined;
    if (block.type === 'resource' && block.resource?.uri) links.push({ title: block.resource.name || block.resource.title || null, url: block.resource.uri });
    if (typeof text !== 'string') continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object') json.push(parsed);
      else prose.push(text);
    } catch {
      prose.push(text);
    }
  }
  const structured = result?.structuredContent ?? null;
  const payload = structured ?? (json.length ? (json.length === 1 ? json[0] : json) : null);
  return { payload, text: prose.join('\n\n'), links };
}

export const itemId = (item) => {
  if (!isObj(item)) return undefined;
  for (const k of ID_KEYS) {
    const v = item[k];
    if (typeof v === 'string' && v !== '') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
};

const hasListKey = (v, keys) => isObj(v) && keys.some((k) => Array.isArray(v[k]));

// kind is 'competitor' or 'insight': the matching list key wins.
export function extractItems(payload, kind, depth = 0) {
  const keys = [`${kind}s`, ...LIST_KEYS];
  if (Array.isArray(payload)) {
    if (payload.length && payload.every((p) => hasListKey(p, keys))) {
      return payload.flatMap((p) => extractItems(p, kind, depth + 1));
    }
    return payload.filter((p) => isObj(p) || typeof p === 'string');
  }
  if (!isObj(payload)) return [];
  const key = keys.find((k) => Array.isArray(payload[k]));
  if (key) return payload[key].filter((p) => isObj(p) || typeof p === 'string');
  if (depth < 2) {
    for (const k of keys) {
      if (isObj(payload[k])) {
        const nested = extractItems(payload[k], kind, depth + 1);
        if (nested.length) return nested;
      }
    }
  }
  if (itemId(payload) !== undefined || has(payload, 'title') || has(payload, 'name')) return [payload];
  return [];
}

const pageObject = (payload) => (Array.isArray(payload) ? payload.find(isObj) : payload);

export function nextCursorOf(payload) {
  const p = pageObject(payload);
  if (!isObj(p)) return undefined;
  const v = dig(p, [
    'nextCursor', 'next_cursor', 'next_page_token', 'nextPageToken', 'cursor.next',
    'pagination.next_cursor', 'pagination.nextCursor', 'meta.next_cursor', 'meta.nextCursor',
    'page_info.end_cursor', 'pageInfo.endCursor',
  ]);
  return typeof v === 'string' || typeof v === 'number' ? v : undefined;
}

// A full URL for the next page, as many REST APIs return it.
export function nextUrlOf(payload) {
  const p = pageObject(payload);
  if (!isObj(p)) return undefined;
  const v = dig(p, ['next', 'links.next', 'links.next.href', '_links.next.href', 'pagination.next', 'meta.next', 'paging.next']);
  return typeof v === 'string' && /^https?:\/\//.test(v) ? v : undefined;
}

export function totalsOf(payload) {
  const p = pageObject(payload);
  if (!isObj(p)) return {};
  const num = (v) => (v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));
  return {
    total: num(dig(p, ['total', 'total_count', 'totalCount', 'meta.total', 'meta.total_count', 'pagination.total', 'pagination.total_count'])),
    totalPages: num(dig(p, ['total_pages', 'totalPages', 'meta.total_pages', 'pagination.total_pages', 'pagination.totalPages'])),
    hasMore: dig(p, ['has_more', 'hasMore', 'has_next_page', 'hasNextPage', 'pagination.has_more', 'meta.has_more', 'page_info.has_next_page', 'pageInfo.hasNextPage']),
  };
}
