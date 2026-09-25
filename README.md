# ShieldBlock Pro

A Manifest V3 browser extension for Chrome and Firefox that blocks ads, trackers, cookie banners, and other page clutter. Everything runs on your device; there is no ShieldBlock server.

The current version is the `version` field in [`manifest.json`](manifest.json).

## Features

- **Network blocking**: about 29,000 built-in rules (EasyList, EasyPrivacy, EasyList Germany, and Peter Lowe, compiled into the package) plus 30+ filter lists refreshed every 12 hours.
- **Element hiding and scriptlets**: cosmetic filters and anti-adblock scriptlets from the same lists. A snapshot ships in the package, so hiding works before the first download finishes.
- **Cookie banners**: rejects consent on 45+ consent platforms instead of just hiding the banner.
- **Privacy**: tracking-parameter removal, fingerprinting protection, referrer trimming, HTTPS upgrade, and GPC/DNT headers.
- **Safe browsing**: optional blocking of known malware and phishing domains, using public URLhaus and OpenPhish feeds checked on your device.
- **Annoyances**: removes chat widgets, push-notification prompts, app-install banners, and survey bubbles.
- **Your own rules**: element picker, custom filter rules, custom filter-list subscriptions, per-site allowlist, per-site filtering matrix, and backup and restore.

### Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Open ShieldBlock | Alt + Shift + S |
| Toggle blocking on the current site | Alt + Shift + B |
| Activate element picker | Alt + Shift + P |

## Install from source

There is no build step. In Chrome, open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and select this folder. In Firefox 128 or later, run `node scripts/package.mjs --firefox` and load the zip from `about:debugging#/runtime/this-firefox`. The Firefox build switches the background service worker to an event page.

## Development

- `node scripts/validate-extension.mjs`: syntax and manifest checks plus a filter-parser smoke test.
- `node scripts/test-parser.mjs`: filter-parser regression tests.
- `node scripts/build-bundled-cosmetics.mjs`: refreshes `src/bundled-cosmetics.json`, the element-hiding snapshot, from the live lists. Run it before each release.
- `node scripts/compile-static-rules.mjs`: compiles a filter list into a static DNR ruleset.
- `node scripts/package.mjs [--firefox]`: builds the store zip in `dist/`.

See [`CLAUDE.md`](CLAUDE.md) for architecture notes.

## Privacy

ShieldBlock Pro sends no data to its developer. It downloads filter lists and, when safe browsing is on, malware and phishing domain lists. Your settings, allowlist, and custom rules are also saved to browser sync (`chrome.storage.sync`), so they follow your browser account to your other devices.
