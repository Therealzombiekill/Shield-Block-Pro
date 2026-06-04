/**
 * ShieldBlock Pro — Background Service Worker
 */

import './browser-compat.js';
import { parseFilterList } from './filter-parser.js';
import { isSafeBrowsingAllowlisted } from './trusted-sites.js';

const MAX_DYNAMIC_RULES = 5000;
const MAX_FILTER_RULES = 4300; // reserve dynamic-rule headroom for pause, whitelist, matrix, and privacy rules
// Dynamic DNR ID ranges. Keep these disjoint from static bundled rules and
// from each other; Chrome rejects duplicate IDs across active rule pools.
const FILTER_DYNAMIC_START = 10000;
const FILTER_DYNAMIC_END   = 29999;
const WHITELIST_BASE       = 48000; // 48000-48998: two allow rules per whitelisted domain
// ID reserved for the global pause-all DNR allow rule. Must be outside all other ranges.
const PAUSE_ALL_RULE_ID = 49999;

// ── Feature rule ID ranges ─────────────────────────────────────────────────
// These ranges sit between filter rules (10000-29999) and pause-all (49999),
// so they never collide with either.
const REMOVEPARAM_BASE  = 30000; // 30000-30999: global + domain-scoped removeparam rules
const MATRIX_BASE       = 31000; // 31000-31999: per-domain filtering matrix rules
const USER_DNR_BASE     = 48000; // 48000-48499: user-typed network block rules
const USER_DNR_END      = 48499;
const DNR_RESOURCE_TYPES = [
  'main_frame','sub_frame','script','image','stylesheet','object',
  'xmlhttprequest','ping','media','websocket','font','other',
];
// ── Hardcoded tracking parameter list ─────────────────────────────────────
// These are applied REGARDLESS of what filter lists contain. Updated independently
// of the 12-hour filter sync cycle — they never change in structure, just grow.
const STATIC_REMOVE_PARAMS = new Set([
  // Google Ads / Analytics
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
  // Facebook / Meta
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',
  // Universal campaign tracking
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_reader', 'utm_place', 'utm_userid', 'utm_cid', 'utm_name',
  // Microsoft Ads
  'msclkid',
  // Twitter / X
  'twclid', 'ref_src', 'ref_url',
  // Instagram
  'igshid', 'igsh',
  // TikTok
  'tt_medium', 'tt_content', 'ttclid',
  // Snapchat
  'ScCid',
  // Mailchimp
  'mc_eid', 'mc_cid',
  // Yandex
  'yclid', '_openstat',
  // Marketo
  'mkt_tok',
  // HubSpot
  '_hsenc', '_hsmi', 'hsa_acc', 'hsa_cam', 'hsa_grp', 'hsa_ad', 'hsa_src',
  'hsa_tgt', 'hsa_kw', 'hsa_mt', 'hsa_net', 'hsa_ver',
  // Adobe / Omniture
  'ef_id', 's_kwcid',
  // Pinterest
  'epik',
  // Klaviyo
  '_ke',
  // Drip
  '__s',
  // Outbrain
  'obOrigUrl',
  // Vero
  'vero_id', 'vero_conv',
  // LinkedIn
  'li_fat_id',
  // Zanox / Awin
  'zanpid',
  // Criteo
  'criteo_origin',
  // Oracle / Eloqua
  'elqTrackId', 'elqak',
  // ActiveCampaign
  'vuid',
  // Other common trackers
  'origin_referrer', 'otc', 'spm', 'wtrid', 'aff_id', 'affiliate_id',
  'source_caller', 'mibextid', // Meta Business
  'irclickid', // Impact Radius
  'cvosrc', 'cvo_campaign',
]);

// ── Time saved estimates (seconds per blocked item by type) ───────────────────
const TIME_SAVED_SECONDS = {
  youtube:  15, // avg of 5s skippable + 30s unskippable
  twitch:   30, // full SSAI ad break
  spotify:  30, // audio ad segment
  hulu:     30, // video ad break
  kick:     30, // video ad break
  amazon:    3, // page load improvement
  general:   5, // typical ad script load time
  social:    2, // skipped sponsored post
  cookies:   8, // time to find + click "reject all"
  annoyances: 3, // dismissed nag / widget / banner
  streaming: 30, // SSAI ad break (additional platforms)
};

// ── Browser detection ─────────────────────────────────────────────────────────
// Service workers don't have navigator.userAgent in all MV3 builds, so we check
// both paths. Firefox exposes globalThis.browser; Chrome does not.
const _IS_FIREFOX = (typeof globalThis.browser !== 'undefined') ||
  (typeof navigator !== 'undefined' && /Firefox/.test(navigator.userAgent));

/**
 * Return the correct AdGuard filter URL for the current browser.
 * AdGuard hosts identical rules at two paths:
 *   /extension/chromium/filters/<id>.txt  — Chromium (MV3 compatible)
 *   /extension/firefox/filters/<id>.txt   — Firefox
 * Using the wrong path returns HTTP 200 but may serve an older/different ruleset.
 */
function adGuardUrl(filterId) {
  const variant = _IS_FIREFOX ? 'firefox' : 'chromium';
  return `https://filters.adtidy.org/extension/${variant}/filters/${filterId}.txt`;
}

// ── Filter list registry ──────────────────────────────────────────────────────
// Rules are pulled from each list up to `max` entries.
// ID ranges MUST NOT overlap — each list's [start, start+max-1] must be disjoint.
// Chrome hard-caps updateDynamicRules at 5,000 total; sync truncates lists to the reserved filter budget.
//
//   List                │ start  │ max  │ end (exclusive)
//   ────────────────────┼────────┼──────┼────────────────
//   EasyList            │ 10000  │ 1600 │ 11600
//   EasyPrivacy         │ 12000  │  700 │ 12700
//   Peter Lowe          │ 13000  │  200 │ 13200
//   AdGuard Tracking    │ 13500  │  350 │ 13850   ← new, replaces AdGuard Annoyances
//   uBlock Annoyances   │ 14000  │  150 │ 14150
//   uBlock Filters      │ 14500  │  550 │ 15050   ← new: uBO main list
//   Fanboy Social       │ 15500  │  120 │ 15620   ← new: social widget blocking
//   AdGuard Base        │ 16000  │  300 │ 16300
//   uBlock Badware      │ 16500  │  150 │ 16650
//   Liste FR            │ 17000  │   80 │ 17080
//   EasyList Germany    │ 17200  │   80 │ 17280
//   RU AdList           │ 17400  │   80 │ 17480
//   AdGuard Annoyances  │ 17600  │  300 │ 17900   ← kept but after the new ones
//   ────────────────────┼────────┼──────┼────────────────
//   Total               │        │~4950 │          (> 4300 filter budget)

const FILTER_LISTS = [
  // Core ad blocking
  { name: 'EasyList',              url: 'https://easylist.to/easylist/easylist.txt',                                                                                   key: 'easylist',      max: 1100, start: 10000 },
  { name: 'EasyPrivacy',           url: 'https://easylist.to/easylist/easyprivacy.txt',                                                                                key: 'easyprivacy',   max:  540, start: 12000 },
  { name: 'Peter Lowe',            url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext',                         key: 'peterlow',      max:  200, start: 13000 },
  // Tracking & privacy
  { name: 'AdGuard Tracking',      url: adGuardUrl(3),                                                                                                                  key: 'adguard_track', max:  350, start: 13500 },
  { name: 'uBlock Annoyances',     url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances-cookies.txt',                               key: 'ublock_ann',    max:  150, start: 14000 },
  // uBlock Origin main filter list — high-quality, minimal overlap with EasyList
  { name: 'uBlock Filters',        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',                                           key: 'ublock_main',   max:  300, start: 14500 },
  // Social widget & share-button tracking
  { name: 'Fanboy Social',         url: 'https://easylist.to/easylist/fanboy-social.txt',                                                                              key: 'fanboy_social', max:  120, start: 15500 },
  // Broader ad network coverage
  { name: 'AdGuard Base',          url: adGuardUrl(2),                                                                                                                  key: 'adguard_base',  max:  300, start: 16000 },
  { name: 'uBlock Badware',        url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt',                                           key: 'ublock_bad',    max:  150, start: 16500 },
  // Regional lists
  { name: 'Liste FR',              url: 'https://easylist-downloads.adblockplus.org/liste_fr.txt',                                                                     key: 'listefr',       max:   80, start: 17000 },
  { name: 'EasyList Germany',      url: 'https://easylist.to/easylistgermany/easylistgermany.txt',                                                                     key: 'easylistde',    max:   80, start: 17200 },
  { name: 'RU AdList',             url: 'https://easylist-downloads.adblockplus.org/advblock.txt',                                                                     key: 'ruadlist',      max:   80, start: 17400 },
  // Annoyances (newsletter popups, notification prompts, cookie notices)
  { name: 'AdGuard Annoyances',    url: adGuardUrl(14),                                                                                                                 key: 'adguard_ann',   max:  300, start: 17600 },
  // Scriptlet-heavy lists — these provide ##+js() rules that defuse anti-adblock scripts
  { name: 'uBlock Origin Filters 2', url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters-2024.txt',                                     key: 'ublock_2024',   max:  200, start: 17900 },
  { name: 'uBlock Annoyances Full',  url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt',                                       key: 'ublock_ann2',   max:  150, start: 18200 },
  // Anti-adblock bypass rules
  { name: 'Anti-Adblock Killer',    url: 'https://raw.githubusercontent.com/reek/anti-adblock-killer/master/anti-adblock-killer-filters.txt',                           key: 'anti_adblock',  max:  100, start: 18400 },
  // Regional lists
  { name: 'EasyList Polish',          url: 'https://easylist-downloads.adblockplus.org/easylistpolish.txt',                                                                    key: 'easylist_pl',   max:   80, start: 19000 },
  { name: 'uBlock Unbreak',            url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt',                                              key: 'ublock_unbr',   max:   80, start: 19200 },
  { name: 'EasyList Korean',          url: 'https://raw.githubusercontent.com/yous/YousList/master/youslist.txt',                                                              key: 'easylist_kr',   max:   80, start: 19400 },
  { name: 'AdGuard Turkish',           url: adGuardUrl(9),                                                                                                                  key: 'adguard_tr',    max:   80, start: 19600 },
  { name: 'ChinaList',               url: 'https://raw.githubusercontent.com/cjx82630/cjxlist/master/cjxlist.txt',                                                            key: 'chinalist',     max:   80, start: 19800 },
  // Anti-cryptomining
  { name: 'NoCoin',                   url: 'https://raw.githubusercontent.com/hoshsadiq/adblock-nocoin-list/master/nocoin.txt',                                               key: 'nocoin',        max:   80, start: 19900 },
  // ── Regional language lists ──────────────────────────────────────────────
  { name: 'EasyList Spanish',       url: 'https://easylist-downloads.adblockplus.org/easylistspanish.txt',           key: 'easylist_es',  max:  30, start: 22000 },
  { name: 'EasyList Italian',       url: 'https://easylist-downloads.adblockplus.org/easylistitaly.txt',             key: 'easylist_it',  max:  30, start: 22030 },
  { name: 'EasyList Dutch',         url: 'https://easylist-downloads.adblockplus.org/easylistdutch.txt',             key: 'easylist_nl',  max:  30, start: 22060 },
  { name: 'AdGuard Japanese',       url: adGuardUrl(7),                                                                                                                  key: 'adguard_ja',   max:  30, start: 22090 },
  { name: 'Liste AR Arabic',        url: 'https://easylist-downloads.adblockplus.org/Liste_AR.txt',                  key: 'liste_ar',     max:  25, start: 22120 },
  { name: 'Czech and Slovak',       url: 'https://raw.githubusercontent.com/tomasko126/easylistczechandslovak/master/filters.txt', key: 'easylist_cs',  max:  25, start: 22145 },
  { name: 'ABP Indonesian',         url: 'https://easylist-downloads.adblockplus.org/abpindo.txt',                   key: 'abp_id',       max:  25, start: 22170 },
  { name: 'Hebrew List',            url: 'https://raw.githubusercontent.com/easylist/EasyListHebrew/master/EasyListHebrew.txt', key: 'hebrew_il',    max:  25, start: 22195 },
  { name: 'ABPVN Vietnamese',       url: 'https://raw.githubusercontent.com/abpvn/abpvn/master/filter/abpvn.txt',    key: 'abp_vn',       max:  25, start: 22220 },
  { name: 'Nordic List',            url: 'https://raw.githubusercontent.com/DandelionSprout/adfilt/master/NorwegianExperimentalList%20alternate%20versions/NordicFiltersABP-Inclusion.txt', key: 'nordic', max: 25, start: 22245 },
];

// Sanity-check: verify no ID range overlaps (logged to console in dev)
(function _checkRanges() {
  const ranges = FILTER_LISTS.map(l => [l.start, l.start + l.max - 1, l.name]);
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i][0] <= ranges[j][1] && ranges[j][0] <= ranges[i][1]) {
        // Runs at module-eval, before logEvent/_eventLog exist — must use console here.
        // (Calling logEvent would hit a TDZ ReferenceError and abort SW startup — i.e.
        // the self-check would crash exactly when it found the problem it guards against.)
        console.error(`[SB] Rule ID range overlap: ${ranges[i][2]} overlaps ${ranges[j][2]}`);
      }
    }
  }
  // Chrome hard-caps updateDynamicRules at 5,000 rules total — warn if the configured
  // sum of per-list maxes ever drifts past it (the table comment is not self-enforcing).
  const sumMax = FILTER_LISTS.reduce((a, l) => a + (l.max | 0), 0);
  if (sumMax > 5000) console.warn(`[SB] FILTER_LISTS max sum ${sumMax} exceeds the 5000 dynamic-rule cap`);
})();

const FILTER_TTL = 12 * 60 * 60 * 1000; // 12 hours

// ── Settings ───────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  twitch: true, amazon: true, general: true,
  cosmetic: true, social: true, cookies: true,
  privacy: true, tracking: true,
  spotify: true,
  hulu: true,
  kick: true,
  youtube: true,
  youtubeExtras: false, // opt-in: hide Shorts + remove end-screen cards
  annoyances: true,     // chat widgets, push pre-prompts, app/install banners, surveys, share bars
  streaming: true,      // SSAI ad-mute on additional streaming platforms (Max, Disney+, etc.)
  badgeEnabled: true,
  safeBrowsing: true,   // phishing / malware URL checking
  paywall: false,       // soft paywall bypass (opt-in — may break paid subscriptions)
  referrerStrip: true,  // strip Referer header on 3rd-party requests
  httpsUpgrade: true,   // upgrade http:// navigations to https://
  timezoneSpoof: false, // spoof timezone to UTC (opt-in — breaks calendar apps)
  privacyHeaders: true, // send DNT: 1 and Sec-GPC: 1 on every request
};

// ── Per-domain block stats (in-memory, lost on SW restart — used for top-domains panel) ─
const _domainStats    = new Map(); // domain → block count (current session)
const DOMAIN_STATS_MAX = 2000;     // evict lowest-count entries when over this limit

// ── Static rule count ─────────────────────────────────────────────────────
// Computed once at startup by counting rules in bundled JSON files.
// Avoids the hardcoded +725 approximation in the popup's rule display.
// Cached in chrome.storage.local so it survives SW restarts.
let _staticRuleCount = 725; // in-memory fallback until computed

async function computeStaticRuleCount() {
  try {
    // DNR doesn't expose a direct count of static rules, but we can count them
    // from the manifest's declared rulesets by fetching the JSON rule files.
    const manifest    = chrome.runtime.getManifest();
    const rulesets    = manifest.declarative_net_request?.rule_resources ?? [];
    let total = 0;
    for (const rs of rulesets) {
      try {
        const res   = await fetch(chrome.runtime.getURL(rs.path));
        const rules = await res.json();
        if (Array.isArray(rules)) total += rules.length;
      } catch (_) {}
    }
    if (total > 0) {
      _staticRuleCount = total;
      await chrome.storage.local.set({ staticRuleCount: total });
      logEvent('system', 'info', `Static rule count: ${total}`);
    }
  } catch (e) {
    logEvent('system', 'warn', `computeStaticRuleCount failed: ${e.message}`);
  }
}
let _staticRuleIds = new Set();

async function loadStaticRuleIds() {
  try {
    const manifest = chrome.runtime.getManifest();
    const rulesets = manifest.declarative_net_request?.rule_resources ?? [];
    const ids = new Set();
    for (const rs of rulesets) {
      try {
        const res   = await fetch(chrome.runtime.getURL(rs.path));
        const rules = await res.json();
        if (Array.isArray(rules)) for (const r of rules) if (r.id) ids.add(r.id);
      } catch (_) {}
    }
    _staticRuleIds = ids;
    for (const list of FILTER_LISTS) {
      const end = list.start + list.max - 1;
      for (const id of ids) {
        if (id >= list.start && id <= end) {
          logEvent('system', 'error',
            `Static rule ID ${id} collides with ${list.name} dynamic range [${list.start},${end}]`);
        }
      }
    }
  } catch (e) {
    logEvent('system', 'warn', `loadStaticRuleIds failed: ${e.message}`);
  }
}

function isFilterListRuleId(id) {
  return FILTER_LISTS.some(l => id >= l.start && id < l.start + l.max);
}

function filterStaticConflicts(rules) {
  if (!_staticRuleIds.size) return rules;
  return rules.filter(r => !_staticRuleIds.has(r.id));
}

async function broadcastGlobalResume() {
  try {
    const tabs = await chrome.tabs.query({ status: 'complete' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'GLOBAL_RESUME' }).catch(() => {});
    }
  } catch (_) {}
}

async function restoreGlobalPauseIfActive() {
  const { globalPause = false } = await chrome.storage.local.get('globalPause');
  if (!globalPause || globalPause.until <= Date.now()) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [PAUSE_ALL_RULE_ID],
      addRules: [{
        id: PAUSE_ALL_RULE_ID,
        priority: 10000,
        action: { type: 'allow' },
        condition: {
          urlFilter: '*',
          resourceTypes: [
            'main_frame','sub_frame','script','image','stylesheet',
            'object','xmlhttprequest','ping','media','websocket','other',
          ],
        },
      }],
    });
  } catch (e) {
    logEvent('pause', 'warn', `Restore pause rule after sync failed: ${e.message}`);
  }
}

async function applyUserFilterRules() {
  try {
    const { userDnrRules = [] } = await chrome.storage.local.get('userDnrRules');
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing
      .filter(r => r.id >= USER_DNR_BASE && r.id <= USER_DNR_END)
      .map(r => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: userDnrRules.slice(0, USER_DNR_END - USER_DNR_BASE + 1),
    });
  } catch (e) {
    logEvent('user-filters', 'warn', `applyUserFilterRules failed: ${e.message}`);
  }
}

async function purgeFilterListDynamicRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing.filter(r => isFilterListRuleId(r.id)).map(r => r.id);
    if (removeIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: [] });
      logEvent('settings', 'info', `Purged ${removeIds.length} filter-list dynamic rules`);
    }
  } catch (e) {
    logEvent('settings', 'warn', `purgeFilterListDynamicRules failed: ${e.message}`);
  }
}

async function reapplyFeatureRules() {
  const s = await getSettings();
  await Promise.all([
    applyRemoveParamRules(),
    applyMatrixRules(),
    applyReferrerRule(s.referrerStrip !== false),
    applyHttpsUpgradeRule(s.httpsUpgrade !== false),
    applyPrivacyHeadersRule(s.privacyHeaders !== false),
    applyUserFilterRules(),
    applyWhitelistRules(),
  ]);
  await restoreGlobalPauseIfActive();
}


// Rule IDs for privacy/security DNR rules (outside filter ranges)
const REFERRER_RULE_ID   = 47000;
const HTTPS_UPGRADE_ID   = 47001; // upgradeScheme — http → https for main/sub frames
const DNT_GPC_RULE_ID    = 47002; // set DNT: 1 and Sec-GPC: 1 on all outbound requests

// ── Settings cache ─────────────────────────────────────────────────────────
// getSettings() is called on every webNavigation.onBeforeNavigate event plus
// in every content script message handler. Reading chrome.storage.local on
// every navigation adds latency and I/O pressure. Cache in memory; invalidate
// whenever SET_SETTINGS writes new values (which is the only mutation path).
let _settingsCache = null;

async function getSettings() {
  if (_settingsCache) return _settingsCache;
  const { settings } = await chrome.storage.local.get('settings');
  _settingsCache = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  return _settingsCache;
}

function invalidateSettingsCache() {
  _settingsCache = null;
}

// ── Stats ─────────────────────────────────────────────────────────────────

function formatBadge(n) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+'M'
       : n >= 1000 ? (n/1000).toFixed(1)+'k'
       : String(n);
}

// Batched stat writer — accumulates increments and flushes in one storage write
// every 500ms (or immediately if > 20 pending). Avoids a read+write per ad removal.
let _pendingStats     = {};  // { statType: count }
let _pendingTimeSaved = 0;   // seconds accumulated since last flush
let _pendingFlush     = null;

// Track daily stats for 7-day chart
async function recordDailyStats(count) {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const { dailyStats = {} } = await chrome.storage.local.get('dailyStats');
    dailyStats[today] = (dailyStats[today] || 0) + count;
    // Keep only last 30 days
    const keys = Object.keys(dailyStats).sort().slice(-30);
    const pruned = {};
    keys.forEach(k => { pruned[k] = dailyStats[k]; });
    await chrome.storage.local.set({ dailyStats: pruned });
  } catch (e) { logEvent('storage', 'warn', `dailyStats write failed: ${e.message}`); }
}

// Queue that serialises all stat writes — prevents concurrent _flushStats calls
// from both reading stale storage and one overwriting the other's increment.
let _flushQueue = Promise.resolve();

function _flushStats() {
  _pendingFlush = null;
  const pending        = _pendingStats;
  const savedThisFlush = _pendingTimeSaved;
  _pendingStats     = {};
  _pendingTimeSaved = 0;
  if (Object.keys(pending).length === 0 && savedThisFlush === 0) return;

  // Record daily total for 7-day chart (fire-and-forget, non-critical)
  const pendingTotal = Object.values(pending).reduce((a,b)=>a+b,0);
  if (pendingTotal > 0) recordDailyStats(pendingTotal);

  // Serialise writes — chain onto the queue so concurrent flushes never race
  _flushQueue = _flushQueue.then(async () => {
    try {
      const { stats, lifetime, timeSaved: prevSaved } =
        await chrome.storage.local.get(['stats','lifetime','timeSaved']);
      const s  = stats   ?? { total:0, youtube:0, twitch:0, spotify:0, hulu:0, kick:0, amazon:0, general:0, social:0, cookies:0 };
      const lt = lifetime ?? { total:0 };
      for (const [type, count] of Object.entries(pending)) {
        s.total  = (s.total  | 0) + count;
        s[type]  = (s[type]  | 0) + count;
        lt.total = (lt.total | 0) + count;
      }
      await chrome.storage.local.set({
        stats: s, lifetime: lt,
        timeSaved: (prevSaved ?? 0) + savedThisFlush,
      });
      try {
        chrome.action.setBadgeText({ text: formatBadge(s.total) });
        chrome.action.setBadgeBackgroundColor({ color: '#7c6aff' });
        // Apply badge visibility from settings
        const { settings: badgeSettings } = await chrome.storage.local.get('settings');
        if (badgeSettings?.badgeEnabled === false) chrome.action.setBadgeText({ text: '' });
      } catch (e) { logEvent('badge', 'warn', `Badge update failed: ${e.message}`); }
    } catch (_) {}
  });
}

let _statQueue = Promise.resolve();

const _tabCosmeticState = new Map(); // tabId -> { baseCss, css }

const _pageStats  = new Map();
const _requestLog = [];       // network blocks (last 150) — in-memory only
const _eventLog   = [];       // all events from content scripts (last 1000 in-memory)
const LOG_MAX     = 150;
const EVENT_MAX   = 1000;
const PERSIST_LOG_MAX = 1000; // entries kept in chrome.storage for quick SW-restart restore

// ── IndexedDB — permanent all-time log ────────────────────────────────────────
// chrome.storage.local is capped at ~10 MB. IndexedDB has no practical limit
// and persists forever. We write every logEvent here (fire-and-forget) so the
// full history survives across SW restarts, browser restarts, and extension updates.
let _logDB = null;

function _getLogDB() {
  if (_logDB) return Promise.resolve(_logDB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sbProLog', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('events')) {
        const store = db.createObjectStore('events', { autoIncrement: true });
        store.createIndex('by_ts', 'ts', { unique: false });
      }
    };
    req.onsuccess = e => {
      _logDB = e.target.result;
      // Reset cache if the connection is closed unexpectedly (quota eviction,
      // another tab calls deleteDatabase, version conflict) so the next write
      // re-opens it instead of using a dead handle forever.
      _logDB.addEventListener('close', () => { _logDB = null; });
      _logDB.addEventListener('error', () => { _logDB = null; });
      resolve(_logDB);
    };
    req.onerror   = ()  => reject(req.error);
    req.onblocked = ()  => { _logDB = null; reject(new Error('IDB blocked')); };
  });
}

function _writeLogToDB(entry) {
  _getLogDB()
    .then(db => {
      const tx = db.transaction('events', 'readwrite');
      tx.objectStore('events').add(entry);
      // Reset on transaction failure so the next write re-opens the connection
      // instead of re-using a handle that is no longer valid.
      tx.onerror = () => { _logDB = null; };
    })
    .catch(() => { _logDB = null; }); // allow reconnect on next write attempt
}

async function _readLogsFromDB(since = 0) {
  try {
    const db = await _getLogDB();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction('events', 'readonly');
      const store = tx.objectStore('events');
      const idx   = store.index('by_ts');
      const range = since > 0 ? IDBKeyRange.lowerBound(since) : null;
      const req   = range ? idx.getAll(range) : idx.getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror   = ()  => reject(req.error);
    });
  } catch (_) { return []; }
}

async function _clearLogDB() {
  try {
    const db = await _getLogDB();
    await new Promise((res, rej) => {
      const req = db.transaction('events', 'readwrite').objectStore('events').clear();
      req.onsuccess = res; req.onerror = rej;
    });
  } catch (_) {}
}

// ── Persistent session log (short-term chrome.storage cache) ──────────────────
// Used to restore _eventLog on SW restart so GET_EVENT_LOG works immediately.
const LOG_PERSIST_INTERVAL  = 15000; // 15s
const LOG_PERSIST_BATCH_SIZE = 20;
let _logDirty = 0;
let _logFlushTimer = null;

async function _persistLog() {
  _logFlushTimer = null;
  if (_logDirty === 0) return;
  _logDirty = 0;
  try {
    // _eventLog is already pre-seeded from storage at startup via _restoreLog().
    // Do NOT re-read persistedLog here — merging storage + _eventLog duplicates every
    // entry that existed before this flush (they appear in both sources).
    await chrome.storage.local.set({ persistedLog: _eventLog.slice(-PERSIST_LOG_MAX) });
  } catch (_) {}
}

function _schedulePersist() {
  _logDirty++;
  if (_logDirty >= LOG_PERSIST_BATCH_SIZE) {
    clearTimeout(_logFlushTimer);
    _persistLog();
  } else if (!_logFlushTimer) {
    _logFlushTimer = setTimeout(_persistLog, LOG_PERSIST_INTERVAL);
  }
}

// Restore persisted log into in-memory buffer on startup
async function _restoreLog() {
  try {
    const { persistedLog = [] } = await chrome.storage.local.get('persistedLog');
    for (const entry of persistedLog.slice(-EVENT_MAX)) _eventLog.push(entry);
  } catch (_) {}
}

function logEvent(source, level, message, data = {}) {
  // Capture abbreviated call-site stack for error-level events so the log
  // shows where the problem originated without flooding the entry.
  if (level === 'error') {
    try {
      const frames = new Error().stack?.split('\n').slice(2, 4)
        .map(s => s.replace(/\s+at\s+/, '').trim());
      if (frames?.length) data = { ...data, _stack: frames.join(' → ') };
    } catch (_) {}
  }
  const entry = { source, level, message, data, ts: Date.now() };
  _eventLog.push(entry);
  if (_eventLog.length > EVENT_MAX) _eventLog.shift();
  _writeLogToDB(entry);   // permanent all-time storage (IndexedDB)
  _schedulePersist();     // short-term cache (chrome.storage for SW restart restore)
}

// tabId → { total, network, dom, youtube, twitch, amazon, general }
const _navStart   = new Map(); // tabId → timestamp of last navigation
const _navCounting = new Set(); // tabIds currently in countNetworkBlocks (prevent concurrent calls)
const _navCounted  = new Set(); // tabIds already counted this navigation

// ── Retry queue for failed filter fetches ─────────────────────────────────
// Lists that fail during sync are queued for a single retry 5 minutes later.
// This recovers from transient network blips without waiting 12 hours.
let _retryQueue = []; // [{ list, limit, reason }]

async function _retryFailedLists() {
  if (_retryQueue.length === 0) return;
  // Don't run concurrently with a full sync — both update DNR rules and can
  // collide. Reschedule for 2 minutes later when the sync will have finished.
  if (_syncLock) {
    logEvent('filter-sync', 'info', 'Retry deferred: full sync in progress, rescheduling in 2m');
    try { await chrome.alarms.create('retrySync', { delayInMinutes: 2 }); } catch (_) {}
    return;
  }
  const toRetry = _retryQueue.splice(0);
  _startKeepAlive('_retryFailedLists');
  logEvent('filter-sync', 'info', `Retrying ${toRetry.length} failed list(s)`, { lists: toRetry.map(l => l.list.name) });
  try {
  const FETCH_TIMEOUT = 15000;
  const results = await Promise.allSettled(
    toRetry.map(({ list, limit }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      return fetch(list.url, { cache: 'no-cache', signal: controller.signal })
        .then(res => { clearTimeout(timer); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text().then(text => ({ list, limit, text })); })
        .catch(err => { clearTimeout(timer); throw err; });
    })
  );
  const newRules = [];
  const retryCosmeticsToMerge = [];
  const retryDomCosToMerge = [];
  const retryScriptletsToMerge = [];
  const retryRemoveParams = []; // collected to merge into aggregated removeParamData
  for (const result of results) {
    if (result.status === 'rejected') {
      logEvent('filter-sync', 'warn', `Retry failed: ${result.reason?.message}`);
      continue;
    }
    const { list, limit, text } = result.value;
    try {
      const { rules, cosmetics, domainCosmetics, scriptletRules, removeParams } =
        parseFilterList(text, list.start, limit);
      newRules.push(...rules);
      retryCosmeticsToMerge.push(...cosmetics);
      retryDomCosToMerge.push(domainCosmetics);
      retryScriptletsToMerge.push(scriptletRules);
      if (removeParams) retryRemoveParams.push(removeParams);
      await chrome.storage.local.set({
        [`fr_${list.key}`]:  rules,
        [`fm_${list.key}`]:  { at: Date.now(), count: rules.length },
        [`fc_${list.key}`]:  cosmetics,
        [`fd_${list.key}`]:  domainCosmetics,
        [`fs_${list.key}`]:  scriptletRules,
        [`frp_${list.key}`]: { global: removeParams?.global ?? [], domain: removeParams?.domain ?? [] },
      });
      logEvent('filter-sync', 'info', `Retry OK: ${list.name} — ${rules.length} rules`);
    } catch (e) { logEvent('filter-sync', 'warn', `Retry parse failed: ${list.name}`); }
  }
  // Incrementally add recovered rules (don't do a full re-swap — just append)
  if (newRules.length > 0) {
    try {
      const existing = await chrome.declarativeNetRequest.getDynamicRules();
      const existingIds = new Set(existing.map(r => r.id));
      const uniqueNew = filterStaticConflicts(newRules.filter(r => !existingIds.has(r.id)));
      const budget = 5000 - existing.length;
      if (budget > 0 && uniqueNew.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: uniqueNew.slice(0, budget) });
        logEvent('filter-sync', 'info', `Retry: added ${Math.min(uniqueNew.length, budget)} rules`);
      }
    } catch (e) { logEvent('filter-sync', 'warn', `Retry DNR apply failed: ${e.message}`); }
  }
  // Merge recovered cosmetics/scriptlets into aggregated caches so new navigations
  // pick them up immediately — without this, they would be absent until the next full sync
  if (retryCosmeticsToMerge.length > 0 || retryDomCosToMerge.length > 0 || retryScriptletsToMerge.length > 0) {
    try {
      const { cosmeticSelectors = [], domainCosmetics: aggDomCos = {}, scriptletRules: aggSR = {} } =
        await chrome.storage.local.get(['cosmeticSelectors', 'domainCosmetics', 'scriptletRules']);
      const mergedCos = [...new Set([...cosmeticSelectors, ...retryCosmeticsToMerge])];
      const mergedDomCos = { ...aggDomCos };
      for (const dc of retryDomCosToMerge) {
        for (const [dom, sels] of Object.entries(dc)) {
          if (!mergedDomCos[dom]) mergedDomCos[dom] = [];
          mergedDomCos[dom].push(...sels);
        }
      }
      const mergedSR = { ...aggSR };
      for (const sr of retryScriptletsToMerge) {
        for (const [dom, rules] of Object.entries(sr)) {
          if (!mergedSR[dom]) mergedSR[dom] = [];
          mergedSR[dom].push(...rules);
        }
      }
      await chrome.storage.local.set({
        cosmeticSelectors: mergedCos,
        domainCosmetics:   mergedDomCos,
        scriptletRules:    mergedSR,
      });
    } catch (e) { logEvent('filter-sync', 'warn', `Retry cosmetics merge failed: ${e.message}`); }
  }
  // Merge recovered removeparam data into the aggregated cache and re-apply DNR rules.
  // Without this, frp_* per-list keys are updated but removeParamData (read by
  // applyRemoveParamRules) stays stale — recovered $removeparam rules are silently inactive.
  if (retryRemoveParams.length > 0) {
    try {
      const { removeParamData = { global: [], domain: [] } } =
        await chrome.storage.local.get('removeParamData');
      const mergedGlobal = new Set(removeParamData.global ?? []);
      const mergedDomain = [...(removeParamData.domain ?? [])];
      for (const rp of retryRemoveParams) {
        for (const p of rp.global ?? []) mergedGlobal.add(p);
        mergedDomain.push(...(rp.domain ?? []));
      }
      await chrome.storage.local.set({
        removeParamData: { global: [...mergedGlobal], domain: mergedDomain },
      });
      await applyRemoveParamRules();
    } catch (e) { logEvent('filter-sync', 'warn', `Retry removeparam merge failed: ${e.message}`); }
  }
  } finally { _stopKeepAlive(); }
}

// ── Network connectivity gate ─────────────────────────────────────────────
// navigator.onLine is available in MV3 service workers on both Chrome and Firefox.
// It returns false ONLY when the OS reports the network interface is down — it
// cannot detect a captive portal or a working interface with no DNS. That edge
// case is acceptable: filter fetches will simply fail and get queued for retry.
// We avoid a real HEAD request here because that would consume quota and add
// latency on every sync cycle.
async function _isOnline() {
  // Primary: trust the platform's network state flag
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  // navigator.onLine is undefined in some early Firefox 128 SW builds — fall back true
  // (let the actual fetch attempt determine reachability)
  return true;
}


function incrementStat(type, tabId) {
  // Update per-page stats synchronously (in-memory only)
  if (tabId) {
    const ps = _pageStats.get(tabId) ?? { total:0, network:0, dom:0, amazon:0, general:0, social:0, cookies:0 };
    ps.total = (ps.total | 0) + 1;
    ps.dom   = (ps.dom   | 0) + 1;
    // Record every stat type per-tab so the popup "This page" breakdown is complete
    ps[type] = (ps[type] | 0) + 1;
    _pageStats.set(tabId, ps);
  }
  // Accumulate — flush to storage in a single write after 500ms idle
  _pendingStats[type] = (_pendingStats[type] ?? 0) + 1;
  _pendingTimeSaved  += TIME_SAVED_SECONDS[type] ?? 2;
  const pending = Object.values(_pendingStats).reduce((a, b) => a + b, 0);
  if (pending >= 20) {
    clearTimeout(_pendingFlush);
    _flushStats(); // flush immediately when backlog hits 20
  } else if (!_pendingFlush) {
    _pendingFlush = setTimeout(_flushStats, 500);
  }
}

function logBlockedRequest(url, tabId) {
  try {
    const hostname = new URL(url).hostname;
    _requestLog.push({ url: hostname, ts: Date.now(), tabId });
    if (_requestLog.length > LOG_MAX) _requestLog.shift();
    // Track domain frequency for the top-blocked-domains panel
    _domainStats.set(hostname, (_domainStats.get(hostname) || 0) + 1);
    // Evict lowest-count entries if over limit — keeps high-frequency domains, drops noise
    if (_domainStats.size > DOMAIN_STATS_MAX) {
      const sorted = [..._domainStats.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < 200; i++) _domainStats.delete(sorted[i][0]); // drop bottom 200
    }
  } catch (_) {}
}

// Real-time log via declarativeNetRequestFeedback (dev mode + production with permission)
try {
  chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
    logBlockedRequest(info.request.url, info.request.tabId);
  });
} catch (_) {}

async function countNetworkBlocks(tabId, url) {
  if (_navCounted.has(tabId) || _navCounting.has(tabId)) return;
  // getMatchedRules is not implemented in Firefox — skip gracefully
  if (!chrome.declarativeNetRequest.getMatchedRules) {
    _navCounted.add(tabId);
    return;
  }
  _navCounting.add(tabId);
  try {
    const minTs = _navStart.get(tabId) ?? (Date.now() - 30000);
    const matched = await chrome.declarativeNetRequest.getMatchedRules({ tabId, minTimeStamp: minTs });
    const count = matched?.rulesMatchedInfo?.length ?? 0;
    _navCounted.add(tabId); // only mark as counted after successful API call
    // Log each matched rule for the request log panel
    matched?.rulesMatchedInfo?.forEach(m => {
      try { logBlockedRequest(m.request?.url || url, tabId); } catch(_) {}
    });
    if (count === 0) return;

    const ps = _pageStats.get(tabId) ?? { total:0, network:0, dom:0, youtube:0, twitch:0, amazon:0, general:0, social:0, cookies:0 };
    ps.total   = (ps.total   | 0) + count;
    ps.network = (ps.network | 0) + count;
    const cat = url?.includes('twitch.tv')  ? 'twitch'
              : url?.includes('amazon.')     ? 'amazon'
              : 'general';
    ps[cat] = (ps[cat] | 0) + count;
    _pageStats.set(tabId, ps);

    _statQueue = _statQueue.then(async () => {
      try {
        const { stats, lifetime } = await chrome.storage.local.get(['stats','lifetime']);
        const s  = stats   ?? { total:0, youtube:0, twitch:0, spotify:0, hulu:0, kick:0, amazon:0, general:0, social:0, cookies:0 };
        const lt = lifetime ?? { total:0 };
        s.total  = (s.total  | 0) + count;
        s[cat]   = (s[cat]   | 0) + count;
        lt.total = (lt.total | 0) + count;
        await chrome.storage.local.set({ stats: s, lifetime: lt });
        try {
          chrome.action.setBadgeText({ text: formatBadge(s.total) });
          // Honour badgeEnabled — don't re-show the badge if the user turned it off
          const { settings: _bs } = await chrome.storage.local.get('settings');
          if (_bs?.badgeEnabled === false) chrome.action.setBadgeText({ text: '' });
        } catch (_) {}
      } catch (_) {}
    });
  } catch (_) {}
  finally { _navCounting.delete(tabId); }
}

// ── Tab lifecycle ──────────────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  _pageStats.delete(tabId);
  _navStart.set(tabId, Date.now());
  _navCounted.delete(tabId);
  _navCounting.delete(tabId);

  // ── Safe browsing check ──────────────────────────────────────────────────
  if (!url?.startsWith('http')) return;
  try {
    const s = await getSettings();
    if (!s.safeBrowsing) return;
    if (await isSafeBrowsingAllowed(url)) return;
    if (checkSafeBrowsing(url)) {
      const warningUrl = chrome.runtime.getURL('blocked.html') + '?url=' + encodeURIComponent(url);
      await chrome.tabs.update(tabId, { url: warningUrl });
      logEvent('safe-browsing', 'warn', `Blocked malicious URL: ${new URL(url).hostname}`);
    }
  } catch (_) {}
});

chrome.webNavigation.onCompleted.addListener(({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
      url.startsWith('moz-extension://') || url.startsWith('about:') || url.startsWith('file://')) return;
  setTimeout(() => countNetworkBlocks(tabId, url), 300);
});

// Clean up Maps when tab is closed (prevent memory leak)
chrome.tabs.onRemoved.addListener((tabId) => {
  _pageStats.delete(tabId);
  _navStart.delete(tabId);
  _navCounted.delete(tabId);
  _navCounting.delete(tabId);
});

// ── Filter Sync ────────────────────────────────────────────────────────────

let _syncLock = false;
let _lastSyncError = null;
let _syncListStatus = {}; // { [key]: { status:'ok'|'error'|'cached'|'304', ruleCount, error? } }

// ── Service worker keep-alive ──────────────────────────────────────────────
// Chrome MV3 kills the service worker after ~30 seconds of inactivity.
// A full filter sync fetches 30+ lists and can easily exceed that on a slow
// connection. When Chrome kills the SW mid-fetch, all in-flight requests are
// aborted silently — no error is recorded, no retry is queued, and the next
// attempt is 12 hours away via the filterSync alarm.
//
// Fix: call any chrome API every 20 seconds while a sync is active. Any
// chrome API call resets the SW idle timer. We use chrome.storage.local.get
// with a dummy key — it's cheap (no disk read if key is absent), available
// on both Chrome and Firefox, and has no side effects.
//
// setInterval is intentionally used here rather than a recursive setTimeout:
// the interval is cleared in a finally block, so a crash or early return
// can't cause it to leak. The interval itself also keeps the SW alive since
// the callback re-registers the timer.
let _keepAliveTimer = null;

function _startKeepAlive(label) {
  if (_keepAliveTimer) return; // already running (nested call guard)
  _keepAliveTimer = setInterval(() => {
    chrome.storage.local.get('__ka').catch(() => {}); // reset idle timer
  }, 20000); // 20s < Chrome's 30s idle threshold
  logEvent('system', 'info', `Keep-alive started (${label})`);
}

function _stopKeepAlive() {
  if (!_keepAliveTimer) return;
  clearInterval(_keepAliveTimer);
  _keepAliveTimer = null;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── $removeparam engine ────────────────────────────────────────────────────
// Strips tracking query parameters before the browser sends the request.
// Uses DNR redirect+queryTransform — zero performance cost in the page,
// handled entirely by the browser's network stack.
//
// Strategy:
//   1. Collect params from all synced filter lists (EasyPrivacy alone has ~800)
//   2. Merge with STATIC_REMOVE_PARAMS (hardcoded, always applied)
//   3. Consolidate into as few DNR rules as possible:
//      - ONE global rule covers all params with no domain constraint
//      - One rule per unique domain-scope group (usually <20 total)
// ══════════════════════════════════════════════════════════════════════════════

async function applyRemoveParamRules() {
  try {
    const settings = await getSettings();
    const existingRpRules = await chrome.declarativeNetRequest.getDynamicRules();
    const rpRemoveIds = existingRpRules
      .filter(r => r.id >= REMOVEPARAM_BASE && r.id < MATRIX_BASE)
      .map(r => r.id);

    if (!settings.tracking) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rpRemoveIds, addRules: [] });
      return;
    }

    const { removeParamData = null, userRemoveParams = null } =
      await chrome.storage.local.get(['removeParamData', 'userRemoveParams']);

    const globalParams = new Set(STATIC_REMOVE_PARAMS);
    const domainGroups = [];

    if (removeParamData) {
      for (const p of removeParamData.global ?? []) globalParams.add(p);
      for (const g of removeParamData.domain ?? []) domainGroups.push(g);
    }
    if (userRemoveParams) {
      for (const p of userRemoveParams.global ?? []) globalParams.add(p);
      for (const g of userRemoveParams.domain ?? []) domainGroups.push(g);
    }

    const newRules = [];
    let idCursor = REMOVEPARAM_BASE;

    const chunkParams = (params, max = 80) => {
      const sorted = [...new Set(params)].sort();
      const chunks = [];
      for (let i = 0; i < sorted.length; i += max) chunks.push(sorted.slice(i, i + max));
      return chunks;
    };

    // Global rules — split large lists so one oversized queryTransform does not
    // make Chrome reject every removeparam rule in the batch.
    for (const params of chunkParams(globalParams)) {
      newRules.push({
        id: idCursor++,
        priority: 3, // above filter block rules (priority 2) so param strip runs first
        action: {
          type: 'redirect',
          redirect: {
            transform: {
              queryTransform: { removeParams: params },
            },
          },
        },
        condition: {
          urlFilter: '|http',
          resourceTypes: ['main_frame', 'sub_frame'],
        },
      });
      if (idCursor > REMOVEPARAM_BASE + 999) break;
    }

    // Domain-scoped rules (e.g. remove 'ref' only on amazon.com)
    for (const group of domainGroups) {
      if (!group.params?.length) continue;
      for (const params of chunkParams(group.params)) {
        const condition = {
          urlFilter: '|http',
          resourceTypes: ['main_frame', 'sub_frame'],
        };
        if (group.initDomains?.length) condition.initiatorDomains = group.initDomains;
        if (group.exclDomains?.length) condition.excludedInitiatorDomains = group.exclDomains;
        newRules.push({
          id: idCursor++,
          priority: 4, // domain-specific beats global
          action: {
            type: 'redirect',
            redirect: { transform: { queryTransform: { removeParams: params } } },
          },
          condition,
        });
        if (idCursor > REMOVEPARAM_BASE + 999) break; // safety cap
      }
      if (idCursor > REMOVEPARAM_BASE + 999) break;
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: rpRemoveIds,
      addRules: newRules,
    });

    logEvent('removeparam', 'info',
      `Applied ${newRules.length} removeparam rules (${globalParams.size} global params, ${domainGroups.length} domain groups)`);
  } catch (e) {
    logEvent('removeparam', 'warn', `applyRemoveParamRules failed: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// ── Per-domain filtering matrix ───────────────────────────────────────────
// Lets users block specific resource types from third parties on a per-site basis.
// Think uBlock's advanced mode — a matrix of origin × resource-type → block/allow.
//
// Storage: filterMatrix: { [hostname]: { [ruleKey]: 'block'|'allow'|'default' } }
// Rule keys: '3p-scripts', '3p-frames', '3p-xhr', '3p-images', '3p-all'
// DNR rules: priority 10 (above filter rules at 2, below pause-all at 10000)
// ══════════════════════════════════════════════════════════════════════════════

const MATRIX_RULE_KEYS = {
  '3p-scripts': { resourceTypes: ['script'],                   domainType: 'thirdParty' },
  '3p-frames':  { resourceTypes: ['sub_frame'],                 domainType: 'thirdParty' },
  '3p-xhr':     { resourceTypes: ['xmlhttprequest', 'ping'],   domainType: 'thirdParty' },
  '3p-images':  { resourceTypes: ['image', 'media', 'font'],   domainType: 'thirdParty' },
  '3p-all':     { resourceTypes: ['script','sub_frame','xmlhttprequest','image','media','font','stylesheet','other'], domainType: 'thirdParty' },
};

async function applyMatrixRules() {
  try {
    const { filterMatrix = {} } = await chrome.storage.local.get('filterMatrix');

    const newRules = [];
    let idCursor = MATRIX_BASE;

    for (const [hostname, rules] of Object.entries(filterMatrix)) {
      for (const [ruleKey, action] of Object.entries(rules)) {
        if (action !== 'block' && action !== 'allow') continue;
        const def = MATRIX_RULE_KEYS[ruleKey];
        if (!def) continue;
        newRules.push({
          id: idCursor++,
          priority: 10,
          action: { type: action },
          condition: {
            urlFilter: '|http',
            initiatorDomains: [hostname],
            resourceTypes: def.resourceTypes,
            domainType: def.domainType,
          },
        });
        if (idCursor > MATRIX_BASE + 999) break;
      }
      if (idCursor > MATRIX_BASE + 999) break;
    }

    // Swap existing matrix rules: only remove IDs actually present
    const existingMxRules = await chrome.declarativeNetRequest.getDynamicRules();
    const mxRemoveIds = existingMxRules
      .filter(r => r.id >= MATRIX_BASE && r.id < 32000)
      .map(r => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: mxRemoveIds,
      addRules: newRules,
    });

    logEvent('matrix', 'info', `Applied ${newRules.length} matrix rules across ${Object.keys(filterMatrix).length} domains`);
  } catch (e) {
    logEvent('matrix', 'warn', `applyMatrixRules failed: ${e.message}`);
  }
}

async function setMatrixRule(hostname, ruleKey, action) {
  const { filterMatrix = {} } = await chrome.storage.local.get('filterMatrix');
  if (!filterMatrix[hostname]) filterMatrix[hostname] = {};
  if (action === 'default') {
    delete filterMatrix[hostname][ruleKey];
    if (!Object.keys(filterMatrix[hostname]).length) delete filterMatrix[hostname];
  } else {
    filterMatrix[hostname][ruleKey] = action;
  }
  await chrome.storage.local.set({ filterMatrix });
  await applyMatrixRules();
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Safe browsing ─────────────────────────────────────────────────────────
// Downloads malware/phishing domain lists and checks navigations against them.
// Sources used (all free, no API key required):
//   urlhaus.abuse.ch  — active malware distribution URLs (updated hourly)
//   openphish.com     — phishing URLs (updated every 30 min)
// Blocked URLs redirect to a local warning page with option to proceed.
// ══════════════════════════════════════════════════════════════════════════════

let _safeBrowsingDomains = new Set(); // in-memory for fast synchronous lookup
const SB_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SB_ALLOW_TTL_MS = 10 * 60 * 1000;

// urlhaus/openphish list malicious *URLs*. We can only block at domain
// granularity, so when malware is hosted on a *path* of a shared platform
// (github.com/u/repo, drive.google.com/file/…) extracting the bare hostname
// blocks the entire legitimate domain — a false positive. Never block these
// shared-hosting platforms or top-reputation apexes (matched incl. subdomains).
// Malware feeds list URLs on shared platforms (github.com/foo) — never keep apex hosts.
function sanitizeSbDomains(domains) {
  const out = [];
  for (const d of domains) {
    const h = String(d).replace(/^www\./, '');
    if (h && !isSafeBrowsingAllowlisted(h)) out.push(h);
  }
  return out;
}

async function loadSafeBrowsingCache() {
  try {
    const { sbDomains = [], sbLastFetch = 0 } = await chrome.storage.local.get(['sbDomains', 'sbLastFetch']);
    const cleaned = sanitizeSbDomains(sbDomains);
    _safeBrowsingDomains = new Set(cleaned);
    if (cleaned.length !== sbDomains.length) {
      await chrome.storage.local.set({ sbDomains: cleaned });
      logEvent('safe-browsing', 'info', `Purged ${sbDomains.length - cleaned.length} allowlisted false positives from cache`);
    }
    logEvent('safe-browsing', 'info', `Loaded ${_safeBrowsingDomains.size} domains from cache`);
    // Refresh if stale
    if (Date.now() - sbLastFetch > SB_REFRESH_INTERVAL_MS) await fetchSafeBrowsingLists();
  } catch (e) {
    logEvent('safe-browsing', 'warn', `Cache load failed: ${e.message}`);
  }
}

async function fetchSafeBrowsingLists() {
  _startKeepAlive('fetchSafeBrowsingLists');
  try {
    const sources = [
    {
      url: 'https://urlhaus.abuse.ch/downloads/text_recent/',
      parse: (text) => {
        const domains = new Set();
        for (const line of text.split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          try {
            const h = new URL(t).hostname.replace(/^www\./, '');
            if (!isSafeBrowsingAllowlisted(h)) domains.add(h);
          } catch (_) {}
        }
        return domains;
      },
    },
    {
      url: 'https://openphish.com/feed.txt',
      parse: (text) => {
        const domains = new Set();
        for (const line of text.split('\n')) {
          const t = line.trim();
          if (!t || t.startsWith('#')) continue;
          try {
            const h = new URL(t).hostname.replace(/^www\./, '');
            if (!isSafeBrowsingAllowlisted(h)) domains.add(h);
          } catch (_) {}
        }
        return domains;
      },
    },
  ];

  const merged = new Set();
  for (const source of sources) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(source.url, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      for (const d of source.parse(text)) merged.add(d);
    } catch (e) {
      logEvent('safe-browsing', 'warn', `Fetch failed (${source.url}): ${e.message}`);
    }
  }

  if (merged.size > 0) {
    const cleaned = sanitizeSbDomains(merged);
    _safeBrowsingDomains = new Set(cleaned);
    await chrome.storage.local.set({ sbDomains: cleaned, sbLastFetch: Date.now() });
    logEvent('safe-browsing', 'info', `Updated: ${cleaned.length} malicious domains`);
  }
  } finally { _stopKeepAlive(); }
}

function checkSafeBrowsing(url) {
  if (!_safeBrowsingDomains.size) return false;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (isSafeBrowsingAllowlisted(hostname)) return false; // never block trusted platforms
    if (_safeBrowsingDomains.has(hostname)) return true;
    // Parent-domain match — but never block if the matched apex is allowlisted
    // (feeds must not list github.com, but sanitize + this guard are belt-and-suspenders).
    const parts = hostname.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (isSafeBrowsingAllowlisted(parent)) return false;
      if (_safeBrowsingDomains.has(parent)) return true;
    }
  } catch (_) {}
  return false;
}


// Allow/block is keyed by HOSTNAME, not the exact URL: the blocked page
// navigates to a normalized URL (and the user then clicks around the site),
// so an exact-URL match would re-block immediately after "Proceed anyway".
async function isSafeBrowsingAllowed(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const { safeBrowsingAllow = {}, sbUserAllow = [] } =
      await chrome.storage.local.get(['safeBrowsingAllow', 'sbUserAllow']);
    // Permanent, user-chosen "always allow this site" exceptions (incl. subdomains).
    if (Array.isArray(sbUserAllow) &&
        sbUserAllow.some(d => host === d || host.endsWith('.' + d))) return true;
    // Short-lived "Proceed anyway" exceptions with a TTL.
    const now = Date.now();
    let changed = false;
    for (const [allowedHost, expiry] of Object.entries(safeBrowsingAllow)) {
      if (!expiry || expiry <= now) {
        delete safeBrowsingAllow[allowedHost];
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ safeBrowsingAllow });
    return (safeBrowsingAllow[host] ?? 0) > now;
  } catch (_) {
    return false;
  }
}

async function allowSafeBrowsingUrl(url) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const { safeBrowsingAllow = {} } = await chrome.storage.local.get('safeBrowsingAllow');
    safeBrowsingAllow[host] = Date.now() + SB_ALLOW_TTL_MS;
    await chrome.storage.local.set({ safeBrowsingAllow });
    return true;
  } catch (_) {
    return false;
  }
}

// "Always allow this site" — a permanent safe-browsing exception, kept separate
// from the ad-blocking whitelist so the two trust decisions don't bleed together.
async function allowSafeBrowsingSitePermanent(url) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const { sbUserAllow = [] } = await chrome.storage.local.get('sbUserAllow');
    const list = Array.isArray(sbUserAllow) ? sbUserAllow : [];
    if (!list.includes(host)) { list.push(host); await chrome.storage.local.set({ sbUserAllow: list }); }
    return true;
  } catch (_) {
    return false;
  }
}

// ── Referrer stripping ─────────────────────────────────────────────────────
// Remove the Referer header from all cross-origin requests via DNR modifyHeaders.
// This prevents sites from seeing which page you came from.
// Complements inject-privacy.js's document.referrer override (which covers the JS layer).
async function applyReferrerRule(enabled) {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [REFERRER_RULE_ID],
      addRules: enabled ? [{
        id: REFERRER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'remove' }],
        },
        condition: {
          urlFilter: '|http',
          domainType: 'thirdParty',
          resourceTypes: ['sub_frame','stylesheet','image','font','script',
                         'xmlhttprequest','media','websocket','ping','other'],
        },
      }] : [],
    });
    logEvent('referrer', 'info', enabled ? 'Referrer stripping active' : 'Referrer stripping disabled');
  } catch (e) {
    logEvent('referrer', 'warn', `applyReferrerRule failed: ${e.message}`);
  }
}

// ── HTTPS upgrading ────────────────────────────────────────────────────────
// Upgrades http:// navigations to https:// using DNR's native upgradeScheme action.
// Chrome has this built-in since v94; Firefox MV3 supports it from 128.
// One rule covers main frames and sub-frames — zero performance cost.
async function applyHttpsUpgradeRule(enabled) {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [HTTPS_UPGRADE_ID],
      addRules: enabled ? [{
        id: HTTPS_UPGRADE_ID,
        priority: 1,
        action: { type: 'upgradeScheme' },
        condition: {
          urlFilter: '|http://',
          resourceTypes: ['main_frame', 'sub_frame'],
        },
      }] : [],
    });
    logEvent('https', 'info', enabled ? 'HTTPS upgrading active' : 'HTTPS upgrading disabled');
  } catch (e) {
    logEvent('https', 'warn', `applyHttpsUpgradeRule failed: ${e.message}`);
  }
}

// ── Privacy request headers (DNT + Sec-GPC) ───────────────────────────────
// Sets DNT: 1 (Do Not Track) and Sec-GPC: 1 (Global Privacy Control) on all
// outbound requests. Sec-GPC is legally significant — California (CCPA),
// Colorado, and Connecticut law require covered businesses to honour it.
// GPC is already set as a JS navigator property (feature 15 in inject-privacy.js)
// but the HTTP header version is what the spec and regulators actually check.
// DNT is widely ignored but signals user intent and costs nothing to send.
async function applyPrivacyHeadersRule(enabled) {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNT_GPC_RULE_ID],
      addRules: enabled ? [{
        id:       DNT_GPC_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'DNT',     operation: 'set', value: '1' },
            { header: 'Sec-GPC', operation: 'set', value: '1' },
          ],
        },
        condition: {
          urlFilter:     '|http',
          resourceTypes: [
            'main_frame','sub_frame','xmlhttprequest','script',
            'image','stylesheet','font','media','ping','other',
          ],
        },
      }] : [],
    });
    logEvent('privacy-headers', 'info', enabled ? 'DNT+Sec-GPC headers active' : 'DNT+Sec-GPC headers disabled');
  } catch (e) {
    logEvent('privacy-headers', 'warn', `applyPrivacyHeadersRule failed: ${e.message}`);
  }
}

function _appendCachedListData(stored, list, limit, buckets) {
  const cached = stored[`fr_${list.key}`] ?? [];
  buckets.allRules.push(...cached.slice(0, limit));
  buckets.allCosmetics.push(...(stored[`fc_${list.key}`] ?? []));
  const cachedDomCos = stored[`fd_${list.key}`] ?? {};
  for (const [dom, sels] of Object.entries(cachedDomCos)) {
    if (!buckets.allDomainCosmetics[dom]) buckets.allDomainCosmetics[dom] = [];
    buckets.allDomainCosmetics[dom].push(...sels);
  }
  const cachedScriptlets = stored[`fs_${list.key}`] ?? {};
  for (const [dom, rules] of Object.entries(cachedScriptlets)) {
    if (!buckets.allScriptletRules[dom]) buckets.allScriptletRules[dom] = [];
    buckets.allScriptletRules[dom].push(...rules);
  }
  const cachedRp = stored[`frp_${list.key}`];
  if (cachedRp) {
    for (const p of cachedRp.global ?? []) buckets.allRemoveParams.global.add(p);
    buckets.allRemoveParams.domain.push(...(cachedRp.domain ?? []));
  }
  _syncListStatus[list.key] = { status: 'cached', ruleCount: cached.length };
  logEvent('filter-sync', 'warn', `${list.name}: fetch failed — ${cached.length} cached rules reused`);
}

async function syncFilterLists(force = false) {
  if (_syncLock) return;
  _syncLock = true;
  const _syncStart = Date.now();
  let syncFailureCount = 0;
  _syncListStatus = {};
  _startKeepAlive('syncFilterLists'); // prevent SW kill during fetch
  try {
    const s = await getSettings();
    if (!s.general) {
      await clearFilterDynamicRules();
      return;
    }

    // ── Connectivity gate ────────────────────────────────────────────────────
    // Skip sync (don't record failures) if the device appears offline.
    // Retry will be triggered by the next alarm or a manual FORCE_SYNC.
    if (!force && !(await _isOnline())) {
      logEvent('filter-sync', 'warn', 'Sync skipped — device appears offline');
      return;
    }

    logEvent('filter-sync', 'info', `Sync started (force=${force})`);

    // NOTE: we do NOT remove existing rules upfront — that would create a window
    // with zero active rules. Instead we build the new ruleset first, then swap
    // atomically in a single updateDynamicRules call below.

    let allRules = [], allCosmetics = [], allDomainCosmetics = {}, allScriptletRules = {};
    let allRemoveParams = { global: new Set(), domain: [] }; // accumulated across all lists

    // Batch all storage reads — meta (staleness), cached rules, AND stored ETags
    const storeKeys = FILTER_LISTS.flatMap(l => [
      `fm_${l.key}`, `fr_${l.key}`, `fe_${l.key}`,
      `fc_${l.key}`, `fd_${l.key}`, `fs_${l.key}`, `frp_${l.key}`, // cosmetics / domain-cosmetics / scriptlets / removeparam cache
    ]);
    const stored = await chrome.storage.local.get(storeKeys);

    // ── Separate fresh (cached) lists from stale (needs fetch) ────────────────
    const staleLists = [];
    for (const list of FILTER_LISTS) {
      const budget = MAX_FILTER_RULES - allRules.length;
      if (budget <= 0) break;
      const limit = Math.min(list.max, budget);

      const meta = stored[`fm_${list.key}`];
      const age  = meta ? Date.now() - meta.at : Infinity;
      const isStale = force || age > FILTER_TTL;

      if (!isStale) {
        const cached = stored[`fr_${list.key}`] ?? [];
        allRules.push(...cached.slice(0, limit));
        // Restore cached cosmetics — without this, every sync after the first wipes all
        // cosmetic and scriptlet blocking (they only get populated for freshly-fetched lists).
        const cachedCosmetics = stored[`fc_${list.key}`] ?? [];
        allCosmetics.push(...cachedCosmetics);
        const cachedDomCos = stored[`fd_${list.key}`] ?? {};
        for (const [dom, sels] of Object.entries(cachedDomCos)) {
          if (!allDomainCosmetics[dom]) allDomainCosmetics[dom] = [];
          allDomainCosmetics[dom].push(...sels);
        }
        const cachedScriptlets = stored[`fs_${list.key}`] ?? {};
        for (const [dom, rules] of Object.entries(cachedScriptlets)) {
          if (!allScriptletRules[dom]) allScriptletRules[dom] = [];
          allScriptletRules[dom].push(...rules);
        }
        // Restore cached removeparam data — same issue: without this, filter-list-derived
        // $removeparam entries vanish after the first 12h cycle when lists return 304/cached.
        const cachedRp = stored[`frp_${list.key}`];
        if (cachedRp) {
          for (const p of cachedRp.global ?? []) allRemoveParams.global.add(p);
          allRemoveParams.domain.push(...(cachedRp.domain ?? []));
        }
      } else {
        staleLists.push({ list, limit, etag: stored[`fe_${list.key}`] ?? null });
      }
    }

    // ── Fetch stale lists in parallel with 15s timeout ─────────────────────────
    // ETag caching: send If-None-Match so unchanged lists return a 0-byte 304.
    // On 304, re-use the cached rule set — no download, no parse, instant.
    const FETCH_TIMEOUT = 15000;
    if (staleLists.length > 0) {
      const results = await Promise.allSettled(
        staleLists.map(({ list, limit, etag }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
          const headers = {};
          if (etag && !force) headers['If-None-Match'] = etag;
          return fetch(list.url, { cache: 'no-cache', signal: controller.signal, headers })
            .then(res => {
              clearTimeout(timer);
              if (res.status === 304) return { list, limit, notModified: true, etag };
              if (!res.ok) return Promise.reject(new Error(`HTTP ${res.status}`));
              const newEtag = res.headers.get('ETag') ?? null;
              return res.text().then(text => ({ list, limit, text, etag: newEtag }));
            })
            .catch(err => { clearTimeout(timer); return Promise.reject(err); });
        })
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          const failMsg = result.reason?.message ?? 'Unknown error';
          const failedEntry = staleLists[results.indexOf(result)];
          logEvent('filter-sync', 'error', `Fetch failed: ${failedEntry?.list?.name ?? '?'} — ${failMsg}`);
          _lastSyncError = failMsg;
          syncFailureCount++;
          const failKey = failedEntry?.list?.key ?? 'unknown';
          const cached = failedEntry ? (stored[`fr_${failKey}`] ?? []) : [];
          if (failedEntry && cached.length) {
            allRules.push(...cached.slice(0, failedEntry.limit));
            const cachedCosmetics = stored[`fc_${failKey}`] ?? [];
            allCosmetics.push(...cachedCosmetics);
            const cachedDomCos = stored[`fd_${failKey}`] ?? {};
            for (const [dom, sels] of Object.entries(cachedDomCos)) {
              if (!allDomainCosmetics[dom]) allDomainCosmetics[dom] = [];
              allDomainCosmetics[dom].push(...sels);
            }
            const cachedScriptlets = stored[`fs_${failKey}`] ?? {};
            for (const [dom, rules] of Object.entries(cachedScriptlets)) {
              if (!allScriptletRules[dom]) allScriptletRules[dom] = [];
              allScriptletRules[dom].push(...rules);
            }
            const cachedRp = stored[`frp_${failKey}`];
            if (cachedRp) {
              for (const param of cachedRp.global ?? []) allRemoveParams.global.add(param);
              allRemoveParams.domain.push(...(cachedRp.domain ?? []));
            }
            _syncListStatus[failKey] = { status: 'cached', ruleCount: cached.length, error: failMsg };
          } else {
            _syncListStatus[failKey] = { status: 'error', error: failMsg };
          }
          // Queue for a single retry in 5 minutes — recovers from transient network blips.
          // NOTE: cached data + list status were already restored inline above
          // (the if/else on `cached.length`). Do NOT also call _appendCachedListData
          // here — doing so appended cached rules/removeparams a second time and
          // overwrote the 'error' status of a genuinely-failed (uncached) list with
          // a misleading 'cached'/ruleCount:0.
          if (failedEntry) {
            _retryQueue.push({ list: failedEntry.list, limit: failedEntry.limit });
          }
          continue;
        }
        const val = result.value;

        if (val.notModified) {
          // 304 — list unchanged, use cached rules without re-parsing
          const cached = stored[`fr_${val.list.key}`] ?? [];
          allRules.push(...cached.slice(0, val.limit));
          // Also restore cached cosmetics/scriptlets (same fix as non-stale path above)
          const cachedCosmetics = stored[`fc_${val.list.key}`] ?? [];
          allCosmetics.push(...cachedCosmetics);
          const cachedDomCos = stored[`fd_${val.list.key}`] ?? {};
          for (const [dom, sels] of Object.entries(cachedDomCos)) {
            if (!allDomainCosmetics[dom]) allDomainCosmetics[dom] = [];
            allDomainCosmetics[dom].push(...sels);
          }
          const cachedScriptlets = stored[`fs_${val.list.key}`] ?? {};
          for (const [dom, rules] of Object.entries(cachedScriptlets)) {
            if (!allScriptletRules[dom]) allScriptletRules[dom] = [];
            allScriptletRules[dom].push(...rules);
          }
          const cachedRp304 = stored[`frp_${val.list.key}`];
          if (cachedRp304) {
            for (const p of cachedRp304.global ?? []) allRemoveParams.global.add(p);
            allRemoveParams.domain.push(...(cachedRp304.domain ?? []));
          }
          // Refresh the staleness timestamp so we don't re-check too soon
          await chrome.storage.local.set({
            [`fm_${val.list.key}`]: { at: Date.now(), count: cached.length },
          });
          logEvent('filter-sync', 'info', `${val.list.name}: unchanged (304) — ${cached.length} rules reused`);
          _syncListStatus[val.list.key] = { status: '304', ruleCount: cached.length };
          continue;
        }

        try {
          const { rules, cosmetics, domainCosmetics, scriptletRules, removeParams } = parseFilterList(val.text, val.list.start, val.limit);
          allRules.push(...rules);
          allCosmetics.push(...cosmetics);
          // Merge domain cosmetics
          for (const [dom, sels] of Object.entries(domainCosmetics)) {
            if (!allDomainCosmetics[dom]) allDomainCosmetics[dom] = [];
            allDomainCosmetics[dom].push(...sels);
          }
          // Merge scriptlet rules
          for (const [dom, scriptlets] of Object.entries(scriptletRules)) {
            if (!allScriptletRules[dom]) allScriptletRules[dom] = [];
            allScriptletRules[dom].push(...scriptlets);
          }
          // Merge removeparam results
          if (removeParams) {
            for (const p of removeParams.global ?? []) allRemoveParams.global.add(p);
            allRemoveParams.domain.push(...(removeParams.domain ?? []));
          }
          const updates = {
            [`fr_${val.list.key}`]: rules,
            [`fm_${val.list.key}`]: { at: Date.now(), count: rules.length },
            [`fc_${val.list.key}`]: cosmetics,
            [`fd_${val.list.key}`]: domainCosmetics,
            [`fs_${val.list.key}`]: scriptletRules,
            [`frp_${val.list.key}`]: { global: removeParams?.global ?? [], domain: removeParams?.domain ?? [] },
          };
          if (val.etag) updates[`fe_${val.list.key}`] = val.etag;
          await chrome.storage.local.set(updates);
          logEvent('filter-sync', 'info', `${val.list.name}: fetched ${rules.length} rules`);
          _syncListStatus[val.list.key] = { status: 'ok', ruleCount: rules.length };
        } catch (e) {
          logEvent('filter-sync', 'error', `Parse failed: ${val.list.name} — ${e.message}`);
          _syncListStatus[val.list.key] = { status: 'error', error: 'parse: ' + e.message };
          syncFailureCount++;
        }
      }
    }

    // ── Deduplicate: by ID first, then by URL pattern ─────────────────────────
    // URL-level dedup removes rules where two lists block the same domain under
    // different IDs — wastes slots for identical blocking behaviour.
    const seenIds  = new Set();
    const seenUrls = new Set();
    let deduped  = allRules.filter(r => {
      if (!Number.isInteger(r.id) || r.id <= 0)           return false;
      if (!r.action?.type || !r.condition?.urlFilter)      return false;
      const len = r.condition.urlFilter.length;
      if (len < 2 || len >= 2048)                          return false;
      if (seenIds.has(r.id))                               return false;
      // URL dedup: skip if another rule already blocks the exact same pattern
      // for the same set of resource types. Include resource types in the key so
      // type-specific rules (e.g. script-only vs xhr-only for the same URL) are kept.
      const rtKey = (r.condition.resourceTypes ?? []).slice().sort().join(',');
      const urlKey = `${r.action.type}:${r.condition.urlFilter}:${rtKey}`;
      if (seenUrls.has(urlKey))                            return false;
      seenIds.add(r.id);
      seenUrls.add(urlKey);
      return true;
    });

    // Hard-cap at MAX_FILTER_RULES (< 5000) — reserve dynamic-rule headroom for the
    // pause, whitelist, matrix, and privacy rules that share the dynamic ID pool.
    if (deduped.length > MAX_FILTER_RULES) deduped = deduped.slice(0, MAX_FILTER_RULES);
    deduped = filterStaticConflicts(deduped);

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing.filter(r => isFilterListRuleId(r.id)).map(r => r.id);
    const existingSnapshot = existing.filter(r => isFilterListRuleId(r.id)).map(r => ({ ...r }));

    if (deduped.length > 0 || removeIds.length > 0) {
      const firstBatch = deduped.slice(0, 500);
      let swapOk = false;
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: removeIds,
          addRules: firstBatch,
        });
        swapOk = true;
      } catch (e) { logEvent('filter-sync', 'error', `DNR rule swap failed: ${e.message}`); }
      if (swapOk) {
        for (let i = 500; i < deduped.length; i += 500) {
          try {
            await chrome.declarativeNetRequest.updateDynamicRules({ addRules: deduped.slice(i, i + 500) });
          } catch (e) { logEvent('filter-sync', 'error', `DNR batch failed at offset ${i}: ${e.message}`); }
        }
      } else if (existingSnapshot.length > 0) {
        try {
          const currentIds = (await chrome.declarativeNetRequest.getDynamicRules()).map(r => r.id);
          for (let i = 0; i < existingSnapshot.length; i += 500) {
            await chrome.declarativeNetRequest.updateDynamicRules({
              removeRuleIds: i === 0 ? currentIds : [],
              addRules: existingSnapshot.slice(i, i + 500),
            });
          }
          logEvent('filter-sync', 'warn', 'Restored prior dynamic rules after failed swap');
        } catch (e) { logEvent('filter-sync', 'error', `DNR rule restore failed: ${e.message}`); }
      }
    }

    const cosmeticsDeduped = [...new Set(allCosmetics)];

    // Deduplicate domain cosmetics selectors per domain
    const domainCosmeticsFinal = {};
    for (const [dom, sels] of Object.entries(allDomainCosmetics)) {
      domainCosmeticsFinal[dom] = [...new Set(sels)].slice(0, 200); // max 200 per domain
    }

    // Deduplicate scriptlet rules per domain
    const scriptletRulesFinal = {};
    for (const [dom, rules] of Object.entries(allScriptletRules)) {
      const seen = new Set();
      scriptletRulesFinal[dom] = rules.filter(r => {
        const k = r.name + JSON.stringify(r.args);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      }).slice(0, 50); // max 50 scriptlets per domain
    }

    // ── Custom filter list subscriptions (cosmetics + scriptlets only) ──────────
    // Network-level (DNR) rules are skipped — the 5000-rule pool is fully used by
    // the built-in lists. Custom lists contribute CSS selectors and scriptlets.
    try {
      const { customFilterLists = [] } = await chrome.storage.local.get('customFilterLists');
      const activeLists = customFilterLists.filter(l => l.enabled !== false);
      if (activeLists.length > 0) {
        // Load cached data for custom lists (separate read to keep main storeKeys simple)
        const customStoreKeys = activeLists.flatMap(l => [
          `cfc_${l.key}`, `cfdc_${l.key}`, `cfsc_${l.key}`,
          `cfm_${l.key}`, `cfe_${l.key}`,
        ]);
        const customStored = await chrome.storage.local.get(customStoreKeys);

        const customResults = await Promise.allSettled(
          activeLists.map(({ url, key }) => {
            const meta      = customStored[`cfm_${key}`];
            const age       = meta ? Date.now() - meta.at : Infinity;
            const isStale   = force || age > FILTER_TTL;
            if (!isStale) {
              // Use cache
              return Promise.resolve({
                key, notModified: true,
                cosmetics:       customStored[`cfc_${key}`] ?? [],
                domainCosmetics: customStored[`cfdc_${key}`] ?? {},
                scriptletRules:  customStored[`cfsc_${key}`] ?? {},
              });
            }
            const controller = new AbortController();
            const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
            const etag       = customStored[`cfe_${key}`] ?? null;
            const headers    = {};
            if (etag && !force) headers['If-None-Match'] = etag;
            return fetch(url, { cache: 'no-cache', signal: controller.signal, headers })
              .then(res => {
                clearTimeout(timer);
                if (res.status === 304) return {
                  key, notModified: true, etag,
                  cosmetics:       customStored[`cfc_${key}`] ?? [],
                  domainCosmetics: customStored[`cfdc_${key}`] ?? {},
                  scriptletRules:  customStored[`cfsc_${key}`] ?? {},
                };
                if (!res.ok) return Promise.reject(new Error(`HTTP ${res.status}`));
                const newEtag = res.headers.get('ETag') ?? null;
                return res.text().then(text => ({ key, text, etag: newEtag, notModified: false }));
              })
              .catch(err => { clearTimeout(timer); return Promise.reject(err); });
          })
        );

        for (const result of customResults) {
          if (result.status === 'rejected') continue;
          const val = result.value;

          if (val.notModified) {
            cosmeticsDeduped.push(...val.cosmetics);
            for (const [d, sels] of Object.entries(val.domainCosmetics)) {
              if (!domainCosmeticsFinal[d]) domainCosmeticsFinal[d] = [];
              domainCosmeticsFinal[d].push(...sels);
            }
            for (const [d, rules] of Object.entries(val.scriptletRules)) {
              if (!scriptletRulesFinal[d]) scriptletRulesFinal[d] = [];
              scriptletRulesFinal[d].push(...rules);
            }
            // If this was an HTTP 304 (server confirmed fresh), bump the timestamp
            // so we don't check again for another FILTER_TTL period.
            // Local cache hits ('etag' not in val) don't need updating — the timestamp is already recent.
            if ('etag' in val) {
              await chrome.storage.local.set({ [`cfm_${val.key}`]: { at: Date.now() } });
            }
            continue;
          }

          // Freshly fetched — parse cosmetics/scriptlets only (maxRules=0 skips DNR)
          try {
            const { cosmetics, domainCosmetics, scriptletRules } =
              parseFilterList(val.text, 0, 0);
            cosmeticsDeduped.push(...cosmetics);
            for (const [d, sels] of Object.entries(domainCosmetics)) {
              if (!domainCosmeticsFinal[d]) domainCosmeticsFinal[d] = [];
              domainCosmeticsFinal[d].push(...sels);
            }
            for (const [d, rules] of Object.entries(scriptletRules)) {
              if (!scriptletRulesFinal[d]) scriptletRulesFinal[d] = [];
              scriptletRulesFinal[d].push(...rules);
            }
            const updates = {
              [`cfc_${val.key}`]:  cosmetics,
              [`cfdc_${val.key}`]: domainCosmetics,
              [`cfsc_${val.key}`]: scriptletRules,
              [`cfm_${val.key}`]:  { at: Date.now() },
            };
            if (val.etag) updates[`cfe_${val.key}`] = val.etag;
            await chrome.storage.local.set(updates);
          } catch (e) { logEvent('filter-sync', 'warn', `Cosmetic cache write failed: ${e.message}`); }
        }
      }
    } catch (_) {}

    // Persist accumulated removeparam data then apply DNR rules
    await chrome.storage.local.set({
      cosmeticSelectors: cosmeticsDeduped,
      domainCosmetics:   domainCosmeticsFinal,
      scriptletRules:    scriptletRulesFinal,
      filterSyncedAt:    Date.now(),
      filterRuleCount:   deduped.length,
      syncFailures:      syncFailureCount,
      syncDuration:      Date.now() - _syncStart,
      syncListStatus:    _syncListStatus,
      removeParamData:   {
        global: [...allRemoveParams.global],
        domain: allRemoveParams.domain,
      },
    });
    if (syncFailureCount === 0) _lastSyncError = null;

    const duration = Date.now() - _syncStart;
    logEvent('filter-sync', syncFailureCount > 0 ? 'warn' : 'info',
      `Sync complete: ${deduped.length} rules, ${syncFailureCount} failure(s), ${duration}ms`);

    // Re-apply all feature DNR rules. The atomic swap above only removes
    // filter-list rule IDs, but re-applying the privacy/referrer/https/matrix/
    // whitelist/pause rules is idempotent and guards against any drift.
    await reapplyFeatureRules();

    // Schedule a retry in 5 minutes for any lists that failed
    if (_retryQueue.length > 0) {
      try { await chrome.alarms.create('retrySync', { delayInMinutes: 5 }); } catch (_) {}
    }

    // Flush the event log to storage so sync entries survive service worker termination
    await _persistLog();
  } finally {
    _stopKeepAlive();
    _syncLock = false;
  }
}

// ── Whitelist ──────────────────────────────────────────────────────────────

async function getWhitelist() {
  const { whitelist = [] } = await chrome.storage.local.get('whitelist');
  return whitelist;
}

function domainMatchesWhitelist(domain, whitelist) {
  return whitelist.some(d => domain === d || domain.endsWith('.' + d));
}

function _globalPauseRule() {
  return {
    id: PAUSE_ALL_RULE_ID,
    priority: 10000,
    action: { type: 'allow' },
    condition: {
      urlFilter: '*',
      resourceTypes: DNR_RESOURCE_TYPES,
    },
  };
}

async function notifyCompleteTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ status: 'complete' });
    for (const tab of tabs) {
      if (tab?.id != null) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (_) {}
}

async function restoreGlobalPauseRule() {
  try {
    const { globalPause = false } = await chrome.storage.local.get('globalPause');
    const active = globalPause && globalPause.until > Date.now();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [PAUSE_ALL_RULE_ID],
      addRules: active ? [_globalPauseRule()] : [],
    });
    if (!active && globalPause) await chrome.storage.local.set({ globalPause: false });
    return active;
  } catch (e) {
    logEvent('pause', 'warn', `Global pause rule restore failed: ${e.message}`);
    return false;
  }
}

async function applyWhitelistRules() {
  try {
    const { whitelist = [] } = await chrome.storage.local.get('whitelist');
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing
      .filter(r => r.id >= WHITELIST_BASE && r.id < PAUSE_ALL_RULE_ID)
      .map(r => r.id);

    const domains = [...new Set(whitelist)]
      .map(d => String(d).trim().toLowerCase().replace(/^www\./, ''))
      .filter(d => d && d.includes('.') && /^[a-z0-9.-]+$/.test(d))
      .slice(0, Math.floor((PAUSE_ALL_RULE_ID - WHITELIST_BASE) / 2));

    const addRules = [];
    let id = WHITELIST_BASE;
    for (const domain of domains) {
      addRules.push({
        id: id++,
        priority: 10000,
        action: { type: 'allow' },
        condition: {
          requestDomains: [domain],
          resourceTypes: ['main_frame', 'sub_frame'],
        },
      });
      addRules.push({
        id: id++,
        priority: 10000,
        action: { type: 'allow' },
        condition: {
          initiatorDomains: [domain],
          resourceTypes: DNR_RESOURCE_TYPES.filter(t => t !== 'main_frame'),
        },
      });
    }

    if (removeRuleIds.length || addRules.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    }
  } catch (e) {
    logEvent('settings', 'warn', `Whitelist DNR apply failed: ${e.message}`);
  }
}

async function clearFilterDynamicRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing
      .filter(r => r.id >= FILTER_DYNAMIC_START && r.id <= FILTER_DYNAMIC_END)
      .map(r => r.id);
    if (removeRuleIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: [] });
    }
    await chrome.storage.local.set({ filterRuleCount: 0 });
  } catch (e) {
    logEvent('filter-sync', 'warn', `Clearing filter rules failed: ${e.message}`);
  }
}

async function parseAndStoreUserFilterText(text) {
  if (typeof text !== 'string') return;
  const { rules, cosmetics, domainCosmetics, scriptletRules, removeParams } =
    parseFilterList(text, USER_DNR_BASE, USER_DNR_END - USER_DNR_BASE + 1);
  await chrome.storage.local.set({
    userCosmetics:        cosmetics,
    userDomainCosmetics:  domainCosmetics,
    userScriptletRules:   scriptletRules,
    userDnrRules:         rules,
    userRemoveParams:     removeParams,
    userFilterText:       text,
  });
  await applyUserFilterRules();
  await applyRemoveParamRules();
}

async function applySettingsSideEffects(settings, { syncFilters = false } = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  try {
    const en = [], dis = [];
    if (merged.general) en.push('base_rules','extended_rules','hosts_rules');
    else dis.push('base_rules','extended_rules','hosts_rules');
    if (merged.tracking) en.push('tracking_rules'); else dis.push('tracking_rules');
    if (en.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: en });
    if (dis.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: dis });
  } catch (e) {
    logEvent('settings', 'warn', `Settings apply failed: ${e.message}`);
  }

  await Promise.all([
    applyReferrerRule(merged.referrerStrip !== false),
    applyHttpsUpgradeRule(merged.httpsUpgrade !== false),
    applyPrivacyHeadersRule(merged.privacyHeaders !== false),
    applyWhitelistRules(),
    restoreGlobalPauseRule(),
    applyRemoveParamRules(), // self-gates on the tracking toggle
  ]);

  if (merged.general) {
    if (syncFilters) syncFilterLists(false);
  } else {
    await clearFilterDynamicRules();
  }
}

// ── Cloud Sync Push ────────────────────────────────────────────────────────
// Pushes settings, whitelist, userFilterText, and custom list metadata to
// chrome.storage.sync so they are available on other devices.
//
// chrome.storage.sync limits:
//   Total:    102,400 bytes
//   Per-item:   8,192 bytes
//   Writes/min: 1,800
//
// Large fields are size-guarded before writing; customFilterLists is stripped
// down to metadata only (url/name/key/enabled) since cached rule data belongs
// in local storage, not sync.
async function pushToCloud() {
  try {
    const data = await chrome.storage.local.get(
      ['settings', 'whitelist', 'userFilterText', 'customFilterLists']
    );
    const toSync = {};

    if (data.settings) toSync.settings = data.settings;
    if (data.whitelist) toSync.whitelist = data.whitelist;

    // userFilterText: skip if too large for a single sync item (>7KB leaves
    // margin for other items without approaching the 8,192-byte per-item cap)
    if (typeof data.userFilterText === 'string' && data.userFilterText.length <= 7000) {
      toSync.userFilterText = data.userFilterText;
    }

    // customFilterLists: strip cached rule data — only metadata needs to sync
    if (Array.isArray(data.customFilterLists)) {
      toSync.customFilterLists = data.customFilterLists.map(
        ({ url, name, key, enabled }) => ({ url, name: name || url, key, enabled: enabled !== false })
      );
    }

    await chrome.storage.sync.set(toSync);
    logEvent('system', 'info', `Cloud push: ${Object.keys(toSync).join(', ')}`);
    return { ok: true, keys: Object.keys(toSync) };
  } catch (e) {
    logEvent('system', 'warn', `Cloud push failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ── Cosmetic Injection ─────────────────────────────────────────────────────

async function injectCosmetics(tabId, tabUrl) {
  if (!tabUrl || !/^https?:\/\//.test(tabUrl)) return;
  // Merge both storage reads into one so all variables are available before use
  const { cosmeticSelectors, domainCosmetics = {}, scriptletRules = {},
          settings: s, whitelist: wl = [], globalPause = false,
          userCosmetics = [], userDomainCosmetics = {}, userScriptletRules = {} } =
    await chrome.storage.local.get([
      'cosmeticSelectors','domainCosmetics','scriptletRules','settings','whitelist','globalPause',
      'userCosmetics','userDomainCosmetics','userScriptletRules',
    ]);
  if (globalPause && globalPause.until > Date.now()) return;
  if (!s?.cosmetic) return;

  let domain;
  try {
    domain = new URL(tabUrl).hostname.replace(/^www\./, '');
    if (domainMatchesWhitelist(domain, wl)) return;
    // Skip YouTube entirely — no ad blocking there, cosmetics only break the player
    const SKIP_DOMAINS = ['youtube.com','youtu.be','youtube-nocookie.com',
                          'music.youtube.com','tv.youtube.com'];
    if (SKIP_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) return;
  } catch (_) { return; }

  const tabState = _tabCosmeticState.get(tabId) ?? { baseCss: false, css: '' };
  if (!tabState.baseCss) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/cosmetic.css'] });
      tabState.baseCss = true;
    } catch (_) {}
  }

  // ── Inject scriptlets for this domain ──────────────────────────────────────
  // scriptlets.js is already injected at document_start via manifest content_scripts.
  // It defines globalThis.__sbRunScriptlets. We just need to call it with the applicable
  // scriptlets for this domain. No eval — we pass a plain JS object as args.
  const applicable = [
    ...(scriptletRules['*'] || []),
    ...(scriptletRules[domain] || []),
    ...Object.entries(scriptletRules)
       .filter(([d]) => d !== '*' && domain !== d && domain.endsWith('.' + d))
       .flatMap(([, v]) => v),
    // User-defined scriptlets
    ...(userScriptletRules['*'] || []),
    ...(userScriptletRules[domain] || []),
    ...Object.entries(userScriptletRules)
       .filter(([d]) => d !== '*' && domain !== d && domain.endsWith('.' + d))
       .flatMap(([, v]) => v),
  ];
  if (applicable.length > 0) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world:  'MAIN',
        func: (scriptlets) => {
          if (typeof globalThis.__sbRunScriptlets === 'function') {
            globalThis.__sbRunScriptlets(scriptlets);
          } else {
            // Content script hasn't run yet — queue for it to pick up
            globalThis.__sbPendingScriptlets = scriptlets;
          }
        },
        args: [applicable],
      });
    } catch (e) { logEvent('filter-sync', 'warn', `Scriptlet injection failed: ${e.message}`); }
  }

  // userCosmetics / userDomainCosmetics already loaded above

  // Merge global + domain-specific + user-defined cosmetic selectors
  const domainSpecific = [
    ...(domainCosmetics[domain] || []),
    ...Object.entries(domainCosmetics)
       .filter(([d]) => domain.endsWith('.' + d))
       .flatMap(([, v]) => v),
    ...(userDomainCosmetics[domain] || []),
    ...Object.entries(userDomainCosmetics)
       .filter(([d]) => domain.endsWith('.' + d))
       .flatMap(([, v]) => v),
  ];
  const allSelectors = [...(cosmeticSelectors || []), ...userCosmetics, ...domainSpecific];
  if (!allSelectors.length) return;

  const safe = allSelectors
    .slice(0, 5000)
    .filter(sel => sel && typeof sel === 'string' && sel.length < 200 &&
                   !sel.includes('{') && !sel.includes('}') &&
                   !sel.includes('<') && !sel.includes('>'));

  const css = safe.slice(0, 5000).join(',\n') + ' { display:none!important; }';
  if (tabState.css && tabState.css !== css) {
    try { await chrome.scripting.removeCSS({ target: { tabId }, css: tabState.css }); } catch (_) {}
  }
  if (css.length > 30 && tabState.css !== css) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, css });
      tabState.css = css;
    } catch (_) {
      for (let i = 0; i < safe.length; i += 200) {
        const chunk = safe.slice(i, i + 200);
        const chunkCss = chunk.join(',\n') + ' { display:none!important; }';
        try { await chrome.scripting.insertCSS({ target: { tabId }, css: chunkCss }); } catch (_) {}
      }
    }
  }
  _tabCosmeticState.set(tabId, tabState);
}

// ── Messages ───────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from this extension's own contexts (content scripts, popup).
  // External pages cannot send runtime messages, but validating here is defense-in-depth.
  if (sender.id !== chrome.runtime.id) return;
  (async () => {
    switch (msg.type) {

      // License — extension is free, always valid
      case 'GET_LICENSE':
        sendResponse({ key: 'FREE', valid: true });
        break;

      case 'INCREMENT_STAT':
        incrementStat(msg.statType ?? 'general', sender?.tab?.id);
        sendResponse({ ok: true });
        break;
      case 'GET_REQUEST_LOG':
        sendResponse(_requestLog.slice().reverse()); // newest first
        break;
      case 'CLEAR_LOG':
        _requestLog.length = 0;
        sendResponse({ ok: true });
        break;
      case 'ADD_CUSTOM_RULE': {
        const { selector } = msg;
        if (selector) {
          const { customHideRules = [] } = await chrome.storage.local.get('customHideRules');
          if (!customHideRules.includes(selector)) {
            customHideRules.push(selector);
            await chrome.storage.local.set({ customHideRules });
          }
        }
        sendResponse({ ok: true });
        break;
      }
      case 'GET_CUSTOM_RULES': {
        const { customHideRules = [] } = await chrome.storage.local.get('customHideRules');
        sendResponse(customHideRules);
        break;
      }
      case 'PARSE_USER_FILTERS': {
        const { text } = msg;
        if (text && typeof text === 'string') {
          await parseAndStoreUserFilterText(text);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'GET_USER_FILTERS': {
        const { userFilterText = '' } = await chrome.storage.local.get('userFilterText');
        sendResponse(userFilterText);
        break;
      }
      case 'CLEAR_USER_FILTERS': {
        await chrome.storage.local.remove(
          ['userCosmetics','userDomainCosmetics','userScriptletRules','userFilterText',
           'userDnrRules','userRemoveParams']
        );
        await applyUserFilterRules();
        await applyRemoveParamRules();
        sendResponse({ ok: true });
        break;
      }
      case 'FETCH_FILTER_URL': {
        // Popup can't fetch cross-origin URLs (CSP), so background does it.
        // Only allows http/https URLs; enforces a 500KB response size limit.
        const { url: fuUrl } = msg;
        if (!fuUrl || !fuUrl.startsWith('http')) { sendResponse({ ok: false, error: 'Invalid URL' }); break; }
        try {
          const ctrl  = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15000);
          const res   = await fetch(fuUrl, { cache: 'no-cache', signal: ctrl.signal });
          clearTimeout(timer);
          if (!res.ok) { sendResponse({ ok: false, error: `HTTP ${res.status}` }); break; }
          // Content-Length or size guard
          const blob = await res.blob();
          if (blob.size > 524288) { sendResponse({ ok: false, error: 'Response too large (>512KB)' }); break; }
          const text = await blob.text();
          logEvent('import', 'info', `Fetched filter URL: ${fuUrl} (${blob.size} bytes)`);
          sendResponse({ ok: true, text });
        } catch (e) {
          sendResponse({ ok: false, error: e.name === 'AbortError' ? 'Timeout' : e.message });
        }
        break;
      }
      case 'GET_CUSTOM_LISTS': {
        const { customFilterLists = [] } = await chrome.storage.local.get('customFilterLists');
        sendResponse(customFilterLists);
        break;
      }
      case 'ADD_CUSTOM_LIST': {
        // key is a stable slug derived from the URL — used as storage prefix
        const { url: clUrl, name: clName } = msg;
        if (!clUrl || typeof clUrl !== 'string') { sendResponse({ ok: false }); break; }
        let clKey;
        try {
          const u   = new URL(clUrl);
          const slug = (u.hostname + u.pathname).replace(/[^a-z0-9]/gi, '_').slice(0, 24);
          // Append a short hash of the full URL so two lists with identical slugs never collide
          let h = 0x811c9dc5;
          for (let i = 0; i < clUrl.length; i++) h = Math.imul(h ^ clUrl.charCodeAt(i), 0x01000193) >>> 0;
          clKey = slug + '_' + h.toString(16).slice(0, 6);
        } catch (_) { sendResponse({ ok: false, error: 'Invalid URL' }); break; }
        const { customFilterLists = [] } = await chrome.storage.local.get('customFilterLists');
        if (customFilterLists.some(l => l.url === clUrl)) { sendResponse({ ok: false, error: 'Already added' }); break; }
        customFilterLists.push({ url: clUrl, name: clName || clUrl, key: clKey, enabled: true });
        await chrome.storage.local.set({ customFilterLists });
        syncFilterLists(true).catch(e => logEvent('filter-sync', 'warn', `Custom list sync failed: ${e.message}`));
        sendResponse({ ok: true });
        break;
      }
      case 'REMOVE_CUSTOM_LIST': {
        const { key: rlKey } = msg;
        const { customFilterLists = [] } = await chrome.storage.local.get('customFilterLists');
        const updated = customFilterLists.filter(l => l.key !== rlKey);
        await chrome.storage.local.set({ customFilterLists: updated });
        // Clean up cached data for this list
        const keysToRemove = [`cfc_${rlKey}`,`cfdc_${rlKey}`,`cfsc_${rlKey}`,`cfm_${rlKey}`,`cfe_${rlKey}`];
        await chrome.storage.local.remove(keysToRemove);
        syncFilterLists(true).catch(e => logEvent('filter-sync', 'warn', `Custom list removal sync failed: ${e.message}`));
        sendResponse({ ok: true });
        break;
      }
      case 'REMOVE_CUSTOM_RULE': {
        const { customHideRules = [] } = await chrome.storage.local.get('customHideRules');
        const updated = customHideRules.filter(r => r !== msg.selector);
        await chrome.storage.local.set({ customHideRules: updated });
        sendResponse({ ok: true });
        break;
      }
      case 'ACTIVATE_PICKER': {
        // Use tabs.sendMessage (tab-specific) NOT runtime.sendMessage (broadcasts to all tabs)
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id) {
          try { await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_PICKER' }); }
          catch (_) {} // content script may not be ready yet
        }
        sendResponse({ ok: true });
        break;
      }
      case 'GET_DAILY_STATS': {
        const { dailyStats = {} } = await chrome.storage.local.get('dailyStats');
        // Return last 7 days
        const days = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          days.push({ date: d, count: dailyStats[d] || 0 });
        }
        sendResponse(days);
        break;
      }
      case 'GET_STATS': {
        const { stats } = await chrome.storage.local.get('stats');
        sendResponse(stats ?? { total:0, youtube:0, twitch:0, spotify:0, hulu:0, kick:0, amazon:0, general:0, social:0, cookies:0 });
        break;
      }
      case 'GET_LIFETIME': {
        const { lifetime } = await chrome.storage.local.get('lifetime');
        sendResponse(lifetime ?? { total:0 });
        break;
      }
      case 'RESET_STATS':
        await chrome.storage.local.set({ stats: { total:0, youtube:0, twitch:0, spotify:0, hulu:0, kick:0, amazon:0, general:0, social:0, cookies:0 } });
        try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
        sendResponse({ ok: true });
        break;

      case 'GET_SETTINGS': {
        // Bundle whitelist + globalPause into the response so content scripts
        // need only ONE async operation at startup instead of two.
        // Before: await Promise.all([sendMessage(GET_SETTINGS), storage.get(whitelist)])
        // After:  await sendMessage(GET_SETTINGS) — whitelist is included in reply
        const _gs = await getSettings();
        const { whitelist: _wl = [], globalPause: _gp = false } =
          await chrome.storage.local.get(['whitelist', 'globalPause']);
        const _gpActive = _gp && _gp.until > Date.now();
        sendResponse({ ..._gs, whitelist: _wl, globalPause: _gpActive });
        break;
      }
      case 'SET_SETTINGS': {
        if (!msg.settings || typeof msg.settings !== 'object') { sendResponse({ ok: false }); break; }
        const merged = { ...(await getSettings()), ...msg.settings };
        await chrome.storage.local.set({ settings: merged });
        invalidateSettingsCache(); // must invalidate AFTER write, BEFORE any getSettings() calls below
        await applySettingsSideEffects(merged, { syncFilters: 'general' in msg.settings && merged.general });
        if (msg.settings.safeBrowsing === true && _safeBrowsingDomains.size === 0) fetchSafeBrowsingLists().catch(() => {});
        // Auto-push updated settings to chrome.storage.sync (fire-and-forget)
        pushToCloud().catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      case 'GET_PAGE_STATS': {
        try {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (!tab?.id) { sendResponse({ total:0, network:0, dom:0, amazon:0, social:0, cookies:0, general:0 }); break; }
          const isWebPage = tab.url?.startsWith('http://') || tab.url?.startsWith('https://');
          if (!_navCounted.has(tab.id) && isWebPage) {
            await countNetworkBlocks(tab.id, tab.url);
          }
          const ps = _pageStats.get(tab.id) ?? { total:0, network:0, dom:0 };
          sendResponse({
            total:   ps.total   ?? 0,
            network: ps.network ?? 0,
            dom:     ps.dom     ?? 0,
            amazon:  ps.amazon  ?? 0,
            social:  ps.social  ?? 0,
            cookies: ps.cookies ?? 0,
            general: ps.general ?? 0,
          });
        } catch (_) { sendResponse({ total:0, network:0, dom:0 }); }
        break;
      }

      case 'CHECK_UPDATE': {
        try {
          const manifest = chrome.runtime.getManifest();
          const res = await fetch(
            'https://raw.githubusercontent.com/shieldblock/shieldblock/main/version.json',
            { cache: 'no-cache' }
          );
          if (res.ok) {
            const { version: latest } = await res.json();
            const current = manifest.version;
            sendResponse({ current, latest, hasUpdate: latest !== current });
          } else {
            sendResponse({ current: manifest.version, latest: null, hasUpdate: false });
          }
        } catch (_) {
          sendResponse({ current: chrome.runtime.getManifest().version, latest: null, hasUpdate: false });
        }
        break;
      }
      case 'GET_HEALTH_STATUS': {
        // Comprehensive self-test: checks all major subsystems and returns pass/warn/fail per check.
        // Designed to be safe (read-only) and fast (<100ms on any device).
        const checks = [];
        const pass = (name, detail) => checks.push({ name, status: 'pass', detail });
        const warn = (name, detail) => checks.push({ name, status: 'warn', detail });
        const fail = (name, detail) => checks.push({ name, status: 'fail', detail });

        // 1. Dynamic filter rules loaded
        try {
          const dyn = await chrome.declarativeNetRequest.getDynamicRules();
          if (dyn.length > 1000) pass('Filter rules', `${dyn.length} dynamic rules active`);
          else if (dyn.length > 0) warn('Filter rules', `Only ${dyn.length} dynamic rules — sync may be needed`);
          else fail('Filter rules', 'No dynamic rules loaded — click ↺ sync in Stats');
        } catch (e) { fail('Filter rules', e.message); }

        // 2. Static rulesets enabled
        try {
          const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
          if (enabled.length >= 2) pass('Static rulesets', `${enabled.length} rulesets enabled: ${enabled.join(', ')}`);
          else warn('Static rulesets', `Only ${enabled.length} rulesets enabled`);
        } catch (e) { warn('Static rulesets', e.message); }

        // 3. Filter sync recency
        try {
          const { filterSyncedAt, syncFailures = 0 } = await chrome.storage.local.get(['filterSyncedAt','syncFailures']);
          const ageHours = filterSyncedAt ? (Date.now() - filterSyncedAt) / 3600000 : Infinity;
          if (ageHours < 13) pass('Last sync', `${ageHours < 1 ? '<1h' : Math.round(ageHours)+'h'} ago${syncFailures > 0 ? ` (${syncFailures} failures)` : ''}`);
          else if (ageHours < 48) warn('Last sync', `${Math.round(ageHours)}h ago — consider force sync`);
          else fail('Last sync', `${Math.round(ageHours)}h ago — stale filter lists`);
        } catch (e) { warn('Last sync', e.message); }

        // 4. Cosmetics loaded
        try {
          const { cosmeticSelectors = [] } = await chrome.storage.local.get('cosmeticSelectors');
          if (cosmeticSelectors.length > 500) pass('Cosmetics', `${cosmeticSelectors.length} selectors`);
          else warn('Cosmetics', `${cosmeticSelectors.length} selectors — low, sync may be needed`);
        } catch (e) { warn('Cosmetics', e.message); }

        // 5. Safe browsing domains loaded
        if (_safeBrowsingDomains.size > 0)
          pass('Safe browsing', `${_safeBrowsingDomains.size} threat domains in memory`);
        else warn('Safe browsing', 'No threat domains loaded');

        // 6. Removeparam rules active
        try {
          const allRules = await chrome.declarativeNetRequest.getDynamicRules();
          const rpRules  = allRules.filter(r => r.id >= REMOVEPARAM_BASE && r.id < MATRIX_BASE);
          if (rpRules.length > 0) pass('$removeparam', `${rpRules.length} param-stripping rules active`);
          else warn('$removeparam', 'No removeparam rules — sync may be needed');
        } catch (e) { warn('$removeparam', e.message); }

        // 7. Privacy header rules
        try {
          const allRules = await chrome.declarativeNetRequest.getDynamicRules();
          const hasDNT   = allRules.some(r => r.id === DNT_GPC_RULE_ID);
          const hasHTTPS = allRules.some(r => r.id === HTTPS_UPGRADE_ID);
          if (hasDNT && hasHTTPS) pass('Privacy rules', 'DNT/GPC headers + HTTPS upgrade active');
          else warn('Privacy rules', `DNT/GPC: ${hasDNT}, HTTPS upgrade: ${hasHTTPS}`);
        } catch (e) { warn('Privacy rules', e.message); }

        // 8. Settings cache valid
        pass('Settings cache', _settingsCache ? 'warm' : 'cold (will lazy-load on next access)');

        // 9. Keep-alive state
        pass('Keep-alive', _keepAliveTimer ? 'active (sync in progress)' : 'idle (normal)');

        // 10. Storage quota estimate
        try {
          if (navigator.storage?.estimate) {
            const est = await navigator.storage.estimate();
            const usedMB  = (est.usage  / 1048576).toFixed(1);
            const quotaMB = (est.quota  / 1048576).toFixed(0);
            const pct     = Math.round((est.usage / est.quota) * 100);
            if (pct < 50) pass('Storage', `${usedMB}MB used of ~${quotaMB}MB (${pct}%)`);
            else if (pct < 80) warn('Storage', `${usedMB}MB used of ~${quotaMB}MB (${pct}%)`);
            else fail('Storage', `${usedMB}MB used of ~${quotaMB}MB (${pct}%) — critically full`);
          } else {
            pass('Storage', 'quota API unavailable (Firefox)');
          }
        } catch (e) { warn('Storage', e.message); }

        // 11. Safe-browsing false-positive guard (GitHub, Drive, GA dashboard)
        const fpHosts = ['github.com', 'drive.google.com', 'analytics.google.com'];
        const fpBlocked = fpHosts.filter(h => _safeBrowsingDomains.has(h));
        if (fpBlocked.length) fail('Trusted sites', `SB block list contains: ${fpBlocked.join(', ')} — reload extension`);
        else pass('Trusted sites', 'GitHub, Drive, and GA not in malware domain cache');

        // 12. Sync failure streak
        try {
          const { syncFailures = 0 } = await chrome.storage.local.get('syncFailures');
          if (syncFailures === 0) pass('List sync errors', 'No recent list failures');
          else if (syncFailures < 4) warn('List sync errors', `${syncFailures} list(s) failed last sync — check Log tab`);
          else fail('List sync errors', `${syncFailures} failures — open Stats and force sync`);
        } catch (e) { warn('List sync errors', e.message); }

        // 13. Extension version
        pass('Version', chrome.runtime.getManifest().version);

        const summary = checks.every(c => c.status === 'pass') ? 'healthy'
                      : checks.some(c => c.status === 'fail')  ? 'degraded'
                      : 'warning';
        sendResponse({ summary, checks, ts: Date.now() });
        break;
      }

      case 'GET_FILTER_STATUS': {
        const d = await chrome.storage.local.get(['filterSyncedAt','filterRuleCount','syncFailures','syncDuration','syncListStatus','staticRuleCount']);
        const dynamic = await chrome.declarativeNetRequest.getDynamicRules();
        // staticRuleCount is computed once at startup (see computeStaticRuleCount) and cached.
        // Falls back to 725 only if the startup computation hasn't run yet.
        const staticRules = d.staticRuleCount ?? _staticRuleCount ?? 725;
        sendResponse({
          lastSync:     d.filterSyncedAt ?? null,
          ruleCount:    d.filterRuleCount ?? 0,
          activeRules:  dynamic.length,
          staticRules,
          syncError:    _lastSyncError,
          syncFailures: d.syncFailures ?? 0,
          syncDuration: d.syncDuration ?? null,
          syncInProgress: _syncLock,
          listStatus:   d.syncListStatus ?? _syncListStatus,
        });
        break;
      }
      case 'FORCE_SYNC':
        syncFilterLists(true);
        sendResponse({ ok: true });
        break;

      case 'PAUSE_SITE': {
        // Pause blocking on a site for N minutes.
        // Adds the domain to the whitelist so both DNR network rules and all
        // content scripts skip it immediately. A `pauseWhitelisted` list tracks
        // which whitelist entries were added by pause (not pre-existing) so
        // RESUME_SITE can safely remove them without touching permanent entries.
        const { domain: pd, minutes = 30 } = msg;
        if (pd) {
          const expiry = Date.now() + minutes * 60000;
          const { pausedSites = {}, whitelist = [], pauseWhitelisted = [] } =
            await chrome.storage.local.get(['pausedSites', 'whitelist', 'pauseWhitelisted']);
          pausedSites[pd] = expiry;
          if (!whitelist.includes(pd)) {
            whitelist.push(pd);
            if (!pauseWhitelisted.includes(pd)) pauseWhitelisted.push(pd);
          }
          await chrome.storage.local.set({ pausedSites, whitelist, pauseWhitelisted });
          await applyWhitelistRules();
          await notifyCompleteTabs({ type: 'WHITELIST_CHANGED', whitelist });
          // Alarm fires even if the service worker is killed and restarted
          chrome.alarms.create(`pauseExpiry:${pd}`, { delayInMinutes: minutes });
          logEvent('pause', 'info', `Paused ${pd} for ${minutes}m`);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'RESUME_SITE': {
        const { domain: rd } = msg;
        if (rd) {
          const { pausedSites = {}, whitelist = [], pauseWhitelisted = [] } =
            await chrome.storage.local.get(['pausedSites', 'whitelist', 'pauseWhitelisted']);
          delete pausedSites[rd];
          // Only remove from whitelist if pause added it — preserve pre-existing entries
          const pwIdx = pauseWhitelisted.indexOf(rd);
          if (pwIdx !== -1) {
            pauseWhitelisted.splice(pwIdx, 1);
            const wlIdx = whitelist.indexOf(rd);
            if (wlIdx !== -1) whitelist.splice(wlIdx, 1);
          }
          await chrome.storage.local.set({ pausedSites, whitelist, pauseWhitelisted });
          await applyWhitelistRules();
          await notifyCompleteTabs({ type: 'WHITELIST_CHANGED', whitelist });
          try { await chrome.alarms.clear(`pauseExpiry:${rd}`); } catch (_) {}
        }
        sendResponse({ ok: true });
        break;
      }
      case 'GET_PAUSE_STATUS': {
        const { pausedSites = {}, whitelist = [], pauseWhitelisted = [] } =
          await chrome.storage.local.get(['pausedSites', 'whitelist', 'pauseWhitelisted']);
        // Clean up expired pauses — remove from whitelist if pause-added
        const now = Date.now();
        let changed = false;
        for (const [d, exp] of Object.entries(pausedSites)) {
          if (exp < now) {
            delete pausedSites[d];
            const pwIdx = pauseWhitelisted.indexOf(d);
            if (pwIdx !== -1) {
              pauseWhitelisted.splice(pwIdx, 1);
              const wlIdx = whitelist.indexOf(d);
              if (wlIdx !== -1) whitelist.splice(wlIdx, 1);
            }
            changed = true;
          }
        }
        if (changed) {
          await chrome.storage.local.set({ pausedSites, whitelist, pauseWhitelisted });
          await applyWhitelistRules();
          await notifyCompleteTabs({ type: 'WHITELIST_CHANGED', whitelist });
        }
        sendResponse(pausedSites);
        break;
      }
      case 'IMPORT_UBO': {
        // Import uBlock Origin backup JSON
        const { uboData } = msg;
        if (!uboData) { sendResponse({ ok: false }); break; }
        try {
          const updates = {};
          // Import user filters
          if (uboData.userFilters && typeof uboData.userFilters === 'string') {
            updates.userFilterText = uboData.userFilters;
            const { cosmetics, domainCosmetics, scriptletRules } =
              parseFilterList(uboData.userFilters, 90000, 500);
            updates.userCosmetics = cosmetics;
            updates.userDomainCosmetics = domainCosmetics;
            updates.userScriptletRules = scriptletRules;
          }
          // Import whitelist
          if (uboData.whitelist && typeof uboData.whitelist === 'string') {
            const domains = uboData.whitelist.split('\n')
              .map(l => l.replace(/^@@\|\|/, '').replace(/\^.*/, '').trim())
              .filter(d => d && !d.startsWith('!') && d.includes('.'));
            if (domains.length) updates.whitelist = domains;
          }
          if (Object.keys(updates).length) await chrome.storage.local.set(updates);
          sendResponse({ ok: true, imported: Object.keys(updates) });
        } catch (e) { sendResponse({ ok: false, error: e.message }); }
        break;
      }
      case 'PUSH_TO_CLOUD': {
        const pushResult = await pushToCloud();
        sendResponse(pushResult);
        break;
      }
      case 'RESTORE_FROM_CLOUD': {
        try {
          const synced = await chrome.storage.sync.get(['settings','whitelist','userFilterText','customFilterLists']);
          if (!Object.keys(synced).length) { sendResponse({ ok: false, error: 'Nothing saved in cloud' }); break; }
          if (synced.settings && typeof synced.settings === 'object') {
            const validated = {};
            for (const [k, v] of Object.entries(synced.settings)) {
              if (k in DEFAULT_SETTINGS && typeof v === typeof DEFAULT_SETTINGS[k]) validated[k] = v;
            }
            synced.settings = validated;
          }
          if ('whitelist' in synced && !Array.isArray(synced.whitelist)) delete synced.whitelist;
          if ('userFilterText' in synced && typeof synced.userFilterText !== 'string') delete synced.userFilterText;
          if ('customFilterLists' in synced && !Array.isArray(synced.customFilterLists)) delete synced.customFilterLists;
          if (!Object.keys(synced).length) { sendResponse({ ok: false, error: 'Nothing usable in cloud data' }); break; }
          await chrome.storage.local.set(synced);
          invalidateSettingsCache();
          if (typeof synced.userFilterText === 'string') await parseAndStoreUserFilterText(synced.userFilterText);
          if (synced.settings) await applySettingsSideEffects({ ...(await getSettings()), ...synced.settings }, { syncFilters: true });
          else await applyWhitelistRules();
          logEvent('system', 'info', `Cloud restore: ${Object.keys(synced).join(', ')}`);
          sendResponse({ ok: true, keys: Object.keys(synced) });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;
      }
      case 'WHITELIST_UPDATED': {
        const wl = msg.whitelist ?? [];
        await chrome.storage.local.set({ whitelist: wl });
        await applyWhitelistRules();
        await notifyCompleteTabs({ type: 'WHITELIST_CHANGED', whitelist: wl });
        // Auto-push whitelist changes to cloud (fire-and-forget)
        pushToCloud().catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      case 'LOG_EVENT': {
        // Fire-and-forget — never block on logging
        const { source = 'unknown', level = 'info', message = '', data = {} } = msg;
        logEvent(source, level, message, data);
        sendResponse({ ok: true });
        return false; // synchronous response, no need to keep channel open
      }
      case 'GET_EVENT_LOG':
        // Merge in-memory (includes very recent entries) with stored entries to give a full view
        sendResponse(_eventLog.slice().reverse());
        break;
      case 'GET_PERSISTED_LOG': {
        // Read last 7 days from IndexedDB — survives SW restarts and browser restarts
        try {
          const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const dbEntries = await _readLogsFromDB(since);
          const seen = new Set();
          const merged = [];
          for (const e of dbEntries) {
            const k = `${e.ts}:${e.source}:${e.message}`;
            if (!seen.has(k)) { seen.add(k); merged.push(e); }
          }
          for (const e of _eventLog) {
            const k = `${e.ts}:${e.source}:${e.message}`;
            if (!seen.has(k)) { seen.add(k); merged.push(e); }
          }
          merged.sort((a, b) => b.ts - a.ts); // newest first for popup display
          sendResponse(merged.slice(0, 1000));
        } catch (_) { sendResponse([]); }
        break;
      }
      case 'EXPORT_LOG_TXT': {
        // Read ALL history from IndexedDB — unlimited, permanent log export.
        try {
          const dbEntries = await _readLogsFromDB(); // no since = all time
          const seen = new Set();
          const merged = [];
          for (const e of dbEntries) {
            const k = `${e.ts}:${e.source}:${e.message}`;
            if (!seen.has(k)) { seen.add(k); merged.push(e); }
          }
          for (const e of _eventLog) {
            const k = `${e.ts}:${e.source}:${e.message}`;
            if (!seen.has(k)) { seen.add(k); merged.push(e); }
          }
          // Add network request log entries
          for (const r of _requestLog) {
            const k = `${r.ts}:network:${r.url}`;
            if (!seen.has(k)) { seen.add(k); merged.push({ source: 'network', level: 'info', message: r.url, ts: r.ts, data: { tabId: r.tabId } }); }
          }
          merged.sort((a, b) => a.ts - b.ts); // oldest first for a log file
          const manifest = chrome.runtime.getManifest();
          const header = [
            `ShieldBlock Pro v${manifest.version} — Full Log Export`,
            `Exported: ${new Date().toISOString()}`,
            `Browser: ${_IS_FIREFOX ? 'Firefox' : 'Chrome'}`,
            `Entries: ${merged.length}`,
            '─'.repeat(72),
          ].join('\n');
          const lines = merged.map(e => {
            const ts   = new Date(e.ts).toISOString();
            const lvl  = (e.level || 'info').toUpperCase().padEnd(5);
            const src  = (e.source || '?').padEnd(16);
            const msg  = e.message || '';
            const data = e.data && Object.keys(e.data).length ? ' ' + JSON.stringify(e.data) : '';
            return `[${ts}] ${lvl} [${src}] ${msg}${data}`;
          });
          sendResponse({ ok: true, text: header + '\n' + lines.join('\n') });
        } catch (e) { sendResponse({ ok: false, error: e.message }); }
        break;
      }
      case 'CLEAR_EVENT_LOG':
        _eventLog.length = 0;
        try { await chrome.storage.local.remove('persistedLog'); } catch (_) {}
        await _clearLogDB().catch(() => {});
        sendResponse({ ok: true });
        break;
      case 'GET_LIST_STATUS':
        sendResponse(_syncListStatus);
        break;
      // ── Matrix handlers ────────────────────────────────────────────────────
      case 'GET_MATRIX': {
        const { filterMatrix = {} } = await chrome.storage.local.get('filterMatrix');
        sendResponse(filterMatrix);
        break;
      }
      case 'SET_MATRIX_RULE': {
        const { hostname, ruleKey, action } = msg;
        if (!hostname || !ruleKey) { sendResponse({ ok: false, error: 'missing params' }); break; }
        await setMatrixRule(hostname, ruleKey, action ?? 'default');
        sendResponse({ ok: true });
        break;
      }
      case 'CLEAR_MATRIX': {
        const { hostname: mh } = msg;
        const { filterMatrix: fm = {} } = await chrome.storage.local.get('filterMatrix');
        if (mh) delete fm[mh]; else Object.keys(fm).forEach(k => delete fm[k]);
        await chrome.storage.local.set({ filterMatrix: fm });
        await applyMatrixRules();
        sendResponse({ ok: true });
        break;
      }
      // ── Removeparam status ─────────────────────────────────────────────────
      case 'GET_REMOVEPARAM_STATUS': {
        const { removeParamData = null } = await chrome.storage.local.get('removeParamData');
        const globalCount = (removeParamData?.global?.length ?? 0) + STATIC_REMOVE_PARAMS.size;
        const domainCount = removeParamData?.domain?.length ?? 0;
        sendResponse({ globalCount, domainCount, staticCount: STATIC_REMOVE_PARAMS.size });
        break;
      }
      // ── Per-page request log ───────────────────────────────────────────────
      case 'GET_PAGE_LOG': {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const tid = activeTab?.id;
        const pageEntries = tid
          ? _requestLog.filter(e => e.tabId === tid).slice().reverse()
          : [];
        sendResponse(pageEntries);
        break;
      }
      // ── Top blocked domains ────────────────────────────────────────────────
      case 'GET_TOP_DOMAINS': {
        const sorted = [..._domainStats.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([domain, count]) => ({ domain, count }));
        sendResponse(sorted);
        break;
      }
      // ── Safe browsing ──────────────────────────────────────────────────────
      case 'GET_SAFE_BROWSING_STATUS': {
        const _sbSettings = await getSettings();
        sendResponse({
          active: _sbSettings.safeBrowsing !== false && _safeBrowsingDomains.size > 0,
          domainCount: _safeBrowsingDomains.size,
        });
        break;
      }
      case 'REFRESH_SAFE_BROWSING':
        fetchSafeBrowsingLists().catch(() => {});
        sendResponse({ ok: true });
        break;
      case 'ALLOW_SAFE_BROWSING_URL':
        sendResponse({ ok: msg.permanent
          ? await allowSafeBrowsingSitePermanent(msg.url)
          : await allowSafeBrowsingUrl(msg.url) });
        break;
      case 'PAUSE_ALL': {
        const { minutes: paMins = 30 } = msg;
        const expiry = Date.now() + paMins * 60000;
        await chrome.storage.local.set({ globalPause: { until: expiry } });

        // ── Network-level pause: insert a high-priority DNR "allow" rule ──────
        // An "allow" action at priority 10000 bypasses all filter rules (max priority ~1000).
        // This is the only way to pause declarativeNetRequest blocking without removing
        // and re-fetching all 5000 dynamic rules.
        try {
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [PAUSE_ALL_RULE_ID], // idempotent — no-op if not present
            addRules: [_globalPauseRule()],
          });
        } catch (e) {
          logEvent('pause', 'warn', `DNR pause rule failed: ${e.message}`);
        }

        // ── Cosmetic/JS pause: notify all active content scripts ─────────────
        // Content scripts handle DOM hiding and platform-specific ad removal.
        // They won't receive this unless they register a GLOBAL_PAUSE listener,
        // but sending it is cheap and forward-compatible.
        await notifyCompleteTabs({ type: 'GLOBAL_PAUSE', until: expiry });

        try { await chrome.alarms.create('pauseAll', { delayInMinutes: paMins }); } catch (_) {}
        logEvent('pause', 'info', `Global pause activated for ${paMins}m (rule ID ${PAUSE_ALL_RULE_ID})`);
        sendResponse({ ok: true, until: expiry });
        break;
      }
      case 'RESUME_ALL': {
        await chrome.storage.local.set({ globalPause: false });
        try {
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [PAUSE_ALL_RULE_ID],
            addRules: [],
          });
        } catch (e) {
          logEvent('pause', 'warn', `DNR resume rule removal failed: ${e.message}`);
        }
        try { await chrome.alarms.clear('pauseAll'); } catch (_) {}

        await broadcastGlobalResume();

        logEvent('pause', 'info', 'Global pause manually resumed');
        sendResponse({ ok: true });
        break;
      }
      case 'GET_GLOBAL_PAUSE': {
        const { globalPause = false } = await chrome.storage.local.get('globalPause');
        const active = globalPause && globalPause.until > Date.now();
        sendResponse({ active, until: active ? globalPause.until : null });
        break;
      }
      case 'EXPORT_DIAGNOSTIC': {
        // Full diagnostic snapshot: settings, stats, filter status, log, list status
        try {
          const [stored, filterStatus] = await Promise.all([
            chrome.storage.local.get(['settings','whitelist','stats','lifetime','filterSyncedAt',
              'filterRuleCount','syncFailures','syncDuration','syncListStatus','dailyStats','persistedLog']),
            (async () => {
              const dynamic = await chrome.declarativeNetRequest.getDynamicRules();
              return { dynamicRuleCount: dynamic.length };
            })(),
          ]);
          const manifest = chrome.runtime.getManifest();
          sendResponse({
            ok: true,
            data: {
              version: manifest.version,
              browser: _IS_FIREFOX ? 'firefox' : 'chrome',
              exportedAt: new Date().toISOString(),
              settings: stored.settings,
              whitelist: stored.whitelist,
              stats: stored.stats,
              lifetime: stored.lifetime,
              filterSyncedAt: stored.filterSyncedAt,
              filterRuleCount: stored.filterRuleCount,
              dynamicRuleCount: filterStatus.dynamicRuleCount,
              syncFailures: stored.syncFailures,
              syncDuration: stored.syncDuration,
              listStatus: stored.syncListStatus ?? _syncListStatus,
              dailyStats: stored.dailyStats,
              recentLog: (stored.persistedLog ?? []).slice(-200),
            },
          });
        } catch (e) { sendResponse({ ok: false, error: e.message }); }
        break;
      }
      case 'EXPORT_SETTINGS': {
        const exported = await chrome.storage.local.get([
          'settings','whitelist','customHideRules','userFilterText','stats','lifetime','customFilterLists'
        ]);
        sendResponse({ ok: true, data: exported });
        break;
      }
      case 'IMPORT_SETTINGS': {
        const { data } = msg;
        if (data && typeof data === 'object') {
          const allowed = ['settings','whitelist','customHideRules','userFilterText','customFilterLists','stats','lifetime'];
          const safe = {};
          for (const k of allowed) {
            if (!(k in data)) continue;
            // Type-validate settings object — reject if any key has wrong type
            if (k === 'settings') {
              if (typeof data[k] !== 'object' || Array.isArray(data[k])) continue;
              const validated = {};
              for (const [sk, sv] of Object.entries(data[k])) {
                if (sk in DEFAULT_SETTINGS && typeof sv === typeof DEFAULT_SETTINGS[sk]) {
                  validated[sk] = sv;
                }
              }
              safe[k] = validated;
            } else if (k === 'userFilterText') {
              if (typeof data[k] === 'string') safe[k] = data[k];
            } else if (k === 'whitelist' || k === 'customHideRules') {
              if (Array.isArray(data[k])) safe[k] = data[k].filter(v => typeof v === 'string');
            } else if (k === 'customFilterLists') {
              if (Array.isArray(data[k])) safe[k] = data[k];
            } else if (k === 'stats') {
              if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) {
                const numeric = {};
                for (const [sk, sv] of Object.entries(data[k])) if (typeof sv === 'number' && Number.isFinite(sv)) numeric[sk] = sv;
                if (Object.keys(numeric).length) safe[k] = numeric;
              }
            } else if (k === 'lifetime') {
              if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) {
                const total = data[k].total;
                if (typeof total === 'number' && Number.isFinite(total)) safe[k] = { total };
              }
            } else {
              safe[k] = data[k];
            }
          }
          if (!Object.keys(safe).length) { sendResponse({ ok: false, error: 'No valid backup data' }); break; }
          await chrome.storage.local.set(safe);
          invalidateSettingsCache();
          const _imp = await getSettings();
          try {
            const en = [], dis = [];
            if (_imp.general) en.push('base_rules', 'extended_rules', 'hosts_rules');
            else dis.push('base_rules', 'extended_rules', 'hosts_rules');
            if (_imp.tracking) en.push('tracking_rules'); else dis.push('tracking_rules');
            if (en.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: en });
            if (dis.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: dis });
          } catch (_) {}
          if (typeof safe.userFilterText === 'string' && safe.userFilterText) {
            await parseAndStoreUserFilterText(safe.userFilterText);
          }
          await reapplyFeatureRules();
          if (_imp.general !== false) syncFilterLists(false).catch(() => {});

        }
        sendResponse({ ok: true });
        break;
      }
      case 'HIDE_ELEMENT': {
        // Content script sends this after right-click → hide element context menu.
        // BUG WAS: `const { tabId: tid } = msg` + `if (selector && tid)` — msg.tabId is
        // always undefined because sender.tab.id is unavailable to content scripts when
        // sending TO background (only the background's onMessage receives sender info).
        // `tid` was always falsy → rule was never saved. Fix: use sender.tab.id from
        // the onMessage listener closure, which IS populated correctly.
        const { selector } = msg;
        if (selector) {
          const { customHideRules = [] } = await chrome.storage.local.get('customHideRules');
          if (!customHideRules.includes(selector)) {
            customHideRules.push(selector);
            await chrome.storage.local.set({ customHideRules });
          }
          logEvent('picker', 'info', `Hidden: ${selector}`, { tabId: sender.tab?.id });
        }
        sendResponse({ ok: true });
        break;
      }
      default: sendResponse({ error: 'Unknown message' });
    }
  })();
  return true;
});

// ── Tab events ─────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => { _tabCosmeticState.delete(tabId); });

chrome.webNavigation.onCommitted.addListener(({ tabId, url, frameId }) => {
  if (frameId === 0) injectCosmetics(tabId, url);
});

// ── Alarms ─────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name === 'filterSync') { syncFilterLists(false).catch(e => logEvent('filter-sync', 'error', `Sync alarm error: ${e.message}`)); return; }
  if (name === 'retrySync') { await _retryFailedLists().catch(e => logEvent('filter-sync', 'error', `Retry alarm error: ${e.message}`)); return; }
  if (name === 'safeBrowsingRefresh') { fetchSafeBrowsingLists().catch(() => {}); return; }
  if (name === 'pauseAll') {
    try {
      await chrome.storage.local.set({ globalPause: false });
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [PAUSE_ALL_RULE_ID],
        addRules: [],
      });
      await broadcastGlobalResume();
      logEvent('pause', 'info', 'Global pause expired — blocking resumed');
    } catch (e) {
      logEvent('pause', 'warn', `pauseAll alarm cleanup failed: ${e.message}`);
    }
    return;
  }
  if (name.startsWith('pauseExpiry:')) {
    const domain = name.slice('pauseExpiry:'.length);
    try {
      const { pausedSites = {}, whitelist = [], pauseWhitelisted = [] } =
        await chrome.storage.local.get(['pausedSites', 'whitelist', 'pauseWhitelisted']);
      if (!(domain in pausedSites)) return; // already resumed manually
      delete pausedSites[domain];
      const pwIdx = pauseWhitelisted.indexOf(domain);
      if (pwIdx !== -1) {
        pauseWhitelisted.splice(pwIdx, 1);
        const wlIdx = whitelist.indexOf(domain);
        if (wlIdx !== -1) whitelist.splice(wlIdx, 1);
      }
      await chrome.storage.local.set({ pausedSites, whitelist, pauseWhitelisted });
      await applyWhitelistRules();
      await notifyCompleteTabs({ type: 'WHITELIST_CHANGED', whitelist });
      logEvent('pause', 'info', `Auto-resumed ${domain}`);
    } catch (e) { logEvent('pause', 'warn', `Pause expiry cleanup failed for ${domain}: ${e.message}`); }
  }
});

// ── Context Menu ────────────────────────────────────────────────────────────

async function setupContextMenus() {
  // Use Promise form — after the browser-compat shim replaces chrome with browser,
  // Firefox's browser.contextMenus.removeAll() is Promise-only and ignores callbacks.
  // Chrome MV3 also returns a Promise when called without a callback (Chrome 99+).
  try { await chrome.contextMenus.removeAll(); } catch (_) {}
  chrome.contextMenus.create({
    id: 'sb-toggle',
    title: 'ShieldBlock: Toggle blocking on this site',
    contexts: ['page', 'frame'],
  });
  chrome.contextMenus.create({
    id: 'sb-hide-element',
    title: 'ShieldBlock: Hide this element',
    contexts: ['all'],
  });
  chrome.contextMenus.create({
    id: 'sb-report-ad',
    title: 'ShieldBlock: This is an ad (report)',
    contexts: ['all'],
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.url) return;

  if (info.menuItemId === 'sb-toggle') {
    let domain;
    try { domain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch (_) { return; }
    const wl = await getWhitelist();
    const idx = wl.indexOf(domain);
    if (idx !== -1) wl.splice(idx, 1); else wl.push(domain);
    await chrome.storage.local.set({ whitelist: wl });
    await applyWhitelistRules();
    await notifyCompleteTabs({ type: 'WHITELIST_CHANGED', whitelist: wl });
    pushToCloud().catch(() => {}); // keep cloud in sync (fire-and-forget)
    try { await chrome.tabs.reload(tab.id); } catch (_) {}
    const whitelisted = domainMatchesWhitelist(domain, wl);
    chrome.action.setBadgeText({ text: whitelisted ? '⏸' : '', tabId: tab.id });
    if (whitelisted) chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId: tab.id });
    return;
  }

  if (info.menuItemId === 'sb-hide-element' || info.menuItemId === 'sb-report-ad') {
    // Ask the content script to hide the last right-clicked element
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: info.menuItemId === 'sb-hide-element' ? 'HIDE_LAST_RCLICK' : 'REPORT_LAST_RCLICK',
      });
    } catch (e) { logEvent('system', 'warn', `Tab message failed: ${e.message}`); }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab?.url) return;
  try {
    const domain = new URL(tab.url).hostname.replace(/^www\./, '');
    const wl = await getWhitelist();
    const whitelisted = domainMatchesWhitelist(domain, wl);
    chrome.action.setBadgeText({ text: whitelisted ? '⏸' : '', tabId });
    if (whitelisted) chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId });
  } catch (e) { logEvent('system', 'warn', `Badge restore failed: ${e.message}`); }
});


// ── Install / Startup ──────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await _restoreLog();
  logEvent('system', 'info', `Extension ${reason} (v${chrome.runtime.getManifest().version}, ${_IS_FIREFOX ? 'Firefox' : 'Chrome'})`);
  await chrome.storage.local.set({ licenseValid: true });

  chrome.alarms.create('filterSync', { periodInMinutes: 720 });
  chrome.alarms.create('safeBrowsingRefresh', { periodInMinutes: 360 });
  await setupContextMenus();

  const _s = await getSettings();
  await Promise.all([
    loadStaticRuleIds(),
    applyRemoveParamRules(), applyMatrixRules(),
    applyReferrerRule(_s.referrerStrip !== false),
    applyHttpsUpgradeRule(_s.httpsUpgrade !== false),
    applyPrivacyHeadersRule(_s.privacyHeaders !== false),
    applyUserFilterRules(),
    loadSafeBrowsingCache(),
    computeStaticRuleCount(),
    applyWhitelistRules(),
    restoreGlobalPauseRule(),
  ]);
  await restoreGlobalPauseIfActive();

  // Show welcome page on fresh install
  if (reason === 'install') {
    // Check cloud sync for existing settings from another device BEFORE showing welcome
    // so the user's preferences are already applied when the welcome page opens.
    try {
      const synced = await chrome.storage.sync.get(['settings','whitelist','userFilterText','customFilterLists']);
      if (Object.keys(synced).length > 0) {
        // Validate types before writing (mirrors RESTORE_FROM_CLOUD checks)
        if (synced.settings && typeof synced.settings === 'object') {
          const validated = {};
          for (const [k, v] of Object.entries(synced.settings)) {
            if (k in DEFAULT_SETTINGS && typeof v === typeof DEFAULT_SETTINGS[k]) validated[k] = v;
          }
          synced.settings = validated;
        }
        if ('whitelist' in synced && !Array.isArray(synced.whitelist)) delete synced.whitelist;
        if ('userFilterText' in synced && typeof synced.userFilterText !== 'string') delete synced.userFilterText;
        if ('customFilterLists' in synced && !Array.isArray(synced.customFilterLists)) delete synced.customFilterLists;
        await chrome.storage.local.set(synced);
        invalidateSettingsCache();
        if (typeof synced.userFilterText === 'string') await parseAndStoreUserFilterText(synced.userFilterText);
        logEvent('system', 'info', `Restored ${Object.keys(synced).join(', ')} from cloud sync`);
      }
    } catch (e) {
      logEvent('system', 'warn', `Cloud restore on install failed: ${e.message}`);
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html'), active: true });
  }

  // Update checker — notify user of new version on update
  if (reason === 'update') {
    const manifest = chrome.runtime.getManifest();
    chrome.storage.local.set({ lastVersion: manifest.version });
  }

  const { stats, settings: existingSettings, whitelist: existingWl } =
    await chrome.storage.local.get(['stats', 'settings', 'whitelist']);

  if (!stats) {
    // Fresh install — write stats/lifetime defaults always.
    // Do NOT overwrite settings or whitelist if already restored from cloud sync
    // (cloud restore runs earlier in this handler and writes to local storage).
    const toWrite = {
      stats:    { total:0, youtube:0, twitch:0, spotify:0, hulu:0, kick:0, amazon:0, general:0, social:0, cookies:0 },
      lifetime: { total:0 },
    };
    if (!existingSettings) toWrite.settings  = DEFAULT_SETTINGS;
    if (!existingWl)       toWrite.whitelist = [];
    await chrome.storage.local.set(toWrite);
  } else if (reason === 'update' && existingSettings) {
    // Extension update — merge new default keys into existing settings so new
    // toggles are available to existing users without resetting their preferences
    const merged = { ...DEFAULT_SETTINGS, ...existingSettings };
    await chrome.storage.local.set({ settings: merged });
  }

  await applySettingsSideEffects(await getSettings(), { syncFilters: false });

  // Fetch filter lists immediately — without this, a fresh install or update
  // has NO dynamic rules until the next browser restart triggers onStartup.
  setTimeout(() => syncFilterLists(true).catch(() => {}), 1000);
});

// ── Keyboard shortcut handlers ────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url || !tab.id) return;

  if (command === 'toggle-site') {
    let domain;
    try { domain = new URL(tab.url).hostname.replace(/^www\./, ''); } catch (_) { return; }
    const wl = await getWhitelist();
    const idx = wl.indexOf(domain);
    if (idx !== -1) wl.splice(idx, 1); else wl.push(domain);
    await chrome.storage.local.set({ whitelist: wl });
    await applyWhitelistRules();
    await notifyCompleteTabs({ type: 'WHITELIST_CHANGED', whitelist: wl });
    pushToCloud().catch(() => {}); // sync whitelist change to cloud (fire-and-forget)
    const whitelisted = domainMatchesWhitelist(domain, wl);
    chrome.action.setBadgeText({ text: whitelisted ? '⏸' : '', tabId: tab.id });
    if (whitelisted) chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId: tab.id });
    try { await chrome.tabs.reload(tab.id); } catch (_) {}
  }

  if (command === 'activate-picker') {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_PICKER' }); }
    catch (_) {}
  }
});

chrome.runtime.onStartup.addListener(async () => {
  // Restore persisted log into in-memory buffer so the log panel shows history
  await _restoreLog();
  logEvent('system', 'info', 'Service worker started (onStartup)');

  // Init feature engines on every browser start
  const _ss = await getSettings();
  // Restore cached static rule count before computing fresh (avoids showing 0 briefly)
  try {
    const { staticRuleCount } = await chrome.storage.local.get('staticRuleCount');
    if (staticRuleCount) _staticRuleCount = staticRuleCount;
  } catch (_) {}
  await Promise.all([
    loadStaticRuleIds(),
    applyRemoveParamRules(), applyMatrixRules(),
    applyReferrerRule(_ss.referrerStrip !== false),
    applyHttpsUpgradeRule(_ss.httpsUpgrade !== false),
    applyPrivacyHeadersRule(_ss.privacyHeaders !== false),
    applyUserFilterRules(),
    loadSafeBrowsingCache(),
    computeStaticRuleCount(),
    applyWhitelistRules(),
    restoreGlobalPauseRule(),
  ]);
  await restoreGlobalPauseIfActive();

  const existing = await chrome.alarms.get('filterSync');
  if (!existing) chrome.alarms.create('filterSync', { periodInMinutes: 720 });
  const sbAlarm = await chrome.alarms.get('safeBrowsingRefresh');
  if (!sbAlarm) chrome.alarms.create('safeBrowsingRefresh', { periodInMinutes: 360 });
  try {
    const { sbRulesVersion } = await chrome.storage.local.get('sbRulesVersion');
    if (sbRulesVersion !== '2.11.0') {
      const all = await chrome.storage.local.get(null);
      const stale = Object.keys(all).filter(k => k.startsWith('fr_') || k.startsWith('fm_'));
      if (stale.length) await chrome.storage.local.remove(stale);
      await chrome.storage.local.set({ sbRulesVersion: '2.11.0' });
      logEvent('startup', 'info', 'Upgraded to v2.11.0 — cleared stale filter cache for resync');
    }
  } catch (_) {}

  setTimeout(() => {
    syncFilterLists(false).catch(e => {
      console.warn('[SB] Startup sync failed:', e.message);
      logEvent('filter-sync', 'error', `Startup sync failed: ${e.message}`);
    });
  }, 500);
  await setupContextMenus();
  try {
    const { stats } = await chrome.storage.local.get('stats');
    const total = stats?.total ?? 0;
    if (total > 0) {
      chrome.action.setBadgeText({ text: formatBadge(total) });
      chrome.action.setBadgeBackgroundColor({ color: '#7c6aff' });
    }
    try {
      const { settings: badgeSettings } = await chrome.storage.local.get('settings');
      if (badgeSettings?.badgeEnabled === false) chrome.action.setBadgeText({ text: '' });
    } catch (_) {}
  } catch (_) {}
});
