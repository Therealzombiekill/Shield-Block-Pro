#!/usr/bin/env node
/**
 * Verify benchmark-critical ad/tracker domains are covered by static rules.
 * Run: node scripts/check-benchmark-domains.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BENCHMARK_DOMAINS = {
  audio: [
    'ads.spotify.com', 'adeventtracker.spotify.com', 'megaphone.fm', 'traffic.megaphone.fm',
  ],
  mobile: [
    'adsdk.vivo.com.cn', 'adtech.vivoglobal.com', 'lenovoads.com', 'ads.lenovo.com',
  ],
  social: [
    'advertising.twitter.com', 'widgets.pinterest.com', 'ads-dev.pinterest.com',
    'rereddit.com', 'analytics.facebook.com', 'ads.facebook.com',
  ],
  amazon: [
    'advertising-api-eu.amazon.com', 'advertising-api.amazon.com',
    'advertising-api-fe.amazon.com', 'amazon-adsystem.com', 'aax.amazon.com',
  ],
};

const rules = [];
for (const f of readdirSync(join(root, 'rules')).filter(x => x.endsWith('.json'))) {
  rules.push(...JSON.parse(readFileSync(join(root, 'rules', f), 'utf8')));
}

function isBlocked(host) {
  const h = host.replace(/^www\./, '');
  return rules.some(r => {
    const f = r.condition?.urlFilter;
    if (!f?.startsWith('||') || !f.endsWith('^')) return false;
    const dom = f.slice(2, -1).split('/')[0];
    return h === dom || h.endsWith('.' + dom);
  });
}

let failed = 0;
for (const [cat, hosts] of Object.entries(BENCHMARK_DOMAINS)) {
  const miss = hosts.filter(h => !isBlocked(h));
  if (miss.length) {
    console.error(`✗ ${cat}: missing ${miss.join(', ')}`);
    failed += miss.length;
  } else {
    console.log(`✓ ${cat}: ${hosts.length}/${hosts.length} domains blocked`);
  }
}
process.exit(failed ? 1 : 0);
