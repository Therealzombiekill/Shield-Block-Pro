# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

ShieldBlock Pro is a Chrome/Firefox MV3 browser extension that blocks ads, trackers, cookie banners, and streaming platform ads. There is no build step, no bundler, and no package.json — all source files are loaded directly by the browser. To test changes, load the extension as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked → point at this directory) and reload it after every change.

## How to test

There are no automated tests. Manual testing workflow:

1. Load unpacked in Chrome at `chrome://extensions`
2. After editing any `src/*.js` or `popup.*` file, click "Reload" on the extension card or use the Extensions toolbar menu
3. For background.js changes, the service worker restarts automatically on reload
4. Check `chrome://extensions` → "Inspect views: service worker" for background console output
5. For popup changes, right-click the extension icon → "Inspect Popup" opens DevTools on the popup

To verify filter parsing changes, open the popup → **Support** tab → "Run check" health check, or check the Log tab for sync errors.

## Architecture

### Execution worlds and the communication model

The extension runs code in three distinct contexts that cannot directly call each other's APIs:

**MAIN world** (`inject-privacy.js`, `inject-youtube.js`, `inject-twitch.js`, `scriptlets.js`): Runs in the page's JavaScript context. Can access `window`, override native APIs, and intercept fetch. Cannot call `chrome.*` APIs. Must communicate via `window.postMessage`.

**ISOLATED world** (all `content-*.js` files, `src/browser-compat.js` prepended): Runs in Chrome's isolated content script context. Can call `chrome.runtime.sendMessage` and `chrome.storage`. Cannot access page JS globals. Receives postMessages from MAIN world scripts. Every content script does `GET_SETTINGS` with a 300ms retry guard to handle service worker wake-up race conditions.

**Service worker** (`src/background.js`): Handles all persistent state, filter syncing, DNR rule management, and stat accumulation. Exposes a single `chrome.runtime.onMessage` handler with 54 message type cases. Chrome kills the SW after ~30s idle — `_startKeepAlive()` / `_stopKeepAlive()` ping storage every 20s during long operations (filter sync, safe browsing fetch) to prevent premature termination.

### Two-script pattern for platform-specific blocking

YouTube and Twitch each use two coordinated scripts:
- `inject-youtube.js` / `inject-twitch.js` — MAIN world, `document_start`: patches native fetch/XHR/globals to strip ad data before the player processes it
- `content-youtube.js` / `content-twitch.js` — ISOLATED world, `document_idle`: DOM-level fallback (click skip buttons, mute during ads, detect ad state via DOM selectors)

The MAIN world script receives enable/disable signals from the ISOLATED script via `window.postMessage({ type: 'SB_YOUTUBE_DISABLE' })` etc., since MAIN world cannot read settings from storage.

`content-youtube.js` also implements opt-in **YouTube Extras** (`settings.youtubeExtras`, default off): hide Shorts shelves/nav and remove end-screen cards. These run only inside the active ad-blocking path and use narrow, page-level selectors to avoid the player-cosmetic black-screen risk.

### DNR rule ID space

All Declarative Net Request rules share a single integer ID namespace. Collisions cause silent rule drops. The layout is documented in `background.js` lines 13–17 and the filter list table at lines 108–176:

| Range | Owner |
|---|---|
| 1–9999 | Static bundled rules (`rules/*.json`) |
| 10000–29999 | Dynamic filter list rules (per-list sub-ranges, see table) |
| 30000–30999 | `$removeparam` tracking param rules |
| 31000–31999 | Per-domain filtering matrix rules |
| 47000–47002 | Privacy/security rules (referrer, HTTPS upgrade, DNT/GPC) |
| 49999 | Global pause-all allow rule |

Chrome hard-caps `updateDynamicRules` at 5,000 rules total. Each filter list in `FILTER_LISTS` has a `start` and `max` that must not overlap with any other list. When adding a new list entry, verify no overlap using the startup `_checkRanges()` self-check (logged at info level).

### Filter pipeline

Filter list text → `parseFilterList()` in `src/filter-parser.js` → four output types:
1. **DNR rules** (`type: 'dnr'`): Applied via `chrome.declarativeNetRequest.updateDynamicRules`
2. **Global cosmetic selectors** (CSS `##.selector`): Stored in `chrome.storage.local` under `cosmeticSelectors`, injected via `chrome.scripting.insertCSS` on navigation
3. **Domain-scoped cosmetics** (`site.com##.selector`): Stored under `domainCosmetics`, injected per-domain
4. **Scriptlet rules** (`##+js(name, args)`): Stored under `scriptletRules`, executed via `chrome.scripting.executeScript` calling `globalThis.__sbRunScriptlets()` defined in `src/scriptlets.js`

`$removeparam` rules are collected into `removeParamData` and applied by `applyRemoveParamRules()` which merges them with the hardcoded `STATIC_REMOVE_PARAMS` set and emits a single global DNR redirect+queryTransform rule where possible.

### Storage layout

Everything lives in `chrome.storage.local`. Key prefixes:
- `fr_<key>` — DNR rules for filter list `key`
- `fc_<key>` — cosmetic selectors for list `key`
- `fd_<key>` — domain cosmetics for list `key`
- `fs_<key>` — scriptlet rules for list `key`
- `frp_<key>` — removeparam data for list `key`
- `fm_<key>` — metadata (fetch timestamp, rule count) for list `key`
- `cfe_<key>` — ETag for list `key` (HTTP 304 caching)
- `cf*_<key>` — same prefixes but for custom user-subscribed lists
- `cosmeticSelectors`, `domainCosmetics`, `scriptletRules` — aggregated post-sync caches
- `removeParamData` — aggregated removeparam data
- `settings` — user toggle state (see `DEFAULT_SETTINGS` in background.js)
- `stats`, `lifetime` — block counts
- `dailyStats` — `{ "YYYY-MM-DD": count }` for 7-day sparkline, kept 30 days
- `filterMatrix` — `{ hostname: { ruleKey: 'allow'|'block'|'default' } }`
- `persistedLog` — last 100 log entries cached for SW restart recovery
- `customHideRules` — element picker selections
- `userCosmetics`, `userDomainCosmetics`, `userScriptletRules`, `userFilterText` — user-typed rules in Filters panel
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

Server-Side Ad Insertion stitches ads into the content stream, so they can't be removed at the network layer. Two layers handle it:
- **Dedicated scripts**: `content-twitch.js`, `content-hulu.js`, `content-kick.js`, `content-spotify.js`
- **Generic handler**: `content-streaming.js` (`settings.streaming`) covers Max, Disney+, Paramount+, Peacock, Pluto TV and Tubi via a per-host config map.

The strategy:
1. Detect ad state via DOM selectors (countdown timers, ad-overlay elements) — `content-streaming.js` adds a player-scoped "Ad…" text detector as a durable fallback
2. Mute the video element (`video.muted = true`) for the ad duration
3. Remove ad UI overlays from the DOM (the dedicated scripts; `content-streaming.js` is **mute-only** to stay playback-safe on players we can't test)
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

`rules/base.json` (261 rules), `rules/extended.json` (387 rules), `rules/hosts.json` (747 rules), `rules/tracking.json` (2 rules) — these ship with the extension and are always active regardless of filter sync status. IDs 1–9999 are reserved for these files (e.g. base.json's Google/DoubleClick redirect rules live at 190–199, not in the 10000–29999 dynamic band). When editing them, keep IDs within the 1–9999 static reserve.

### Alarms

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
