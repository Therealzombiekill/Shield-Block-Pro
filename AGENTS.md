# AGENTS.md

Guidance for AI agents working in this repository.

## Project overview

ShieldBlock Pro is a Manifest V3 Chrome/Firefox browser extension. **No build step**, **no package manager**, **no automated tests**. Load unpacked from the repo root.

See `CLAUDE.md` for architecture and DNR ID ranges.

## v2.12+ / v2.13+ — platform stability (YouTube, Amazon)

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

## Do not regress

- No InnerTube `fetch`/`XHR` hooks in `inject-youtube.js` (file kept but unloaded)
- No `import` in content scripts — use `browser-compat.js` shims
- Popup panels must stay `opacity: 1` when active (no stuck invisible UI)
