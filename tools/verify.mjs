#!/usr/bin/env node
// ShieldBlock Pro — static stability verification harness.
//
// No dependencies, no build step. Run from anywhere:
//   node tools/verify.mjs
//
// Checks the invariants that, if broken, silently disable blocking or crash the
// service worker: JS syntax, JSON validity, the full DNR ID-range map (all pools
// disjoint), static rule-file ID uniqueness/range, manifest file references, the
// browser-compat ordering rule, and the DNR rule-sanitizer behavior.
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let problems = 0;
const fail = (m) => { console.log('  ✗ ' + m); problems++; };
const ok   = (m) => console.log('  ✓ ' + m);
const head = (m) => console.log('\n=== ' + m + ' ===');
const R = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── 1. JS syntax ───────────────────────────────────────────────────────────
head('JS syntax (node --check)');
const jsFiles = execSync(`find "${ROOT}" -name '*.js' -not -path '*/.git/*'`).toString().trim().split('\n');
let synFail = 0;
for (const f of jsFiles) {
  try { execSync(`node --check "${f}"`, { stdio: 'pipe' }); }
  catch (e) { fail(`syntax: ${f}\n${e.stderr?.toString().split('\n').slice(0,2).join('\n')}`); synFail++; }
}
if (!synFail) ok(`${jsFiles.length} JS files parse`);

// ── 2. JSON validity ─────────────────────────────────────────────────────────
head('JSON validity');
const jsonFiles = ['manifest.json','rules/base.json','rules/extended.json','rules/hosts.json','rules/tracking.json','src/filter-catalog.json'];
const parsed = {};
for (const f of jsonFiles) {
  try { parsed[f] = JSON.parse(R(f)); ok(f); } catch (e) { fail(`${f}: ${e.message}`); }
}

// ── 3. DNR ID range map — full disjointness ────────────────────────────────
head('DNR ID range disjointness (all pools)');
const bg = R('src/background.js');
const num = (name) => { const m = bg.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`)); return m ? +m[1] : null; };
const C = {
  REMOVEPARAM_BASE: num('REMOVEPARAM_BASE'), MATRIX_BASE: num('MATRIX_BASE'),
  USER_DNR_BASE: num('USER_DNR_BASE'), USER_DNR_END: num('USER_DNR_END'),
  WHITELIST_BASE: num('WHITELIST_BASE'), PAUSE_ALL_RULE_ID: num('PAUSE_ALL_RULE_ID'),
  REFERRER_RULE_ID: num('REFERRER_RULE_ID'), HTTPS_UPGRADE_ID: num('HTTPS_UPGRADE_ID'), DNT_GPC_RULE_ID: num('DNT_GPC_RULE_ID'),
};
const flRe = /\{\s*name:\s*['"]([^'"]+)['"][^}]*?max:\s*(\d+),\s*start:\s*(\d+)/g;
let m, lists = [];
while ((m = flRe.exec(bg))) lists.push([+m[3], +m[3] + +m[2] - 1, 'list:' + m[1]]);
const ranges = [
  [1, 9999, 'static-bundled'],
  ...lists,
  [C.REMOVEPARAM_BASE, C.REMOVEPARAM_BASE + 999, 'removeparam'],
  [C.MATRIX_BASE, C.MATRIX_BASE + 999, 'matrix'],
  [C.USER_DNR_BASE, C.USER_DNR_END, 'user-dnr'],
  [C.REFERRER_RULE_ID, C.REFERRER_RULE_ID, 'referrer'],
  [C.HTTPS_UPGRADE_ID, C.HTTPS_UPGRADE_ID, 'https-upgrade'],
  [C.DNT_GPC_RULE_ID, C.DNT_GPC_RULE_ID, 'dnt-gpc'],
  [C.WHITELIST_BASE, C.PAUSE_ALL_RULE_ID - 1, 'whitelist'],
  [C.PAUSE_ALL_RULE_ID, C.PAUSE_ALL_RULE_ID, 'pause-all'],
];
let overlaps = 0;
for (let i = 0; i < ranges.length; i++)
  for (let j = i + 1; j < ranges.length; j++)
    if (ranges[i][0] <= ranges[j][1] && ranges[j][0] <= ranges[i][1]) {
      fail(`overlap: ${ranges[i][2]} [${ranges[i][0]}-${ranges[i][1]}] vs ${ranges[j][2]} [${ranges[j][0]}-${ranges[j][1]}]`);
      overlaps++;
    }
if (!overlaps) ok(`${ranges.length} ID pools all disjoint`);
const sumMax = lists.reduce((a, l) => a + (l[1] - l[0] + 1), 0);
ok(`filter-list slot sum = ${sumMax} (must stay < 5000 hard cap)`);
if (sumMax > 5000) fail('filter-list slot sum exceeds 5000 hard cap');

// ── 4. Static bundled rules — IDs unique 1..9999 + structurally valid ──────
head('Static bundled rule files');
const allStaticIds = new Map();
for (const f of ['rules/base.json','rules/extended.json','rules/hosts.json','rules/tracking.json']) {
  const arr = parsed[f];
  if (!Array.isArray(arr)) { fail(`${f}: not an array`); continue; }
  let bad = 0;
  for (const r of arr) {
    if (!Number.isInteger(r.id) || r.id < 1 || r.id > 9999) { bad++; if (bad<=3) fail(`${f}: id out of 1..9999: ${r.id}`); }
    if (allStaticIds.has(r.id)) fail(`${f}: duplicate static id ${r.id} (also in ${allStaticIds.get(r.id)})`);
    else allStaticIds.set(r.id, f);
    if (!r.action?.type || !r.condition) { bad++; if (bad<=3) fail(`${f}: rule ${r.id} missing action/condition`); }
  }
  if (!bad) ok(`${f}: ${arr.length} rules, ids valid & unique`);
}
ok(`${allStaticIds.size} static rule IDs unique across all 4 files`);

// ── 5. Manifest references exist + browser-compat ordering ────────────────────
head('Manifest references');
const mani = parsed['manifest.json'];
const refs = new Set();
for (const cs of mani.content_scripts ?? []) (cs.js ?? []).forEach(j => refs.add(j));
(mani.web_accessible_resources ?? []).forEach(w => (w.resources ?? []).forEach(r => { if (!r.includes('*')) refs.add(r); }));
for (const r of mani.declarative_net_request?.rule_resources ?? []) refs.add(r.path);
if (mani.background?.service_worker) refs.add(mani.background.service_worker);
for (const ic of Object.values(mani.icons ?? {})) refs.add(ic);
let missing = 0;
for (const r of refs) if (!existsSync(join(ROOT, r))) { fail(`missing file referenced by manifest: ${r}`); missing++; }
if (!missing) ok(`${refs.size} referenced files all present`);
let compatOk = true;
for (const cs of mani.content_scripts ?? []) {
  if (cs.world === 'MAIN') continue;
  if ((cs.js ?? [])[0] !== 'src/browser-compat.js') { fail(`content_scripts [${(cs.js||[]).join(',')}] must start with browser-compat.js`); compatOk = false; }
}
if (compatOk) ok('browser-compat.js is first in every ISOLATED content-script entry');

// ── 6. DNR rule sanitizer behavior ──────────────────────────────────────────
head('sanitizeDnrRule / isValidDnrDomain');
const { sanitizeDnrRule, isValidDnrDomain, parseFilterList } = await import(join(ROOT, 'src/filter-parser.js'));
const T = (name, cond) => { try { cond() ? ok(name) : fail(name); } catch (e) { fail(`${name}: threw ${e.message}`); } };
T('valid multi-label accepted',  () => isValidDnrDomain('ads.example.com') === true);
T('single-label (localhost) accepted', () => isValidDnrDomain('localhost') === true);
T('wildcard domain rejected',    () => isValidDnrDomain('example.*') === false);
T('IDN domain rejected',         () => isValidDnrDomain('münchen.de') === false);
T('leading-dot rejected',        () => isValidDnrDomain('.x.com') === false);
T('non-ASCII urlFilter dropped', () => sanitizeDnrRule({condition:{urlFilter:'||münchen.de'}}) === null);
T('space urlFilter dropped',     () => sanitizeDnrRule({condition:{urlFilter:'||ad .com'}}) === null);
T('scoped-but-invalid dropped',  () => sanitizeDnrRule({condition:{urlFilter:'||x.com', initiatorDomains:['example.*']}}) === null);
T('scoped mix keeps valid only', () => { const r = sanitizeDnrRule({condition:{urlFilter:'||x.com', initiatorDomains:['foo.com','bar.*']}}); return r && JSON.stringify(r.condition.initiatorDomains) === '["foo.com"]'; });
T('overlap removed from excluded', () => { const r = sanitizeDnrRule({condition:{urlFilter:'||x.com', initiatorDomains:['github.com'], excludedInitiatorDomains:['github.com','youtube.com']}}); return r && JSON.stringify(r.condition.excludedInitiatorDomains) === '["youtube.com"]'; });
T('normal rule preserved',       () => !!sanitizeDnrRule({condition:{urlFilter:'||ads.com^', resourceTypes:['script'], excludedInitiatorDomains:['youtube.com']}}));
const realism = parseFilterList(['||doubleclick.net^','||ads.x^$script','||cdn.ads.net^$domain=news.com|blog.org','||t.io^$third-party'].join('\n'), 10000, 50);
const survived = realism.rules.map(r => sanitizeDnrRule(JSON.parse(JSON.stringify(r)))).filter(Boolean);
T('realism: legit rules survive', () => survived.length === realism.rules.length);

console.log('\n' + '═'.repeat(50));
console.log(problems === 0 ? '✓ ALL STABILITY CHECKS PASSED' : `✗ ${problems} PROBLEM(S) FOUND`);
process.exit(problems ? 1 : 0);
