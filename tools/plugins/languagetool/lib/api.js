export class LanguageToolError extends Error {
  constructor(code, { status, detail } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const CODES = {
  400: 'bad-request', 401: 'auth', 403: 'auth', 413: 'too-large', 429: 'rate-limit',
};

/** Form body for /v2/check. A form body and no custom headers keep it a CORS simple request. */
export function buildBody(items, settings, endpoint) {
  const annotation = items.map((i) => ('text' in i
    ? { text: i.text }
    : { markup: i.markup, ...(i.interpretAs ? { interpretAs: i.interpretAs } : {}) }));
  const body = new URLSearchParams({
    data: JSON.stringify({ annotation }),
    language: settings.language,
  });
  if (settings.language === 'auto' && settings.variants.length) {
    body.set('preferredVariants', settings.variants.join(','));
  }
  if (settings.level === 'picky') body.set('level', 'picky');
  if (settings.disabledRules.length) body.set('disabledRules', settings.disabledRules.join(','));
  if (endpoint.auth) {
    body.set('username', endpoint.auth.username);
    body.set('apiKey', endpoint.auth.apiKey);
  }
  return body;
}

export async function check(fetchFn, endpoint, body) {
  let resp;
  try {
    resp = await fetchFn(endpoint.url, {
      method: 'POST', body, credentials: 'omit', referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new LanguageToolError('network');
  }
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 300);
    throw new LanguageToolError(CODES[resp.status] || 'server', { status: resp.status, detail });
  }
  const json = await resp.json().catch(() => null);
  if (!Array.isArray(json?.matches)) throw new LanguageToolError('server', { status: resp.status });
  return json;
}
