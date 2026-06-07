#!/usr/bin/env node
/**
 * Compile ABP/uBO filter list text into Chrome static DNR rules JSON.
 *
 * Static rulesets use a separate ~30k rule budget from dynamic rules (MV3).
 * Run at release time — not required for unpacked dev workflow.
 *
 * Usage:
 *   node scripts/compile-static-rules.mjs easylist.txt --out rules/generated.json --start-id 20000 --max 5000
 *
 * Add output to manifest.json declarative_net_request.rule_resources when ready.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseFilterList } from '../src/filter-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = { out: 'rules/generated.json', startId: 20000, max: 5000 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--start-id') opts.startId = Number(argv[++i]);
    else if (a === '--max') opts.max = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/compile-static-rules.mjs <filter.txt> [--out rules/generated.json] [--start-id 20000] [--max 5000]`);
      process.exit(0);
    } else positional.push(a);
  }
  opts.input = positional[0];
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.input) {
  console.error('Error: provide a filter list .txt path');
  process.exit(1);
}

const text = readFileSync(resolve(process.cwd(), opts.input), 'utf8');
const { rules, cosmetics, domainCosmetics, scriptletRules } = parseFilterList(text, opts.startId, opts.max);

const outPath = resolve(root, opts.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(rules, null, 2) + '\n');

const procCount = Object.values(domainCosmetics).flat()
  .filter(s => /:has-text\(|:upward\(|:xpath\(|:matches-css\(/.test(s)).length;

console.log(`Wrote ${rules.length} DNR rules → ${opts.out}`);
console.log(`  (also parsed ${cosmetics.length} global cosmetics, ${procCount} procedural domain rules, ${
  Object.values(scriptletRules).flat().length} scriptlets — not embedded in static JSON)`);
console.log(`ID range: ${rules[0]?.id ?? 'n/a'} – ${rules[rules.length - 1]?.id ?? 'n/a'}`);
console.log('Next: add ruleset entry to manifest.json declarative_net_request.rule_resources');
