# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

ShieldBlock Pro is a Manifest V3 Chrome/Firefox browser extension. There is **no build step** and **no runtime or dev dependencies** — source files are loaded directly by the browser as an unpacked extension. A `package.json` exists solely to mark the source as ES modules and to wire Node's built-in test runner; `npm install` pulls nothing.

There **is** an automated test suite (`npm test` → `node --test`, files under `test/`) that guards the silent-failure surfaces: the filter-parser contract, DNR rule-ID range disjointness and budgets, static-ruleset validity, and manifest integrity. It runs in CI (`.github/workflows/ci.yml`) on Node 20 and 22.

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
| Automated tests | `npm test` (alias for `node --test`) — zero-dependency suite in `test/`, also enforced in CI |
| Build | None — edit source and reload the extension |
| Structure / manifest validation | Covered by `test/manifest.test.js` and `test/static-rules.test.js` |
| JS syntax check | `npm run check` (filter-parser + background); CI `node --check`s every script |

### Hello-world verification

After loading unpacked:

1. Confirm **ShieldBlock Pro** appears enabled on `chrome://extensions` (currently v2.10.1).
2. Open the extension popup from the toolbar.
3. Go to the **Support** tab → **Extension Health** → click **Run check**.
4. Expect mostly passing checks; a fresh install may show a "working but not optimal" warning until filter lists finish syncing.

Filter sync uses remote CDNs (EasyList, uBlock, AdGuard, etc.) and requires network access. Bundled static DNR rules in `rules/*.json` work offline.

### Reload gotchas

- **Background (`src/background.js`):** service worker restarts on extension reload; check the service worker console for startup errors.
- **Content scripts:** require a **page reload** (not just extension reload) to pick up changes on already-open tabs.
- **Popup changes:** close and reopen the popup after reload.
