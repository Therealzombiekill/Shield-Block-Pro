#!/usr/bin/env node
/**
 * Validate manifest JSON and JS syntax for all extension sources.
 * Run: node scripts/validate-extension.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walkJs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

let failed = 0;

try {
  JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  console.log('manifest.json: OK');
} catch (e) {
  console.error('manifest.json: FAIL', e.message);
  failed++;
}

for (const f of [join(root, 'popup.js'), ...walkJs(join(root, 'src'))]) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
    console.log(f.replace(root + '/', '') + ': OK');
  } catch (e) {
    console.error(f.replace(root + '/', '') + ': FAIL');
    failed++;
  }
}

// Procedural cosmetic + cosmetic-utils smoke tests
try {
  const { parseFilterList, isProceduralCosmetic } = await import(join(root, 'src/filter-parser.js'));
  const { finalizeDomainCosmetics, countProceduralInDomainCosmetics } = await import(join(root, 'src/cosmetic-utils.js'));
  const sample = parseFilterList([
    'sport1.de##strong:has-text(/anzeige/i)',
    '##p:has-text(Ad)',
    'example.com##.banner',
  ].join('\n'), 9000, 100);
  const proc = Object.values(sample.domainCosmetics).flat().filter(isProceduralCosmetic);
  if (proc.length !== 2) throw new Error(`expected 2 procedural rules, got ${proc.length}`);
  if (!sample.domainCosmetics['sport1.de']?.some(s => s.includes(':has-text('))) {
    throw new Error('domain procedural rule missing');
  }
  if (!sample.domainCosmetics['*']?.some(s => s.includes(':has-text('))) {
    throw new Error('global procedural rule missing');
  }
  if (!sample.domainCosmetics['example.com']?.includes('.banner')) {
    throw new Error('plain domain cosmetic missing');
  }
  const capped = finalizeDomainCosmetics({ '*': ['a:has-text(Ad)', ...Array.from({length:100},(_,i)=>`.z-${i}`)] }, { globalMax: 10 });
  if (!capped['*'].some(isProceduralCosmetic)) throw new Error('finalize dropped procedural under cap');
  if (countProceduralInDomainCosmetics(sample.domainCosmetics) !== 2) throw new Error('countProcedural mismatch');
  console.log('filter-parser + cosmetic-utils smoke test: OK');
} catch (e) {
  console.error('filter-parser smoke test: FAIL', e.message);
  failed++;
}

try {
  execSync('node scripts/audit-publisher-blocks.mjs', { cwd: root, stdio: 'pipe' });
  console.log('audit-publisher-blocks: OK');
} catch (e) {
  console.error('audit-publisher-blocks: FAIL', e.stdout?.toString() || e.message);
  failed++;
}

process.exit(failed ? 1 : 0);
