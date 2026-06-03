# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

ShieldBlock Pro is a Manifest V3 Chrome/Firefox browser extension. **No build step**, **no package manager**, **no automated tests**. Load unpacked from the repo root.

See `CLAUDE.md` for architecture and DNR ID ranges.

## v2.14.0 — filter lists & platform stability

**39 built-in lists** (~4,300 DNR budget): EasyList, EasyPrivacy, uBO (main, unbreak, privacy, badware, cookies, annoyances), AdGuard (base, tracking, social, annoyances), Fanboy (annoyances, cookies, social), Peter Lowe, NoCoin, anti-adblock, regional languages.

**YouTube:** Network/filter-list blocking only — no `inject-youtube` / `content-youtube`. YouTube is **not** auto-whitelisted (v2.14 removes old whitelist entries). `googlevideo.com` etc. stay protected in `trusted-sites.js`.

**Amazon:** Still allowlisted; no `content-amazon.js`.

**Twitch / Spotify / Hulu / Kick:** Platform scripts **removed** from manifest — use filter lists only.

## v2.12+ / v2.13+ — platform stability (legacy notes)

**YouTube ad blocking is removed.** Do not re-add `inject-youtube.js` or `content-youtube.js` to `manifest.json` without explicit user request and playback testing.

| What | Behavior on YouTube |
|------|---------------------|
| Dedicated YT scripts | **Not loaded** |
| `inject-privacy.js` / `scriptlets.js` | **Excluded** via `exclude_matches` |
| Network / cosmetics | **Allowlisted** (`ensurePlatformStabilityMode`) |
| Default `settings.youtube` | `false` |

**Amazon shopping stability (v2.13+):** Do not re-add `content-amazon.js` to `manifest.json`. Regional `*.amazon.*` sites are allowlisted; static DNR must not block first-party Amazon APIs (`unagi`, `fls-na`, `aax`, etc.). Cosmetics/scriptlets skip Amazon hosts.

Filter lists still **protect** `googlevideo.com`, `youtube.com`, Amazon storefronts, etc. via `trusted-sites.js`.

## Trusted sites

Single source: `src/trusted-sites.js`. Content scripts use `browser-compat.js` (`__sbShouldSkipPrivacyUrlClean`) — not ES `import`.

## Cursor Cloud

- Chrome ≥ 116, load unpacked from `/workspace`
- Validate: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"` and `node --check src/background.js`
- Hello-world: Support → Run check (v2.13.0+); verify Amazon loads after reload
- Popup: minimal UI — session/lifetime/time saved (live via `GET_POPUP_STATS`), PayPal, privacy
- Stability: `runStabilityMaintenanceIfNeeded()` on install/startup (`STABILITY_VERSION` in `background.js`)
- **Not enterprise-managed:** no `management` permission; cloud sync is **opt-in** (`sbCloudSyncEnabled`). “Managed extensions” in Chrome = browser policy or duplicate install — see `chrome://policy`

## Do not regress

- No InnerTube `fetch`/`XHR` hooks in `inject-youtube.js` (file kept but unloaded)
- No `import` in content scripts — use `browser-compat.js` shims
- Popup panels must stay `opacity: 1` when active (no stuck invisible UI)
