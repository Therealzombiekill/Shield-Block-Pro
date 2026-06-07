# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

ShieldBlock Pro is a Manifest V3 Chrome/Firefox browser extension. There is **no build step**, **no package manager**, and **no automated test suite**. Source files are loaded directly by the browser as an unpacked extension.

See `CLAUDE.md` for architecture, storage layout, DNR rule ID ranges, and manual testing workflow.

## Cursor Cloud specific instructions

### What runs locally

| Component | Required? | Notes |
|-----------|-----------|-------|
| Google Chrome ≥ 116 (or Firefox ≥ 128) | **Yes** | Primary dev path is Chrome |
| Node.js | Optional | Only for ad-hoc validation scripts; not part of the extension runtime |
| Local dev server / Docker / database | **No** | Extension state lives in `chrome.storage.local` and IndexedDB inside the browser |

Nothing is started from the terminal. The only runtime is the browser extension service worker (`src/background.js`), which starts when the extension is loaded.

### Loading the extension for development

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the repository root (`/workspace`)
4. After editing `src/*.js`, `popup.*`, or `manifest.json`, click **Reload** on the extension card

Useful DevTools entry points:

- **Service worker console:** `chrome://extensions` → "Inspect views: service worker"
- **Popup DevTools:** right-click the extension toolbar icon → "Inspect Popup"

### Lint / test / build

| Task | Command / workflow |
|------|-------------------|
| Lint | Not configured (no ESLint/Prettier in repo) |
| Automated tests | None — manual browser testing only |
| Build | None — edit source and reload the extension |
| Structure validation | `node scripts/validate-extension.mjs` |
| Roadmap verification | `node scripts/test-roadmap.mjs` (45 factual checks) |
| JS syntax check | Included in `validate-extension.mjs` |
| Static rules compile | `node scripts/compile-static-rules.mjs easylist.txt --out rules/generated.json` (release-time only) |
| Benchmark baseline | Support tab → Blocking Benchmarks; see `docs/benchmarks.md` |

### Hello-world verification

After loading unpacked:

1. Confirm **ShieldBlock Pro** appears enabled on `chrome://extensions` (currently v2.18.0).
2. Open the extension popup from the toolbar.
3. Go to the **Support** tab → **Extension Health** → click **Run check**.
4. Expect mostly passing checks; a fresh install may show a "working but not optimal" warning until filter lists finish syncing.

Filter sync uses remote CDNs (EasyList, uBlock, AdGuard, etc.) and requires network access. Bundled static DNR rules in `rules/*.json` work offline.

### YouTube ad blocking (v2.10.5 — do not oscillate strategies)

**One stable design** (do not re-add `fetch`/`XHR` Response rewriting in `inject-youtube.js` — it caused repeated black-screen regressions):

| Layer | File | What it does |
|-------|------|----------------|
| First load only | `inject-youtube.js` | In-place prune of `ytInitialPlayerResponse` ad fields (no `new Response()`) |
| All playback | `content-youtube.js` | Skip button, seek short ads, mute long ads, remove feed overlays, dismiss anti-adblock modal |

SPA navigations use pristine `/player` fetch responses; DOM layer handles in-player ads.

- **After YouTube changes:** reload extension + hard-refresh YouTube tabs.
- **Log tag:** `2.10.5-stable` in Support → Log.
- **Never** remove all `tp-yt-iron-overlay-backdrop` nodes (blanks the player).
- **Do not** merge alternate “full InnerTube fetch hook” branches without playback testing — that path keeps getting reverted for black screens.

### Chrome on cloud VMs (GUI testing)

```bash
google-chrome --user-data-dir=/tmp/chrome-sb-dev --no-first-run --disable-default-apps --load-extension=/workspace &
```

`--load-extension` auto-loads the repo on first launch; if it does not appear, use **Load unpacked** on `chrome://extensions` and point at `/workspace`. Cloud Chrome may also listen on **remote debugging port 9222** (`curl -s http://127.0.0.1:9222/json/list`). MV3 service worker may show **Inactive** when idle — normal.

### Reload gotchas

- **Background (`src/background.js`):** service worker restarts on extension reload; check the service worker console for startup errors.
- **Content scripts:** require a **page reload** (not just extension reload) to pick up changes on already-open tabs.
- **Popup changes:** close and reopen the popup after reload.
