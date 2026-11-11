import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, saveConfig } from '../tools/plugins/languagetool/lib/config.js';

const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body,
  permissions: headers['x-da-actions']?.split('=').pop().split(','),
});

const recorder = (routes) => {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    return route ? route[1](url, opts) : res(404, {});
  };
  fn.calls = calls;
  return fn;
};

const ADMIN = ['https://admin', 'hlx', 'page'].join('.');
const PING = `${ADMIN}/ping/o/s`;
const LEGACY = 'https://admin.da.live/config/o/s/';
const HLX6 = `${['https://api', 'aem', 'live'].join('.')}/o/sites/s/config/editor/da.json`;
const legacyConfig = { data: { data: [] }, ':type': 'multi-sheet', ':names': ['data'] };

test('loadConfig reads the legacy DA config store and reports write access', async () => {
  const daFetch = recorder([
    [PING, () => res(200, {})],
    [LEGACY, () => res(200, legacyConfig, { 'x-da-actions': '/o/s=read,write' })],
  ]);
  const result = await loadConfig(daFetch, 'o', 's');
  assert.deepEqual(result.config, legacyConfig);
  assert.equal(result.canWrite, true);
  assert.equal(result.store, 'legacy');
});

test('loadConfig: a missing site config is an empty config, read-only access is reported', async () => {
  const daFetch = recorder([
    [PING, () => res(200, {})],
    [LEGACY, () => res(404, {}, { 'x-da-actions': '/o/s=read' })],
  ]);
  const result = await loadConfig(daFetch, 'o', 's');
  assert.equal(result.config, null);
  assert.equal(result.canWrite, false);
});

test('loadConfig uses the Helix 6 editor config for upgraded sites', async () => {
  const daFetch = recorder([
    [PING, () => res(200, {}, { 'x-api-upgrade-available': 'true' })],
    [HLX6, () => res(200, { languagetool: [{ key: 'words', value: 'X' }] })],
  ]);
  const result = await loadConfig(daFetch, 'o', 's');
  assert.equal(result.store, 'hlx6');
  assert.deepEqual(result.config.languagetool.data, [{ key: 'words', value: 'X' }]);
});

test('saveConfig writes the whole config back to the store it came from', async () => {
  const daFetch = recorder([[LEGACY, () => res(200, {})]]);
  assert.equal(await saveConfig(daFetch, 'o', 's', 'legacy', legacyConfig), true);
  const { opts } = daFetch.calls[0];
  assert.equal(opts.method, 'PUT');
  assert.deepEqual(JSON.parse(opts.body.get('config')), legacyConfig);

  const hlx6 = recorder([[HLX6, () => res(204, {})]]);
  assert.equal(await saveConfig(hlx6, 'o', 's', 'hlx6', legacyConfig), true);
  assert.equal(hlx6.calls[0].opts.method, 'POST');
});
