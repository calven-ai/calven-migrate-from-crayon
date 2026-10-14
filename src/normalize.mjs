// Maps Crayon answers and insights onto the neutral calven-export schema and
// renders them as Markdown. The original response is always kept under
// `source`, and an answer's text is kept exactly as Crayon returned it.

import { dig, isObj, itemId } from './parse.mjs';

export const SCHEMA = 'calven-export/v1';

const str = (v) => (v === undefined || v === null ? null : isObj(v) ? dig(v, ['name', 'title', 'email', 'id']) ?? null : String(v));
const looksLikeHtml = (s) => typeof s === 'string' && /<\/?[a-z][\s\S]*>/i.test(s);

export const label = (id) => {
  const s = String(id).replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Answers are Outputs of Crayon's AI tools: Crayon's terms (June 2026, 8.2)
// let the customer use them for internal business purposes. Insights are
// sorted by type: win/loss records and call clips come from the customer's
// own deals and calls; reviews, news and web content are third-party
// material Crayon collected.
export function insightOrigin(type) {
  const t = String(type || '').toLowerCase();
  if (/win|loss|deal|opportunit|call|clip|interview/.test(t)) return 'customer';
  if (/review|news|article|press|web|site|social|job|blog|content|update/.test(t)) return 'crayon_or_third_party';
  return 'unknown';
}

export function normalizeAnswer(a, askedAt) {
  const body = a.text || null;
  return {
    schema: SCHEMA,
    source_system: 'crayon',
    kind: 'answer',
    id: `${slug(a.competitor)}--${a.question_id}`,
    title: `${a.competitor}: ${label(a.question_id)}`,
    competitor: { id: null, name: a.competitor },
    section: a.question_id,
    question: a.question,
    status: a.status,
    body_html: looksLikeHtml(body) ? body : null,
    body_markdown: body === null ? null : looksLikeHtml(body) ? htmlToMarkdown(body) : body,
    citations: a.citations,
    tags: [],
    url: null,
    author: null,
    origin: 'crayon_output',
    created_at: askedAt,
    updated_at: null,
    error: a.error,
    source: a.payload ?? (a.text ? { text: a.text } : null),
  };
}

export function normalizeInsight(item) {
  const body = dig(item, ['full_text', 'fullText', 'body_html', 'html', 'content', 'body', 'text', 'description', 'summary']);
  const bodyText = typeof body === 'string' ? body : null;
  const tagged = dig(item, ['competitors', 'tagged_competitors', 'taggedCompetitors']);
  const firstTagged = Array.isArray(tagged) ? tagged[0] : undefined;
  const competitorName = str(firstTagged ?? dig(item, ['competitor', 'competitor_name', 'competitorName', 'lost_to', 'lostTo']));
  const competitorId = isObj(firstTagged) ? str(firstTagged.id) : str(dig(item, ['competitor.id', 'competitor_id', 'competitorId']));
  const type = str(dig(item, ['type', 'insight_type', 'insightType', 'kind', 'category'])) ?? null;
  const tags = dig(item, ['tags', 'labels']);
  return {
    schema: SCHEMA,
    source_system: 'crayon',
    kind: 'insight',
    id: itemId(item) ?? null,
    title: str(dig(item, ['title', 'name', 'headline'])) ?? null,
    competitor: competitorName || competitorId ? { id: competitorId ?? null, name: competitorName ?? null } : null,
    section: type,
    question: null,
    status: null,
    body_html: looksLikeHtml(bodyText) ? bodyText : null,
    body_markdown: bodyText === null ? null : looksLikeHtml(bodyText) ? htmlToMarkdown(bodyText) : bodyText,
    citations: [],
    tags: Array.isArray(tags) ? tags.map(str).filter(Boolean) : [],
    url: str(dig(item, ['source_url', 'sourceUrl', 'url', 'link', 'permalink'])) ?? null,
    author: str(dig(item, ['author', 'owner', 'created_by', 'createdBy', 'reviewer_role', 'reviewerRole'])) ?? null,
    origin: insightOrigin(type),
    created_at: str(dig(item, ['date', 'published_at', 'publishedAt', 'created_at', 'createdAt'])) ?? null,
    updated_at: str(dig(item, ['updated_at', 'updatedAt'])) ?? null,
    error: null,
    source: item,
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

// Covers the HTML a card editor produces. Anything unusual is still in body_html.
export function htmlToMarkdown(html) {
  let s = html.replace(/\r/g, '');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.trim()}\n\n`);
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => (t.trim() ? `**${t.trim()}**` : ''));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => (t.trim() ? `*${t.trim()}*` : ''));
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => `[${t.trim() || href}](${href})`);
  s = s.replace(/<img\b[^>]*src="([^"]*)"[^>]*>/gi, (m, src) => `![${(m.match(/alt="([^"]*)"/i) || [])[1] || ''}](${src})`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${t.replace(/<\/?p[^>]*>/gi, '').trim()}`);
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => `\n\n> ${t.trim()}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|table)>/gi, '\n\n');
  s = s.replace(/<\/t[dh]>/gi, ' | ');
  s = s.replace(/<[^>]+>/g, '');
  s = decode(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function slug(s, max = 60) {
  const out = String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  // names Windows reserves for devices cannot be file names
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/.test(out)) return `_${out}`;
  return out || 'untitled';
}

// JSON strings are valid YAML double-quoted scalars.
const yaml = (v) => JSON.stringify(v);

export function toMarkdown(record) {
  const front = [
    '---',
    `schema: ${yaml(record.schema)}`,
    `source_system: ${yaml(record.source_system)}`,
    `kind: ${yaml(record.kind)}`,
    `id: ${yaml(record.id)}`,
    `title: ${yaml(record.title)}`,
    `competitor: ${yaml(record.competitor?.name ?? null)}`,
    `section: ${yaml(record.section)}`,
  ];
  if (record.kind === 'answer') front.push(`question: ${yaml(record.question)}`, `status: ${yaml(record.status)}`);
  front.push(
    `tags: ${yaml(record.tags)}`,
    `url: ${yaml(record.url)}`,
    `author: ${yaml(record.author)}`,
    `origin: ${yaml(record.origin)}`,
    `created_at: ${yaml(record.created_at)}`,
    `updated_at: ${yaml(record.updated_at)}`,
    '---',
    '',
  );
  const lines = [...front, `# ${record.title || `Untitled ${record.kind} ${record.id ?? ''}`.trim()}`, ''];
  if (record.kind === 'answer') {
    lines.push(`> Asked Crayon: ${record.question}`, '');
    if (record.status === 'error') lines.push(`The question failed: ${record.error}`, '');
    else if (record.body_markdown) lines.push(record.body_markdown, '');
    else lines.push('Crayon returned no answer.', '');
    if (record.citations?.length) {
      lines.push('## Citations', '');
      for (const c of record.citations) {
        const text = (c.title || c.url || '').replace(/[[\]]/g, '');
        lines.push(c.url ? `- [${text}](${c.url})` : `- ${text}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
  if (record.body_markdown) {
    lines.push(record.body_markdown, '');
  } else {
    // No recognised body field: show the whole item so the file is complete.
    lines.push('The export did not recognise a body field for this item. The full item follows.', '', '```json', JSON.stringify(record.source, null, 2), '```', '');
  }
  if (record.url) lines.push(`Source: ${record.url}`, '');
  return lines.join('\n');
}
