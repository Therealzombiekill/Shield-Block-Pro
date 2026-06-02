/**
 * Build-time generator for bundled static DNR rulesets.
 *
 * WHY THIS EXISTS
 * ---------------
 * MV3 caps `updateDynamicRules` at 5,000 rules total. ShieldBlock's runtime
 * filter sync packs ~30 lists into that single budget, so EasyList alone is
 * throttled to ~1,100 of its ~40,000 rules. Static rulesets do NOT count
 * against the dynamic cap and Chrome allows tens of thousands of them, so the
 * large, stable lists belong here — shipped with the extension and toggled via
 * declarativeNetRequest.updateEnabledRulesets. This is the uBO-Lite model.
 *
 * The conversion reuses the SAME parseFilterList() the runtime path uses, so a
 * static rule and a dynamic rule produced from the same filter line are byte
 * identical. No second, divergent converter to maintain.
 *
 * Static-ruleset rule IDs only need to be unique *within their own file*, so we
 * number each ruleset 1..N independently — no interaction with the dynamic ID
 * namespace (10000+) documented in background.js.
 *
 * Usage:  npm run build:rulesets
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFilterList } from '../src/filter-parser.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'rules', 'static');

// Per-ruleset caps keep the total enabled static-rule count under Chrome's
// guaranteed minimum (30,000) once the existing bundled rulesets (~2,000:
// base/extended/tracking/hosts) are included. Measured yields drive these.
// Caps chosen so enabled static rules (these + the ~1,400 bundled
// base/extended/tracking/hosts) stay under Chrome's 30,000 guaranteed minimum
// with headroom. EasyList (general ads) gets the larger share.
// `idBase` keeps each ruleset's IDs in a high, disjoint band. Static and dynamic
// rules live in separate ID namespaces in MV3, but background.js's
// loadStaticRuleIds()/filterStaticConflicts() conflate them by number to guard
// against accidental overlap — so static IDs MUST stay clear of every dynamic
// range (filter lists 10000–20250, removeparam 30000+, matrix 31000+, user
// 48000+, pause 49999). The 1M/2M bands below can never collide.
const LISTS = [
  { key: 'easylist',    name: 'EasyList',    url: 'https://easylist.to/easylist/easylist.txt',    cap: 16000, idBase: 1_000_000 },
  { key: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt', cap: 11000, idBase: 2_000_000 },
];

// Broad domain-anchor rules (||domain^ with no path) block an entire ad/tracker
// host with one rule — the highest coverage-per-rule. When a list yields more
// rules than its cap, keep these first so capping never drops a domain block in
// favour of a narrow path rule. Reordering is safe: all rules share priority 2
// and DNR matching is order-independent.
function isDomainAnchor(rule) {
  return /^\|\|[a-z0-9.*_-]+$/i.test(rule.condition.urlFilter);
}

function validateRule(r) {
  if (!Number.isInteger(r.id) || r.id < 1)            return 'id must be a positive integer';
  if (!r.action || r.action.type !== 'block')         return 'action.type must be "block"';
  const c = r.condition;
  if (!c || typeof c.urlFilter !== 'string' || !c.urlFilter) return 'condition.urlFilter missing';
  if (c.urlFilter.length > 2000)                      return 'urlFilter too long';
  if (!Array.isArray(c.resourceTypes) || !c.resourceTypes.length) return 'resourceTypes missing';
  return null;
}

// Drop exact-duplicate rules (same matcher + types + initiator scope). The raw
// lists contain many near-dupes; deduping shrinks the file and the rule budget.
function dedupe(rules) {
  const seen = new Set();
  const out  = [];
  for (const r of rules) {
    const c = r.condition;
    const key = `${c.urlFilter}|${(c.resourceTypes || []).join(',')}|${(c.excludedInitiatorDomains || []).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const summary = [];
  let grandTotal = 0;

  for (const list of LISTS) {
    process.stdout.write(`Fetching ${list.name}… `);
    const res = await fetch(list.url, { headers: { 'User-Agent': 'ShieldBlock-build' } });
    if (!res.ok) throw new Error(`${list.name}: HTTP ${res.status}`);
    const text = await res.text();
    process.stdout.write(`${(text.length / 1024 / 1024).toFixed(1)}MB → parsing… `);

    // Parse the whole list (high ceiling), then dedupe and rank before capping
    // so the cap keeps the highest-value rules rather than the first N seen.
    const { rules: raw } = parseFilterList(text, 1, 200000);
    const deduped = dedupe(raw);
    const anchors = deduped.filter(isDomainAnchor);
    const others  = deduped.filter(r => !isDomainAnchor(r));
    const kept    = [...anchors, ...others].slice(0, list.cap);
    // Number IDs from the ruleset's high idBase so they're unique in-file and
    // can't collide with any dynamic rule range (see LISTS note above).
    kept.forEach((r, i) => { r.id = list.idBase + i + 1; });

    for (const r of kept) {
      const err = validateRule(r);
      if (err) throw new Error(`${list.name} rule #${r.id}: ${err}`);
    }

    await writeFile(join(OUT, `${list.key}.json`), JSON.stringify(kept));
    process.stdout.write(`${kept.length} rules kept (${anchors.length} anchors + ${others.length} other, from ${raw.length} raw)\n`);
    summary.push({ list: list.name, file: `rules/static/${list.key}.json`, rules: kept.length });
    grandTotal += kept.length;
  }

  console.log('\n── Generated static rulesets ─────────────────────────────');
  console.table(summary);
  console.log(`TOTAL static network rules: ${grandTotal.toLocaleString()}`);
  console.log(`(Chrome guaranteed-minimum static budget: 30,000)`);
  if (grandTotal > 28000) {
    console.warn('⚠  Over budget once bundled base/extended/hosts (~2k) are added — lower caps.');
  }
}

main().catch(err => { console.error('BUILD FAILED:', err.message); process.exit(1); });
