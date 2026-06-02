/**
 * Parser contract tests — src/filter-parser.js
 *
 * The filter parser is the single chokepoint where filter-list text becomes DNR
 * rules, cosmetics, domain cosmetics, scriptlets, and removeparam data. A silent
 * change here (dropping a rule class, mis-keying a domain) is invisible at runtime
 * because the extension just blocks slightly less — these tests pin the contract.
 *
 * Zero dependencies: Node's built-in test runner + assert.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseFilterList, isProceduralSelector, ENGINE_PROCEDURAL_PSEUDOS,
  MAX_COSMETICS, MAX_DOMAIN_COSMETICS, MAX_SCRIPTLETS,
} from '../src/filter-parser.js';

// ── Network (DNR) rules ──────────────────────────────────────────────────────

test('network rule → single block DNR rule with caret stripped', () => {
  const { rules } = parseFilterList('||ads.example.com^', 1000);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 1000);
  assert.equal(rules[0].action.type, 'block');
  assert.equal(rules[0].condition.urlFilter, '||ads.example.com');
  // YouTube playback must never be blocked by a generic network rule.
  assert.deepEqual(rules[0].condition.excludedInitiatorDomains,
    ['youtube.com', 'youtu.be', 'youtube-nocookie.com']);
});

test('network rule options map to the right DNR resourceTypes', () => {
  const { rules } = parseFilterList('||track.example.com^$script,image', 1000);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.resourceTypes, ['script', 'image']);
});

test('DNR rule ids increment sequentially from startId', () => {
  const { rules } = parseFilterList('||a.example.com^\n||b.example.com^\n||c.example.com^', 5000);
  assert.deepEqual(rules.map(r => r.id), [5000, 5001, 5002]);
});

test('maxRules budget is respected (network rules stop at the cap)', () => {
  const text = Array.from({ length: 50 }, (_, i) => `||ad${i}.example.com^`).join('\n');
  const { rules } = parseFilterList(text, 1000, 10);
  assert.equal(rules.length, 10);
});

test('protected playback/CDN domains are never turned into block rules', () => {
  const { rules } = parseFilterList('||youtube.com^\n||googlevideo.com^\n||ytimg.com^', 1000);
  assert.equal(rules.length, 0);
});

test('core Google app domains are protected, but Google ad/tracking domains stay blockable', () => {
  // Regression: apis.google.com / boq.google.com were blocked, which broke Google Drive/Docs.
  const protectedG = parseFilterList('||apis.google.com^\n||accounts.google.com^\n||boq.google.com^', 1000);
  assert.equal(protectedG.rules.length, 0, 'core Google app infra must not be blockable');
  const adsG = parseFilterList('||analytics.google.com^\n||adservice.google.com^', 1000);
  assert.equal(adsG.rules.length, 2, 'Google ad/tracking domains must still be blockable');
});

// ── Cosmetic filters ─────────────────────────────────────────────────────────

test('global cosmetic ##.selector lands in cosmetics', () => {
  const { cosmetics } = parseFilterList('##.ad-banner', 1000);
  assert.deepEqual(cosmetics, ['.ad-banner']);
});

test('domain cosmetic example.com##.sel is keyed by domain', () => {
  const { domainCosmetics } = parseFilterList('example.com##.sponsored', 1000);
  assert.deepEqual(domainCosmetics, { 'example.com': ['.sponsored'] });
});

test('regression: $= attribute selectors survive (not mistaken for a filter option)', () => {
  // `$` after `##` is CSS syntax, not the filter-option separator. A prior bug
  // dropped these. Guard both global and the structurally similar forms.
  const { cosmetics } = parseFilterList('##[class$="-ad"]\n##[src$=".gif"]', 1000);
  assert.ok(cosmetics.includes('[class$="-ad"]'));
  assert.ok(cosmetics.includes('[src$=".gif"]'));
});

test('selectors that are too short or too long are dropped', () => {
  const { cosmetics } = parseFilterList(`##a\n##${'x'.repeat(600)}`, 1000);
  assert.equal(cosmetics.length, 0);
});

// ── Procedural cosmetics — GAP #1: the engine had no input ───────────────────
//
// content-procedural.js implements :has-text/:matches-css/:upward/:xpath, reading
// the selectors straight out of `domainCosmetics`. Before the fix the parser's
// "unsupported pseudo" filter discarded exactly those selectors, so the engine
// ran against an always-empty set — dead on arrival. These tests are the flip:
// they fail on the old parser and pass once procedural rules flow through.

test('procedural cosmetics reach the engine (domain-scoped :has-text/:upward/:xpath/:matches-css)', () => {
  const text = [
    'example.com##.ad:has-text(Sponsored)',
    'example.com##div:upward(2)',
    'example.com##:xpath(//div[@class="ad"])',
    'example.com##.box:matches-css(display: block)',
  ].join('\n');
  const { domainCosmetics } = parseFilterList(text, 1000);
  assert.deepEqual(domainCosmetics['example.com'], [
    '.ad:has-text(Sponsored)',
    'div:upward(2)',
    ':xpath(//div[@class="ad"])',
    '.box:matches-css(display: block)',
  ]);
});

test('global procedural cosmetics are dropped (no global engine; would break insertCSS)', () => {
  const { cosmetics, domainCosmetics } = parseFilterList('##.ad:has-text(Sponsored)', 1000);
  assert.equal(cosmetics.length, 0);
  assert.deepEqual(domainCosmetics, {});
});

test('truly unsupported pseudo/action operators are still dropped', () => {
  const text = [
    'example.com##.x:nth-ancestor(2)',
    'example.com##.x:watch-attr(class)',
    'example.com##.x:matches-css-after(content: ad)',
    'example.com##.x:style(display: none)',
    'example.com##.x:remove()',
    'example.com##.x:matches-path(/shop)',
  ].join('\n');
  const { domainCosmetics } = parseFilterList(text, 1000);
  assert.deepEqual(domainCosmetics, {});
});

test('native CSS :has() is preserved and not misclassified as procedural :has-text', () => {
  const { domainCosmetics } = parseFilterList('example.com##.container:has(> .ad)', 1000);
  assert.deepEqual(domainCosmetics, { 'example.com': ['.container:has(> .ad)'] });
  assert.equal(isProceduralSelector('.container:has(> .ad)'), false);
});

test('isProceduralSelector matches exactly the four engine pseudo-classes', () => {
  for (const m of ENGINE_PROCEDURAL_PSEUDOS) {
    assert.equal(isProceduralSelector(`.x${m}arg)`), true, `should match ${m}`);
  }
  assert.equal(isProceduralSelector('.plain-class'), false);
  assert.equal(isProceduralSelector('.x:hover'), false);
  assert.equal(isProceduralSelector('[data-has-text]'), false);
});

test('parser ENGINE_PROCEDURAL_PSEUDOS stays in sync with the engine PROCEDURAL_MARKERS', () => {
  // If a pseudo is added to one list but not the other, a procedural selector
  // routed to domainCosmetics would be treated as plain CSS and injected — and a
  // single invalid selector invalidates the whole comma-joined rule.
  const proc = readFileSync(fileURLToPath(new URL('../src/content-procedural.js', import.meta.url)), 'utf8');
  const m = proc.match(/PROCEDURAL_MARKERS\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, 'PROCEDURAL_MARKERS not found in content-procedural.js');
  const engineMarkers = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  assert.deepEqual([...ENGINE_PROCEDURAL_PSEUDOS].sort(), engineMarkers.sort());
});

// ── Scriptlets ───────────────────────────────────────────────────────────────

test('scriptlet rule parses name + args and keys by domain', () => {
  const { scriptletRules } = parseFilterList('example.com##+js(set-constant, foo, true)', 1000);
  assert.deepEqual(scriptletRules, { 'example.com': [{ name: 'set-constant', args: ['foo', 'true'] }] });
});

// ── Exceptions / noise ───────────────────────────────────────────────────────

test('exception rules (@@ and #@#) produce nothing', () => {
  const out = parseFilterList('@@||example.com^\nexample.com#@#.foo', 1000);
  assert.equal(out.rules.length, 0);
  assert.equal(out.cosmetics.length, 0);
  assert.deepEqual(out.domainCosmetics, {});
});

test('comments, section headers, and blank lines are ignored', () => {
  const out = parseFilterList('! comment\n[Adblock Plus 2.0]\n\n   \n#! title', 1000);
  assert.equal(out.rules.length, 0);
  assert.equal(out.cosmetics.length, 0);
});

// ── removeparam ──────────────────────────────────────────────────────────────

test('global removeparam is collected into removeParams.global', () => {
  const { removeParams } = parseFilterList('||example.com^$removeparam=utm_source', 1000);
  assert.deepEqual(removeParams.global, ['utm_source']);
  assert.equal(removeParams.domain.length, 0);
});

test('pipe-separated removeparam expands into individual params', () => {
  const { removeParams } = parseFilterList('||x.com^$removeparam=utm_source|utm_medium', 1000);
  assert.deepEqual(removeParams.global.sort(), ['utm_medium', 'utm_source']);
});

test('domain-scoped removeparam carries its initiator domains', () => {
  const { removeParams } = parseFilterList('||example.com^$removeparam=fbclid,domain=test.com', 1000);
  assert.equal(removeParams.domain.length, 1);
  assert.deepEqual(removeParams.domain[0].params, ['fbclid']);
  assert.deepEqual(removeParams.domain[0].initDomains, ['test.com']);
});

// ── Cosmetic budgets ─────────────────────────────────────────────────────────
// Bounded to keep storage.local from overflowing. Domain cosmetics are applied
// uncapped per-page by content-procedural.js, so they carry the larger budget.

test('cosmetic budget constants are sane (domain budget is the largest)', () => {
  assert.ok(MAX_COSMETICS >= 8000, `global cosmetic budget regressed: ${MAX_COSMETICS}`);
  assert.ok(MAX_DOMAIN_COSMETICS >= 15000, `domain cosmetic budget regressed: ${MAX_DOMAIN_COSMETICS}`);
  assert.ok(MAX_DOMAIN_COSMETICS >= MAX_COSMETICS, 'domain budget should be >= global budget');
  assert.ok(MAX_SCRIPTLETS >= 1000);
});

test('global cosmetic budget is enforced', () => {
  const text = Array.from({ length: MAX_COSMETICS + 25 }, (_, i) => `##.ad-${i}`).join('\n');
  const { cosmetics } = parseFilterList(text, 1000);
  assert.equal(cosmetics.length, MAX_COSMETICS);
});

test('domain cosmetic budget is enforced across all domains', () => {
  const text = Array.from({ length: MAX_DOMAIN_COSMETICS + 25 }, (_, i) => `site${i}.com##.ad`).join('\n');
  const { domainCosmetics } = parseFilterList(text, 1000);
  const total = Object.values(domainCosmetics).reduce((s, v) => s + v.length, 0);
  assert.equal(total, MAX_DOMAIN_COSMETICS);
});
