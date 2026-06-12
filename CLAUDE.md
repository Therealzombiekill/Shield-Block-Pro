# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

ShieldBlock Pro is a Chrome/Firefox MV3 browser extension that blocks ads, trackers, and cookie banners. There is no build step, no bundler, and no package.json — all source files are loaded directly by the browser. To test changes, load the extension as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked → point at this directory) and reload it after every change.

## How to test

There are no automated tests. Manual testing workflow:

1. Load unpacked in Chrome at `chrome://extensions`
2. After editing any `src/*.js` or `popup.*` file, click "Reload" on the extension card or use the Extensions toolbar menu
3. For background.js changes, the service worker restarts automatically on reload
4. Check `chrome://extensions` → "Inspect views: service worker" for background console output
5. For popup changes, right-click the extension icon → "Inspect Popup" opens DevTools on the popup
6. If `chrome://extensions` shows **"Service worker registration failed. Status code: 10"**, Chrome could not fetch a file in `src/background.js`'s ES-module import graph (`browser-compat.js`, `filter-parser.js`, `cosmetic-utils.js`, `trusted-sites.js`). That means the loaded folder is incomplete or stale (e.g. files copied over an old install so a newly added module is missing) or Chrome's service-worker cache is corrupt — not a problem in the committed source. Fix: run `node scripts/validate-extension.mjs` to confirm the tree is intact, then **Remove** the extension and Load unpacked again from the full repo directory (a plain Reload does not always clear a failed registration). The version on the extension card must match `manifest.json` — if it doesn't, the wrong folder is loaded.

To verify filter parsing changes, open the popup → **Support** tab → "Run check" health check, or check the Log tab for sync errors.

## Architecture

### Execution worlds and the communication model

The extension runs code in three distinct contexts that cannot directly call each other's APIs:

**MAIN world** (`inject-privacy.js`, `scriptlets.js`): Runs in the page's JavaScript context. Can access `window`, override native APIs, and intercept fetch. Cannot call `chrome.*` APIs. Must communicate via `window.postMessage`.

**ISOLATED world** (all `content-*.js` files, `src/browser-compat.js` prepended): Runs in Chrome's isolated content script context. Can call `chrome.runtime.sendMessage` and `chrome.storage`. Cannot access page JS globals. Receives postMessages from MAIN world scripts. Every content script does `GET_SETTINGS` with a 300ms retry guard to handle service worker wake-up race conditions.

**Service worker** (`src/background.js`): Handles all persistent state, filter syncing, DNR rule management, and stat accumulation. Exposes a single `chrome.runtime.onMessage` handler with 54 message type cases. Chrome kills the SW after ~30s idle — `_startKeepAlive()` / `_stopKeepAlive()` ping storage every 20s during long operations (filter sync, safe browsing fetch) to prevent premature termination.

### DNR rule ID space

All Declarative Net Request rules share a single integer ID namespace. Collisions cause silent rule drops. The layout is documented near the top of `background.js` and in the `FILTER_LISTS` table:

| Range | Owner |
|---|---|
| 1–9999 | Hand-maintained static rules (`rules/base.json`, `extended.json`, `hosts.json`, `tracking.json`) |
| 10000–29999 | Dynamic filter list rules, segment 1 (per-list sub-ranges, computed by `_allocateFilterRanges`) |
| 30000–30999 | `$removeparam` tracking param rules |
| 31000–31999 | Per-domain filtering matrix rules |
| 32000–32499 | User-typed network rules |
| 33000–46999 | Dynamic filter list rules, segment 2 (overflow band — lists that don't fit segment 1) |
| 47000–47002 | Privacy/security rules (referrer, HTTPS upgrade, DNT/GPC) |
| 48000–48998 | Whitelist allow rules |
| 49999 | Global pause-all allow rule |
| 100000+ | Compiled static rulesets (easylist 100000, easyprivacy 130000, easylistgermany 140000, peterlowe 150000) |

The dynamic-rule cap is platform-detected (`MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES`): 5,000 on Chrome <121, 30,000 on Chrome 121+. `_allocateFilterRanges()` scales each list's `max` fractionally to fill the budget (~29.3k rules on Chrome 121+) and lays ranges across the two filter segments; `_checkRanges()` self-checks for overlaps and band escapes at startup.

### Filter pipeline

Filter list text → `parseFilterList()` in `src/filter-parser.js` → four output types:
1. **DNR rules** (`type: 'dnr'`): block rules, plus `@@` exception rules compiled to `allow` (or `allowAllRequests` for `$document`) — exceptions are reserved up to ¼ of each list's budget and sorted first so they're never starved by block volume. Generic substring patterns (`/ads/banner/*`) are supported; `$important` maps to priority 3. Applied via `chrome.declarativeNetRequest.updateDynamicRules`
2. **Global cosmetic selectors** (CSS `##.selector`): Stored in `chrome.storage.local` under `cosmeticSelectors`, injected via `chrome.scripting.insertCSS` on navigation — **one CSS rule per selector**, never comma-joined (one invalid selector would invalidate an entire grouped rule)
3. **Domain-scoped cosmetics** (`site.com##.selector`, incl. multi-domain `a.com,b.com##…` fan-out): Stored under `domainCosmetics`, injected per-domain
4. **Scriptlet rules** (`##+js(name, args)`, incl. multi-domain fan-out): Stored under `scriptletRules`, executed via `chrome.scripting.executeScript` calling `globalThis.__sbRunScriptlets()` defined in `src/scriptlets.js`
5. **Cosmetic exceptions** (`site.com#@#.selector` unhide rules): Stored under `cosmeticExceptions` (`fx_<key>` per list), subtracted from the selector set in `injectCosmetics()` so lists can repair false-positive hides

`$badfilter` rules cancel the matching rule within the same list at parse time (`_ruleSignature` matching).

**ASCII/IDN invariant**: Chrome DNR rejects non-ASCII `urlFilter`s and `updateDynamicRules` is atomic per batch — one bad rule kills the whole batch. The parser converts IDN domains to punycode everywhere they appear (cosmetic/scriptlet domain prefixes, `$domain=` initiator domains, pure `||host^` patterns) via `toPunycodeDomain()`, drops any other non-ASCII `urlFilter`, and honors uBO's `\,`/`\x2c` escapes in scriptlet args (`splitScriptletArgs()`). `syncFilterLists()` re-checks urlFilter ASCII at the dedup choke point as a safety net for user-typed rules and custom lists. `_startKeepAlive()`/`_stopKeepAlive()` are reference-counted — overlapping long operations (sync + safe-browsing refresh) must each hold/release, always pairing the stop in a `finally`.

Untyped network rules omit `resourceTypes` (DNR's default — everything except `main_frame` — matches uBO semantics and keeps rules small). The Google-API initiator guard (`SHARED_GOOGLE_API_EXCLUDED_INITIATORS`) is applied only to generic substring patterns, never to domain-anchored rules or exceptions.

`$removeparam` rules are collected into `removeParamData` and applied by `applyRemoveParamRules()` which merges them with the hardcoded `STATIC_REMOVE_PARAMS` set and emits a single global DNR redirect+queryTransform rule where possible.

### Stats pipeline (accurate counting)

Two sources feed one batched accumulator (`incrementStat` → `_flushStats`, serialized on `_flushQueue`):

1. **DOM blocks** — content scripts send `INCREMENT_STAT` with a platform `statType`; each type has a per-item time-saved estimate in `TIME_SAVED_SECONDS`.
2. **Network blocks** — `_pollMatchedRules()` in background.js polls `chrome.declarativeNetRequest.getMatchedRules()` **globally** (no tabId) on the 1-minute `statsPoll` alarm, plus throttled event triggers (page load ≥25s gap, popup open ≥10s gap). The API has a hard quota (20 calls/10 min, self-capped at 16 via a persisted rolling window) and ~5-minute match retention, so a 1-minute global poll sees every match. A persisted timestamp high-water mark dedupes across polls and SW restarts.

Matched rules are classified via `_staticRuleMeta`/`_dynRuleMeta` (rule ID → action kind + target domain): only `block` and non-transform `redirect` actions count as blocks (~50ms time-saved each, `NETWORK_TIME_SAVED_SECONDS`); queryTransform redirects count as `removeparam` ("cleaned", no time, excluded from totals); `allow`/`modifyHeaders`/`upgradeScheme` matches are **never** counted — the DNT/GPC header rule matches every request and would otherwise turn the counter into a request counter. The blocked-domain labels shown in the request-log/top-domains panels come from the matched rule's *condition* (`MatchedRuleInfo` carries no request URL; `onRuleMatchedDebug` is unpacked-only).

Firefox has no `getMatchedRules` — network counting is skipped there; DOM stats still work.

### Storage layout

Everything lives in `chrome.storage.local`. Key prefixes:
- `fr_<key>` — DNR rules for filter list `key`
- `fc_<key>` — cosmetic selectors for list `key`
- `fd_<key>` — domain cosmetics for list `key`
- `fs_<key>` — scriptlet rules for list `key`
- `fx_<key>` — cosmetic exceptions (`#@#` unhide rules) for list `key`
- `frp_<key>` — removeparam data for list `key`
- `fm_<key>` — metadata (fetch timestamp, rule count) for list `key`
- `cfe_<key>` — ETag for list `key` (HTTP 304 caching)
- `cf*_<key>` — same prefixes but for custom user-subscribed lists
- `cosmeticSelectors`, `domainCosmetics`, `scriptletRules`, `cosmeticExceptions` — aggregated post-sync caches
- `removeParamData` — aggregated removeparam data
- `settings` — user toggle state (see `DEFAULT_SETTINGS` in background.js)
- `stats` — per-category session block counts (zeroed on every browser launch by `onStartup` — the popup hero is labelled "Session"). Includes `removeparam` (tracking params cleaned), which is excluded from `total`/badge/lifetime
- `lifetime`, `timeSaved` — cumulative all-time counters (never auto-reset)
- `dailyStats` — `{ "YYYY-MM-DD": count }` for 7-day sparkline, kept 30 days, local-time day buckets

`chrome.storage.session` (auto-cleared on browser close) holds `sessStats`: the matched-rule poller's dedupe watermark + quota window, per-tab page stats, tab→host map, request log, and top-domain counts — so MV3 service-worker restarts don't wipe them.
- `filterMatrix` — `{ hostname: { ruleKey: 'allow'|'block'|'default' } }`
- `persistedLog` — last 100 log entries cached for SW restart recovery
- `customHideRules` — element picker selections
- `userCosmetics`, `userDomainCosmetics`, `userScriptletRules`, `userCosmeticExceptions`, `userFilterText` — user-typed rules in Filters panel
- `customFilterLists` — subscribed external filter lists

The service worker also uses **IndexedDB** (`sbProLog` database, `events` object store) for permanent long-term logging. `chrome.storage.local` only holds a rolling short-term cache (`persistedLog`) for SW-restart recovery.

### Settings and the settings cache

`getSettings()` in background.js caches settings in `_settingsCache` to avoid storage I/O on every navigation event. `SET_SETTINGS` is the only mutation path and calls `invalidateSettingsCache()`. Content scripts call `GET_SETTINGS` via message and get the merged `DEFAULT_SETTINGS + stored`.

All content scripts check `settings?.globalPause` first and `settings?.[feature]` second before doing any work. The whitelist check pattern is always:
```js
const _wl = settings?.whitelist ?? [];
const _host = location.hostname.replace(/^www\./, '');
if (_wl.some(d => _host === d || _host.endsWith('.' + d))) return;
```

### SSAI streaming platforms

Server-Side Ad Insertion stitches ads into the content stream, so they can't be removed at the network layer. Dedicated scripts handle the platforms we can actually test:
- **Dedicated scripts**: `content-twitch.js`, `content-hulu.js`, `content-kick.js`, `content-spotify.js`

> A generic `content-streaming.js` handler (`settings.streaming`) for Max/Disney+/Paramount+/Peacock/Pluto/Tubi/Roku/Sling/etc. was **removed** — mainstream ad blockers cover those platforms better, and a mute-only fallback on players we can't test carried a real false-mute risk (a stray ad-class element page-wide muted the whole session). The `streaming` setting and `streaming` stat bucket were removed with it.

The strategy:
1. Detect ad state via DOM selectors (countdown timers, ad-overlay elements)
2. Mute the video element (`video.muted = true`) for the ad duration
3. Remove ad UI overlays from the DOM
4. Restore original mute state when the ad ends

Spotify additionally attempts a skip (seeks to `audio.duration - 0.1` or clicks the next-track button).

### Annoyance blocker

`content-annoyances.js` (ISOLATED, `document_idle`, `settings.annoyances`) removes intrusive third-party widgets the general cosmetic engine doesn't cover: live-chat widgets, web-push permission pre-prompts, smart app-install banners, survey/feedback bubbles, and sticky social-share bars. Selectors are vendor-scoped (named IDs/classes) to keep false positives near zero. Newsletter popups, anti-adblock walls and high-z interstitials remain in `content-general.js` (under `settings.cosmetic`) — do not duplicate them here.

### Browser compatibility

`src/browser-compat.js` must be the first script loaded in every content script context (it's listed first in every `manifest.json` content_scripts entry). It maps `globalThis.chrome = globalThis.browser` in Firefox so all code can use `chrome.*` uniformly. The background SW imports it at the top: `import './browser-compat.js'`.

`content-privacy.js` needs the shared helpers in `./trusted-sites.js`, but Chrome loads declarative `content_scripts` as **classic scripts** — `"type": "module"` is not a supported `content_scripts` key and a top-level `import` throws "Cannot use import statement outside a module". So `content-privacy.js` loads the module via dynamic `import(chrome.runtime.getURL('src/trusted-sites.js'))` inside its async IIFE, with a no-op fallback. Any module imported this way **must** be listed in `web_accessible_resources` — `src/trusted-sites.js` is.

Firefox-specific callouts in the codebase:
- `chrome.declarativeNetRequest.getMatchedRules` is not implemented in Firefox — guarded with `if (!chrome.declarativeNetRequest.getMatchedRules)`
- AdGuard filter URLs are browser-specific (chromium vs firefox path): see `adGuardUrl()` in background.js
- `browser.contextMenus.removeAll()` in Firefox is Promise-only — always `await` it

### Popup architecture

`popup.html` + `popup.js`: single-page UI with six tab panels. `popup.js` has no framework — raw DOM manipulation throughout. The `msg()` helper wraps `chrome.runtime.sendMessage` with a 400ms SW wake-up retry. The `boot()` function initializes all panels and wires all event listeners. Each panel section has a `refresh*()` function called on tab switch and on relevant setting changes.

CSS lives entirely in the `<style>` block of `popup.html`. All CSS uses custom properties defined in `:root`. No inline styles except for `display:none` on dynamically-shown elements.

### Static bundled rules

Two tiers, all always active regardless of filter sync status (gated only by the `general`/`tracking` settings via `updateEnabledRulesets`):

1. **Hand-maintained** — `rules/base.json` (275), `rules/extended.json` (387), `rules/hosts.json` (747), `rules/tracking.json` (2). IDs 1–9999 are reserved for these files (e.g. base.json's Google/DoubleClick redirect rules live at 190–199). When editing them, keep IDs within the 1–9999 static reserve.
2. **Compiled snapshots** — `rules/easylist-static.json` (16,800 rules, IDs 100000+), `rules/easyprivacy-static.json` (6,000, IDs 130000+), `rules/easylistgermany-static.json` (~2,200, IDs 140000+), `rules/peterlowe-static.json` (3,300, IDs 150000+), generated at release time with `node scripts/compile-static-rules.mjs <list.txt> --out rules/<name>.json --start-id <id> --max <n>`. These give full baseline protection from first install, before any dynamic sync completes, and don't consume the dynamic-rule budget. Static rules have their own pool with a 30,000-rule guaranteed minimum — keep the total across ALL static rulesets (hand-maintained + compiled) ≤ 30,000, and keep compiled IDs ≥ 100000 so `filterStaticConflicts()` never collides them with dynamic bands. Refresh them when cutting a release.

The 12-hour dynamic sync remains the freshness layer on top of the static snapshots. A weekly GitHub Action (`.github/workflows/refresh-static-rules.yml`) recompiles the snapshots and opens a PR; CI (`.github/workflows/ci.yml`) enforces rule-ID uniqueness, ASCII urlFilters, and the 30k static budget.

**Unbreak stubs** (`src/stubs/noop-*.js`): base.json rules 440-447 redirect the major ad/analytics loader scripts (gpt.js, adsbygoogle.js, analytics.js/ga.js, gtag/gtm.js, apstag.js) to neutered API stubs at priority 3 (above block rules at 2) — pages that call `googletag.*`/`ga()` etc. keep working and fire their callbacks instead of erroring when the script is blocked. Stub files must be listed in `web_accessible_resources`.

### Alarms

- `statsPoll` — fires every 1 minute, triggers `_pollMatchedRules()` (network block counting; also keeps matches from aging out of `getMatchedRules`' ~5-minute retention while the SW is idle)
- `filterSync` — fires every 720 minutes (12 hours), triggers `syncFilterLists(false)`
- `retrySync` — fires 5 minutes after a partial sync failure, triggers `_retryFailedLists()`
- `safeBrowsingRefresh` — fires every 6 hours, refreshes malware/phishing domain lists
- `pauseExpiry:<domain>` — fires when a per-site pause timer expires
- `pauseAll` — fires when the global pause timer expires

## Key constraints

- **No eval()**: Scriptlets are implemented as named functions in `IMPL` map in `scriptlets.js`, called by name — never `eval`'d from filter list strings.
- **5,000 dynamic rule cap**: Chrome enforces this hard. The sum of all `max` values in `FILTER_LISTS` must stay ≤ 5,000. The startup `_checkRanges()` check verifies this.
- **No content scripts on YouTube cosmetics**: `content-general.js` and `content-procedural.js` explicitly skip `youtube.com` — cosmetic selectors can match player elements and cause black screens.
- **CSP**: `"extension_pages": "script-src 'self'; object-src 'self'"` — no inline scripts, no remote scripts. The popup cannot fetch cross-origin URLs directly; it sends `FETCH_FILTER_URL` to the background which does the fetch and enforces a 512KB size limit.

## Maintainer workflow

- Standing instruction from the maintainer (2026-06-11): after completing a change in a Claude Code session, push the working branch, open a PR, and **merge it to `main` automatically** once `node scripts/validate-extension.mjs` and `node scripts/test-roadmap.mjs` pass — do not leave the PR waiting for manual review. Skip the auto-merge only if validation fails or the change is risky, and say so in the session.
