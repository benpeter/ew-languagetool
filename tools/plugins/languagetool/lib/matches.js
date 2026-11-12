import { locate } from './text.js';

export const TYPES = ['spelling', 'grammar', 'punctuation', 'style'];

const PUNCTUATION = new Set(['PUNCTUATION', 'TYPOGRAPHY', 'CASING']);
const STYLE = new Set(['STYLE', 'REDUNDANCY', 'COLLOQUIALISMS', 'REPETITIONS_STYLE', 'PLAIN_ENGLISH', 'GENDER_NEUTRALITY']);

/** Sort a LanguageTool match into one of four types authors understand. */
export function classify(match) {
  const { issueType, category } = match.rule;
  const cat = category?.id;
  if (cat === 'TYPOS' || match.type?.typeName === 'UnknownWord') return 'spelling';
  if (issueType === 'whitespace' || issueType === 'typographical' || PUNCTUATION.has(cat)
    || /KOMMA|COMMA/.test(cat)) return 'punctuation';
  if (issueType === 'style' || issueType === 'register' || STYLE.has(cat)) return 'style';
  return 'grammar';
}

export const matchKey = (m) => `${m.rule.id}:${m.word}`;

/**
 * Locate raw matches of one request in the document and drop the ones the
 * author does not want to see.
 * @param {number} base offset of the request in the whole annotation string
 * @param {{ words?: string[], ignored?: Set<string> }} filters
 */
export function prepareMatches(doc, matches, base, { words = [], ignored = new Set() } = {}) {
  const dictionary = new Set(words.map((w) => w.toLowerCase()));
  return matches.flatMap((m) => {
    const offset = base + m.offset;
    const where = locate(doc, offset, m.length);
    if (!where) return [];
    const type = classify(m);
    if (type === 'spelling' && dictionary.has(where.word.trim().toLowerCase())) return [];
    const prepared = {
      ...where,
      offset,
      length: m.length,
      type,
      message: m.message,
      rule: {
        id: m.rule.id,
        description: m.rule.description || '',
        premium: !!m.rule.isPremium,
      },
      suggestions: (m.replacements || []).slice(0, 3).map((r) => r.value),
    };
    return ignored.has(matchKey(prepared)) ? [] : [prepared];
  });
}

/** Issues by type in the order of TYPES, each in document order. Empty types are left out. */
export function groupByType(matches) {
  const sorted = [...matches].sort((a, b) => a.offset - b.offset);
  return TYPES
    .map((type) => ({ type, matches: sorted.filter((m) => m.type === type) }))
    .filter((group) => group.matches.length);
}

export function countByType(matches) {
  const counts = Object.fromEntries(TYPES.map((t) => [t, 0]));
  matches.forEach((m) => { counts[m.type] += 1; });
  return counts;
}

/** The text around a match, cut at word boundaries about `radius` characters away. */
export function context(match, radius = 60) {
  const { text } = match.segment;
  let from = Math.max(0, match.start - radius);
  if (from > 0) {
    const space = text.indexOf(' ', from);
    from = space !== -1 && space < match.start ? space + 1 : from;
  }
  let to = Math.min(text.length, match.end + radius);
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to);
    to = space > match.end ? space : to;
  }
  return {
    before: text.slice(from, match.start),
    word: text.slice(match.start, match.end),
    after: text.slice(match.end, to),
    cutStart: from > 0,
    cutEnd: to < text.length,
  };
}

const PROMPT_LIMIT = 40;
const quoteList = (values) => {
  const quoted = values.map((v) => `"${v}"`);
  return quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}` : quoted[0];
};

/**
 * A prompt for the Workspace assistant: the flagged words, where they are and the fix.
 * LanguageTool's messages stay out: some are questions to the author ("Möchten Sie …?").
 */
export function assistantPrompt(matches) {
  const sorted = [...matches].sort((a, b) => a.offset - b.offset);
  const lines = sorted.slice(0, PROMPT_LIMIT).map((m, i) => {
    const c = context(m, 40);
    const excerpt = `${c.cutStart ? '…' : ''}${c.before}${c.word}${c.after}${c.cutEnd ? '…' : ''}`;
    const fix = m.suggestions.length ? `change to ${quoteList(m.suggestions)}` : `no suggestion (${m.type})`;
    return `${i + 1}. "${m.word}" in "${excerpt}": ${fix}`;
  });
  const rest = sorted.length - lines.length;
  return [
    'LanguageTool flagged these spots on this page. Fix the real mistakes. Change only the flagged words, keep names and intended wording, and leave a spot as it is when it is fine.',
    '',
    ...lines,
    ...(rest > 0 ? ['', `${rest} more are not listed. Check the page again after these fixes.`] : []),
  ].join('\n');
}

const WORD = /[\p{L}\p{M}\p{N}]/u;
const isWord = (ch) => !!ch && WORD.test(ch);

/**
 * Where the flagged spot starts and ends in whole words.
 * A spot of only spaces or punctuation also takes the words that touch it.
 */
function span(match) {
  const { text } = match.segment;
  let { start, end } = match;
  while (start > 0 && isWord(text[start - 1]) && isWord(text[start])) start -= 1;
  while (end < text.length && isWord(text[end]) && isWord(text[end - 1])) end += 1;
  if (![...text.slice(start, end)].some(isWord)) {
    while (start > 0 && /\S/.test(text[start - 1])) start -= 1;
    while (end < text.length && /\S/.test(text[end])) end += 1;
  }
  return { start, end };
}

const fixed = (match, { start, end }, value) => {
  const { text } = match.segment;
  return {
    from: text.slice(start, end),
    to: `${text.slice(start, match.start)}${value}${text.slice(match.end, end)}`,
  };
};

/** The flagged spot and its fix in whole words, so "-" reads as "Marburg-Weidenhausen". */
export const phrase = (match, value) => fixed(match, span(match), value);

/** How the dialog and the assistant prompt name a paragraph or block. */
export function segmentStart(segment) {
  const words = segment.text.trim().split(/\s+/);
  return {
    where: segment.kind === 'block' ? `${segment.label} block` : segment.label,
    start: words.slice(0, 8).join(' '),
    more: words.length > 8,
  };
}

/**
 * A prompt for the Workspace assistant to make one fix.
 * Values are JSON strings, so quotes in them stay quotes.
 */
export function fixPrompt(match, value) {
  const { segment } = match;
  const { text } = segment;
  const bounds = span(match);
  // Neighbour words make the spot unique in its paragraph, so the assistant changes the right one.
  for (let i = 0; i < 3 && text.split(text.slice(bounds.start, bounds.end)).length > 2; i += 1) {
    while (bounds.start > 0 && /\s/.test(text[bounds.start - 1])) bounds.start -= 1;
    while (bounds.start > 0 && /\S/.test(text[bounds.start - 1])) bounds.start -= 1;
    while (bounds.end < text.length && /\s/.test(text[bounds.end])) bounds.end += 1;
    while (bounds.end < text.length && /\S/.test(text[bounds.end])) bounds.end += 1;
  }
  const { from, to } = fixed(match, bounds, value);
  const { where, start } = segmentStart(segment);
  const q = JSON.stringify;
  const change = to.trim() ? `change ${q(from)} to ${q(to)}` : `delete ${q(from)}`;
  const name = segment.kind === 'block' ? where : where.toLowerCase();
  return `In the ${name} that starts with ${q(start)}, ${change}. Change nothing else.`;
}
