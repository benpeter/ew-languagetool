// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import loadSharedUi from './shared-ui.js';
import { buildDocument, chunkItems, applyReplacements } from './lib/text.js';
import {
  TYPES, prepareMatches, groupBySegment, countByType, matchKey, context, assistantPrompt,
} from './lib/matches.js';
import {
  parseSettings, resolveEndpoint, addWord, serverLabel,
} from './lib/settings.js';
import { buildBody, check } from './lib/api.js';
import { replaceSelection, plainText } from './lib/selection.js';
import { loadConfig, saveConfig } from './lib/config.js';

const KEY_STORE = 'ew-languagetool:premium';
const CONSENT_STORE = 'ew-languagetool:consent';
const FREE_PER_MINUTE = 20;
const ICONS = new URL('./img/', import.meta.url).href;
const SVG = 'http://www.w3.org/2000/svg';
const TYPE_LABELS = {
  spelling: 'Spelling', grammar: 'Grammar', punctuation: 'Punctuation', style: 'Style',
};
const MESSAGES = {
  'rate-limit': 'LanguageTool\'s limit was reached (the free server allows about 20 checks a minute). Wait a minute and try again.',
  'too-large': 'This text is too long for one check. Check a smaller selection, or use a premium key for longer texts.',
  auth: 'LanguageTool did not accept your premium key. Remove it in the menu and add it again.',
  'bad-request': 'LanguageTool rejected the request. Check the language and rules in the site settings.',
  server: 'LanguageTool had a problem. Try again later.',
  'missing-key': 'This site uses LanguageTool Premium. Add your premium key to check.',
  'bad-server': 'The server in the site settings is not a valid https URL. Ask a site admin to fix it.',
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
// DA's shared menu, popover and toast; the panel works without them.
const ui = { showToast: null, popover: false, menu: null };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v !== undefined && v !== null) node.setAttribute(k, v === true ? '' : v);
  });
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `${ICONS}${name}.svg#icon`);
  svg.append(use);
  return svg;
}

// Problems and progress stay in the panel; confirmations go to DA's toast when it loaded.
function setStatus(text, kind = '') {
  const status = $('status');
  status.textContent = text;
  status.className = `lt-status ${kind}`;
}

function notify(text) {
  if (typeof ui.showToast !== 'function') {
    setStatus(text, 'ok');
    return;
  }
  setStatus('');
  ui.showToast({ text });
}

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
};

const writeJson = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
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
// Help popovers and the menu (EW Style Guide)
// ---------------------------------------------------------------------------

const openHelp = () => [...document.querySelectorAll('nx-popover.lt-help-popover')].find((p) => p.open);
// One overlay at a time: popovers only close on outside clicks and Escape.
const closeOverlays = () => {
  openHelp()?.close();
  ui.menu?.close?.();
};

/** Explanations sit behind an info button that opens a text-only nx-popover. */
function help(topic, row, texts) {
  row.querySelectorAll(':scope > .lt-help, :scope > nx-popover, :scope > .lt-inline-help').forEach((n) => n.remove());
  if (!ui.popover) {
    row.append(...texts.map((text) => el('p', { class: 'lt-inline-help' }, text)));
    return;
  }
  const id = `lt-help-${topic.replace(/\W+/g, '-')}`;
  const trigger = el('button', {
    type: 'button',
    id: `${id}-button`,
    class: 'nx-action-btn-icon nx-btn-sm lt-help',
    'aria-label': `About ${topic}`,
    'aria-expanded': 'false',
    'aria-controls': id,
  }, icon('s2-icon-infocircle-20-n'));
  const popover = el('nx-popover', { id, class: 'lt-help-popover' }, texts.map((text) => el('p', {}, text)));
  popover.scoped = true;
  trigger.addEventListener('click', () => {
    if (popover.open) {
      popover.close();
      return;
    }
    closeOverlays();
    popover.show({ anchor: row, placement: 'auto' });
    trigger.setAttribute('aria-expanded', 'true');
  });
  popover.addEventListener('close', () => trigger.setAttribute('aria-expanded', 'false'));
  row.append(trigger, popover);
}

document.addEventListener('keydown', (event) => {
  const popover = event.key === 'Escape' && openHelp();
  if (popover) document.querySelector(`[aria-controls="${popover.id}"]`)?.focus();
});

function showKeyForm() {
  closeOverlays();
  $('key-form').hidden = false;
  $('lt-user').focus();
}

function removeKey() {
  writeJson(KEY_STORE, null);
  // eslint-disable-next-line no-use-before-define
  renderHead();
  notify('Removed your premium key from this browser.');
  $('lt-options')?.focus();
}

const configUrl = () => `https://da.live/config#/${state.context.org}/${state.context.repo}/`;

// Adding or removing the key and the site settings are rare, so they sit in a menu.
function renderMenu() {
  const items = [credentials()
    ? { id: 'remove-key', label: 'Remove premium key', description: 'Only from this browser.' }
    : { id: 'add-key', label: 'Add premium key', description: 'Check with your own LanguageTool Premium account.' }];
  if (state.canWrite) {
    items.push({ id: 'site-settings', label: 'Site settings', description: 'Server, language and site dictionary, in a new tab.' });
  }
  const run = (id) => {
    if (id === 'add-key') showKeyForm();
    if (id === 'remove-key') removeKey();
    if (id === 'site-settings') window.open(configUrl(), '_blank', 'noopener');
  };
  // Update the open menu in place: replacing it while it closes throws in nx-menu.
  if (ui.menu) {
    ui.menu.items = items;
    return;
  }
  const slot = $('menu-slot');
  if (!customElements.get('nx-menu')) {
    slot.replaceChildren(...items.map((item) => el('button', {
      type: 'button', class: 'nx-action-btn-quiet nx-btn-sm', onclick: () => run(item.id),
    }, item.label)));
    return;
  }
  const trigger = el('button', {
    type: 'button', slot: 'trigger', id: 'lt-options', class: 'nx-action-btn-icon nx-btn-sm', 'aria-label': 'LanguageTool options',
  }, icon('s2-icon-more-20-n'));
  const menu = el('nx-menu', { placement: 'below-end' }, trigger);
  menu.items = items;
  menu.addEventListener('select', (e) => run(e.detail?.id));
  // nx-menu doesn't return focus when it closes.
  menu.addEventListener('close', () => {
    const { activeElement } = document;
    const inside = activeElement === menu || menu.contains(activeElement);
    if (inside && document.hasFocus()) trigger.focus();
  });
  trigger.addEventListener('click', () => openHelp()?.close());
  ui.menu = menu;
  slot.replaceChildren(menu);
}

// ---------------------------------------------------------------------------
// Where checks go
// ---------------------------------------------------------------------------

const privacyText = (ep) => (ep.kind === 'custom'
  ? `Checking sends the text you check to ${ep.host}, the LanguageTool server this site set up. Nothing else leaves your browser.`
  : `Checking sends the text you check to LanguageTool (${ep.host}), run by LanguageTooler GmbH. Nothing else leaves your browser.`);

function siteFacts() {
  const s = state.settings;
  const language = s.language === 'auto' ? `detected per check (${s.variants.join(', ')} preferred)` : s.language;
  const shown = s.words.slice(0, 12).join(', ');
  const more = s.words.length > 12 ? ` and ${s.words.length - 12} more` : '';
  return [
    `Language: ${language}. Level: ${s.level}.${s.disabledRules.length ? ` Rules turned off: ${s.disabledRules.join(', ')}.` : ''}`,
    s.words.length ? `Site dictionary: ${shown}${more}.` : 'The site dictionary is empty.',
    'Site admins change these in the languagetool sheet of the site configuration.',
  ];
}

function renderHead() {
  const ep = endpoint();
  $('server-name').textContent = serverLabel(state.settings, ep);
  const privacy = ep.host ? [privacyText(ep)] : [];
  if (ep.kind === 'premium' && state.settings.server === 'free') {
    privacy.push('The site uses the free API. Your premium key, saved in this browser, sends your checks to LanguageTool Premium instead.');
  }
  help('where checks go', $('server-row'), [...privacy, ...siteFacts()]);

  const problem = $('problem');
  problem.hidden = !ep.error;
  if (ep.error === 'missing-key') {
    problem.replaceChildren(
      el('p', {}, MESSAGES['missing-key']),
      el('button', { type: 'button', class: 'nx-action-btn-quiet nx-btn-sm', onclick: showKeyForm }, 'Add premium key'),
    );
  } else if (ep.error) {
    problem.replaceChildren(el('p', {}, describeError({ code: ep.error })));
  }
  const ready = !ep.error;
  $('check-page').disabled = !ready || state.busy;
  $('check-selection').disabled = !ready || state.busy;
  renderMenu();
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function excerpt(match) {
  const c = context(match);
  return el(
    'p',
    { class: 'lt-excerpt' },
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
    renderHead();
    // eslint-disable-next-line no-use-before-define
    renderResults();
    notify(`Added “${word}” to the site dictionary.`);
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
    notify(`Copied “${value}”.`);
  } catch {
    setStatus('Could not copy. To apply fixes, select the text in the document and use Check selection.', 'error');
  }
}

function matchItem(match) {
  const selection = state.mode === 'selection';
  const accepted = state.accepted.get(String(match.offset))?.value;
  const suggestions = match.suggestions.map((value) => {
    const label = value === ' ' ? '(space)' : value || '(remove)';
    const on = selection && accepted === value;
    return el('button', {
      type: 'button',
      class: `nx-action-btn nx-btn-sm${on ? ' is-active' : ''}`,
      'aria-pressed': selection ? String(on) : false,
      'aria-label': selection ? `Use “${label}”` : `Copy “${label}”`,
      onclick: () => useSuggestion(match, value),
    }, label);
  });
  const word = match.word.trim();
  const tools = [
    el('button', {
      type: 'button',
      class: 'nx-action-btn-quiet nx-btn-sm',
      'aria-label': `Ignore “${word}” on this page`,
      onclick: () => {
        state.ignored.add(matchKey(match));
        // eslint-disable-next-line no-use-before-define
        renderResults();
        notify(`Ignoring “${word}” until you close the panel.`);
      },
    }, 'Ignore'),
  ];
  if (match.type === 'spelling' && state.canWrite) {
    tools.push(el('button', {
      type: 'button',
      class: 'nx-action-btn-quiet nx-btn-sm',
      'aria-label': `Add “${word}” to the site dictionary`,
      onclick: () => addToDictionary(word),
    }, 'Add to dictionary'));
  }
  return el(
    'li',
    { class: `lt-match ${match.type}` },
    el('p', { class: 'lt-message' }, el('span', { class: 'lt-badge' }, TYPE_LABELS[match.type]), ' ', match.message),
    excerpt(match),
    suggestions.length ? el('div', { class: 'lt-suggestions', role: 'group', 'aria-label': selection ? 'Fixes' : 'Suggestions, click to copy' }, suggestions) : null,
    el(
      'div',
      { class: 'lt-tools' },
      el('span', { class: 'lt-rule', title: match.rule.description }, match.rule.id, match.rule.premium ? ' (premium)' : ''),
      tools,
    ),
  );
}

function renderResults() {
  const matches = currentMatches();
  const counts = countByType(matches);
  const selection = state.mode === 'selection';
  const where = selection ? 'in the selection' : 'on this page';
  $('results').hidden = false;
  $('results-title').textContent = matches.length
    ? `${matches.length} ${matches.length === 1 ? 'issue' : 'issues'} ${where}`
    : `No issues ${where}`;
  help('the results', $('results-row'), selection
    ? ['Pick the fixes you want, then apply them to the selection.', 'Ignore hides an issue until you close the panel. Add to dictionary accepts a word for every author on this site.']
    : ['To fix issues, select the text in the document and use Check selection. Clicking a suggestion here copies it.', 'Ignore hides an issue until you close the panel. Add to dictionary accepts a word for every author on this site.']);
  const time = state.checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('results-meta').textContent = `${state.languageLabel} · checked at ${time}`;
  $('counts').replaceChildren(...TYPES.map((t) => el('li', { class: t }, `${TYPE_LABELS[t]} `, el('strong', {}, String(counts[t])))));
  $('counts').hidden = !matches.length;

  const groups = groupBySegment(matches);
  $('groups').replaceChildren(...groups.map(({ segment, matches: list }) => {
    const start = segment.text.trim().split(/\s+/).slice(0, 5).join(' ');
    const title = `${segment.kind === 'block' ? `${segment.label} block` : segment.label}: “${start}…”`;
    return el(
      'section',
      { class: 'lt-group' },
      el('h3', {}, title),
      el('ul', { class: 'lt-matches' }, list.map(matchItem)),
    );
  }));

  const fixes = [...state.accepted.values()];
  // The apply bar shows once a fix is picked, with the changed paragraphs as a preview.
  $('apply-bar').hidden = !selection || !fixes.length;
  if (selection && fixes.length) {
    $('apply').textContent = `Apply ${fixes.length} ${fixes.length === 1 ? 'fix' : 'fixes'}`;
    const before = state.doc.segments.map((s) => s.text);
    $('preview').textContent = buildDocument(applyReplacements(state.doc, fixes)).segments
      .map((s) => s.text).filter((t, i) => t !== before[i]).join('\n');
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
  $('notice-text').textContent = privacyText(ep);
  $('notice').hidden = false;
  $('notice-ok').focus();
  return new Promise((resolve) => {
    const done = (ok) => {
      $('notice').hidden = true;
      if (ok) writeJson(CONSENT_STORE, [...given, ep.host]);
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

function setBusy(busy) {
  state.busy = busy;
  $('check-page').disabled = busy;
  $('check-selection').disabled = busy;
}

const spinning = (text) => {
  $('status').replaceChildren(el('span', { class: 'nx-loading-spinner', 'aria-hidden': 'true' }), text);
  $('status').className = 'lt-status';
};

async function runCheck(mode) {
  closeOverlays();
  const ep = endpoint();
  if (ep.error) {
    setStatus(describeError({ code: ep.error }), 'error');
    return;
  }
  if (!(await consentNeeded(ep))) {
    setStatus('Nothing was sent.');
    return;
  }
  setBusy(true);
  try {
    let html;
    if (mode === 'selection') {
      try {
        html = await state.actions.getSelection();
      } catch {
        throw new Error('no-selection');
      }
    } else {
      spinning('Reading the page…');
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
      spinning(chunks.length > 1 ? `Checking part ${i + 1} of ${chunks.length}…` : 'Checking…');
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
      ? `${language.name} (detected)`
      : language?.name || state.settings.language;
    setStatus('');
    renderResults();
    $('results-title').focus();
  } catch (error) {
    setStatus(describeError(error, ep), 'error');
  } finally {
    setBusy(false);
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
  notify(`Applied ${fixes.length} ${fixes.length === 1 ? 'fix' : 'fixes'}.`);
}

function askAssistant() {
  state.actions.setPrompt(assistantPrompt(currentMatches()), { autoSend: false });
  notify('Added the list to the assistant. Review the prompt before you send it.');
}

function wireKeyForm() {
  $('key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const username = $('lt-user').value.trim();
    const apiKey = $('lt-key').value.trim();
    if (!username || !apiKey) return;
    if (!writeJson(KEY_STORE, { username, apiKey })) {
      setStatus('This browser blocks storage for the panel, so the key can\'t be saved.', 'error');
      return;
    }
    $('key-form').reset();
    $('key-form').hidden = true;
    renderHead();
    notify('Saved your premium key in this browser.');
    $('check-page').focus();
  });
  $('key-cancel').addEventListener('click', () => {
    $('key-form').reset();
    $('key-form').hidden = true;
    $('lt-options')?.focus();
  });
  help('the premium key', $('key-title'), [
    'Each author uses their own LanguageTool account. Premium finds more issues and checks longer texts.',
    'The key stays in this browser and goes only to api.languagetoolplus.com, never to the site configuration.',
  ]);
}

(async function init() {
  const [sdk, shared] = await Promise.all([DA_SDK, loadSharedUi().catch(() => ({}))]);
  ui.showToast = shared.showToast;
  ui.popover = !!customElements.get('nx-popover');
  Object.assign(state, {
    context: sdk.context, actions: sdk.actions, capabilities: sdk.capabilities,
  });
  const { org, repo } = sdk.context;
  try {
    const { config, canWrite } = await loadConfig(sdk.actions.daFetch, org, repo);
    state.settings = parseSettings(config);
    state.canWrite = canWrite;
  } catch {
    state.settings = parseSettings(null);
    state.canWrite = false;
  }
  renderHead();
  wireKeyForm();
  help('checking', $('check-row'), [
    'Check page lists the issues on the whole page. To fix them, select the text in the document and use Check selection.',
    'Checks only run when you click.',
  ]);
  $('check-page').addEventListener('click', () => runCheck('page'));
  $('check-selection').addEventListener('click', () => runCheck('selection'));
  $('apply').addEventListener('click', applyFixes);
  $('assistant').addEventListener('click', askAssistant);
  setStatus('');
}());
