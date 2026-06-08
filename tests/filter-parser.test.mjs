import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilterList, isProceduralCosmetic } from '../src/filter-parser.js';

// The parser is the core engine that turns filter-list text into DNR rules,
// cosmetics, scriptlets and removeparams. These lock its contract.

test('network block rule -> DNR block rule', () => {
  const { rules } = parseFilterList('||ads.example.com^', 5000, 100);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 5000);
  assert.equal(rules[0].action.type, 'block');
  assert.match(rules[0].condition.urlFilter, /ads\.example\.com/);
});

test('bare exception (@@) does not naively emit an allow rule', () => {
  // The parser intentionally drops standalone @@ exceptions rather than emit a
  // broad DNR allow that could over-allow; exceptions are handled out of band.
  const { rules } = parseFilterList('@@||example.com^', 1, 100);
  assert.equal(rules.length, 0);
});

test('global cosmetic selector', () => {
  const { cosmetics } = parseFilterList('##.banner-ad', 1, 100);
  assert.ok(cosmetics.includes('.banner-ad'));
});

test('domain-scoped cosmetic', () => {
  const { domainCosmetics } = parseFilterList('example.com##.sidebar-ad', 1, 100);
  assert.ok(domainCosmetics['example.com']?.includes('.sidebar-ad'));
});

test('scriptlet rule', () => {
  const { scriptletRules } = parseFilterList('example.com##+js(set-constant, adsEnabled, false)', 1, 100);
  const list = scriptletRules['example.com'];
  assert.ok(Array.isArray(list) && list.length === 1);
  assert.equal(list[0].name, 'set-constant');
});

test('removeparam option is parsed', () => {
  const { removeParams } = parseFilterList('||example.com^$removeparam=fbclid', 1, 100);
  const all = [...removeParams.global, ...removeParams.domain.flatMap(d => d.params)];
  assert.ok(all.includes('fbclid'));
});

test('comments and list headers are ignored', () => {
  const { rules, cosmetics } = parseFilterList('[Adblock Plus 2.0]\n! a comment\n', 1, 100);
  assert.equal(rules.length, 0);
  assert.equal(cosmetics.length, 0);
});

test('maxRules cap is respected', () => {
  const text = ['||a.com^', '||b.com^', '||c.com^', '||d.com^'].join('\n');
  const { rules } = parseFilterList(text, 1, 2);
  assert.equal(rules.length, 2);
});

test('startId offsets rule ids sequentially', () => {
  const { rules } = parseFilterList('||a.com^\n||b.com^', 9000, 100);
  assert.equal(rules[0].id, 9000);
  assert.equal(rules[1].id, 9001);
});

test('isProceduralCosmetic detects procedural selectors', () => {
  assert.equal(isProceduralCosmetic('.box:has-text(Sponsored)'), true);
  assert.equal(isProceduralCosmetic('.ad:upward(2)'), true);
  assert.equal(isProceduralCosmetic('.simple-class'), false);
});
