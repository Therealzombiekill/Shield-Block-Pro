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
2. Open the three test URLs above, each in its own tab.
3. Complete each site's test flow and note the score.
4. Re-run with ShieldBlock paused (popup → pause) or on a clean profile to confirm the delta.

> The in-popup "Blocking Benchmarks" score-entry panel was removed (it only stored
> numbers you typed in by hand). Record results in the comparison table below — or
> your own notes — instead.

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
