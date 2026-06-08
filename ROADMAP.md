# ShieldBlock Pro — Roadmap

Positioning: **the privacy-first ad/tracker blocker that never breaks your sites.**
Not trying to out-filter uBlock Origin — owning the fingerprint-resistance +
zero-breakage lane instead.

> **Audit note (code reality check):** most of the original roadmap turned out to
> be already implemented. The fingerprint-resistance stack is already
> comprehensive. The list below reflects what's *actually* left.

## ✅ Already built (verified in code)
- **Fingerprint resistance** — canvas, WebGL **and WebGL2** vendor/renderer,
  AudioContext noise, font enumeration, `hardwareConcurrency`, `deviceMemory`,
  `languages`, `connection`, screen metrics, Battery API, **`userAgentData`
  (Client-Hints)**, timezone (`Intl.DateTimeFormat`), media-device enumeration,
  devicemotion/orientation, `globalPrivacyControl`.
- **WebRTC IP-leak protection** (`webRTCIPHandlingPolicy`).
- Network privacy — referrer strip, HTTPS upgrade, DNT + Sec-GPC, URL/redirect cleaning.
- Settings import/export, uBO backup import, custom filter-list subscription
  (file + URL), cloud sync, stats CSV export, diagnostic export, reset stats.
- Per-domain filter matrix, element picker, request log, Safe Browsing,
  cryptominer blocking (NoCoin).
- 16,887 static rules + dynamic subscriptions + 21k cosmetics + procedural.

## ⏳ Genuinely remaining
### Tier 1 — differentiators
- [ ] **CNAME uncloaking** (Firefox `dns.resolve`) — unmask trackers behind
      first-party CNAMEs. Genuinely missing; complex in MV3; Firefox-only.
- [ ] **Local CDN resource replacement** (Decentraleyes-style) — serve common
      libs locally so CDNs can't track. Med-high effort.
- [ ] **Per-site privacy report card** — surface the (already-strong) protection
      per page: "local IP hidden · canvas spoofed · 7 trackers blocked." Low risk;
      the data already exists (page stats + settings).
- [ ] Minor fingerprint vectors: `getClientRects` quantization, speech-synthesis
      voice list. Niche; some breakage risk — verify before shipping.

### Tier 3 — polish
- [ ] CHANGELOG + store-listing refresh (still mentions YouTube/Twitch)
- [ ] UI localization (i18n)
- [ ] Keyboard shortcuts + context-menu element zapper

## 🚫 Explicitly NOT doing
- Re-entering the YouTube/Twitch SSAI ad-block arms race (deliberately removed).
- Adding more overlapping filter lists (diminishing returns + FP surface).
- "Acceptable ads" or any monetization of blocking (trust-killer).
- Bundling a VPN/proxy (scope creep).

## Architecture notes
- **Static vs dynamic budgets:** dynamic DNR caps at 5,000 (live, fetched);
  static rulesets cap at ~30,000 (frozen, shipped). Bulk → static; freshness +
  cosmetics → dynamic.
- Behavior-changing privacy features **must** get a real-world breakage pass
  before shipping — highest false-positive risk.
