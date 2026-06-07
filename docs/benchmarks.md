# ShieldBlock Pro — Blocking Benchmark Baseline

Measure the extension against standard public tests before and after filter/engine changes.

## Test sites

| Site | URL | What it measures |
|------|-----|----------------|
| **d3ward toolz** | https://d3ward.github.io/toolz/adblock.html | Network + cosmetic blocking score (/100) |
| **AdBlock Tester** | https://adblock-tester.com/ | Multi-category ad/tracker blocking (/50 typical max) |
| **EFF Cover Your Tracks** | https://coveryourtracks.eff.org/ | Fingerprint / tracking protection (qualitative) |

## How to run

1. Load unpacked extension in Chrome (Developer mode).
2. Open popup → **Support** → **Blocking Benchmarks** → **Open tests** (opens all three tabs).
3. Complete each site's test flow.
4. Enter scores in the popup fields → **Save scores**.
5. Run **Extension Health** → confirm **Benchmarks** row shows 3/3 scored.

Scores persist in `chrome.storage.local` under `benchmarkScores`.

## Comparison targets (reference)

Run the same flow with **uBlock Origin Lite** or **AdGuard** on identical Chrome profile settings to establish competitor baselines. Record side-by-side in this table:

| Date | Version | d3ward | AdBlock Tester | EFF CYT | Notes |
|------|---------|--------|----------------|---------|-------|
| | | | | | |

## After procedural-cosmetic / scriptlet changes

Re-sync filter lists (Stats → force sync), hard-refresh open tabs, then re-run benchmarks. Cosmetic-heavy sites (AdBlock Tester categories 3–4) should improve when `:has-text()` rules are fed to `content-procedural.js`.

## CLI validation (no browser)

```bash
node scripts/validate-extension.mjs
node scripts/compile-static-rules.mjs path/to/easylist.txt --out rules/generated.json --start-id 20000
```
