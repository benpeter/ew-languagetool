// Read and write the DA site config the same way Experience Workspace does
// (da-nx nx2/utils/api.js `config`): legacy sites use admin.da.live, Helix 6
// sites the editor config on api.aem.live.

const HLX_ADMIN = 'https://admin.hlx.page';
const AEM_API = 'https://api.aem.live';
const DA_ADMIN = 'https://admin.da.live';

const legacyUrl = (org, site) => `${DA_ADMIN}/config/${org}/${site}/`;
const hlx6Url = (org, site) => `${AEM_API}/${org}/sites/${site}/config/editor/da.json`;

async function isHlx6(daFetch, org, site) {
  const resp = await daFetch(`${HLX_ADMIN}/ping/${org}/${site}`);
  return resp.headers.get('x-api-upgrade-available') !== null;
}

const toSheets = (obj) => Object.keys(obj).reduce((acc, name) => {
  const data = Array.isArray(obj[name]) ? obj[name] : [];
  acc[name] = {
    total: data.length, limit: data.length, offset: 0, data,
  };
  return acc;
}, { ':names': Object.keys(obj), ':type': 'multi-sheet' });

const toObject = (config) => (config[':names'] || [])
  .reduce((acc, name) => ({ ...acc, [name]: config[name]?.data || [] }), {});

/** @returns {{ config: object|null, canWrite: boolean, store: 'legacy'|'hlx6' }} */
export async function loadConfig(daFetch, org, site) {
  const store = await isHlx6(daFetch, org, site) ? 'hlx6' : 'legacy';
  const resp = await daFetch(store === 'hlx6' ? hlx6Url(org, site) : `${legacyUrl(org, site)}?nocache=${Date.now()}`);
  const canWrite = !!resp.permissions?.includes('write');
  if (!resp.ok) {
    if (resp.status === 404) return { config: null, canWrite, store };
    throw new Error(`config-${resp.status}`);
  }
  const json = await resp.json();
  return { config: store === 'hlx6' ? toSheets(json) : json, canWrite, store };
}

export async function saveConfig(daFetch, org, site, store, config) {
  if (store === 'hlx6') {
    const resp = await daFetch(hlx6Url(org, site), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toObject(config)),
    });
    return resp.ok;
  }
  const body = new FormData();
  body.append('config', JSON.stringify(config));
  const resp = await daFetch(legacyUrl(org, site), { method: 'PUT', body });
  return resp.ok;
}
