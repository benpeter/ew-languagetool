import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBody, check, LanguageToolError } from '../tools/plugins/languagetool/lib/api.js';
import { DEFAULTS } from '../tools/plugins/languagetool/lib/settings.js';

const free = { url: 'https://api.languagetool.org/v2/check', kind: 'free', auth: null };
const items = [{ markup: '<p>', interpretAs: '\n\n' }, { text: 'Hallo' }, { markup: '</p>', interpretAs: '\n\n' }];

test('buildBody sends annotated data, language and options as a form', () => {
  const body = buildBody(items, { ...DEFAULTS, level: 'picky', disabledRules: ['A', 'B'] }, free);
  assert.ok(body instanceof URLSearchParams);
  assert.deepEqual(JSON.parse(body.get('data')), { annotation: items });
  assert.equal(body.get('language'), 'auto');
  assert.equal(body.get('preferredVariants'), 'en-US,de-DE');
  assert.equal(body.get('level'), 'picky');
  assert.equal(body.get('disabledRules'), 'A,B');
  assert.equal(body.get('apiKey'), null);
});

test('buildBody: fixed language has no variants; premium adds credentials', () => {
  const premium = { ...free, kind: 'premium', auth: { username: 'a@b.c', apiKey: 'k' } };
  const body = buildBody(items, { ...DEFAULTS, language: 'de-DE' }, premium);
  assert.equal(body.get('language'), 'de-DE');
  assert.equal(body.get('preferredVariants'), null);
  assert.equal(body.get('level'), null);
  assert.equal(body.get('username'), 'a@b.c');
  assert.equal(body.get('apiKey'), 'k');
});

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => JSON.parse(body),
  text: async () => body,
});

test('check posts a simple form request without custom headers', async () => {
  let seen;
  const fetchFn = async (url, opts) => {
    seen = { url, opts };
    return response(200, '{"matches":[],"language":{"code":"de-DE"}}');
  };
  const result = await check(fetchFn, free, new URLSearchParams({ a: '1' }));
  assert.deepEqual(result.matches, []);
  assert.equal(seen.url, free.url);
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers, undefined);
  assert.equal(seen.opts.credentials, 'omit');
  assert.ok(seen.opts.body instanceof URLSearchParams);
});

const failure = async (status, body = 'Error: x') => {
  try {
    await check(async () => response(status, body), free, new URLSearchParams());
  } catch (e) {
    return e;
  }
  return null;
};

test('check maps HTTP errors to codes the panel can explain', async () => {
  assert.equal((await failure(429)).code, 'rate-limit');
  assert.equal((await failure(413)).code, 'too-large');
  assert.equal((await failure(401)).code, 'auth');
  assert.equal((await failure(403)).code, 'auth');
  assert.equal((await failure(400)).code, 'bad-request');
  assert.equal((await failure(503)).code, 'server');
  const e = await failure(429, 'Error: Access from 1.2.3.4 denied: IP request limit of 20 requests per 60 seconds exceeded');
  assert.ok(e instanceof LanguageToolError);
  assert.equal(e.status, 429);
  assert.match(e.detail, /request limit/);
});

test('check maps a failed fetch (offline or blocked by CORS) to network', async () => {
  let error;
  try {
    await check(async () => { throw new TypeError('Failed to fetch'); }, free, new URLSearchParams());
  } catch (e) { error = e; }
  assert.equal(error.code, 'network');
});

test('check rejects a 200 response without matches', async () => {
  let error;
  try {
    await check(async () => response(200, '{"nope":1}'), free, new URLSearchParams());
  } catch (e) { error = e; }
  assert.equal(error.code, 'server');
});
