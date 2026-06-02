/**
 * Procedural cosmetic engine — src/procedural-engine.js
 *
 * Runs the real shipping engine in a vm and drives it against a mock DOM adapter.
 * Proves the operators resolve correctly AND that they CHAIN left-to-right
 * (the previous single-op engine applied only the first op, so a rule like
 * `.item:has-text(x):upward(2)` removed the wrong element).
 */
import { test } from 'node:test';
// Loose assert (not /strict): the engine runs in a vm, so the objects/arrays it
// returns belong to a different realm and deepStrictEqual would reject them purely
// on prototype identity. Loose deepEqual compares structure, which is what we want.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const code = readFileSync(fileURLToPath(new URL('../src/procedural-engine.js', import.meta.url)), 'utf8');
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
const P = sandbox.__sbProc;

// Mock DOM adapter — nodes are plain objects; queryAll returns fixtures by selector.
function ctx(fixtures) {
  return {
    queryAll: (sel) => fixtures[sel] || [],
    getText:  (el) => el.text || '',
    getStyle: (el, prop) => (el.style || {})[prop] || '',
    attrs:    (el) => el.attrs || [],
    parent:   (el) => el.parent || null,
    closest:  (el, sel) => { let n = el; while (n) { if ((n.matchSel || []).includes(sel)) return n; n = n.parent; } return null; },
    xpath:    () => [],
  };
}

test('parse splits prefix and ordered ops with balanced parens', () => {
  assert.deepEqual(P.parse('.ad:has-text(Sponsored):upward(2)'),
    { prefix: '.ad', ops: [{ name: 'has-text', arg: 'Sponsored' }, { name: 'upward', arg: '2' }] });
  assert.deepEqual(P.parse('.x:xpath(//div[contains(@class,"ad")])'),
    { prefix: '.x', ops: [{ name: 'xpath', arg: '//div[contains(@class,"ad")]' }] });
});

test('isProcedural true only for engine pseudos (native :has stays plain CSS)', () => {
  assert.equal(P.isProcedural('.a:has-text(x)'), true);
  assert.equal(P.isProcedural('.a:matches-attr(data-x)'), true);
  assert.equal(P.isProcedural('.a:has(.b)'), false);
  assert.equal(P.isProcedural('.plain'), false);
});

test(':has-text filters by text', () => {
  const a = { text: 'Buy now — Sponsored' }, b = { text: 'real content' };
  assert.deepEqual(P.evaluate('.item:has-text(Sponsored)', ctx({ '.item': [a, b] })), [a]);
});

test(':min-text-length filters by text length', () => {
  const short = { text: 'hi' }, long = { text: 'x'.repeat(60) };
  assert.deepEqual(P.evaluate('.c:min-text-length(50)', ctx({ '.c': [short, long] })), [long]);
});

test(':matches-attr matches attribute name and optional value', () => {
  const m = { attrs: [{ name: 'data-ad-id', value: '123' }] };
  const n = { attrs: [{ name: 'class', value: 'x' }] };
  assert.deepEqual(P.evaluate('div:matches-attr(data-ad-id)', ctx({ div: [m, n] })), [m]);
  assert.deepEqual(P.evaluate('div:matches-attr(data-ad-id=123)', ctx({ div: [m, n] })), [m]);
  assert.deepEqual(P.evaluate('div:matches-attr(data-ad-id=999)', ctx({ div: [m, n] })), []);
});

test(':upward(n) climbs ancestors; :upward(selector) finds closest', () => {
  const grand = {}, parent = { parent: grand }, child = { parent };
  assert.deepEqual(P.evaluate('.label:upward(2)', ctx({ '.label': [child] })), [grand]);
  const card = { matchSel: ['.card'] }, mid = { parent: card }, leaf = { parent: mid };
  assert.deepEqual(P.evaluate('.label:upward(.card)', ctx({ '.label': [leaf] })), [card]);
});

test('operators CHAIN left-to-right (has-text then upward removes the ancestor)', () => {
  const container = {}, inner = { parent: container, text: 'Sponsored post' };
  assert.deepEqual(P.evaluate('.item:has-text(Sponsored):upward(1)', ctx({ '.item': [inner] })), [container]);
  // a non-matching subtree yields nothing
  const c2 = {}, inner2 = { parent: c2, text: 'genuine' };
  assert.deepEqual(P.evaluate('.item:has-text(Sponsored):upward(1)', ctx({ '.item': [inner2] })), []);
});

test('non-procedural or unknown-op selectors resolve to nothing (never over-remove)', () => {
  assert.deepEqual(P.evaluate('.x:has(.y)', ctx({ '.x': [{}] })), []); // native :has → not procedural
  assert.deepEqual(P.evaluate('.plain', ctx({ '.plain': [{}] })), []);
});
