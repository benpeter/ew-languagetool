import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDocument, chunkItems, locate, applyReplacements,
} from '../tools/plugins/languagetool/lib/text.js';

const annotationString = (items) => items.map((i) => i.text ?? i.markup).join('');

test('splits markup from text and decodes entities in text only', () => {
  const doc = buildDocument('<p>Fish &amp; chips <a href="/x?a=1&amp;b=2">here</a>.</p>');
  assert.deepEqual(doc.items.filter((i) => 'text' in i).map((i) => i.text), ['Fish & chips ', 'here', '.']);
  assert.ok(doc.items.some((i) => i.markup === '<a href="/x?a=1&amp;b=2">'));
});

test('block-level tags break sentences, inline tags do not', () => {
  const { items } = buildDocument('<ul><li>One<ul><li>Two</li></ul></li></ul><p>a<strong>b</strong><br>c</p>');
  const li = items.find((i) => i.markup === '<li>');
  const strong = items.find((i) => i.markup === '<strong>');
  const br = items.find((i) => i.markup === '<br>');
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

test('text in code, pre and metadata blocks is not checked', () => {
  const html = '<main><div><p>Use <code>npm i</code> now</p><pre>teh code</pre>'
    + '<div class="section-metadata"><div><div>style</div><div>dark</div></div></div></div></main>';
  const doc = buildDocument(html);
  assert.deepEqual(doc.items.filter((i) => 'text' in i).map((i) => i.text), ['Use ', ' now']);
  assert.deepEqual(doc.segments.map((s) => s.text), ['Use  now']);
});

test('item offsets match the string LanguageTool sees', () => {
  const html = '<p>This is an <strong class="x">test</strong> of teh checker.</p>';
  const doc = buildDocument(html);
  const s = annotationString(doc.items);
  assert.equal(s, html);
  const run = doc.runs.find((r) => s.slice(r.start, r.end) === ' of teh checker.');
  assert.ok(run);
});

test('locate maps a match offset back to its segment and word', () => {
  const html = '<p>This is an <strong class="x">test</strong> of teh checker.</p><p>Das ist <a href="/x">ein Fehler</a> .</p>';
  const doc = buildDocument(html);
  const teh = locate(doc, 49, 3);
  assert.equal(teh.word, 'teh');
  assert.equal(teh.segment.text, 'This is an test of teh checker.');
  assert.equal(teh.segment.text.slice(teh.start, teh.end), 'teh');
  const space = locate(doc, 103, 2);
  assert.equal(space.word, ' .');
  assert.equal(space.segment.index, 1);
});

test('locate spans inline markup and returns null outside text', () => {
  const doc = buildDocument('<p>ab<em>cd</em>ef</p>');
  const m = locate(doc, 4, 13);
  assert.equal(m.word, 'bcde');
  assert.equal(locate(doc, 0, 3), null);
});

test('chunkItems keeps chunks under the limit and cuts only at block boundaries', () => {
  const html = '<p>aaaa aaaa</p><p>bbbb bbbb</p><p>cccc</p>';
  const doc = buildDocument(html);
  const chunks = chunkItems(doc.items, 14);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => annotationString(c.items)), ['<p>aaaa aaaa</p>', '<p>bbbb bbbb</p>', '<p>cccc</p>']);
  assert.deepEqual(chunks.map((c) => c.base), [0, 16, 32]);
  assert.equal(chunkItems(doc.items, 1000).length, 1);
});

test('applyReplacements edits text and keeps markup', () => {
  const html = '<p>stehen Ihnen gerne zu <strong>Verfügung</strong> &amp; Besuch .</p>';
  const doc = buildDocument(html);
  const s = annotationString(doc.items);
  const zu = s.indexOf('zu ');
  const dot = s.indexOf(' .');
  const out = applyReplacements(doc, [
    { offset: zu, length: 2, value: 'zur' },
    { offset: dot, length: 2, value: '.' },
  ]);
  assert.equal(out, '<p>stehen Ihnen gerne zur <strong>Verfügung</strong> &amp; Besuch.</p>');
});

test('applyReplacements across inline markup puts the value in the first text run', () => {
  const doc = buildDocument('<p>ab<em>cd</em>ef</p>');
  assert.equal(applyReplacements(doc, [{ offset: 4, length: 13, value: 'X' }]), '<p>aX<em></em>f</p>');
});

test('applyReplacements escapes the new text', () => {
  const doc = buildDocument('<p>a b</p>');
  assert.equal(applyReplacements(doc, [{ offset: 4, length: 1, value: '<&>' }]), '<p>a &lt;&amp;&gt;</p>');
});
