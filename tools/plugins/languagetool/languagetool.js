// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import { buildDocument, chunkItems, applyReplacements } from './lib/text.js';
import {
  TYPES, prepareMatches, groupBySegment, countByType, matchKey, context,
} from './lib/matches.js';
import { parseSettings, resolveEndpoint, addWord } from './lib/settings.js';
import { buildBody, check } from './lib/api.js';
import { replaceSelection, plainText } from './lib/selection.js';
import { loadConfig, saveConfig } from './lib/config.js';

const KEY_STORE = 'ew-languagetool:premium';
const CONSENT_STORE = 'ew-languagetool:consent';
const FREE_PER_MINUTE = 20;
const TYPE_LABELS = {
  spelling: 'Spelling', grammar: 'Grammar', punctuation: 'Punctuation', style: 'Style',
};
const MESSAGES = {
  'rate-limit': 'LanguageTool\'s limit was reached (the free server allows about 20 checks a minute). Wait a minute and try again.',
  'too-large': 'This text is too long for one check. Check a smaller selection, or use a premium key for longer texts.',
  auth: 'LanguageTool did not accept the premium key. Check the email and API key in Settings.',
  'bad-request': 'LanguageTool rejected the request. Check the language and rules in the site settings.',
  server: 'LanguageTool had a problem. Try again later.',
  'missing-key': 'This site uses LanguageTool premium. Add your email and API key in Settings.',
  'bad-server': 'The server in the site settings is not a valid https URL.',
  'no-selection': 'Select some text in the document first.',
  'selection-changed': 'The selection changed since the check. Check the selection again.',
  'no-live': 'This editor does not share the page text with extensions. Select text and use Check selection.',
  'too-fast': 'Many checks in the last minute. Wait a moment so the free server does not block you.',
  partial: 'Fixes inside formatted text work only on whole paragraphs. Select the whole paragraph, check it again and apply.',
};

const $ = (id) => document.getElementById(id);
const state = {
  ignored: new Set(),
  accepted: new Map(),
  recent: [],
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== undefined) node.setAttribute(k, v === true ? '' : v);
  });
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function setStatus(text, kind = '') {
  const status = $('status');
  status.textContent = text;
  status.className = `status ${kind}`;
}

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};

const credentials = () => readJson(KEY_STORE);

function endpoint() {
  return resolveEndpoint(state.settings, credentials());
}

function describeError(error, ep) {
  if (error.code === 'network') {
    return `Could not reach ${ep?.host || 'LanguageTool'}. Check your connection. A self-hosted server must allow requests from this page (CORS).`;
  }
  const text = MESSAGES[error.code] || MESSAGES[error.message] || MESSAGES.server;
  return error.code === 'bad-request' && error.detail ? `${text} (${error.detail})` : text;
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function renderSettings() {
  const { settings } = state;
  const ep = endpoint();
  const server = {
    free: 'LanguageTool free API',
    premium: 'LanguageTool premium API',
  }[settings.server] || settings.server;
  const using = ep.error ? describeError({ code: ep.error }) : `${ep.host} (${ep.kind})`;
  const rows = [
    ['Server', server],
    ['Checks go to', using],
    ['Language', settings.language === 'auto' ? `auto (${settings.variants.join(', ')})` : settings.language],
    ['Level', settings.level],
    ['Disabled rules', settings.disabledRules.join(', ') || 'none'],
    ['Site dictionary', settings.words.join(', ') || 'empty'],
  ];
  $('site-settings').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const creds = credentials();
  $('lt-user').value = creds?.username || '';
  $('lt-key').value = creds?.apiKey ? '••••••••' : '';
  $('forget').disabled = !creds;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function excerpt(match) {
  const c = context(match);
  return el(
    'p',
    { class: 'excerpt' },
    c.cutStart ? '…' : '',
    c.before,
    el('mark', {}, c.word),
    c.after,
    c.cutEnd ? '…' : '',
  );
}

function currentMatches() {
  return state.raw.flatMap(({ base, matches }) => prepareMatches(state.doc, matches, base, {
    words: state.settings.words,
    ignored: state.ignored,
  }));
}

async function addToDictionary(word) {
  if (state.saving) return;
  state.saving = true;
  setStatus(`Adding “${word}” to the site dictionary…`);
  try {
    const { org, repo } = state.context;
    const loaded = await loadConfig(state.actions.daFetch, org, repo);
    const next = addWord(loaded.config, word);
    const saved = next === loaded.config
      || await saveConfig(state.actions.daFetch, org, repo, loaded, next);
    if (!saved) throw new Error('save');
    state.settings = parseSettings(next);
    renderSettings();
    // eslint-disable-next-line no-use-before-define
    renderResults();
    setStatus(`Added “${word}” to the site dictionary.`, 'ok');
  } catch {
    setStatus(`Could not save the site dictionary. Use Ignore instead, or ask a site admin to add “${word}”.`, 'error');
  } finally {
    state.saving = false;
  }
}

function toggleSuggestion(match, value) {
  const key = String(match.offset);
  if (state.accepted.get(key)?.value === value) {
    state.accepted.delete(key);
  } else {
    [...state.accepted].forEach(([k, a]) => {
      if (a.offset < match.offset + match.length && match.offset < a.offset + a.length) {
        state.accepted.delete(k);
      }
    });
    state.accepted.set(key, { offset: match.offset, length: match.length, value });
  }
  // eslint-disable-next-line no-use-before-define
  renderResults();
}

async function useSuggestion(match, value) {
  if (state.mode === 'selection') {
    toggleSuggestion(match, value);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    setStatus(`Copied “${value}”. To apply fixes, select the text in the document and use Check selection.`, 'ok');
  } catch {
    setStatus('To apply fixes, select the text in the document and use Check selection.');
  }
}

function matchItem(match) {
  const accepted = state.accepted.get(String(match.offset))?.value;
  const suggestions = match.suggestions.map((value) => el('button', {
    type: 'button',
    class: 'suggestion',
    'aria-pressed': state.mode === 'selection' ? String(accepted === value) : false,
    title: state.mode === 'selection' ? 'Use this fix' : 'Copy',
    onclick: () => useSuggestion(match, value),
  }, value === ' ' ? '(space)' : value || '(remove)'));
  const tools = [
    el('button', {
      type: 'button',
      class: 'quiet',
      onclick: () => {
        state.ignored.add(matchKey(match));
        // eslint-disable-next-line no-use-before-define
        renderResults();
        setStatus(`Ignoring “${match.word}” on this page until you close the panel.`);
      },
    }, 'Ignore on this page'),
  ];
  if (match.type === 'spelling' && state.canWrite) {
    tools.push(el('button', {
      type: 'button', class: 'quiet', onclick: () => addToDictionary(match.word.trim()),
    }, 'Add to site dictionary'));
  }
  return el(
    'li',
    { class: `match ${match.type}` },
    el('p', { class: 'message' }, el('span', { class: 'badge' }, TYPE_LABELS[match.type]), ' ', match.message),
    excerpt(match),
    suggestions.length ? el('div', { class: 'suggestions', role: 'group', 'aria-label': 'Suggestions' }, ...suggestions) : null,
    el(
      'div',
      { class: 'tools' },
      el('span', { class: 'rule', title: match.rule.description }, match.rule.id, match.rule.premium ? ' (premium)' : ''),
      ...tools,
    ),
  );
}

function renderResults() {
  const matches = currentMatches();
  const counts = countByType(matches);
  const selection = state.mode === 'selection';
  $('results').hidden = false;
  $('results-title').textContent = `${matches.length} ${matches.length === 1 ? 'issue' : 'issues'} ${selection ? 'in the selection' : 'on this page'}`;
  const time = state.checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('results-meta').textContent = `${state.languageLabel} · checked at ${time}${selection ? '' : ' · check again after editing'}`;
  $('counts').replaceChildren(...TYPES.map((t) => el('li', { class: t }, `${TYPE_LABELS[t]} `, el('strong', {}, String(counts[t])))));

  const groups = groupBySegment(matches);
  $('groups').replaceChildren(...groups.map(({ segment, matches: list }) => {
    const start = segment.text.trim().split(/\s+/).slice(0, 5).join(' ');
    const title = `${segment.kind === 'block' ? `${segment.label} block` : segment.label}: “${start}…”`;
    return el(
      'section',
      { class: 'group' },
      el('h3', {}, title),
      el('ul', { class: 'matches' }, ...list.map(matchItem)),
    );
  }));

  const fixes = [...state.accepted.values()];
  $('apply-bar').hidden = !selection;
  if (selection) {
    $('apply').disabled = !fixes.length;
    $('apply').textContent = fixes.length ? `Apply ${fixes.length} ${fixes.length === 1 ? 'fix' : 'fixes'} to the selection` : 'Pick fixes below';
    const before = state.doc.segments.map((s) => s.text);
    $('preview').textContent = fixes.length
      ? buildDocument(applyReplacements(state.doc, fixes)).segments
        .map((s) => s.text).filter((t, i) => t !== before[i]).join('\n')
      : '';
  }
  $('assistant-row').hidden = selection || !matches.length || typeof state.actions.setPrompt !== 'function';
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

function readLiveDocument() {
  const { actions, capabilities } = state;
  if (capabilities?.liveDocument !== 1 || typeof actions.subscribeLiveDocument !== 'function') {
    return Promise.reject(new Error('no-live'));
  }
  return new Promise((resolve, reject) => {
    let unsubscribe;
    const timer = setTimeout(() => {
      unsubscribe?.();
      reject(new Error('no-live'));
    }, 5000);
    unsubscribe = actions.subscribeLiveDocument((snapshot) => {
      clearTimeout(timer);
      queueMicrotask(() => unsubscribe());
      resolve(snapshot);
    });
  });
}

function consentNeeded(ep) {
  const given = readJson(CONSENT_STORE) || [];
  if (given.includes(ep.host)) return Promise.resolve(true);
  $('notice-text').textContent = ep.kind === 'custom'
    ? `Checking sends the text you check to ${ep.host}, the LanguageTool server this site set up. Nothing else leaves your browser.`
    : `Checking sends the text you check to LanguageTool (${ep.host}), a service by LanguageTooler GmbH. Nothing else leaves your browser.`;
  $('notice').hidden = false;
  $('notice-ok').focus();
  return new Promise((resolve) => {
    const done = (ok) => {
      $('notice').hidden = true;
      if (ok) localStorage.setItem(CONSENT_STORE, JSON.stringify([...given, ep.host]));
      resolve(ok);
    };
    $('notice-ok').onclick = () => done(true);
    $('notice-cancel').onclick = () => done(false);
  });
}

function tooFast(ep, requests) {
  const now = Date.now();
  state.recent = state.recent.filter((t) => now - t < 60000);
  return ep.kind === 'free' && state.recent.length + requests > FREE_PER_MINUTE;
}

async function runCheck(mode) {
  const ep = endpoint();
  if (ep.error) {
    setStatus(describeError({ code: ep.error }), 'error');
    $('settings').open = true;
    return;
  }
  if (!(await consentNeeded(ep))) {
    setStatus('Nothing was sent.');
    return;
  }
  $('check-page').disabled = true;
  $('check-selection').disabled = true;
  try {
    let html;
    if (mode === 'selection') {
      try {
        html = await state.actions.getSelection();
      } catch {
        throw new Error('no-selection');
      }
    } else {
      setStatus('Reading the page…');
      ({ html } = await readLiveDocument());
    }
    const doc = buildDocument(html);
    if (!doc.segments.length) throw new Error(mode === 'selection' ? 'no-selection' : 'no-live');
    const chunks = chunkItems(doc.items, ep.maxChars);
    if (tooFast(ep, chunks.length)) throw new Error('too-fast');

    // A selection often starts mid-sentence; don't ask for a capital letter there.
    const settings = mode === 'selection'
      ? { ...state.settings, disabledRules: [...state.settings.disabledRules, 'UPPERCASE_SENTENCE_START'] }
      : state.settings;
    const raw = [];
    let language;
    for (let i = 0; i < chunks.length; i += 1) {
      setStatus(chunks.length > 1 ? `Checking part ${i + 1} of ${chunks.length}…` : 'Checking…');
      state.recent.push(Date.now());
      // Requests run one after the other to stay within LanguageTool's limits.
      // eslint-disable-next-line no-await-in-loop
      const result = await check(fetch, ep, buildBody(chunks[i].items, settings, ep));
      raw.push({ base: chunks[i].base, matches: result.matches });
      language ??= result.language;
    }

    Object.assign(state, {
      mode, doc, raw, html, checkedAt: new Date(), accepted: new Map(),
    });
    state.languageLabel = state.settings.language === 'auto' && language?.detectedLanguage
      ? `Language: ${language.name} (detected)`
      : `Language: ${language?.name || state.settings.language}`;
    renderResults();
    const count = currentMatches().length;
    setStatus(count ? `Found ${count} ${count === 1 ? 'issue' : 'issues'}.` : 'No issues found.', 'ok');
    $('results-title').focus();
  } catch (error) {
    setStatus(describeError(error, ep), 'error');
  } finally {
    $('check-page').disabled = false;
    $('check-selection').disabled = false;
  }
}

async function applyFixes() {
  const fixes = [...state.accepted.values()];
  if (!fixes.length) return;
  const next = applyReplacements(state.doc, fixes);
  const text = plainText(state.doc) === null ? undefined : plainText(buildDocument(next));
  if (text === undefined) {
    // sendHTML replaces whole elements cleanly but splits a paragraph around a partial selection.
    const live = await readLiveDocument().then(({ html }) => buildDocument(html), () => null);
    const whole = new Set(live?.segments.map((s) => s.text));
    if (!state.doc.segments.every((s) => whole.has(s.text))) {
      setStatus(MESSAGES.partial, 'error');
      return;
    }
  }
  const result = await replaceSelection(state.actions, state.html, next, text);
  if (!result.ok) {
    setStatus(MESSAGES[result.error], 'error');
    return;
  }
  state.accepted = new Map();
  $('results').hidden = true;
  setStatus(`Applied ${fixes.length} ${fixes.length === 1 ? 'fix' : 'fixes'}.`, 'ok');
}

function askAssistant() {
  const lines = currentMatches().slice(0, 40).map((m) => {
    const fix = m.suggestions.length ? ` Suggestion: ${m.suggestions.map((s) => `"${s}"`).join(' or ')}.` : '';
    const c = context(m, 40);
    return `- "${m.word.trim()}" in "${(c.before + c.word + c.after).trim()}": ${m.message}${fix}`;
  });
  state.actions.setPrompt(
    `LanguageTool found these issues on this page. Please fix the real mistakes and keep names and wording that are intended:\n${lines.join('\n')}`,
    { autoSend: false },
  );
  setStatus('Sent the list to the Workspace assistant. Review the prompt there before sending.');
}

function wireSettings() {
  $('key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = $('lt-user').value.trim();
    const apiKey = $('lt-key').value.trim();
    const existing = credentials();
    const key = apiKey === '••••••••' && existing ? existing.apiKey : apiKey;
    if (!username || !key) return;
    localStorage.setItem(KEY_STORE, JSON.stringify({ username, apiKey: key }));
    renderSettings();
    setStatus('Saved your premium key in this browser.', 'ok');
  });
  $('forget').addEventListener('click', () => {
    localStorage.removeItem(KEY_STORE);
    renderSettings();
    setStatus('Removed your premium key from this browser.', 'ok');
  });
}

(async function init() {
  const sdk = await DA_SDK;
  Object.assign(state, {
    context: sdk.context, actions: sdk.actions, capabilities: sdk.capabilities,
  });
  const { org, repo } = sdk.context;
  $('config-link').href = `https://da.live/config#/${org}/${repo}/`;
  try {
    const { config, canWrite } = await loadConfig(sdk.actions.daFetch, org, repo);
    state.settings = parseSettings(config);
    state.canWrite = canWrite;
  } catch {
    state.settings = parseSettings(null);
    state.canWrite = false;
  }
  renderSettings();
  wireSettings();
  $('check-page').addEventListener('click', () => runCheck('page'));
  $('check-selection').addEventListener('click', () => runCheck('selection'));
  $('apply').addEventListener('click', applyFixes);
  $('assistant').addEventListener('click', askAssistant);
  $('check-page').disabled = false;
  $('check-selection').disabled = false;
  setStatus('Check the whole page, or select text in the document and check the selection to fix it.');
}());
