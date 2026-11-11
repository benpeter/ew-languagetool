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
      shortMessage: m.shortMessage || '',
      rule: {
        id: m.rule.id,
        description: m.rule.description || '',
        category: m.rule.category?.name || '',
        premium: !!m.rule.isPremium,
      },
      suggestions: (m.replacements || []).slice(0, 3).map((r) => r.value),
    };
    return ignored.has(matchKey(prepared)) ? [] : [prepared];
  });
}

export function groupBySegment(matches) {
  const groups = new Map();
  [...matches].sort((a, b) => a.offset - b.offset).forEach((m) => {
    if (!groups.has(m.segment)) groups.set(m.segment, { segment: m.segment, matches: [] });
    groups.get(m.segment).matches.push(m);
  });
  return [...groups.values()].sort((a, b) => a.segment.index - b.segment.index);
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
