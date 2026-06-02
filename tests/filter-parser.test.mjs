/**
 * Contract tests for src/filter-parser.js — the conversion shared by the runtime
 * sync path AND the static-ruleset generator. A regression here silently breaks
 * blocking, so these lock the output shapes in place.
 *
 * Zero dependencies — Node's built-in test runner. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilterList } from '../src/filter-parser.js';

test('network rule: ||domain^ becomes a block DNR rule', () => {
  const { rules } = parseFilterList('||ads.example.com^');
  assert.equal(rules.length, 1);
  const r = rules[0];
  assert.equal(r.action.type, 'block');
  assert.equal(r.condition.urlFilter, '||ads.example.com');
  assert.ok(Array.isArray(r.condition.resourceTypes) && r.condition.resourceTypes.length);
  assert.ok(Number.isInteger(r.id) && r.id >= 1);
});

test('exception (@@) rules are skipped', () => {
  const { rules } = parseFilterList('@@||example.com^');
  assert.equal(rules.length, 0);
});

test('protected domains (e.g. youtube) are never blocked', () => {
  const { rules } = parseFilterList('||youtube.com^\n||googlevideo.com^');
  assert.equal(rules.length, 0);
});

test('comments and section headers are ignored', () => {
  const { rules, cosmetics } = parseFilterList('! a comment\n[Adblock Plus 2.0]\n#! title');
  assert.equal(rules.length, 0);
  assert.equal(cosmetics.length, 0);
});

test('global cosmetic ##.selector', () => {
  const { cosmetics } = parseFilterList('##.banner-ad');
  assert.deepEqual(cosmetics, ['.banner-ad']);
});

test('domain cosmetic site.com##.selector', () => {
  const { domainCosmetics } = parseFilterList('example.com##.sponsored');
  assert.deepEqual(domainCosmetics['example.com'], ['.sponsored']);
});

test('scriptlet ##+js(name, args)', () => {
  const { scriptletRules } = parseFilterList('example.com##+js(set-constant, adblock, true)');
  assert.deepEqual(scriptletRules['example.com'], [{ name: 'set-constant', args: ['adblock', 'true'] }]);
});

test('removeparam on a network rule lands in removeParams.global', () => {
  const { removeParams } = parseFilterList('||example.com^$removeparam=fbclid');
  assert.ok(removeParams.global.includes('fbclid'));
});

test('CSS attribute selectors with $= are NOT mistaken for filter options', () => {
  // Regression guard: ##[class$="-ad"] must parse as a cosmetic, not be dropped.
  const { cosmetics } = parseFilterList('##[class$="-ad"]');
  assert.deepEqual(cosmetics, ['[class$="-ad"]']);
});

test('maxRules caps the number of DNR rules', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `||ad${i}.example.com^`).join('\n');
  const { rules } = parseFilterList(lines, 1, 10);
  assert.equal(rules.length, 10);
});

test('IDs are contiguous from startId', () => {
  const { rules } = parseFilterList('||a-domain.com^\n||b-domain.com^\n||c-domain.com^', 500);
  assert.deepEqual(rules.map(r => r.id), [500, 501, 502]);
});

// ── KNOWN GAP (documented, not yet fixed) ────────────────────────────────────
// Procedural cosmetics (:has-text/:upward/:xpath/:matches-css) are dropped by the
// parser, so src/content-procedural.js — which is built to apply them — never
// receives any from filter lists. When that gap is fixed, flip this expectation.
test('KNOWN GAP: procedural cosmetics are currently dropped', () => {
  const { domainCosmetics, cosmetics } = parseFilterList('example.com##.box:has-text(Sponsored)');
  assert.equal(Object.keys(domainCosmetics).length, 0,
    'procedural rule unexpectedly stored — if you fixed the gap, update this test');
  assert.equal(cosmetics.length, 0);
});
