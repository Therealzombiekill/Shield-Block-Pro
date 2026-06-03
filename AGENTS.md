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
| Lint | Not configured |
| Automated tests | None — manual browser testing |
| Build | None |
| Structure validation | `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"` |
| JS syntax check | `node --check src/background.js` |

### Hello-world verification

1. Extension enabled on `chrome://extensions` (v2.11.0+).
2. Open popup → **Support** → **Extension Health** → **Run check**.
3. Expect **Trusted sites**, **Version**, and filter checks to pass.

### Regression checklist (before merging YouTube / DNR / privacy changes)

| Site / feature | How to verify |
|----------------|---------------|
| YouTube playback | Video plays; no error **282054944**; log tag `2.11.0-stable` |
| YouTube ads | DOM skip/mute works; **no** `InnerTube fetch: stripped` in logs |
| GitHub | Sign-in, repo browse, assets load |
| Google Drive / Docs | Open files, edit |
| GA dashboard | `analytics.google.com` loads reports (third-party trackers still blocked elsewhere) |
| Safe browsing | Health: GitHub/Drive/GA not in malware cache |

### YouTube — do not oscillate strategies

**Stable design** — do **not** re-add `fetch`/`XHR` `Response` rewriting in `inject-youtube.js` (black screen + 282054944):

| Layer | File | Role |
|-------|------|------|
| First paint | `inject-youtube.js` | In-place `ytInitialPlayerResponse` prune only |
| Player | `content-youtube.js` | Skip, mute, overlays, 282054944 recovery |
| Privacy | `inject-privacy.js` | No generic anti-adblock on YouTube |

Never remove all `tp-yt-iron-overlay-backdrop` nodes. Never merge “full InnerTube fetch hook” branches without playback proof.

### Chrome on cloud VMs

```bash
google-chrome --user-data-dir=/tmp/chrome-sb-dev --no-first-run --disable-default-apps &
```

### Reload gotchas

- **Background:** reload extension; check service worker console.
- **Content scripts:** reload the **page** tab.
- **Popup:** close and reopen after reload.

### VM update script (dependency refresh only)

```text
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
node --check src/background.js
```
