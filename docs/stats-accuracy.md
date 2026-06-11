# Stats accuracy audit — blocked counts & time saved

Deep audit of how ShieldBlock Pro counted "ads blocked" and "time saved", the
bugs found, and the redesigned pipeline that replaced it (v2.18.x).

## What was wrong

### Over-counting — the counter was effectively a request counter

The old `countNetworkBlocks()` counted **every** entry returned by
`chrome.declarativeNetRequest.getMatchedRules()` as a blocked ad. But matched
rules include every rule whose action was applied, not just blocks:

| Matched rule | Action | Old behavior | Reality |
|---|---|---|---|
| 47002 DNT/Sec-GPC headers (default ON) | `modifyHeaders` | counted as a block | matches **every outbound request** |
| 47000 referrer strip (default ON) | `modifyHeaders` | counted as a block | matches every 3rd-party subresource |
| 47001 HTTPS upgrade | `upgradeScheme` | counted as a block | a scheme upgrade |
| 48000+ whitelist rules, 49999 global pause | `allow` | counted as a block | browsing a *whitelisted* or *paused* site **increased** "ads blocked" |
| 355–362 YouTube-protect rules | `allow` | counted as a block | explicitly allowed traffic |
| 900–901 + 30000s removeparam | `redirect`+`queryTransform` | counted as a block | a stripped `utm_*`/`gclid` param, not an ad |

### Under-counting — one snapshot, then silence

- Counting ran **once per navigation**, 300 ms after `onCompleted`. Everything
  after that — lazy-loaded ads, infinite scroll, SPA route changes (YouTube,
  Twitch), long-lived tabs — was never counted.
- `getMatchedRules` has a **quota of 20 calls per 10 minutes**. One call per
  page load (plus one per popup open) exhausted it after ~20 pages; every page
  after that silently counted zero (`catch (_) {}`).

### Wrong data in the panels

- `MatchedRuleInfo` has **no request URL** (`m.request?.url` was always
  `undefined`), so the "Top blocked this session" and "Blocked on this page"
  panels logged the *page you were visiting* instead of the blocked tracker.
- Network blocks never reached `dailyStats` → the 7-day sparkline showed only
  DOM-level blocks.
- Network blocks added **0 seconds** to "Time saved".
- Daily buckets used UTC dates — evening activity in the Americas/Asia landed
  on the wrong day.
- The popup hero says "**Session** ads blocked" but `stats` never reset —
  it duplicated "Lifetime total".
- `_pageStats`/`_domainStats`/`_requestLog` lived only in SW memory; MV3 kills
  the SW after ~30 s idle, so "This page" and "Top blocked" reset constantly.
- YouTube network blocks were attributed to `general` (only twitch/amazon were
  checked).

## The new design

### Global quota-aware poller (`_pollMatchedRules`)

- Polls `getMatchedRules()` **globally** (no tabId) on a 1-minute `statsPoll`
  alarm + throttled event triggers (page load ≥25 s gap, popup open ≥10 s gap),
  all behind a single-flight lock.
- Self-imposed cap of 16 calls per rolling 10 minutes (hard quota is 20). The
  call window and a **timestamp high-water mark** (dedupe) are persisted in
  `chrome.storage.session`, so SW restarts neither double-count nor over-call.
- Match retention is ~5 minutes, so a 1-minute poll sees every match —
  including SPA navigations and long-lived tabs the old snapshot missed.

### Classification by rule action, not by existence

`_staticRuleMeta` (built from bundled `rules/*.json` at startup) and
`_dynRuleMeta` (from `getDynamicRules()`, refreshed lazily + every 10 min) map
rule ID → action kind:

- `block` and redirect-to-blank → counted as **blocked** (+50 ms time saved
  each — Brave's published per-request estimate; DOM blocks keep their richer
  per-type estimates, e.g. 15 s per skipped YouTube ad).
- `redirect` with `queryTransform` → counted as **`removeparam`** ("Tracking
  params cleaned" — its own popup row, excluded from total/badge/lifetime).
- `allow` / `modifyHeaders` / `upgradeScheme` → **never counted**.

Blocked-domain labels for the log panels come from the matched rule's
*condition* (`requestDomains` / `urlFilter`) — the only honest source, since
the API doesn't expose the request URL to packed extensions.

### Honest semantics

- `stats` is now genuinely session-scoped: zeroed in `onStartup`; cumulative
  history stays in `lifetime` (always tracked in parallel) and `timeSaved`.
- All stat writes (DOM + network + daily) flow through one serialized,
  batched writer — no more racing read-modify-writes.
- Daily buckets use local dates.
- Per-tab stats, top domains, and the request log survive SW restarts via
  `chrome.storage.session` (auto-cleared when the browser closes).

### Firefox

`getMatchedRules` is not implemented in Firefox — network counting skips
gracefully there (as before); DOM-level platform stats are unaffected.

## Verifying

1. Load unpacked → browse an ad-heavy site → popup within ~1 min shows network
   blocks; "Top blocked this session" lists tracker domains (doubleclick.net,
   …), not the sites you visited.
2. Visit a whitelisted site → counter must NOT increase.
3. Toggle DNT/referrer privacy options on → counter must not climb with plain
   browsing on an ad-free page.
4. Navigate a URL with `?utm_source=x` → "Tracking params cleaned" increments;
   hero total does not.
5. Restart the browser → hero resets to 0, "Lifetime total" and "Time saved"
   persist.
