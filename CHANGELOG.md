# Changelog

## [2.20.0] — Unreleased (privacy lane)
### Added
- **WebRTC IP-leak protection** — stops sites reading your local IP via WebRTC
  ICE candidates (leaks even behind a VPN), using `webRTCIPHandlingPolicy =
  default_public_interface_only`. Default-on toggle under Privacy & Advanced;
  WebRTC calls still work.
- **Per-site privacy report card** — the stats panel now shows which shields are
  live on the current page (fingerprint spoofing, local-IP hiding, referrer
  strip, HTTPS upgrade, DNT+GPC, cookie banners, tracker-param stripping,
  ad/tracker blocking), or an allowlisted/paused state.
- **Auto-refresh GitHub Action** — weekly job recompiles the static rulesets
  from upstream lists and opens a PR, keeping the frozen snapshot fresh.
- `ROADMAP.md` documenting the privacy-first / zero-breakage direction.

## [2.19.0]
### Removed
- Soft paywall bypass (legal/store-policy risk + selector fragility).
- Platform ad-blockers: YouTube, Twitch, Spotify, Hulu, Kick, SSAI streaming
  (could not be verified working).
- "Blocking Benchmarks" Support-tab UI + dead per-platform stat counters.
### Fixed
- 40+ false-positive apex blocks that broke legitimate sites (Facebook, Yahoo
  Mail, Fidelity, Akamai CDN, Craigslist, IMDb, NYT, Algolia, speedtest.net, …).
- Firefox filter-sync quota failure (added `unlimitedStorage`).
- bild.de ads re-appearing (standing `display:none` for re-inserted slots).
- `content-privacy.js` dead import; "Sign in with Google" (relaxed
  apis/boq.google.com).
- Stat-counting accuracy (count unique elements; honest time-saved incl.
  network blocks).
### Added
- Static rule coverage 1,415 → 16,887 by compiling EasyList, EasyPrivacy,
  EasyList Germany (full), and Peter Lowe into static rulesets.
- Modern tracker / session-replay / Amazon-Ads / German-ad-network static rules.
