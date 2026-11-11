// Turns editor HTML into LanguageTool's annotated `data` items and maps match
// offsets back to the text the author sees. No DOM needed, so it runs in tests.

const TOKEN = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^\s/>]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;
const VOID = new Set(['area', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'picture',
  'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const SKIP_TAGS = new Set(['code', 'pre', 'script', 'style', 'template', 'textarea']);
const SKIP_BLOCKS = new Set(['metadata', 'section-metadata', 'library-metadata']);
// Wrappers the editor adds around content; their children are the real segments.
const TRANSPARENT = new Set(['default-content-wrapper']);
const KINDS = {
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  p: 'paragraph',
  ul: 'list',
  ol: 'list',
  blockquote: 'quote',
  table: 'table',
};
const LABELS = {
  heading: 'Heading', paragraph: 'Paragraph', list: 'List', quote: 'Quote', table: 'Table', other: 'Text',
};
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isNaN(code) ? all : String.fromCodePoint(code);
  }
  return ENTITIES[e.toLowerCase()] ?? all;
});

export const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseTag(raw) {
  if (raw.startsWith('<!--')) return { comment: true };
  const closing = raw[1] === '/';
  const name = raw.slice(closing ? 2 : 1).match(/^[^\s/>]+/)[0].toLowerCase();
  const cls = raw.match(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const classes = cls ? (cls[1] ?? cls[2] ?? cls[3]).trim().split(/\s+/).filter(Boolean) : [];
  return {
    name, closing, classes, empty: VOID.has(name) || /\/>$/.test(raw),
  };
}

function tokens(html) {
  const list = [];
  let last = 0;
  [...html.matchAll(TOKEN)].forEach((m) => {
    if (m.index > last) list.push({ text: html.slice(last, m.index) });
    list.push({ markup: m[0], tag: parseTag(m[0]) });
    last = m.index + m[0].length;
  });
  if (last < html.length) list.push({ text: html.slice(last) });
  return list;
}

function describe(tag) {
  if (tag.name === 'div' && tag.classes.length) {
    const label = tag.classes[0].replace(/-/g, ' ');
    return { kind: 'block', label: label[0].toUpperCase() + label.slice(1) };
  }
  const kind = KINDS[tag.name] || 'other';
  return { kind, label: LABELS[kind] };
}

/**
 * @param {string} html editor HTML: a live document (<main>...) or a selection fragment
 * @returns {{ items: object[], runs: object[], segments: object[] }}
 *   items: LanguageTool annotation items; `end` marks where a request may be cut.
 *   runs: text items with their offsets in the annotation string and in their segment.
 *   segments: top-level paragraphs, headings, lists and blocks with their plain text.
 */
export function buildDocument(html) {
  const items = [];
  const runs = [];
  const segments = [];
  const stack = []; // { name, transparent, skip, root }
  let rootDepth = 0;
  let offset = 0;
  let segment = null;
  let pendingBreak = false;
  let skip = 0;

  const depth = () => stack.filter((e) => !e.transparent).length;
  const push = (item) => {
    items.push(item);
    offset += (item.text ?? item.markup).length;
  };
  const openSegment = (info) => {
    segment = { ...info, text: '' };
    segments.push(segment);
    pendingBreak = false;
  };

  tokens(html).forEach((token) => {
    if ('text' in token) {
      if (skip) {
        push({ markup: token.text });
      } else if (!segment && !token.text.trim()) {
        push({ markup: token.text });
      } else {
        if (!segment) openSegment({ kind: 'paragraph', label: 'Text', loose: true });
        const text = decode(token.text);
        if (pendingBreak && segment.text) segment.text += '\n';
        pendingBreak = false;
        runs.push({
          start: offset,
          end: offset + text.length,
          segment,
          segStart: segment.text.length,
          item: items.length,
        });
        segment.text += text;
        push({ text });
      }
    } else if (token.tag.comment) {
      push({ markup: token.markup });
    } else {
      const { tag } = token;
      const item = { markup: token.markup };
      if (tag.name === 'br') item.interpretAs = '\n';
      else if (BLOCK.has(tag.name)) item.interpretAs = '\n\n';
      if (segment && (BLOCK.has(tag.name) || tag.name === 'br')) pendingBreak = true;

      if (tag.closing) {
        const at = stack.map((e) => e.name).lastIndexOf(tag.name);
        if (at !== -1) {
          const closed = stack.splice(at);
          if (closed.some((e) => e.skip)) skip = stack.filter((e) => e.skip).length;
          if (closed.some((e) => e.root)) {
            segment = null;
            item.end = true;
          }
        }
        push(item);
      } else {
        if (tag.name === 'main') rootDepth = depth() + 2;
        const entry = {
          name: tag.name,
          transparent: tag.name === 'div' && TRANSPARENT.has(tag.classes[0]),
          skip: SKIP_TAGS.has(tag.name) || (tag.name === 'div' && SKIP_BLOCKS.has(tag.classes[0])),
        };
        if (!entry.transparent && depth() === rootDepth && tag.name !== 'main') {
          if (segment?.loose) {
            const prev = items[items.length - 1];
            if (prev) prev.end = true;
          }
          entry.root = true;
          openSegment(describe(tag));
        }
        push(item);
        if (!tag.empty) {
          stack.push(entry);
          if (entry.skip) skip += 1;
        } else if (entry.root) {
          segment = null;
          item.end = true;
        }
      }
    }
  });

  const kept = segments.filter((s) => s.text.trim());
  kept.forEach((s, index) => {
    s.index = index;
    delete s.loose;
  });
  return { items, runs: runs.filter((r) => kept.includes(r.segment)), segments: kept };
}

/** Find the segment and the author-visible text a match covers, or null. */
export function locate(doc, offset, length) {
  const end = offset + length;
  const hits = doc.runs.filter((r) => r.start < end && r.end > offset);
  if (!hits.length) return null;
  const first = hits[0];
  const last = hits[hits.length - 1];
  const { segment } = first;
  if (hits.some((r) => r.segment !== segment)) return null;
  const start = first.segStart + Math.max(0, offset - first.start);
  const stop = last.segStart + Math.min(last.end, end) - last.start;
  const word = hits.map((r) => {
    const { text } = doc.items[r.item];
    return text.slice(Math.max(0, offset - r.start), Math.min(text.length, end - r.start));
  }).join('');
  return {
    segment, start, end: stop, word,
  };
}

/** Split items into requests of at most `max` characters, cutting only between segments. */
export function chunkItems(items, max) {
  const pieces = [];
  let piece = { items: [], length: 0 };
  items.forEach((item) => {
    piece.items.push(item);
    piece.length += (item.text ?? item.markup).length;
    if (item.end) {
      pieces.push(piece);
      piece = { items: [], length: 0 };
    }
  });
  if (piece.items.length) pieces.push(piece);

  const chunks = [];
  let chunk = null;
  let base = 0;
  pieces.forEach((p) => {
    if (!chunk || (chunk.length && chunk.length + p.length > max)) {
      chunk = { items: [], length: 0, base };
      chunks.push(chunk);
    }
    chunk.items.push(...p.items);
    chunk.length += p.length;
    base += p.length;
  });
  return chunks;
}

/**
 * Rebuild the HTML with replacements applied to text only; markup is kept.
 * @param {{ offset: number, length: number, value: string }[]} replacements
 *   annotation-string offsets, not overlapping
 */
export function applyReplacements(doc, replacements) {
  const sorted = [...replacements].sort((a, b) => a.offset - b.offset);
  const runAt = new Map(doc.runs.map((r) => [r.item, r]));
  const inserted = new Set();
  let offset = 0;
  return doc.items.map((item, index) => {
    const start = offset;
    if (!('text' in item)) {
      offset += item.markup.length;
      return item.markup;
    }
    offset += item.text.length;
    if (!runAt.has(index)) return escapeHtml(item.text);
    let out = '';
    let pos = 0;
    sorted.forEach((r) => {
      const from = Math.max(r.offset, start) - start;
      const to = Math.min(r.offset + r.length, offset) - start;
      if (from > item.text.length || to < 0 || from > to) return;
      if (to === from && r.length) return;
      out += item.text.slice(pos, from);
      if (!inserted.has(r)) out += r.value;
      inserted.add(r);
      pos = to;
    });
    return escapeHtml(out + item.text.slice(pos));
  }).join('');
}
