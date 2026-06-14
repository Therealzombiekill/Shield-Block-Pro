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
    'adswizz.com', 'adcolony.com', 'unityads.unity3d.com', 'targetspot.com',
  ],
  mobile: [
    'adsdk.vivo.com.cn', 'adtech.vivoglobal.com', 'lenovoads.com', 'ads.lenovo.com',
    'tapjoy.com', 'startapp.com', 'startappservice.com',
    'admob.com', 'mintegral.com', 'rayjump.com', 'mtgglobals.com',
    'applovin.com', 'applvn.com', 'ironsrc.com', 'supersonicads.com', 'vungle.com',
    'chartboost.com', 'inmobi.com', 'fyber.com',
    'ad.xiaomi.com', 'tracking.miui.com', 'adv.sec.miui.com', 'ads.oppomobile.com',
    'adsfs.oppomobile.com', 'samsungads.com', 'smetrics.samsung.com',
    'open.oneplus.net', 'click.oneplus.cn', 'metrics2.data.hicloud.com', 'grs.hicloud.com',
  ],
  social: [
    'advertising.twitter.com', 'widgets.pinterest.com', 'ads-dev.pinterest.com',
    'rereddit.com', 'analytics.facebook.com', 'ads.facebook.com',
    'adsapi.snapchat.com', 'tr6.snapchat.com', 'log.tiktokv.com', 'mon.tiktokv.com',
    'pixel.reddit.com', 'alb.reddit.com', 'q.quora.com', 'ads.quora.com',
    'ads.linkedin.com', 'px.ads.linkedin.com', 'analytics.pointdrive.linkedin.com', 'snap.licdn.com',
  ],
  amazon: [
    'advertising-api-eu.amazon.com', 'advertising-api.amazon.com',
    'advertising-api-fe.amazon.com', 'amazon-adsystem.com', 'aax.amazon.com',
  ],
  analytics: [
    'cloudflareinsights.com', 'cdn.rudderlabs.com', 'cdn.segment.com',
    'api.segment.io', 'api.mixpanel.com', 'cdn.mxpnl.com', 'api2.amplitude.com',
    'cdn.amplitude.com', 'static.hotjar.com', 'clarity.ms',
  ],
  trackers: [
    'analytics.x.com', 'qevents.quora.com', 'mcs-va.tiktokv.com',
    'advertising.apple.com', 'prd.jwpltx.com',
  ],
  messaging: [
    'sdk.iad-01.braze.com', 'cdn.onesignal.com', 'api.onesignal.com',
    'track.customer.io',
  ],
  replay: [
    'cdn.heapanalytics.com', 'edge.fullstory.com', 'cdn.mouseflow.com',
    'cdn.logrocket.io', 'jssdkcdns.mparticle.com', 'sentry.io',
  ],
  regional: [
    'analytics.query.yahoo.com', 'udcm.yahoo.com', 'log.fc.yahoo.com', 'gemini.yahoo.com',
    'adfstat.yandex.ru', 'appmetrica.yandex.ru', 'adfox.yandex.ru', 'metrika.yandex.ru',
    'atanx.alicdn.com',
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
