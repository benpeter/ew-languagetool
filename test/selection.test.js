import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceSelection, plainText } from '../tools/plugins/languagetool/lib/selection.js';
import { buildDocument } from '../tools/plugins/languagetool/lib/text.js';

const fakeActions = (current) => {
  const sent = [];
  return {
    sent,
    getSelection: async () => {
      // The SDK rejects with a plain string.
      // eslint-disable-next-line no-throw-literal
      if (current instanceof Error) throw current.message;
      return current;
    },
    sendHTML: (html) => { sent.push(html); },
    sendText: (text) => { sent.push({ text }); },
  };
};

test('replaces the selection when it is unchanged', async () => {
  const actions = fakeActions('<p>zu Verfügung</p>');
  const result = await replaceSelection(actions, '<p>zu Verfügung</p>', '<p>zur Verfügung</p>');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(actions.sent, ['<p>zur Verfügung</p>']);
});

test('refuses when the selection changed since the check', async () => {
  const actions = fakeActions('<p>something else</p>');
  const result = await replaceSelection(actions, '<p>zu Verfügung</p>', '<p>zur Verfügung</p>');
  assert.deepEqual(result, { ok: false, error: 'selection-changed' });
  assert.deepEqual(actions.sent, []);
});

test('refuses when there is no selection any more', async () => {
  const actions = fakeActions(new Error('No selection found'));
  const result = await replaceSelection(actions, '<p>a</p>', '<p>b</p>');
  assert.deepEqual(result, { ok: false, error: 'no-selection' });
  assert.deepEqual(actions.sent, []);
});

test('does nothing when the fix changes nothing', async () => {
  const actions = fakeActions('<p>a</p>');
  assert.deepEqual(await replaceSelection(actions, '<p>a</p>', '<p>a</p>'), { ok: true });
  assert.deepEqual(actions.sent, []);
});

test('plainText: a selection of plain text inside one element can be sent as text', () => {
  assert.equal(plainText(buildDocument('<p>stehen Ihnen gerne zu Verfügung</p>')), 'stehen Ihnen gerne zu Verfügung');
  assert.equal(plainText(buildDocument('<ul><li>Fish &amp; chips</li></ul>')), 'Fish & chips');
  assert.equal(plainText(buildDocument('gerne zu')), 'gerne zu');
});

test('plainText: formatting or several elements need HTML', () => {
  assert.equal(plainText(buildDocument('<p>a <strong>b</strong></p>')), null);
  assert.equal(plainText(buildDocument('<p>a</p><p>b</p>')), null);
});

test('sends text instead of HTML when given, so the paragraph is not split', async () => {
  const actions = fakeActions('<p>zu Verfügung</p>');
  const result = await replaceSelection(actions, '<p>zu Verfügung</p>', '<p>zur Verfügung</p>', 'zur Verfügung');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(actions.sent, [{ text: 'zur Verfügung' }]);
});
