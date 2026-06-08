# ShieldBlock Pro — Roadmap

Positioning: **the privacy-first ad/tracker blocker that never breaks your sites.**
Not trying to out-filter uBlock Origin — owning the fingerprint-resistance +
zero-breakage lane instead.

## Tier 1 — Privacy-lane differentiators
- [ ] **CNAME uncloaking** (Firefox `dns.resolve`) — unmask trackers hiding behind
      first-party subdomains. uBO-on-Firefox parity; most blockers can't do it.
- [ ] **Fingerprint-spoofing gaps** — add `hardwareConcurrency`, `deviceMemory`,
      WebGL vendor/renderer string, font enumeration, `getClientRects`.
- [ ] **Client-Hints / User-Agent reduction** — the modern fingerprint vector.
- [ ] **Local CDN resource replacement** (Decentraleyes-style) — serve common libs
      locally so CDNs can't track across sites.
- [ ] **Per-site privacy report card** — surface what's protected on this page.
- [x] **WebRTC IP-leak protection** — `webRTCIPHandlingPolicy` = public-interface-only.

## Tier 2 — Quality & trust
- [ ] **Settings import/export** (JSON backup/restore).
- [ ] **Auto-refresh static rules** (GitHub Action, weekly PR).
- [ ] **"Report broken site" loop** — one-click pause + log which rule broke it.
- [ ] **Storage/supercookie cleaning** — clear localStorage/IndexedDB/ETag trackers.
- [ ] **Network request inspector** upgrade.
- [ ] **Cloud-sync polish** (cross-device settings).

## Tier 3 — Polish
- [ ] UI localization (i18n)
- [ ] Keyboard shortcuts + context-menu element zapper
- [ ] CHANGELOG + store-listing refresh
- [ ] Onboarding tour

## Explicitly NOT doing
- Re-entering the YouTube/Twitch SSAI ad-block arms race (deliberately removed).
- Adding more overlapping filter lists (diminishing returns + false-positive surface).
- "Acceptable ads" or any monetization of blocking (trust-killer).
- Bundling a VPN/proxy (scope creep).

## Architecture notes
- **Static vs dynamic budgets:** dynamic DNR rules cap at 5,000 (live, fetched);
  static rulesets cap at ~30,000 (frozen, shipped). Bulk coverage → static
  (currently 16,887 rules); freshness + cosmetics → dynamic subscriptions.
- Behavior-changing privacy features (fingerprint spoofing, client-hints, CNAME)
  **must** get a real-world breakage pass before shipping — they're the highest
  false-positive risk.
