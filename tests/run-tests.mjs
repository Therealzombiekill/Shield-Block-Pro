/**
 * ShieldBlock Pro — pure-logic regression tests
 *
 * Standalone, dependency-free. Run with:  node tests/run-tests.mjs
 * (No package.json / build step — this only exercises the parser and the
 *  shared trusted-sites / cosmetic-utils helpers, which are pure ES modules.)
 *
 * Exits non-zero on any failure so it can gate a release or CI step.
 */

import { parseFilterList, isProceduralCosmetic } from '../src/filter-parser.js';
import {
  isDomainProtected, isSafeBrowsingAllowlisted, shouldSkipPrivacyUrlClean, hostMatchesSet,
  PROTECTED_DOMAINS,
} from '../src/trusted-sites.js';
import {
  finalizeDomainCosmetics, finalizeScriptletRules, countProceduralInDomainCosmetics,
} from '../src/cosmetic-utils.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readJson = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

let passed = 0, failed = 0;
const fails = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; fails.push(name); }
}
function eq(actual, expected, name) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
     `${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

const P = (text, max = 200) => parseFilterList(text, 10000, max);

// ── filter-parser: network (DNR) rules ──────────────────────────────────────
{
  const r = P('||ads.example.com^');
  eq(r.rules.length, 1, 'basic network rule count');
  const rule = r.rules[0];
  eq(rule.id, 10000, 'rule id = startId');
  eq(rule.priority, 2, 'rule priority = 2');
  eq(rule.action.type, 'block', 'rule action = block');
  eq(rule.condition.urlFilter, '||ads.example.com', 'urlFilter strips ^');
  ok(rule.condition.excludedInitiatorDomains.includes('youtube.com'), 'YouTube excluded as initiator');
}
{
  const r = P('||t.com^$third-party,script');
  eq(r.rules[0].condition.domainType, 'thirdParty', '$third-party => domainType thirdParty');
  eq(r.rules[0].condition.resourceTypes, ['script'], '$script => resourceTypes [script]');
}
{
  const r = P('||x.com^$~script');
  ok(!r.rules[0].condition.resourceTypes.includes('script'), '$~script excludes script');
  ok(r.rules[0].condition.resourceTypes.length === 8, '$~script keeps the other 8 default types');
}
{
  const r = P('||x.com^$domain=a.com|~b.com');
  ok(r.rules[0].condition.initiatorDomains?.includes('a.com'), 'domain= => initiatorDomains');
  ok(r.rules[0].condition.excludedInitiatorDomains.includes('b.com'), '~domain => excludedInitiatorDomains');
}
{ eq(P('||a^').rules.length, 0, 'too-short filter (<4 bare) rejected'); }
{ eq(P('@@||good.com^').rules.length, 0, 'exception (@@) rule produces no block'); }
{ eq(P('! a comment').rules.length, 0, 'comment line ignored'); }
{ eq(P('[Adblock Plus 2.0]').rules.length, 0, 'adblock header ignored'); }
{ eq(P('||youtube.com^').rules.length, 0, 'protected domain not blocked'); }
{ eq(P('||ads.youtube.com^').rules.length, 0, 'subdomain of protected domain not blocked'); }
{ eq(P('||x.com^$redirect=noopjs').rules.length, 0, '$redirect option skipped'); }
{ eq(P('||x.com^$csp=script-src none').rules.length, 0, '$csp option skipped'); }
{ eq(P('||x.com^$image,domain=cspire.com').rules.length, 1, 'csp substring in domain= does NOT drop a valid rule'); }

// ── filter-parser: cosmetics & scriptlets ───────────────────────────────────
{ eq(P('##.ad-banner').cosmetics, ['.ad-banner'], 'global cosmetic'); }
{
  const r = P('example.com##.sponsored');
  eq(r.domainCosmetics, { 'example.com': ['.sponsored'] }, 'domain cosmetic');
}
{
  // $= / ^= CSS attribute selectors must NOT be treated as filter options
  const r = P('##[class$="-ad"]');
  eq(r.cosmetics, ['[class$="-ad"]'], 'CSS $= attribute selector kept as cosmetic');
}
{ eq(P('a.com,b.com##.x').domainCosmetics, {}, 'multi-domain cosmetic skipped'); }
{ eq(P('example.com#@#.foo').domainCosmetics, {}, 'exception cosmetic (#@#) skipped'); }
{
  const r = P('site.com##+js(set-constant, foo, true)');
  eq(r.scriptletRules, { 'site.com': [{ name: 'set-constant', args: ['foo', 'true'] }] }, 'scriptlet parse');
}
{
  // global procedural cosmetics route to domainCosmetics['*'] for content-procedural.js
  const r = P('##:has-text(Sponsored)');
  eq(r.domainCosmetics, { '*': [':has-text(Sponsored)'] }, 'global procedural => domainCosmetics[*]');
  eq(r.cosmetics, [], 'global procedural is NOT a plain cosmetic');
}
{
  ok(isProceduralCosmetic(':has-text(x)'), 'isProceduralCosmetic true for :has-text');
  ok(!isProceduralCosmetic('.plain'), 'isProceduralCosmetic false for plain selector');
}

// ── filter-parser: removeparam ──────────────────────────────────────────────
{ eq(P('||x.com^$removeparam=utm_source').removeParams.global, ['utm_source'], 'global removeparam'); }
{ eq(P('$removeparam=a|b').removeParams.global.sort(), ['a', 'b'], 'pattern-less removeparam captured + piped split'); }
{ eq(P('*$removeparam=fbclid').removeParams.global, ['fbclid'], 'wildcard (*) global removeparam captured'); }
{ eq(P('$third-party').rules.length, 0, 'option-only non-removeparam line still rejected (no rule)'); }
{ eq(P('$third-party').removeParams.global, [], 'option-only non-removeparam yields no removeparam'); }
{ eq(P('||x.com^$removeparam=/regex/').removeParams.global, [], 'regex removeparam skipped'); }
{
  const r = P('||x.com^$removeparam=ref,domain=amazon.com');
  ok(r.removeParams.domain.length === 1 && r.removeParams.domain[0].initDomains.includes('amazon.com'),
     'domain-scoped removeparam captured');
}

// ── filter-parser: caps ─────────────────────────────────────────────────────
{
  const many = Array.from({ length: 50 }, (_, i) => `||ad${i}.example.com^`).join('\n');
  eq(parseFilterList(many, 10000, 10).rules.length, 10, 'maxRules cap honoured');
}

// ── trusted-sites ───────────────────────────────────────────────────────────
{ ok(isDomainProtected('||youtube.com^'), 'isDomainProtected youtube'); }
{ ok(isDomainProtected('||sub.googlevideo.com/path'), 'isDomainProtected parent match'); }
{ ok(!isDomainProtected('||evil-ads.com^'), 'isDomainProtected false for unknown'); }
{ ok(isSafeBrowsingAllowlisted('github.com'), 'SB allowlist github apex'); }
{ ok(isSafeBrowsingAllowlisted('gist.github.com'), 'SB allowlist github subdomain'); }
{ ok(!isSafeBrowsingAllowlisted('totally-evil.test'), 'SB allowlist false for unknown'); }
{ ok(shouldSkipPrivacyUrlClean('docs.google.com'), 'skip url-clean on docs.google.com'); }
{ ok(!shouldSkipPrivacyUrlClean('example.com'), 'do not skip url-clean on example.com'); }
{ ok(hostMatchesSet('www.github.com', PROTECTED_DOMAINS), 'hostMatchesSet strips www + matches'); }
{ ok(!hostMatchesSet('', PROTECTED_DOMAINS), 'hostMatchesSet handles empty host'); }

// ── cosmetic-utils ──────────────────────────────────────────────────────────
{
  const out = finalizeDomainCosmetics({ 'x.com': ['.a', '.a', '.b'] });
  eq(out['x.com'], ['.a', '.b'], 'finalizeDomainCosmetics dedupes');
}
{
  const out = finalizeDomainCosmetics({ 'x.com': ['.plain', ':has-text(ad)'] });
  eq(out['x.com'][0], ':has-text(ad)', 'finalizeDomainCosmetics keeps procedural first');
}
{
  const big = { 'x.com': Array.from({ length: 500 }, (_, i) => `.c${i}`) };
  ok(finalizeDomainCosmetics(big, { domainMax: 350 })['x.com'].length === 350, 'finalizeDomainCosmetics caps per-domain');
}
{
  const out = finalizeScriptletRules({ 'x.com': [
    { name: 'noop', args: ['a'] }, { name: 'noop', args: ['a'] }, { name: 'noop', args: ['b'] },
  ] });
  eq(out['x.com'].length, 2, 'finalizeScriptletRules dedupes by name+args');
}
{
  eq(countProceduralInDomainCosmetics({ a: [':has-text(x)', '.p'], b: [':upward(2)'] }), 2,
     'countProceduralInDomainCosmetics counts procedural selectors');
}

// ── static bundled rules: ID-range invariants ───────────────────────────────
// CLAUDE.md: all DNR rules share one integer ID namespace and "collisions cause
// silent rule drops". Static rules are reserved 1-9999; the dynamic filter band
// starts at 10000. Codify those invariants so a future rules edit can't regress them.
{
  const manifest = readJson('../manifest.json');
  const war = new Set((manifest.web_accessible_resources ?? []).flatMap(e => e.resources ?? []));
  const files = ['base.json', 'extended.json', 'hosts.json', 'tracking.json'];
  const across = new Map();
  let dupWithin = 0, dupAcross = 0, overBand = 0, structBad = 0, badRedirect = 0, total = 0;
  for (const f of files) {
    const rules = readJson('../rules/' + f);
    const within = new Set();
    for (const r of rules) {
      total++;
      if (within.has(r.id)) dupWithin++; else within.add(r.id);
      if (across.has(r.id)) dupAcross++; else across.set(r.id, f);
      if (!(Number.isInteger(r.id) && r.id >= 1 && r.id <= 9999)) overBand++;
      if (!r.action?.type || !r.condition) structBad++;
      const ep = r.action?.type === 'redirect' && r.action.redirect?.extensionPath;
      if (ep && !war.has(ep.replace(/^\//, ''))) badRedirect++;
    }
  }
  ok(total > 1000, `static rule files load (${total} rules)`);
  eq(dupWithin, 0, 'no duplicate static rule IDs within any file');
  eq(dupAcross, 0, 'no duplicate static rule IDs across files (shared ID namespace)');
  eq(overBand, 0, 'all static rule IDs within the reserved 1-9999 band (no dynamic-band collision)');
  eq(structBad, 0, 'all static rules have action.type + condition');
  eq(badRedirect, 0, 'all static redirect extensionPath targets are web-accessible');
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\nShieldBlock Pro tests: ${passed} passed, ${failed} failed`);
if (failed) { console.error('FAILURES:\n  - ' + fails.join('\n  - ')); process.exit(1); }
console.log('All pure-logic tests passed.');
