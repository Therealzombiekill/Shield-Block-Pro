#!/usr/bin/env node
/**
 * Factual verification suite for roadmap features.
 * Run: node scripts/test-roadmap.mjs
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseFilterList, isProceduralCosmetic } from '../src/filter-parser.js';
import { finalizeDomainCosmetics, countProceduralInDomainCosmetics } from '../src/cosmetic-utils.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const facts = [];

function assert(name, cond, detail = '') {
  if (cond) {
    facts.push({ name, ok: true, detail });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    facts.push({ name, ok: false, detail });
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ── 1. Procedural parser feeds engine ────────────────────────────────────────
const sampleLines = [
  'sport1.de##strong:has-text(/anzeige/i)',
  '##p:has-text(Ad)',
  'example.com##.banner',
  'news.com##div.item:upward(2)',
  'site.com##a:matches-css(display: block)',
].join('\n');
const parsed = parseFilterList(sampleLines, 9000, 100);
assert('Parser keeps domain :has-text()', parsed.domainCosmetics['sport1.de']?.length === 1);
assert('Parser routes global procedural to *', parsed.domainCosmetics['*']?.length === 1);
assert('Parser keeps plain domain cosmetic', parsed.domainCosmetics['example.com']?.includes('.banner'));
assert('Parser keeps :upward()', isProceduralCosmetic(parsed.domainCosmetics['news.com']?.[0] ?? ''));
assert('Parser keeps :matches-css()', isProceduralCosmetic(parsed.domainCosmetics['site.com']?.[0] ?? ''));

// ── 2. finalizeDomainCosmetics prioritizes procedural under cap ──────────────
const bloated = {
  '*': [
    ...Array.from({ length: 300 }, (_, i) => `.plain-${i}`),
    'div:has-text(/Ad/i)',
    'span:has-text(Sponsored)',
  ],
  'sport1.de': ['strong:has-text(/anzeige/i)', ...Array.from({ length: 400 }, (_, i) => `.x-${i}`)],
};
const capped = finalizeDomainCosmetics(bloated, { globalMax: 50, domainMax: 50 });
assert('Cap keeps procedural on *', capped['*'].filter(isProceduralCosmetic).length === 2, `got ${capped['*'].filter(isProceduralCosmetic).length}`);
assert('Cap keeps procedural on domain', capped['sport1.de'].some(s => s.includes(':has-text(')));
assert('Cap respects max size', capped['*'].length <= 50 && capped['sport1.de'].length <= 50);

// ── 3. Real uBO list sample (network) ────────────────────────────────────────
let uboText = '';
try {
  uboText = await fetch('https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt')
    .then(r => r.ok ? r.text() : '');
} catch (_) {}
if (uboText) {
  const ubo = parseFilterList(uboText, 14500, 300);
  const uboFinal = finalizeDomainCosmetics(ubo.domainCosmetics);
  const procBefore = countProceduralInDomainCosmetics(ubo.domainCosmetics);
  const procAfter  = countProceduralInDomainCosmetics(uboFinal);
  assert('uBO list yields procedural rules', procBefore >= 50, `${procBefore} parsed`);
  assert('finalize preserves procedural rules', procAfter >= Math.min(procBefore, 10), `${procAfter} after cap`);
  facts.push({ name: 'uBO sample stats', ok: true, detail: `dnr=${ubo.rules.length} proc=${procBefore} scriptlets=${Object.values(ubo.scriptletRules).flat().length}` });
  console.log(`  uBO filters.txt: ${ubo.rules.length} DNR, ${procBefore} procedural, ${Object.values(ubo.scriptletRules).flat().length} scriptlets`);
} else {
  console.log('⚠ skipped uBO network sample (offline)');
}

// ── 4. Scriptlet alias coverage (top uBO names) ─────────────────────────────
const scriptSrc = readFileSync(join(root, 'src/scriptlets.js'), 'utf8');
const implNames = new Set([...scriptSrc.matchAll(/^\s+'([^']+)':/gm)].map(m => m[1]));
const aliasNames = new Set([...scriptSrc.matchAll(/IMPL\['([^']+)'\]/g)].map(m => m[1]));
const allScriptlets = new Set([...implNames, ...aliasNames]);
const required = [
  'acs', 'aopr', 'aopw', 'set', 'sc', 'nostif', 'nowoif', 'nosiif', 'aeld',
  'nano-stb', 'nano-sib', 'no-xhr-if', 'prevent-xhr', 'json-prune',
  'json-prune-fetch-response', 'json-prune-xhr-response', 'trusted-replace-xhr-response',
  'rmnt', 'ra', 'nobab', 'nofab', 'aost', 'googletag', 'm3u-prune',
];
for (const name of required) {
  assert(`Scriptlet: ${name}`, allScriptlets.has(name));
}

// ── 5. XHR proxy unified (no duplicate XMLHttpRequest = assignments) ────────
const xhrAssignCount = (scriptSrc.match(/window\.XMLHttpRequest\s*=/g) || []).length;
assert('Single XHR proxy install path', xhrAssignCount === 1, `${xhrAssignCount} assignments`);
assert('ensureXhrProxy present', scriptSrc.includes('ensureXhrProxy'));

// ── 6. Manifest streaming + privacy scripts ──────────────────────────────────
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const cs = manifest.content_scripts ?? [];
const ytMain = cs.some(e => e.js?.includes('src/inject-youtube.js') && e.world === 'MAIN');
const ytIso  = cs.some(e => e.js?.includes('src/content-youtube.js'));
const twitch = cs.some(e => e.js?.includes('src/content-twitch.js'));
const proc   = cs.some(e => e.js?.includes('src/content-procedural.js'));
const privM  = cs.some(e => e.js?.includes('src/inject-privacy.js') && e.world === 'MAIN');
assert('Manifest: inject-youtube MAIN', ytMain);
assert('Manifest: content-youtube', ytIso);
assert('Manifest: content-twitch', twitch);
assert('Manifest: content-procedural', proc);
assert('Manifest: inject-privacy MAIN', privM);

// ── 7. Static compile script exists ──────────────────────────────────────────
assert('compile-static-rules.mjs exists', readFileSync(join(root, 'scripts/compile-static-rules.mjs'), 'utf8').includes('parseFilterList'));

// ── 8. content-procedural refreshes on storage change ───────────────────────
const procSrc = readFileSync(join(root, 'src/content-procedural.js'), 'utf8');
const bgSrc   = readFileSync(join(root, 'src/background.js'), 'utf8');
assert('Procedural: listens for domainCosmetics changes', procSrc.includes('changes.domainCosmetics'));
assert('Procedural: rebuildSelectorLists on sync', procSrc.includes('rebuildSelectorLists'));
assert('Background: cosmetic cache invalidation on parser upgrade', bgSrc.includes('COSMETIC_PARSER_VERSION'));
assert('Background: incremental writeCosmeticProgress during sync', bgSrc.includes('writeCosmeticProgress'));
assert('Background: GET_PROCEDURAL_COUNT message', bgSrc.includes('GET_PROCEDURAL_COUNT'));

console.log('\n── Summary ──');
console.log(`Passed: ${facts.filter(f => f.ok).length}/${facts.length + failed} checks`);
if (failed) {
  console.error(`FAILED: ${failed}`);
  process.exit(1);
}
console.log('All roadmap verification checks passed.');
