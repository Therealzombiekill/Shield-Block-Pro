# Benchmarking ShieldBlock Pro

Goal: measure where ShieldBlock Pro actually stands versus the best Chrome MV3 blockers
(uBlock Origin **Lite**, AdGuard) so we improve **real** gaps instead of guessing. Establish
a baseline first, then re-run after every change to prove progress (and catch regressions).

> Reality check: full uBlock Origin is **not** available on Chrome MV3 — that's why uBO ships
> the reduced "Lite" build there. The target we can actually win is **best MV3 blocker**: beat
> uBO Lite, rival AdGuard. These benchmarks measure against that bar.

---

## 1. The test suites

| Suite | URL | Measures | Maps to (our subsystem) |
|---|---|---|---|
| **d3ward toolz** | https://d3ward.github.io/toolz/adblock.html | Network blocking — % of known ad/tracker hosts refused | filter lists, `rules/*.json`, DNR capacity |
| **Can You Block It** | https://canyoublockit.com/testing/ | Cosmetic hiding + anti‑adblock (multiple difficulty levels) | cosmetic selectors, **procedural cosmetics**, scriptlets |
| **AdBlock Tester** | https://adblock-tester.com/ | Single 0–100 score across ads/trackers/social/etc. | everything; good headline number |
| **EFF Cover Your Tracks** | https://coveryourtracks.eff.org/ | Tracker blocking + fingerprint randomization/uniqueness | `inject-privacy.js`, `content-privacy.js`, fingerprint resistance |
| **Local self‑test** | `test/adblock-selftest.html` (this repo) | Quick, version‑controlled network‑block smoke test | regression checks between releases |

The first four are authoritative. The local page is for fast, repeatable regression checks that
don't depend on an external site staying online.

---

## 2. Running the local self-test

```bash
# from the repo root
python3 -m http.server 8099
# then open http://localhost:8099/test/adblock-selftest.html
```

Serve over **http**, not `file://`, so DNR rules apply faithfully. Method:

1. **Noise floor** — disable every blocker, reload, *Run test*. Anything still "blocked" is a dead
   host / DNS failure, not a real block. Note them; subtract them from the real run.
2. **Real run** — enable ShieldBlock, let a filter sync finish (popup → Support → *Run check*),
   reload, *Run test*.
3. **Real blocked rate = (blocked with extension) − (dead‑host floor).**
4. Use **Copy results** to paste a snapshot into the changelog / a PR.

---

## 3. Fair-comparison rules

So numbers are comparable across blockers and over time:

- **One blocker at a time**, in a **fresh Chrome profile** per blocker (avoid cross-contamination).
- Record the **Chrome version** — DNR limits differ (<121 caps dynamic rules at 5,000; 121+ allows
  30,000 "safe" rules; ShieldBlock auto-scales to whatever it detects).
- For ShieldBlock, **wait for a full filter sync** before testing (popup → Support → *Run check*
  shows rule counts).
- Use each blocker's **default lists** (don't hand-tune one and not the others).
- Run each suite **twice** and keep the better/median — these tests have run-to-run noise.

---

## 4. Baseline scorecard (fill this in)

> Date: ____  ·  Chrome version: ____

| Suite (higher = better) | ShieldBlock Pro | uBO Lite | AdGuard | Gap |
|---|---|---|---|---|
| d3ward — % blocked | | | | |
| Can You Block It — levels passed | | | | |
| AdBlock Tester — score /100 | | | | |
| Cover Your Tracks — trackers blocked | | | | |
| Cover Your Tracks — fingerprint | | | | |
| Local self-test — % blocked | | | | |

Per-category from the local self-test (so you see *which* gap):

| Category | ShieldBlock % | Notes |
|---|---|---|
| Ads | | |
| Analytics | | |
| Social | | |
| Fingerprint | | |
| Cryptomine | | |

---

## 5. Turning failures into fixes

| If this is weak… | …the fix lives here | Effort |
|---|---|---|
| d3ward / self-test **network %** low | Raise per-list `max` in `FILTER_LISTS`, add lists, or move big lists to **static rulesets** (`rules/*.json`); confirm dynamic-rule budget (`MAX_DYNAMIC_RULES`) is detecting the 30k cap | med–high |
| **Can You Block It** leaves elements visible | Cosmetic selectors, and especially the **procedural cosmetics** engine (`:has-text` / `:upward` / `:xpath`) — currently input-starved in `filter-parser.js` | med |
| **Anti-adblock** nags appear | Scriptlets (`src/scriptlets.js` `IMPL` map) + anti-adblock filter lists | med |
| **Cover Your Tracks**: trackers slip through | `EasyPrivacy`/AdGuard Tracking coverage; first-party (CNAME) trackers need Firefox CNAME uncloaking | low–high |
| **Cover Your Tracks**: fingerprint "unique" | `inject-privacy.js` canvas/font/WebGL noise + UA-CH reduction | med |
| **YouTube/Twitch** ads play | Platform scripts (`inject-youtube.js`, `content-youtube.js`, …) | ongoing |

---

## 6. Regression workflow

Run the **local self-test** before and after any change that touches the filter pipeline
(`filter-parser.js`, `background.js`, `rules/*.json`) and paste the before/after into the PR.
A drop in blocked % is a regression. Periodically re-run the full external suite set (§1) and
update the scorecard in §4 so "are we #1 yet?" always has a current, evidence-based answer.
