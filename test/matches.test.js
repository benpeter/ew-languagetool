import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocument, chunkItems } from '../tools/plugins/languagetool/lib/text.js';
import {
  classify, prepareMatches, groupByType, countByType, matchKey, context, assistantPrompt,
  phrase, fixPrompt,
} from '../tools/plugins/languagetool/lib/matches.js';

const rule = (id, issueType, category) => ({ id, issueType, category: { id: category } });
const match = (offset, length, r, values = []) => ({
  offset, length, rule: r, message: `msg ${r.id}`, shortMessage: '', replacements: values.map((value) => ({ value })),
});

test('classify maps LanguageTool rules to four author-facing types', () => {
  assert.equal(classify(match(0, 1, rule('GERMAN_SPELLER_RULE', 'misspelling', 'TYPOS'))), 'spelling');
  assert.equal(classify(match(0, 1, rule('COMMA_PARENTHESIS_WHITESPACE', 'whitespace', 'TYPOGRAPHY'))), 'punctuation');
  assert.equal(classify(match(0, 1, rule('KOMMA_ZWISCHEN', 'typographical', 'PUNCTUATION'))), 'punctuation');
  assert.equal(classify(match(0, 1, rule('COMMA_IN_FRONT_RELATIVE_CLAUSE', 'uncategorized', 'HILFESTELLUNG_KOMMASETZUNG'))), 'punctuation');
  assert.equal(classify(match(0, 1, rule('VERY_UNIQUE', 'style', 'REDUNDANCY'))), 'style');
  assert.equal(classify(match(0, 1, rule('ZU_ZUR', 'uncategorized', 'CONFUSED_WORDS'))), 'grammar');
  assert.equal(classify(match(0, 1, rule('EN_A_VS_AN', 'misspelling', 'MISC'))), 'grammar');
});

const html = '<p>Das Team von Schamdan steht Ihnen gerne zu Verfügung.</p><p>Bei Ovinho kaufen wir Wein .</p>';
const doc = buildDocument(html);
const sent = doc.items.map((i) => i.text ?? i.markup).join('');
const at = (word) => sent.indexOf(word);
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
  const second = chunkItems(doc.items, 1)[1].base;
  const chunkRaw = [match(at('Ovinho') - second, 6, rule('GERMAN_SPELLER_RULE', 'misspelling', 'TYPOS'))];
  const [m] = prepareMatches(doc, chunkRaw, second, {});
  assert.equal(m.word, 'Ovinho');
  assert.equal(m.offset, at('Ovinho'));
});

test('groupByType lists types with issues in a fixed order; countByType counts each type', () => {
  const list = prepareMatches(doc, raw, 0, {});
  const groups = groupByType([...list].reverse());
  assert.deepEqual(groups.map((g) => [g.type, g.matches.map((m) => m.word)]), [
    ['spelling', ['Schamdan', 'Ovinho']],
    ['grammar', ['zu']],
    ['punctuation', [' .']],
  ]);
  assert.deepEqual(countByType(list), {
    spelling: 2, grammar: 1, punctuation: 1, style: 0,
  });
});

test('context cuts the sentence around a match at word boundaries', () => {
  const text = 'Die Weine sind zwar nicht ausschließlich regional aus Hessen, aber von Ovinho, einen kleinen Weinhändler.';
  const start = text.indexOf('Ovinho');
  const c = context({ segment: { text }, start, end: start + 6 }, 20);
  assert.equal(c.word, 'Ovinho');
  assert.equal(c.before, 'Hessen, aber von ');
  assert.equal(c.after, ', einen kleinen');
  assert.equal(c.cutStart, true);
  assert.equal(c.cutEnd, true);
  const short = context({ segment: { text: 'zu Verfügung' }, start: 0, end: 2 }, 20);
  assert.deepEqual(short, {
    before: '', word: 'zu', after: ' Verfügung', cutStart: false, cutEnd: false,
  });
});

test('assistantPrompt lists word, excerpt and fix, not LanguageTool messages', () => {
  // LanguageTool messages can be questions to the author ("Möchten Sie …?"), which read
  // as questions to the assistant in a prompt.
  const prompt = assistantPrompt(prepareMatches(doc, raw, 0, {}));
  assert.doesNotMatch(prompt, /msg /);
  const lines = prompt.split('\n');
  assert.ok(lines.includes('1. "Schamdan" in "Das Team von Schamdan steht Ihnen gerne zu Verfügung.": change to "Garten", "Schämten" or "Schäden"'));
  assert.ok(lines.includes('2. "zu" in "Das Team von Schamdan steht Ihnen gerne zu Verfügung.": change to "zur"'));
  assert.ok(lines.includes('4. " ." in "Bei Ovinho kaufen wir Wein .": change to "."'));
  assert.match(lines[0], /names/);
});

test('assistantPrompt marks spots without a suggestion and caps the list at 40', () => {
  const noFix = prepareMatches(doc, [match(at('Ovinho'), 6, rule('GERMAN_SPELLER_RULE', 'misspelling', 'TYPOS'))], 0, {});
  assert.ok(assistantPrompt(noFix).split('\n').includes('1. "Ovinho" in "Bei Ovinho kaufen wir Wein .": no suggestion (spelling)'));
  const many = Array.from({ length: 45 }, (_, i) => ({
    segment: { text: 'Ein Fehlr.' }, start: 4, end: 9, word: 'Fehlr', offset: i, type: 'spelling', suggestions: ['Fehler'],
  }));
  const lines = assistantPrompt(many).split('\n');
  assert.equal(lines.filter((l) => /^\d+\. /.test(l)).length, 40);
  assert.ok(lines.includes('5 more are not listed. Check the page again after these fixes.'));
});

const spot = (text, word, from = text.indexOf(word)) => ({
  segment: { text, kind: 'paragraph', label: 'Paragraph' }, start: from, end: from + word.length, word,
});

test('phrase shows a fix in whole words, with a neighbour word for spaces and punctuation', () => {
  assert.deepEqual(phrase(spot('Das Team steht gerne zu Verfügung.', 'zu'), 'zur'), { from: 'zu', to: 'zur' });
  // A dash between two words: "-" alone means nothing to an author.
  const dash = spot('Das Schamdan in Marburg Weidenhausen bietet', ' ');
  assert.deepEqual(phrase(dash, '-'), { from: 'Marburg Weidenhausen', to: 'Marburg-Weidenhausen' });
  assert.deepEqual(phrase(spot('Wir freuen uns auf Ihren Besuch .', ' .'), '.'), { from: 'Besuch .', to: 'Besuch.' });
  // A match inside a word grows to the whole word.
  assert.deepEqual(phrase(spot('Ein kleiner Fehlr hier.', 'hlr'), 'hler'), { from: 'Fehlr', to: 'Fehler' });
  assert.deepEqual(phrase(spot('Ruft uns an: 06421-25728', '06421-25728'), '06421 / 25728'), { from: '06421-25728', to: '06421 / 25728' });
});

test('fixPrompt asks the assistant for one change and names the paragraph, not LanguageTool', () => {
  const m = { ...spot('Das Schamdan in Marburg Weidenhausen bietet Euch türkische Köstlichkeiten in Marburg an.', ' '), message: 'Möchten Sie …?' };
  assert.equal(
    fixPrompt(m, '-'),
    'In the paragraph that starts with "Das Schamdan in Marburg Weidenhausen bietet Euch türkische", change "Marburg Weidenhausen" to "Marburg-Weidenhausen". Change nothing else.',
  );
  const block = { ...spot('Ruft uns an: 06421-25728', '06421-25728'), segment: { text: 'Ruft uns an: 06421-25728', kind: 'block', label: 'Columns' } };
  assert.equal(
    fixPrompt(block, '06421 / 25728'),
    'In the Columns block that starts with "Ruft uns an: 06421-25728", change "06421-25728" to "06421 / 25728". Change nothing else.',
  );
});
