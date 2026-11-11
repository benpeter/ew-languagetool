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
  amp: '&', lt: '<', gt: '>', quot: '"', nbsp: '\u00a0',
};
// What LanguageTool gets instead of a tag or of text it should not check.
const STAND_IN = '<x>';

const decode = (s) => s.replace(/&(amp|lt|gt|quot|nbsp);/g, (all, e) => ENTITIES[e]);
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const blockName = (text) => text.trim().toLowerCase().replace(/\s*\(.*\)$/, '').replace(/\s+/g, '-');
const labelOf = (name) => {
  const label = name.replace(/-/g, ' ');
  return label[0].toUpperCase() + label.slice(1);
};

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
  if (tag.name === 'div' && tag.classes.length) return { kind: 'block', label: labelOf(tag.classes[0]) };
  const kind = KINDS[tag.name] || 'other';
  return { kind, label: LABELS[kind] };
}

/**
 * @param {string} html editor HTML: a live document (<main>, blocks as divs)
 *   or a selection (blocks as tables whose first row names the block)
 * @returns {{ items: object[], runs: object[], segments: object[] }}
 *   items: LanguageTool annotation items. Markup items carry a stand-in as
 *     `markup` and the original as `html`; `end` marks where a request may be cut.
 *   runs: text items with their offsets in the annotation string and in their segment.
 *   segments: top-level paragraphs, headings, lists and blocks with their plain text.
 */
export function buildDocument(html) {
  const items = [];
  const runs = [];
  const segments = [];
  const stack = []; // { name, skip, root, table, nameRowOf }
  let rootDepth = 0;
  let offset = 0;
  let segment = null;
  let pendingBreak = false;
  let skip = 0;

  const push = (item) => {
    items.push(item);
    offset += (item.text ?? item.markup).length;
  };
  const markup = (original, interpretAs) => push({
    markup: STAND_IN, html: original, ...(interpretAs ? { interpretAs } : {}),
  });

  const list = tokens(html);
  // Rows per table: a selection inside one cell arrives as a one-row table.
  const rowCounts = new Map();
  const open = [];
  list.forEach(({ tag }, i) => {
    if (tag?.name === 'table') {
      if (tag.closing) {
        open.pop();
      } else {
        open.push(i);
        rowCounts.set(i, 0);
      }
    } else if (tag?.name === 'tr' && !tag.closing && open.length) {
      const top = open[open.length - 1];
      rowCounts.set(top, rowCounts.get(top) + 1);
    }
  });

  list.forEach((token, index) => {
    if ('text' in token) {
      const table = stack.findLast((e) => e.table);
      if (table?.naming) table.blockText += decode(token.text);
      if (skip || (!segment && !token.text.trim())) {
        markup(token.text);
        return;
      }
      if (!segment) {
        segment = { kind: 'paragraph', label: 'Text', text: '' };
        segments.push(segment);
      }
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
      return;
    }
    const { tag } = token;
    if (tag.comment) {
      markup(token.markup);
      return;
    }
    const isBlock = BLOCK.has(tag.name);
    if (segment && (isBlock || tag.name === 'br')) pendingBreak = true;

    if (tag.closing) {
      const at = stack.map((e) => e.name).lastIndexOf(tag.name);
      const closed = at === -1 ? [] : stack.splice(at);
      const table = closed.find((e) => e.nameRowOf)?.nameRowOf;
      if (table) {
        table.naming = false;
        const name = blockName(table.blockText);
        if (SKIP_BLOCKS.has(name)) table.skip = true;
        else if (name && table.root && segment) Object.assign(segment, { kind: 'block', label: labelOf(name) });
      }
      skip = stack.filter((e) => e.skip).length;
      if (closed.some((e) => e.root)) segment = null;
      push({
        markup: STAND_IN,
        html: token.markup,
        ...(isBlock ? { interpretAs: '\n\n' } : {}),
        ...(closed.some((e) => e.root) ? { end: true } : {}),
      });
      return;
    }

    if (tag.name === 'main') rootDepth = stack.length + 2;
    const entry = {
      name: tag.name,
      skip: SKIP_TAGS.has(tag.name) || (tag.name === 'div' && SKIP_BLOCKS.has(tag.classes[0])),
      table: tag.name === 'table',
      rows: rowCounts.get(index),
    };
    if (stack.length === rootDepth && tag.name !== 'main') {
      entry.root = true;
      segment = { ...describe(tag), text: '' };
      segments.push(segment);
      pendingBreak = false;
    }
    // The first row of a block table holds the block name: don't check it.
    const table = stack.findLast((e) => e.table);
    if (tag.name === 'tr' && table && !table.named && table.rows > 1) {
      table.named = true;
      table.naming = true;
      table.blockText = '';
      entry.skip = true;
      entry.nameRowOf = table;
    }
    let interpretAs;
    if (tag.name === 'br') interpretAs = '\n';
    else if (isBlock) interpretAs = '\n\n';
    else if (entry.skip && segment && !skip) interpretAs = 'X';
    markup(token.markup, interpretAs);
    if (tag.empty) {
      if (entry.root) {
        segment = null;
        items[items.length - 1].end = true;
      }
      return;
    }
    stack.push(entry);
    if (entry.skip) skip += 1;
  });

  const kept = segments.filter((s) => s.text.trim());
  kept.forEach((s, index) => { s.index = index; });
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
 * Rebuild the original HTML with replacements applied to text only.
 * @param {{ offset: number, length: number, value: string }[]} replacements
 *   annotation-string offsets, not overlapping
 */
export function applyReplacements(doc, replacements) {
  const sorted = [...replacements].sort((a, b) => a.offset - b.offset);
  const checked = new Set(doc.runs.map((r) => r.item));
  const inserted = new Set();
  let offset = 0;
  return doc.items.map((item, index) => {
    const start = offset;
    if (!('text' in item)) {
      offset += item.markup.length;
      return item.html;
    }
    offset += item.text.length;
    if (!checked.has(index)) return escapeHtml(item.text);
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
