// Site settings live in a `languagetool` sheet of the DA site config (key/value rows).
// Personal premium credentials never go there; see credentials.js.

export const SHEET = 'languagetool';

export const DEFAULTS = Object.freeze({
  server: 'free',
  language: 'auto',
  variants: ['en-US', 'de-DE'],
  level: 'default',
  disabledRules: [],
  words: [],
});

const ENDPOINTS = {
  free: { url: 'https://api.languagetool.org/v2/check', maxChars: 20000 },
  premium: { url: 'https://api.languagetoolplus.com/v2/check', maxChars: 60000 },
};
const CUSTOM_MAX_CHARS = 20000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const parseWords = (value) => String(value ?? '')
  .split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

function sheetRows(config) {
  if (config?.[SHEET]?.data) return config[SHEET].data;
  return config?.[':sheetname'] === SHEET ? config.data || [] : [];
}

export function parseSettings(config) {
  const settings = {
    ...DEFAULTS, variants: [...DEFAULTS.variants], disabledRules: [], words: [],
  };
  sheetRows(config).forEach(({ key, value }) => {
    const text = String(value ?? '').trim();
    if (key === 'words') settings.words.push(...parseWords(text));
    else if (key === 'disabledRules') settings.disabledRules = parseWords(text);
    else if (key === 'variants' && text) settings.variants = parseWords(text);
    else if (key === 'level' && ['default', 'picky'].includes(text)) settings.level = text;
    else if ((key === 'server' || key === 'language') && text) settings[key] = text;
  });
  return settings;
}

/**
 * Where to send text, and with which credentials.
 * A personal key upgrades the free server to premium; a self-hosted server never gets it.
 */
export function resolveEndpoint(settings, credentials) {
  const { server } = settings;
  if (server === 'free' || server === 'premium') {
    if (credentials?.username && credentials?.apiKey) {
      const { username, apiKey } = credentials;
      return {
        ...ENDPOINTS.premium, kind: 'premium', host: 'api.languagetoolplus.com', auth: { username, apiKey },
      };
    }
    if (server === 'premium') return { error: 'missing-key' };
    return {
      ...ENDPOINTS.free, kind: 'free', host: 'api.languagetool.org', auth: null,
    };
  }
  let url;
  try {
    url = new URL(server);
  } catch {
    return { error: 'bad-server' };
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    return { error: 'bad-server' };
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/v2/check') ? path : `${path}/v2/check`;
  url.search = '';
  url.hash = '';
  return {
    url: url.href, maxChars: CUSTOM_MAX_CHARS, kind: 'custom', host: url.host, auth: null,
  };
}

const toSheet = (data, extra = {}) => ({
  ...extra, total: data.length, limit: data.length, offset: 0, data,
});

function asMultiSheet(config) {
  if (!config) return { ':names': [], ':version': 3, ':type': 'multi-sheet' };
  if (config[':type'] === 'multi-sheet') return config;
  const name = config[':sheetname'] || 'data';
  const {
    ':type': type, ':sheetname': sheetname, ':names': names, ':version': version, ...sheet
  } = config;
  return {
    [name]: sheet, ':names': [name], ':version': version ?? 3, ':type': 'multi-sheet',
  };
}

/**
 * Return a copy of the site config with `word` in the site dictionary,
 * or the same object when the word is already there.
 */
export function addWord(config, word) {
  const lower = word.toLowerCase();
  if (parseSettings(config).words.some((w) => w.toLowerCase() === lower)) return config;
  const multi = asMultiSheet(config);
  const sheet = multi[SHEET];
  const rows = (sheet?.data || []).map((row) => ({ ...row }));
  const row = rows.find((r) => r.key === 'words');
  if (row) row.value = [...parseWords(row.value), word].join(', ');
  else rows.push({ key: 'words', value: word });
  const {
    total, limit, offset, data, ...rest
  } = sheet || {};
  return {
    ...multi,
    [SHEET]: toSheet(rows, rest),
    ':names': sheet ? multi[':names'] : [...(multi[':names'] || []), SHEET],
  };
}
