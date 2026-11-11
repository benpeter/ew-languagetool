import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocument, chunkItems, locate, applyReplacements,
} from '../tools/plugins/languagetool/lib/text.js';

// The string LanguageTool sees: match offsets count over it.
const annotationString = (items) => items.map((i) => i.text ?? i.markup).join('');

test('splits markup from text and decodes entities in text only', () => {
  const doc = buildDocument('<p>Fish &amp; chips <a href="/x?a=1&amp;b=2">here</a>.</p>');
  assert.deepEqual(doc.items.filter((i) => 'text' in i).map((i) => i.text), ['Fish & chips ', 'here', '.']);
  assert.ok(doc.items.some((i) => i.html === '<a href="/x?a=1&amp;b=2">'));
});

test('only text leaves the browser: tags, attributes and skipped text are replaced by stand-ins', () => {
  const html = '<main><div><p>See <a href="https://secret.example/x" data-prose-index="4">this</a></p>'
    + '<div class="metadata"><div><div>title</div><div>Hidden title</div></div></div></div></main>';
  const sent = annotationString(buildDocument(html).items);
  assert.ok(!sent.includes('secret'));
  assert.ok(!sent.includes('prose'));
  assert.ok(!sent.includes('Hidden'));
  assert.ok(sent.includes('See ') && sent.includes('this'));
});

test('block-level tags break sentences, inline tags do not', () => {
  const { items } = buildDocument('<ul><li>One<ul><li>Two</li></ul></li></ul><p>a<strong>b</strong><br>c</p>');
  const li = items.find((i) => i.html === '<li>');
  const strong = items.find((i) => i.html === '<strong>');
  const br = items.find((i) => i.html === '<br>');
  assert.equal(li.interpretAs, '\n\n');
  assert.equal(strong.interpretAs, undefined);
  assert.equal(br.interpretAs, '\n');
});

test('groups text into segments: one per top-level element or block of a live document', () => {
  const html = '<main><div><h1>Über uns</h1><p>Erster <em>Absatz</em>.</p></div>'
    + '<div><div class="cards dark"><div><div><p>Karte eins</p></div><div><p>Karte zwei</p></div></div></div>'
    + '<ul><li>A</li><li>B</li></ul></div></main>';
  const { segments } = buildDocument(html);
  assert.deepEqual(segments.map((s) => [s.kind, s.label, s.text]), [
    ['heading', 'Heading', 'Über uns'],
    ['paragraph', 'Paragraph', 'Erster Absatz.'],
    ['block', 'Cards', 'Karte eins\nKarte zwei'],
    ['list', 'List', 'A\nB'],
  ]);
});

test('a selection fragment without <main> is one or more top-level segments', () => {
  assert.deepEqual(buildDocument('gerne zu Verfügung').segments.map((s) => s.text), ['gerne zu Verfügung']);
  assert.deepEqual(buildDocument('<p>a</p><p>b</p>').segments.map((s) => s.text), ['a', 'b']);
});

test('selected blocks are tables: the name row is not checked, metadata tables are skipped', () => {
  const html = '<table><tbody><tr><td><p>cards (dark)</p></td></tr>'
    + '<tr><td><p>Karte eins</p></td><td><p>Karte zwei</p></td></tr></tbody></table>'
    + '<table><tbody><tr><td><p>section-metadata</p></td></tr><tr><td><p>style</p></td><td><p>dark</p></td></tr></tbody></table>'
    + '<p>Danach</p>';
  const doc = buildDocument(html);
  assert.deepEqual(doc.segments.map((s) => [s.kind, s.label, s.text]), [
    ['block', 'Cards', 'Karte eins\nKarte zwei'],
    ['paragraph', 'Paragraph', 'Danach'],
  ]);
  assert.deepEqual(doc.items.filter((i) => 'text' in i).map((i) => i.text), ['Karte eins', 'Karte zwei', 'Danach']);
});

test('text in code, pre and metadata blocks is not checked; inline code reads as a word', () => {
  const html = '<main><div><p>Use <code>npm i</code> now</p><pre>teh code</pre>'
    + '<div class="section-metadata"><div><div>style</div><div>dark</div></div></div></div></main>';
  const doc = buildDocument(html);
  assert.deepEqual(doc.items.filter((i) => 'text' in i).map((i) => i.text), ['Use ', ' now']);
  assert.deepEqual(doc.segments.map((s) => s.text), ['Use  now']);
  assert.equal(doc.items.find((i) => i.html === '<code>').interpretAs, 'X');
});

test('item offsets match the string LanguageTool sees; the original HTML comes back unchanged', () => {
  const html = '<p>This is an <strong class="x">test</strong> of teh checker.</p>';
  const doc = buildDocument(html);
  const s = annotationString(doc.items);
  const run = doc.runs.find((r) => s.slice(r.start, r.end) === ' of teh checker.');
  assert.ok(run);
  assert.equal(applyReplacements(doc, []), html);
});

test('locate maps a match offset back to its segment and word', () => {
  const html = '<p>This is an <strong class="x">test</strong> of teh checker.</p><p>Das ist <a href="/x">ein Fehler</a> .</p>';
  const doc = buildDocument(html);
  const s = annotationString(doc.items);
  const teh = locate(doc, s.indexOf('teh'), 3);
  assert.equal(teh.word, 'teh');
  assert.equal(teh.segment.text, 'This is an test of teh checker.');
  assert.equal(teh.segment.text.slice(teh.start, teh.end), 'teh');
  const space = locate(doc, s.indexOf(' .'), 2);
  assert.equal(space.word, ' .');
  assert.equal(space.segment.index, 1);
});

test('locate spans inline markup and returns null outside text', () => {
  const doc = buildDocument('<p>ab<em>cd</em>ef</p>');
  const s = annotationString(doc.items);
  const from = s.indexOf('b');
  const m = locate(doc, from, s.indexOf('e') + 1 - from);
  assert.equal(m.word, 'bcde');
  assert.equal(locate(doc, 0, s.indexOf('a')), null);
});

test('chunkItems keeps chunks under the limit and cuts only at block boundaries', () => {
  const html = '<p>aaaa aaaa</p><p>bbbb bbbb</p><p>cccc</p>';
  const doc = buildDocument(html);
  const lengths = [...html.matchAll(/<p>(\w+(?: \w+)?)<\/p>/g)]
    .map((m) => annotationString(buildDocument(m[0]).items).length);
  const chunks = chunkItems(doc.items, lengths[0] + 1);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => c.items.filter((i) => 'text' in i).map((i) => i.text)), [['aaaa aaaa'], ['bbbb bbbb'], ['cccc']]);
  assert.deepEqual(chunks.map((c) => c.base), [0, lengths[0], lengths[0] + lengths[1]]);
  assert.equal(chunkItems(doc.items, 1000).length, 1);
});

test('applyReplacements edits text and keeps markup', () => {
  const html = '<p>stehen Ihnen gerne zu <strong>Verfügung</strong> &amp; Besuch .</p>';
  const doc = buildDocument(html);
  const s = annotationString(doc.items);
  const out = applyReplacements(doc, [
    { offset: s.indexOf('zu '), length: 2, value: 'zur' },
    { offset: s.indexOf(' .'), length: 2, value: '.' },
  ]);
  assert.equal(out, '<p>stehen Ihnen gerne zur <strong>Verfügung</strong> &amp; Besuch.</p>');
});

test('applyReplacements across inline markup puts the value in the first text run', () => {
  const doc = buildDocument('<p>ab<em>cd</em>ef</p>');
  const s = annotationString(doc.items);
  const from = s.indexOf('b');
  const out = applyReplacements(doc, [{ offset: from, length: s.indexOf('e') + 1 - from, value: 'X' }]);
  assert.equal(out, '<p>aX<em></em>f</p>');
});

test('applyReplacements escapes the new text', () => {
  const doc = buildDocument('<p>a b</p>');
  const s = annotationString(doc.items);
  assert.equal(applyReplacements(doc, [{ offset: s.indexOf('b'), length: 1, value: '<&>' }]), '<p>a &lt;&amp;&gt;</p>');
});

test('a selection inside one block cell is a one-row table: its text is checked', () => {
  const doc = buildDocument('<table><tbody><tr><td><p>gerne zu Verfügung</p></td></tr></tbody></table>');
  assert.deepEqual(doc.segments.map((s) => s.text), ['gerne zu Verfügung']);
});
