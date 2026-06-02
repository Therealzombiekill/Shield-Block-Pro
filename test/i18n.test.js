/**
 * i18n integrity — _locales/en/messages.json + the HTML pages
 *
 * The whole point of i18n here is that it degrades safely: a missing data-i18n key
 * falls back to the baked-in English text. But a missing __MSG__ key referenced by
 * the MANIFEST is fatal — the extension won't load. And a data-i18n attribute that
 * points at a non-existent key is dead weight. These tests pin both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(`${ROOT}${rel}`, 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const HTML_PAGES = ['popup.html', 'welcome.html', 'blocked.html'];

const messages = JSON.parse(read(`_locales/${manifest.default_locale}/messages.json`));
const keys = new Set(Object.keys(messages).map(k => k.toLowerCase())); // i18n keys are case-insensitive
const has = (k) => keys.has(String(k).toLowerCase());

test('default_locale is declared and its messages catalog exists', () => {
  assert.ok(manifest.default_locale, 'manifest.default_locale must be set for chrome.i18n');
  assert.ok(existsSync(`${ROOT}_locales/${manifest.default_locale}/messages.json`));
});

test('every catalog entry has a non-empty string message', () => {
  assert.ok(Object.keys(messages).length > 0);
  for (const [k, v] of Object.entries(messages)) {
    assert.ok(v && typeof v.message === 'string' && v.message.length > 0, `bad message entry: ${k}`);
    assert.ok(/^[A-Za-z][A-Za-z0-9_]*$/.test(k), `invalid message key: ${k}`);
  }
});

test('every __MSG__ placeholder in the manifest resolves to a catalog key', () => {
  const refs = [...read('manifest.json').matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map(m => m[1]);
  assert.ok(refs.length >= 2, 'expected the manifest to localize at least name + description');
  for (const r of refs) assert.ok(has(r), `manifest references missing message: ${r} (would break load)`);
});

test('every data-i18n key used in the HTML pages exists in the catalog', () => {
  for (const page of HTML_PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/\bdata-i18n="([^"]+)"/g)) {
      assert.ok(has(m[1]), `${page}: data-i18n="${m[1]}" has no catalog entry`);
    }
    // data-i18n-attr="attr:key;attr2:key2"
    for (const m of html.matchAll(/\bdata-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split(';')) {
        const key = pair.split(':')[1]?.trim();
        if (key) assert.ok(has(key), `${page}: data-i18n-attr key "${key}" has no catalog entry`);
      }
    }
  }
});

test('the i18n runtime is loaded on every localized HTML page', () => {
  for (const page of HTML_PAGES) {
    assert.match(read(page), /src\/i18n\.js/, `${page} must load src/i18n.js`);
  }
});

test('any t("key", …) call in popup.js resolves to a catalog key', () => {
  // Guards dynamic-string conversions: t() with a key that has no entry would show
  // the raw fallback only — fine — but a typo'd key with no fallback shows the key.
  const js = read('popup.js');
  for (const m of js.matchAll(/\bt\(\s*'([a-z0-9_]+)'/g)) {
    assert.ok(has(m[1]), `popup.js: t('${m[1]}') has no catalog entry`);
  }
});

// ── Runtime proof: the walker actually localizes and falls back ──────────────

test('i18n.js localizes [data-i18n] text, falls back on missing keys, and sets attrs', () => {
  const code = read('src/i18n.js');
  const elem = (attrs, text) => ({
    _a: { ...attrs }, textContent: text,
    getAttribute(k) { return k in this._a ? this._a[k] : null; },
    setAttribute(k, v) { this._a[k] = v; },
  });
  const known   = elem({ 'data-i18n': 'settings' }, 'Settings');
  const missing = elem({ 'data-i18n': 'no_such_key' }, 'Original English');
  const attrEl  = elem({ 'data-i18n-attr': 'placeholder:add' }, '');

  const document = {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll(sel) {
      if (sel === '[data-i18n]') return [known, missing];
      if (sel === '[data-i18n-attr]') return [attrEl];
      return [];
    },
  };
  const TRANSLATIONS = { settings: 'Réglages', add: 'Ajouter' };
  const sandbox = { document, chrome: { i18n: { getMessage: (k) => TRANSLATIONS[k] || '' } } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);

  assert.equal(known.textContent, 'Réglages', 'known key should be localized');
  assert.equal(missing.textContent, 'Original English', 'missing key must fall back to baked-in text');
  assert.equal(attrEl._a.placeholder, 'Ajouter', 'data-i18n-attr should set the attribute');
  assert.equal(sandbox.t('settings', 'x'), 'Réglages');
  assert.equal(sandbox.t('missing_key', 'Fallback'), 'Fallback', 't() returns fallback when key missing');
});
