import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, parseSettings, resolveEndpoint, addWord, parseWords,
} from '../tools/plugins/languagetool/lib/settings.js';

const config = (rows, extra = {}) => ({
  data: { data: [{ key: 'x', value: '1' }] },
  library: { data: [{ title: 'LanguageTool', path: '/tools/x.html' }] },
  ...(rows ? {
    languagetool: {
      total: rows.length, limit: rows.length, offset: 0, data: rows,
    },
  } : {}),
  ':names': ['data', 'library', ...(rows ? ['languagetool'] : [])],
  ':version': 3,
  ':type': 'multi-sheet',
  ...extra,
});

test('defaults apply when the site has no languagetool sheet', () => {
  assert.deepEqual(parseSettings(config()), DEFAULTS);
  assert.deepEqual(parseSettings(null), DEFAULTS);
  assert.equal(DEFAULTS.server, 'free');
  assert.equal(DEFAULTS.language, 'auto');
});

test('site rows override defaults; lists are split; words rows add up', () => {
  const s = parseSettings(config([
    { key: 'server', value: 'premium' },
    { key: 'language', value: 'de-DE' },
    { key: 'level', value: 'picky' },
    { key: 'disabledRules', value: 'WHITESPACE_RULE, DE_CASE' },
    { key: 'words', value: 'Schamdan, Ovinho' },
    { key: 'words', value: 'Marburg' },
    { key: 'unknown', value: 'ignored' },
  ]));
  assert.equal(s.server, 'premium');
  assert.equal(s.language, 'de-DE');
  assert.equal(s.level, 'picky');
  assert.deepEqual(s.disabledRules, ['WHITESPACE_RULE', 'DE_CASE']);
  assert.deepEqual(s.words, ['Schamdan', 'Ovinho', 'Marburg']);
});

test('invalid values fall back to defaults', () => {
  const s = parseSettings(config([{ key: 'level', value: 'loud' }, { key: 'server', value: '' }]));
  assert.equal(s.level, 'default');
  assert.equal(s.server, 'free');
});

test('parseWords splits on commas and new lines and drops blanks', () => {
  assert.deepEqual(parseWords(' a, b\nc,, '), ['a', 'b', 'c']);
});

test('free server without key; a personal key upgrades free to premium', () => {
  const free = resolveEndpoint({ ...DEFAULTS }, null);
  assert.equal(free.url, 'https://api.languagetool.org/v2/check');
  assert.equal(free.kind, 'free');
  assert.equal(free.auth, null);
  const premium = resolveEndpoint({ ...DEFAULTS }, { username: 'a@b.c', apiKey: 'k' });
  assert.equal(premium.url, 'https://api.languagetoolplus.com/v2/check');
  assert.deepEqual(premium.auth, { username: 'a@b.c', apiKey: 'k' });
  assert.ok(premium.maxChars > free.maxChars);
});

test('premium server without a key asks for one', () => {
  assert.deepEqual(resolveEndpoint({ ...DEFAULTS, server: 'premium' }, null), { error: 'missing-key' });
});

test('a self-hosted server gets the text and never the personal key', () => {
  const e = resolveEndpoint({ ...DEFAULTS, server: 'https://lt.example.com' }, { username: 'a', apiKey: 'k' });
  assert.equal(e.url, 'https://lt.example.com/v2/check');
  assert.equal(e.kind, 'custom');
  assert.equal(e.host, 'lt.example.com');
  assert.equal(e.auth, null);
  assert.equal(resolveEndpoint({ ...DEFAULTS, server: 'https://lt.example.com/v2/check' }).url, 'https://lt.example.com/v2/check');
  assert.equal(resolveEndpoint({ ...DEFAULTS, server: 'http://localhost:8081/' }).url, 'http://localhost:8081/v2/check');
  assert.deepEqual(resolveEndpoint({ ...DEFAULTS, server: 'http://lt.example.com' }), { error: 'bad-server' });
  assert.deepEqual(resolveEndpoint({ ...DEFAULTS, server: 'nonsense' }), { error: 'bad-server' });
});

test('addWord adds a sheet when missing and keeps every other sheet', () => {
  const before = config();
  const after = addWord(before, 'Schamdan');
  assert.deepEqual(after.languagetool.data, [{ key: 'words', value: 'Schamdan' }]);
  assert.deepEqual(after[':names'], ['data', 'library', 'languagetool']);
  assert.deepEqual(after.library, before.library);
  assert.deepEqual(after.data, before.data);
  assert.equal(after[':type'], 'multi-sheet');
  assert.equal(before.languagetool, undefined, 'input is not mutated');
});

test('addWord appends to the first words row and skips duplicates', () => {
  const before = config([{ key: 'server', value: 'free' }, { key: 'words', value: 'Schamdan' }]);
  const after = addWord(before, 'Ovinho');
  assert.deepEqual(after.languagetool.data, [{ key: 'server', value: 'free' }, { key: 'words', value: 'Schamdan, Ovinho' }]);
  assert.equal(after.languagetool.total, 2);
  assert.equal(addWord(after, 'ovinho'), after);
});

test('addWord turns a single-sheet config into a multi-sheet one', () => {
  const single = {
    total: 1, limit: 1, offset: 0, data: [{ key: 'a', value: 'b' }], ':type': 'sheet',
  };
  const after = addWord(single, 'Schamdan');
  assert.equal(after[':type'], 'multi-sheet');
  assert.deepEqual(after[':names'], ['data', 'languagetool']);
  assert.deepEqual(after.data.data, [{ key: 'a', value: 'b' }]);
});
