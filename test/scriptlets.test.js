/**
 * Scriptlet dispatch — src/scriptlets.js
 *
 * Anti-adblock/annoyance scriptlets are looked up by name from filter rules. Two
 * silent-failure traps this guards:
 *   - filter rules often write the name WITH a ".js" suffix (set-constant.js) —
 *     it must still resolve, or the rule does nothing.
 *   - uBO short aliases (nostif, nowoif, set, rc, ra…) must map to an impl.
 * The real shipping file is executed in a vm with a minimal page sandbox.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CODE = readFileSync(fileURLToPath(new URL('../src/scriptlets.js', import.meta.url)), 'utf8');

function load(overrides = {}) {
  const sandbox = Object.assign({
    window: {},
    document: { documentElement: {}, querySelectorAll: () => [] },
    location: { hostname: 'example.com' },
    MutationObserver: function () { this.observe = () => {}; },
    console: { log() {}, warn() {}, error() {} },
  }, overrides);
  sandbox.globalThis = sandbox;
  vm.runInNewContext(CODE, sandbox);
  return sandbox;
}

test('exposes __sbRunScriptlets and ignores non-array input', () => {
  const sb = load();
  assert.equal(typeof sb.__sbRunScriptlets, 'function');
  assert.doesNotThrow(() => sb.__sbRunScriptlets(null));
});

test('.js suffix on a scriptlet name still resolves to the implementation', () => {
  const sb = load();
  sb.__sbRunScriptlets([{ name: 'set-constant.js', args: ['adBlockDetected', 'false'] }]);
  assert.equal(sb.window.adBlockDetected, false);
});

test('alias "set" maps to set-constant (incl. nested paths)', () => {
  const sb = load();
  sb.__sbRunScriptlets([{ name: 'set', args: ['foo.bar', 'true'] }]);
  assert.equal(sb.window.foo.bar, true);
});

test('alias "nostif" maps to prevent-setTimeout and matches by source', () => {
  const sb = load();
  sb.window.setTimeout = function orig() { return 'ORIG'; };
  sb.__sbRunScriptlets([{ name: 'nostif', args: ['blockme'] }]);
  assert.equal(sb.window.setTimeout(function () { /* blockme */ }, 0), 0, 'matching timer is blocked');
  assert.equal(sb.window.setTimeout(function () { return 1; }, 0), 'ORIG', 'non-matching timer passes through');
});

test('remove-attr (and alias "ra") strips the listed attributes from matches', () => {
  const removed = [];
  const el = { removeAttribute: (a) => removed.push(a) };
  const sb = load({ document: { documentElement: {}, querySelectorAll: (sel) => (sel === '.ad' ? [el] : []) } });
  sb.__sbRunScriptlets([{ name: 'ra', args: ['onclick|data-ad', '.ad'] }]);
  assert.deepEqual(removed, ['onclick', 'data-ad']);
});

test('an unknown scriptlet name is a safe no-op (never throws)', () => {
  const sb = load();
  assert.doesNotThrow(() => sb.__sbRunScriptlets([{ name: 'totally-unknown-scriptlet', args: [] }]));
});

test('scriptlets never run on YouTube (player-safety guard)', () => {
  const sb = load({ location: { hostname: 'www.youtube.com' } });
  sb.__sbRunScriptlets([{ name: 'set-constant', args: ['x', 'true'] }]);
  assert.equal(sb.window.x, undefined);
});
