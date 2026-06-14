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
| Static rules compile | `node scripts/compile-static-rules.mjs <list.txt> --out rules/<name>.json --start-id <id> --max <n>` — refresh at release time: easylist-static (100000, max 16800), easyprivacy-static (130000, max 6000), easylistgermany-static (140000, max 2200), peterlowe-static (150000, max 3300). Static IDs must stay >=100000 (outside all dynamic bands) and total enabled static rules <=30,000 |
| Benchmark baseline | Open the adblock test URLs manually (d3ward, adblock-tester, EFF Cover Your Tracks) |
| Store packaging | `node scripts/package.mjs` → `dist/ShieldBlock-Pro-v<version>.zip` |
| CI | `.github/workflows/ci.yml` runs syntax checks + validators + static budget on every PR; `refresh-static-rules.yml` recompiles snapshots weekly via PR |

### Hello-world verification

1. Confirm **ShieldBlock Pro** appears enabled on `chrome://extensions` (currently v2.22.1).
2. Open the extension popup from the toolbar.
3. Go to the **Support** tab → **Extension Health** → click **Run check**.
4. Expect mostly passing checks; a fresh install may show a "working but not optimal" warning until filter lists finish syncing.

### Regression checklist (before merging DNR / privacy changes)

| Site / feature | How to verify |
|----------------|---------------|
| GitHub | Sign-in, repo browse, assets load |
| Google Drive / Docs | Open files, edit |
| GA dashboard | `analytics.google.com` loads reports (third-party trackers still blocked elsewhere) |
| Safe browsing | Health: GitHub/Drive/GA not in malware cache |

### Chrome on cloud VMs

```bash
google-chrome --user-data-dir=/tmp/chrome-sb-dev --no-first-run --disable-default-apps --load-extension=/workspace &
```

`--load-extension` auto-loads the repo on first launch; if it does not appear, use **Load unpacked** on `chrome://extensions` and point at `/workspace`. Cloud Chrome may also listen on **remote debugging port 9222** (`curl -s http://127.0.0.1:9222/json/list`). MV3 service worker may show **Inactive** when idle — normal.

### Reload gotchas

- **Background:** reload extension; check service worker console.
- **Content scripts:** reload the **page** tab.
- **Popup:** close and reopen after reload.

### VM update script (dependency refresh only)

```text
node scripts/validate-extension.mjs
```
