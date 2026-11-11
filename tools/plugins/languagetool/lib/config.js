// Read and write the DA site config the same way Experience Workspace does
// (da-nx nx2/utils/api.js `config`): legacy sites use admin.da.live, Helix 6
// sites the editor config on api.aem.live.

const HLX_ADMIN = 'https://admin.hlx.page';
const AEM_API = 'https://api.aem.live';
const DA_ADMIN = 'https://admin.da.live';
const SHEET = 'languagetool';

const legacyUrl = (org, site) => `${DA_ADMIN}/config/${org}/${site}/`;
const hlx6Url = (org, site) => `${AEM_API}/${org}/sites/${site}/config/editor/da.json`;

async function isHlx6(daFetch, org, site) {
  const resp = await daFetch(`${HLX_ADMIN}/ping/${org}/${site}`);
  return resp.headers.get('x-api-upgrade-available') !== null;
}

/**
 * @returns {{ config: object|null, canWrite: boolean, store: 'legacy'|'hlx6', raw?: object }}
 *   config in sheet format; for Helix 6 only the languagetool sheet, with the
 *   stored object in `raw` so a save changes nothing else.
 */
export async function loadConfig(daFetch, org, site) {
  if (await isHlx6(daFetch, org, site)) {
    const resp = await daFetch(hlx6Url(org, site));
    if (!resp.ok && resp.status !== 404) throw new Error(`config-${resp.status}`);
    const raw = resp.ok ? await resp.json() : {};
    const rows = Array.isArray(raw[SHEET]) ? raw[SHEET] : null;
    // api.aem.live sends no permission header; a save without access gets a 403.
    return {
      config: rows && { [SHEET]: { data: rows }, ':names': [SHEET], ':type': 'multi-sheet' },
      canWrite: true,
      store: 'hlx6',
      raw,
    };
  }
  const resp = await daFetch(`${legacyUrl(org, site)}?nocache=${Date.now()}`);
  const canWrite = !!resp.permissions?.includes('write');
  if (!resp.ok) {
    if (resp.status === 404) return { config: null, canWrite, store: 'legacy' };
    throw new Error(`config-${resp.status}`);
  }
  return { config: await resp.json(), canWrite, store: 'legacy' };
}

export async function saveConfig(daFetch, org, site, { store, raw }, config) {
  if (store === 'hlx6') {
    const resp = await daFetch(hlx6Url(org, site), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...raw, [SHEET]: config[SHEET].data }),
    });
    return resp.ok;
  }
  const body = new FormData();
  body.append('config', JSON.stringify(config));
  const resp = await daFetch(legacyUrl(org, site), { method: 'PUT', body });
  return resp.ok;
}
