import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocument } from '../tools/plugins/languagetool/lib/text.js';
import {
  classify, prepareMatches, groupBySegment, countByType, matchKey,
} from '../tools/plugins/languagetool/lib/matches.js';

const rule = (id, issueType, category) => ({ id, issueType, category: { id: category } });
const match = (offset, length, r, values = []) => ({
  offset, length, rule: r, message: `msg ${r.id}`, shortMessage: '', replacements: values.map((value) => ({ value })),
});

test('classify maps LanguageTool rules to four author-facing types', () => {
  assert.equal(classify(match(0, 1, rule('GERMAN_SPELLER_RULE', 'misspelling', 'TYPOS'))), 'spelling');
  assert.equal(classify(match(0, 1, rule('COMMA_PARENTHESIS_WHITESPACE', 'whitespace', 'TYPOGRAPHY'))), 'punctuation');
  assert.equal(classify(match(0, 1, rule('KOMMA_ZWISCHEN', 'typographical', 'PUNCTUATION'))), 'punctuation');
  assert.equal(classify(match(0, 1, rule('VERY_UNIQUE', 'style', 'REDUNDANCY'))), 'style');
  assert.equal(classify(match(0, 1, rule('ZU_ZUR', 'uncategorized', 'CONFUSED_WORDS'))), 'grammar');
  assert.equal(classify(match(0, 1, rule('EN_A_VS_AN', 'misspelling', 'MISC'))), 'grammar');
});

const html = '<p>Das Team von Schamdan steht Ihnen gerne zu Verfügung.</p><p>Bei Ovinho kaufen wir Wein .</p>';
const doc = buildDocument(html);
const at = (word) => html.indexOf(word);
const raw = [
  match(at('Schamdan'), 8, rule('GERMAN_SPELLER_RULE', 'misspelling', 'TYPOS'), ['Garten', 'Schämten', 'Schäden', 'Schaden']),
  match(at('zu '), 2, rule('ZU_ZUR', 'uncategorized', 'CONFUSED_WORDS'), ['zur']),
  match(at('Ovinho'), 6, rule('GERMAN_SPELLER_RULE', 'misspelling', 'TYPOS'), ['Ovid']),
  match(at(' .'), 2, rule('COMMA_PARENTHESIS_WHITESPACE', 'whitespace', 'TYPOGRAPHY'), ['.']),
];

test('prepareMatches locates matches, keeps three suggestions and drops dictionary words', () => {
  const list = prepareMatches(doc, raw, 0, { words: ['schamdan'] });
  assert.deepEqual(list.map((m) => m.word), ['zu', 'Ovinho', ' .']);
  assert.deepEqual(list[0].suggestions, ['zur']);
  const all = prepareMatches(doc, raw, 0, {});
  assert.deepEqual(all[0].suggestions, ['Garten', 'Schämten', 'Schäden']);
  assert.equal(all[0].type, 'spelling');
});

test('dictionary words only hide spelling matches, case-insensitively', () => {
  const list = prepareMatches(doc, raw, 0, { words: ['ZU', 'OVINHO'] });
  assert.deepEqual(list.map((m) => m.word), ['Schamdan', 'zu', ' .']);
});

test('ignored keys hide matches for this page', () => {
  const all = prepareMatches(doc, raw, 0, {});
  const list = prepareMatches(doc, raw, 0, { ignored: new Set([matchKey(all[1])]) });
  assert.deepEqual(list.map((m) => m.word), ['Schamdan', 'Ovinho', ' .']);
});

test('prepareMatches adds the chunk base to offsets', () => {
  const second = html.indexOf('<p>Bei');
  const chunkRaw = [match(at('Ovinho') - second, 6, rule('GERMAN_SPELLER_RULE', 'misspelling', 'TYPOS'))];
  const [m] = prepareMatches(doc, chunkRaw, second, {});
  assert.equal(m.word, 'Ovinho');
  assert.equal(m.offset, at('Ovinho'));
});

test('groupBySegment keeps document order; countByType counts each type', () => {
  const list = prepareMatches(doc, raw, 0, {});
  const groups = groupBySegment(list);
  assert.deepEqual(groups.map((g) => [g.segment.index, g.matches.length]), [[0, 2], [1, 2]]);
  assert.deepEqual(countByType(list), {
    spelling: 2, grammar: 1, punctuation: 1, style: 0,
  });
});
