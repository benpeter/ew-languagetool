import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replaceSelection } from '../tools/plugins/languagetool/lib/selection.js';

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
