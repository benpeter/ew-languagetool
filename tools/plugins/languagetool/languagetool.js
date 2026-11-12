// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import loadSharedUi from './shared-ui.js';
import { buildDocument, chunkItems, applyReplacements } from './lib/text.js';
import {
  TYPES, prepareMatches, groupByType, countByType, matchKey, context, assistantPrompt, phrase,
  fixPrompt,
} from './lib/matches.js';
import {
  parseSettings, resolveEndpoint, addWord, serverLabel, chatEnabled,
} from './lib/settings.js';
import { buildBody, check } from './lib/api.js';
import { replaceSelection, plainText } from './lib/selection.js';
import { loadConfig, saveConfig } from './lib/config.js';

const KEY_STORE = 'ew-languagetool:premium';
const CONSENT_STORE = 'ew-languagetool:consent';
const FREE_PER_MINUTE = 20;
const PAGE_SIZE = 5;
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
  pages: {},
  closed: new Set(),
  detail: null,
  chat: false,
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
  if ($('detail').open) {
    $('detail-status').textContent = text;
    return;
  }
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
// The server, at the bottom of the panel
// ---------------------------------------------------------------------------

const privacyText = (ep) => (ep.kind === 'custom'
  ? `Checking sends the text you check to ${ep.host}, the LanguageTool server this site set up.`
  : `Checking sends the text you check to LanguageTool (${ep.host}), run by LanguageTooler GmbH.`);

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
  help('the server', $('server-row'), [...privacy, ...siteFacts()]);

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const titleOf = (m) => phrase(m, '').from.trim() || m.word;
const toneIcon = (tone) => el('span', { class: `lt-tone ${tone}`, 'aria-hidden': 'true' });
// A picked fix only exists when checking a selection.
const picked = (m) => (state.mode === 'selection' ? state.accepted.get(String(m.offset))?.value : undefined);

function excerpt(m, value) {
  const c = context(m);
  let spot = el('mark', {}, c.word);
  if (value !== undefined) spot = value ? el('ins', {}, value) : el('del', {}, c.word);
  return el('span', { class: 'lt-excerpt' }, c.cutStart ? '…' : '', c.before, spot, c.after, c.cutEnd ? '…' : '');
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
    setStatus('');
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

// ---------------------------------------------------------------------------
// One issue in a dialog, like Preflight's suggestion view
// ---------------------------------------------------------------------------

function detailList() {
  return groupByType(currentMatches()).find((g) => g.type === state.detail.type)?.matches || [];
}

function openDetail(type, index) {
  state.detail = { type, index, choice: 0 };
  // eslint-disable-next-line no-use-before-define
  renderDetail();
  if (state.detail && !$('detail').open) $('detail').showModal();
}

function moveDetail(step) {
  state.detail.index += step;
  state.detail.choice = 0;
  $('detail-status').textContent = '';
  // eslint-disable-next-line no-use-before-define
  renderDetail();
  const next = $(step < 0 ? 'lt-detail-prev' : 'lt-detail-next');
  (next.disabled ? $(step < 0 ? 'lt-detail-next' : 'lt-detail-prev') : next).focus();
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify(`Copied “${text}”.`);
  } catch {
    notify('Could not copy. Select the text in the document and use Check selection to fix it.');
  }
}

function toChat(m, value, autoSend) {
  state.actions.setPrompt(fixPrompt(m, value), { autoSend });
  $('detail').close();
  notify(autoSend
    ? 'Asked the assistant to make this change.'
    : 'Added the change to the assistant. Review the prompt before you send it.');
}

function ignore(m) {
  state.ignored.add(matchKey(m));
  // eslint-disable-next-line no-use-before-define
  renderResults();
  // eslint-disable-next-line no-use-before-define
  renderDetail();
  notify(`Ignoring “${m.word.trim()}” until you close the panel.`);
  $('detail-body').querySelector('.lt-detail-more button')?.focus();
}

const heading = (kind, text) => el(
  'div',
  { class: 'lt-detail-heading' },
  el('span', { class: `lt-tone ${kind === 'issue' ? 'negative' : 'positive'}`, 'aria-hidden': 'true' }),
  el('h4', {}, text),
);

function choices(m) {
  if (m.suggestions.length === 1) return el('p', {}, excerpt(m, m.suggestions[0]));
  return el('fieldset', { class: 'lt-choices' }, el('legend', { class: 'lt-vh' }, 'Suggestions'), m.suggestions.map((value, i) => el(
    'label',
    { class: 'lt-choice' },
    el('input', {
      type: 'radio',
      name: 'lt-choice',
      value: String(i),
      checked: i === state.detail.choice,
      onchange: () => {
        state.detail.choice = i;
        // eslint-disable-next-line no-use-before-define
        renderDetail();
        $('detail-body').querySelector(`input[value="${i}"]`)?.focus();
      },
    }),
    excerpt(m, value),
  )));
}

function fixActions(m) {
  const value = m.suggestions[state.detail.choice];
  if (state.mode === 'selection') {
    const on = picked(m) === value;
    return el('div', { class: 'lt-detail-actions' }, el('button', {
      type: 'button',
      class: on ? 'nx-action-btn nx-btn-sm' : 'nx-btn-accent nx-btn-sm',
      onclick: () => {
        toggleSuggestion(m, value);
        // eslint-disable-next-line no-use-before-define
        renderDetail();
        $('lt-use-fix').focus();
      },
      id: 'lt-use-fix',
    }, on ? 'Don’t use this fix' : 'Use this fix'));
  }
  return el(
    'div',
    { class: 'lt-detail-actions' },
    el('button', { type: 'button', class: 'lt-copy', onclick: () => copy(phrase(m, value).to) }, icon('s2-icon-copy-20-n'), 'Copy suggestion'),
    state.chat ? el(
      'div',
      { class: 'lt-chat-actions' },
      el('button', { type: 'button', class: 'nx-action-btn nx-btn-sm', onclick: () => toChat(m, value, false) }, icon('s2-icon-aichat-20-n'), el('span', {}, 'Add to chat')),
      el('button', { type: 'button', class: 'nx-btn-accent nx-btn-sm', onclick: () => toChat(m, value, true) }, icon('s2-icon-aisparkles-20-n'), el('span', {}, 'Apply change')),
    ) : null,
  );
}

function renderDetail() {
  if (!state.detail) return;
  const list = detailList();
  if (!list.length) {
    $('detail').close();
    return;
  }
  const { detail } = state;
  detail.index = Math.max(0, Math.min(detail.index, list.length - 1));
  const m = list[detail.index];
  detail.offset = m.offset;
  detail.choice = Math.min(detail.choice, Math.max(0, m.suggestions.length - 1));
  const word = m.word.trim();
  const { segment } = m;
  const where = segment.kind === 'block' ? `${segment.label} block` : segment.label;
  const start = segment.text.trim().split(/\s+/).slice(0, 8).join(' ');
  const total = list.length;
  $('detail-title').textContent = TYPE_LABELS[m.type];
  $('detail-body').replaceChildren(
    el('h3', { class: 'lt-asset' }, titleOf(m)),
    el(
      'section',
      {},
      heading('issue', 'Issue identified'),
      el('p', {}, m.message),
      el('p', {}, excerpt(m)),
      m.suggestions.length ? null : el('p', { class: 'lt-rule' }, 'LanguageTool has no suggestion here. Change the text in the document yourself.'),
    ),
    m.suggestions.length
      ? el('section', {}, heading('fix', 'Suggested change'), choices(m), fixActions(m))
      : null,
    el(
      'div',
      { class: 'lt-detail-more' },
      el('button', { type: 'button', class: 'nx-action-btn-quiet nx-btn-sm', onclick: () => ignore(m) }, 'Ignore on this page'),
      m.type === 'spelling' && state.canWrite
        ? el('button', { type: 'button', class: 'nx-action-btn-quiet nx-btn-sm', onclick: () => addToDictionary(word).then(renderDetail) }, 'Add to site dictionary')
        : null,
    ),
    el('h4', { class: 'lt-context-title' }, 'Context'),
    el(
      'div',
      { class: 'lt-context' },
      el('span', { class: 'lt-chip' }, TYPE_LABELS[m.type]),
      el('p', {}, `${where}: “${start}${segment.text.trim().length > start.length ? '…' : ''}”`),
      m.rule.description && m.rule.description !== m.message
        ? el('p', { class: 'lt-rule' }, `${m.rule.description}${m.rule.premium ? ' (premium rule)' : ''}`)
        : null,
    ),
    el(
      'div',
      { class: 'lt-paging lt-detail-paging' },
      el('button', {
        type: 'button', id: 'lt-detail-prev', class: 'lt-paging-btn prev', 'aria-label': 'Previous issue', disabled: detail.index === 0, onclick: () => moveDetail(-1),
      }),
      el('span', { class: 'lt-paging-label' }, `${detail.index + 1} of ${plural(total, `${TYPE_LABELS[m.type].toLowerCase()} issue`)}`),
      el('button', {
        type: 'button', id: 'lt-detail-next', class: 'lt-paging-btn next', 'aria-label': 'Next issue', disabled: detail.index >= total - 1, onclick: () => moveDetail(1),
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Results, like Preflight: counts by type, then a section per type
// ---------------------------------------------------------------------------

function itemRow(m, index) {
  const pick = picked(m);
  const desc = pick === undefined ? m.message : `Will change to “${phrase(m, pick).to}”`;
  const title = titleOf(m);
  return el(
    'li',
    { class: 'lt-item' },
    toneIcon(pick === undefined ? 'negative' : 'positive'),
    el('div', { class: 'lt-item-body' }, el('span', { class: 'lt-item-title' }, title), el('span', { class: 'lt-item-desc', title: desc }, desc)),
    el('button', {
      type: 'button',
      class: 'lt-item-action',
      'data-offset': String(m.offset),
      'aria-label': `${m.suggestions.length ? 'View suggestions for' : 'View'} “${title}”`,
      onclick: () => openDetail(m.type, index),
    }, m.suggestions.length ? 'View suggestions' : 'View'),
  );
}

function paging(type, page, end, total) {
  const go = (step) => {
    state.pages[type] = page + step;
    // eslint-disable-next-line no-use-before-define
    renderResults();
    const next = $(`lt-${step < 0 ? 'prev' : 'next'}-${type}`);
    (next.disabled ? $(`lt-${step < 0 ? 'next' : 'prev'}-${type}`) : next).focus();
  };
  return el(
    'div',
    { class: 'lt-paging' },
    el('button', {
      type: 'button', id: `lt-prev-${type}`, class: 'lt-paging-btn prev', 'aria-label': 'Previous issues', disabled: page === 0, onclick: () => go(-1),
    }),
    el('span', { class: 'lt-paging-label' }, `${end} of ${total} issues`),
    el('button', {
      type: 'button', id: `lt-next-${type}`, class: 'lt-paging-btn next', 'aria-label': 'Next issues', disabled: end >= total, onclick: () => go(1),
    }),
  );
}

function section({ type, matches: list }) {
  const page = Math.min(state.pages[type] ?? 0, Math.floor((list.length - 1) / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, list.length);
  const details = el(
    'details',
    { class: 'lt-section', open: !state.closed.has(type) },
    el(
      'summary',
      { class: 'lt-section-head' },
      el('span', { class: 'lt-section-chip' }, toneIcon('negative')),
      el('span', { class: 'lt-section-labels' }, el('span', { class: 'lt-section-label' }, TYPE_LABELS[type]), el('span', { class: 'lt-section-sublabel' }, plural(list.length, 'issue'))),
      el('span', { class: 'lt-chevron', 'aria-hidden': 'true' }),
    ),
    el('ul', { class: 'lt-items' }, list.slice(start, end).map((m, i) => itemRow(m, start + i))),
    list.length > PAGE_SIZE ? paging(type, page, end, list.length) : null,
  );
  details.addEventListener('toggle', () => {
    if (details.open) state.closed.delete(type);
    else state.closed.add(type);
  });
  return details;
}

function renderResults() {
  const matches = currentMatches();
  const counts = countByType(matches);
  const selection = state.mode === 'selection';
  const where = selection ? 'in the selection' : 'on this page';
  $('results').hidden = false;
  $('results-title').textContent = matches.length
    ? `${plural(matches.length, 'issue')} ${where}`
    : `No issues ${where}`;
  help('the results', $('results-row'), [
    selection
      ? 'Open an issue and pick a fix. Then apply the fixes to the selection.'
      : 'Open an issue to see what LanguageTool suggests. Copy the fix, ask the assistant to make it, or select the text in the document and use Check selection.',
    'Ignore hides an issue until you close the panel. Add to site dictionary accepts a word for every author on this site.',
  ]);
  const time = state.checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('results-meta').textContent = `${state.languageLabel} · checked at ${time}`;
  $('summary').replaceChildren(...TYPES.map((t) => el(
    'div',
    { class: 'lt-tile' },
    el('span', { class: 'lt-tile-label' }, TYPE_LABELS[t]),
    el('span', { class: `lt-tile-value ${counts[t] ? 'negative' : 'positive'}` }, String(counts[t])),
  )));
  $('sections').replaceChildren(...groupByType(matches).map(section));

  const fixes = [...state.accepted.values()];
  // The apply bar shows once a fix is picked, with the changed paragraphs as a preview.
  $('apply-bar').hidden = !selection || !fixes.length;
  if (selection && fixes.length) {
    $('apply').textContent = `Apply ${fixes.length} ${fixes.length === 1 ? 'fix' : 'fixes'}`;
    const before = state.doc.segments.map((s) => s.text);
    $('preview').textContent = buildDocument(applyReplacements(state.doc, fixes)).segments
      .map((s) => s.text).filter((t, i) => t !== before[i]).join('\n');
  }
  $('assistant-row').hidden = selection || !matches.length || !state.chat;
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

    const fresh = { accepted: new Map(), pages: {}, closed: new Set() };
    Object.assign(state, {
      mode, doc, raw, html, checkedAt: new Date(), ...fresh,
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
  let siteConfig = null;
  try {
    const { config, canWrite } = await loadConfig(sdk.actions.daFetch, org, repo);
    siteConfig = config;
    state.settings = parseSettings(config);
    state.canWrite = canWrite;
  } catch {
    state.settings = parseSettings(null);
    state.canWrite = false;
  }
  // Workspace turns chat off with a flag in the org or site config.
  const orgConfig = await sdk.actions.daFetch(`https://admin.da.live/config/${org}/`)
    .then((resp) => (resp.ok ? resp.json() : null), () => null);
  state.chat = typeof sdk.actions.setPrompt === 'function' && chatEnabled([orgConfig, siteConfig]);
  renderHead();
  wireKeyForm();
  help('checking', $('check-row'), [
    'Check page lists the issues on the whole page. Check selection checks the text you selected and can fix it in place.',
    'Checks only run when you click.',
  ]);
  $('check-page').addEventListener('click', () => runCheck('page'));
  $('check-selection').addEventListener('click', () => runCheck('selection'));
  $('apply').addEventListener('click', applyFixes);
  $('assistant').addEventListener('click', askAssistant);
  const dialog = $('detail');
  $('detail-close').addEventListener('click', () => dialog.close());
  // A click outside the dialog panel lands on the dialog itself, like nx-dialog's backdrop.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    const row = document.querySelector(`.lt-item-action[data-offset="${state.detail?.offset}"]`);
    state.detail = null;
    $('detail-status').textContent = '';
    (row || $('results-title')).focus();
  });
  setStatus('');
}());
