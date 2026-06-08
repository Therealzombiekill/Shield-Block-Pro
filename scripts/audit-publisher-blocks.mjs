#!/usr/bin/env node
/**
 * Fail CI if static DNR rules apex-block major publisher first-party domains.
 * Run: node scripts/audit-publisher-blocks.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PUBLISHER_FIRST_PARTY_DOMAINS } from '../src/trusted-sites.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publisherSet = new Set(PUBLISHER_FIRST_PARTY_DOMAINS);

const rules = [];
for (const f of readdirSync(join(root, 'rules')).filter(x => x.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(root, 'rules', f), 'utf8'));
  const list = Array.isArray(data) ? data : data.rules ?? [];
  rules.push(...list.map(r => ({ ...r, _file: f })));
}

function apexFromFilter(urlFilter) {
  if (!urlFilter?.startsWith('||') || !urlFilter.endsWith('^')) return null;
  const bare = urlFilter.slice(2, -1).split('/')[0].toLowerCase();
  if (bare.includes('*')) return null;
  return bare;
}

function isPublisherApexBlock(rule) {
  if (rule.action?.type !== 'block') return false;
  const apex = apexFromFilter(rule.condition?.urlFilter);
  if (!apex || !publisherSet.has(apex)) return false;
  // Third-party-only rules are OK (initiatorDomains without blocking first-party).
  if (rule.condition?.initiatorDomains?.length && rule.condition?.domainType === 'thirdParty') {
    return false;
  }
  return true;
}

const violations = rules.filter(isPublisherApexBlock);
if (violations.length) {
  console.error('✗ Publisher false-positive apex blocks in static rules:');
  for (const v of violations) {
    console.error(`  ${v._file} id=${v.id} ${v.condition.urlFilter}`);
  }
  process.exit(1);
}

console.log(`✓ No apex blocks on ${publisherSet.size} protected publisher domains`);
