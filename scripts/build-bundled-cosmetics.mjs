#!/usr/bin/env node
/**
 * Build src/bundled-cosmetics.json — a snapshot of the core lists' element-hiding
 * selectors and scriptlets, shipped in the package so cosmetic blocking works from
 * the first page load after install instead of waiting on the first filter sync.
 *
 * background.js seeds storage from this file only while no sync has completed yet;
 * the first successful sync overwrites it with live data.
 *
 * Run at release time (needs network):
 *   node scripts/build-bundled-cosmetics.mjs
 */
import { writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseFilterList } from '../src/filter-parser.js';
import { finalizeDomainCosmetics, finalizeScriptletRules } from '../src/cosmetic-utils.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = resolve(root, 'src/bundled-cosmetics.json');

// Keep in sync with the matching FILTER_LISTS entries in src/background.js.
const LISTS = [
  { key: 'easylist',    url: 'https://easylist.to/easylist/easylist.txt' },
  { key: 'ublock_main', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt' },
  { key: 'ublock_ann',  url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-cookies.txt' },
];

const cosmetics = [];
const domainCosmetics = {};
const scriptletRules = {};
const cosmeticExceptions = {};

for (const { key, url } of LISTS) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  const parsed = parseFilterList(await res.text(), 1, 0);
  cosmetics.push(...parsed.cosmetics);
  for (const [dom, sels] of Object.entries(parsed.domainCosmetics)) {
    (domainCosmetics[dom] ??= []).push(...sels);
  }
  for (const [dom, rules] of Object.entries(parsed.scriptletRules)) {
    (scriptletRules[dom] ??= []).push(...rules);
  }
  for (const [dom, sels] of Object.entries(parsed.cosmeticExceptions ?? {})) {
    (cosmeticExceptions[dom] ??= []).push(...sels);
  }
  console.log(`${key}: ${parsed.cosmetics.length} global, ${Object.keys(parsed.domainCosmetics).length} domains, ${Object.keys(parsed.scriptletRules).length} scriptlet domains`);
}

const out = {
  builtAt: new Date().toISOString(),
  lists: LISTS.map(l => l.key),
  cosmeticSelectors: [...new Set(cosmetics)],
  domainCosmetics: finalizeDomainCosmetics(domainCosmetics),
  scriptletRules: finalizeScriptletRules(scriptletRules),
  // Same per-domain cap syncFilterLists applies to the aggregated exceptions.
  cosmeticExceptions: Object.fromEntries(Object.entries(cosmeticExceptions)
    .map(([dom, sels]) => [dom, [...new Set(sels)].slice(0, 400)])),
};
const json = JSON.stringify(out);
writeFileSync(OUT, json);
console.log(`Wrote ${OUT} — ${out.cosmeticSelectors.length} global selectors, ` +
  `${Object.keys(out.domainCosmetics).length} domains, ${(json.length / 1024).toFixed(0)} KB`);
