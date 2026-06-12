#!/usr/bin/env node
/**
 * Parser regression tests — IDN/punycode handling, non-ASCII DNR safety,
 * and uBO scriptlet-argument escaping.
 *
 * These guard the ASCII/IDN invariant documented in CLAUDE.md: Chrome DNR
 * rejects non-ASCII urlFilters and updateDynamicRules is atomic per batch,
 * so a single bad rule silently kills up to 500 good ones.
 *
 * Run: node scripts/test-parser.mjs   (also wired into CI)
 */
import { parseFilterList } from '../src/filter-parser.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`✓ ${name}`); }
  else      { failed++; console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const ASCII = /^[\x00-\x7F]*$/;

// ── Scriptlet argument escaping ──────────────────────────────────────────────
{
  const r = parseFilterList(String.raw`example.com##+js(trusted-set-cookie, consent, ok\,sure)`, 20000, 100);
  const args = r.scriptletRules['example.com']?.[0]?.args;
  check('scriptlet: \\, escape preserved as literal comma',
    Array.isArray(args) && args[0] === 'consent' && args[1] === 'ok,sure',
    JSON.stringify(args));
}
{
  const r = parseFilterList(String.raw`other.com##+js(aopr, foo\x2cbar)`, 20000, 100);
  const args = r.scriptletRules['other.com']?.[0]?.args;
  check('scriptlet: \\x2c escape preserved as literal comma',
    Array.isArray(args) && args[0] === 'foo,bar', JSON.stringify(args));
}
{
  const r = parseFilterList(`plain.com##+js(set, flag, false)`, 20000, 100);
  const args = r.scriptletRules['plain.com']?.[0]?.args;
  check('scriptlet: unescaped args still split on commas',
    Array.isArray(args) && args.length === 2 && args[0] === 'flag' && args[1] === 'false',
    JSON.stringify(args));
}

// ── IDN → punycode for DOM-side rules ────────────────────────────────────────
{
  const r = parseFilterList(`пример.рф##.ad`, 20000, 100);
  check('cosmetic: IDN domain keyed as punycode',
    Array.isArray(r.domainCosmetics['xn--e1afmkfd.xn--p1ai']), JSON.stringify(Object.keys(r.domainCosmetics)));
}
{
  const r = parseFilterList(`a.com,пример.рф##.promo`, 20000, 100);
  check('cosmetic: multi-domain fan-out converts each IDN',
    Array.isArray(r.domainCosmetics['a.com']) && Array.isArray(r.domainCosmetics['xn--e1afmkfd.xn--p1ai']),
    JSON.stringify(Object.keys(r.domainCosmetics)));
}
{
  const r = parseFilterList(`пример.рф##+js(nostif, 1000)`, 20000, 100);
  check('scriptlet: IDN domain keyed as punycode',
    Array.isArray(r.scriptletRules['xn--e1afmkfd.xn--p1ai']), JSON.stringify(Object.keys(r.scriptletRules)));
}

// ── IDN / non-ASCII network rules ────────────────────────────────────────────
{
  const r = parseFilterList(`||пример.рф^`, 20000, 100);
  check('network: pure ||idn^ converts to punycode urlFilter',
    r.rules.length === 1 && r.rules[0].condition.urlFilter.includes('xn--e1afmkfd.xn--p1ai'),
    JSON.stringify(r.rules.map(x => x.condition.urlFilter)));
}
{
  const r = parseFilterList(`||пример.рф/баннер/`, 20000, 100);
  check('network: IDN host + unicode path is dropped', r.rules.length === 0,
    `${r.rules.length} rules emitted`);
}
{
  const r = parseFilterList(`/реклама-баннер/`, 20000, 100);
  check('network: generic unicode substring pattern is dropped', r.rules.length === 0,
    `${r.rules.length} rules emitted`);
}
{
  const r = parseFilterList(`||ads.example.com^$script,domain=пример.рф`, 20000, 100);
  const init = r.rules[0]?.condition?.initiatorDomains;
  check('network: $domain= IDN initiator converts to punycode',
    Array.isArray(init) && init[0] === 'xn--e1afmkfd.xn--p1ai', JSON.stringify(init));
}

// ── Controls: ASCII behavior unchanged ───────────────────────────────────────
{
  const r = parseFilterList(`||doubleclick.net^`, 20000, 100);
  check('control: plain block rule still emitted',
    r.rules.length === 1 && r.rules[0].action.type === 'block',
    JSON.stringify(r.rules));
}
{
  const r = parseFilterList(`@@||needed-cdn.com^$script`, 20000, 100);
  check('control: exception compiles to allow',
    r.rules.length === 1 && r.rules[0].action.type === 'allow',
    JSON.stringify(r.rules.map(x => x.action)));
}
{
  const mixed = [
    `||пример.рф^`, `пример.рф##.ad`, `/реклама/`, `||ads.test^$domain=пример.рф`,
    `||tracker.net^`, `##.banner-ad`, `site.io##+js(aopr, ads\\,x)`,
  ].join('\n');
  const r = parseFilterList(mixed, 20000, 100);
  const allAscii = r.rules.every(x => ASCII.test(JSON.stringify(x.condition)));
  check('invariant: every emitted DNR condition is pure ASCII', allAscii,
    JSON.stringify(r.rules.map(x => x.condition)));
}

console.log(`\n── Summary ──\nPassed: ${passed}/${passed + failed} parser checks`);
if (failed) { console.error('PARSER CHECKS FAILED'); process.exit(1); }
console.log('All parser checks passed.');
