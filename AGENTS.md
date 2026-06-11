# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

ShieldBlock Pro is a Manifest V3 Chrome/Firefox browser extension. There is **no build step**, **no package manager**, and **no automated test suite**. Source files are loaded directly by the browser as an unpacked extension.

See `CLAUDE.md` for architecture, storage layout, DNR rule ID ranges, and manual testing workflow.

## Trusted sites (v2.11.0+)

**Single source:** `src/trusted-sites.js` — protected filter domains, Google API initiator exclusions, safe-browsing allowlist, and privacy URL-clean skip hosts.

| Consumer | Uses |
|----------|------|
| `src/filter-parser.js` | `isDomainProtected`, `SHARED_GOOGLE_API_EXCLUDED_INITIATORS` |
| `src/background.js` | `isSafeBrowsingAllowlisted` (+ `sanitizeSbDomains`) |
| `src/content-privacy.js` | `shouldSkipPrivacyUrlClean` → `SB_PRIVACY_CONFIG.skipUrlClean` |

When adding GitHub / Google Workspace / GA dashboard protection, update **trusted-sites.js** first, then mirror `excludedInitiatorDomains` on static `apis.google.com` / `boq.google.com` rules in `rules/hosts.json` if needed.

## Cursor Cloud specific instructions

### What runs locally

| Component | Required? | Notes |
|-----------|-----------|-------|
| Google Chrome ≥ 116 (or Firefox ≥ 128) | **Yes** | Primary dev path is Chrome |
| Node.js | Optional | Ad-hoc validation only |
| Local dev server / Docker / database | **No** | State in `chrome.storage.local` + IndexedDB |

Nothing is started from the terminal. Runtime is the extension service worker (`src/background.js`).

### Loading the extension for development

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → `/workspace`
2. After edits, **Reload** the extension card

DevTools: service worker console on the extension card; popup via right-click toolbar icon → Inspect Popup.

### Lint / test / build

| Task | Command / workflow |
|------|-------------------|
| Lint | Not configured (no ESLint/Prettier in repo) |
| Automated tests | None — manual browser testing only |
| Build | None — edit source and reload the extension |
| Structure validation | `node scripts/validate-extension.mjs` |
| Roadmap verification | `node scripts/test-roadmap.mjs` (49 factual checks) |
| Benchmark domains | `node scripts/check-benchmark-domains.mjs` |
| JS syntax check | Included in `validate-extension.mjs` |
| Static rules compile | `node scripts/compile-static-rules.mjs easylist.txt --out rules/generated.json` (release-time only) |
| Benchmark baseline | Support tab → Blocking Benchmarks; see `docs/benchmarks.md` |

### Hello-world verification

1. Confirm **ShieldBlock Pro** appears enabled on `chrome://extensions` (currently v2.18.0).
2. Open the extension popup from the toolbar.
3. Go to the **Support** tab → **Extension Health** → click **Run check**.
4. Expect mostly passing checks; a fresh install may show a "working but not optimal" warning until filter lists finish syncing.

### Regression checklist (before merging YouTube / DNR / privacy changes)

| Site / feature | How to verify |
|----------------|---------------|
| YouTube playback | Video plays; no error **282054944**; log tag `2.11.1-playfirst` |
| YouTube ads | DOM skip/mute works; **no** `InnerTube fetch: stripped` in logs |
| GitHub | Sign-in, repo browse, assets load |
| Google Drive / Docs | Open files, edit |
| GA dashboard | `analytics.google.com` loads reports (third-party trackers still blocked elsewhere) |
| Safe browsing | Health: GitHub/Drive/GA not in malware cache |

### YouTube — play-first (v2.11.1+)

**Let the player start, then block ads.** Do **not** re-add `fetch`/`XHR` `Response` rewriting (black screen + 282054944).

| Phase | Behavior |
|-------|----------|
| Until `playing` | No overlay removal, no skip/mute, no `ytInitial` prune |
| After playback + ~2s grace | `SB_YT_PLAYBACK_READY` → DOM ad handling + optional `ytInitial` prune on later SPA sets |
| Browse / no video | After 12s, feed-only overlay cleanup (no in-player touches) |

Log tag: `2.11.1-playfirst`. Never remove all `tp-yt-iron-overlay-backdrop` nodes.

### Chrome on cloud VMs

```bash
google-chrome --user-data-dir=/tmp/chrome-sb-dev --no-first-run --disable-default-apps --load-extension=/workspace &
```

`--load-extension` auto-loads the repo on first launch; if it does not appear, use **Load unpacked** on `chrome://extensions` and point at `/workspace`. Cloud Chrome may also listen on **remote debugging port 9222** (`curl -s http://127.0.0.1:9222/json/list`). MV3 service worker may show **Inactive** when idle — normal.

### Reload gotchas

- **Background:** reload extension; check service worker console.
- **Content scripts:** reload the **page** tab.
- **Popup:** close and reopen after reload.
- **Static DNR rules (`rules/*.json`):** a full Chrome restart does **not** re-index edited static rulesets for an unpacked extension — the old indexed ruleset is reused. Click **Reload** (↻) on the `chrome://extensions` card (or bump `manifest.json` version) to force a re-index. Verify with `chrome.declarativeNetRequest.testMatchOutcome(...)` in the service worker console. (Dynamic rules update live; only static rulesets are affected.)

### VM update script (dependency refresh only)

```text
node scripts/validate-extension.mjs
```
