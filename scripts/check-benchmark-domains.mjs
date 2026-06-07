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
    'audio-ad-delivery.spotify.com', 'adstudio.spotify.com', 'pixel.spotify.com', 'ads.tritondigital.com',
    'ads-fa.spotify.com', 'gabo-receiver-service.spotify.com',
  ],
  mobile: [
    'adsdk.vivo.com.cn', 'adtech.vivoglobal.com', 'lenovoads.com', 'ads.lenovo.com',
    'tapjoy.com', 'startapp.com', 'startappservice.com',
    'admob.com', 'mintegral.com', 'rayjump.com', 'mtgglobals.com',
  ],
  social: [
    'advertising.twitter.com', 'widgets.pinterest.com', 'ads-dev.pinterest.com',
    'rereddit.com', 'analytics.facebook.com', 'ads.facebook.com',
    'adsapi.snapchat.com', 'tr6.snapchat.com', 'log.tiktokv.com', 'mon.tiktokv.com',
    'pixel.reddit.com', 'alb.reddit.com', 'q.quora.com', 'ads.quora.com',
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
