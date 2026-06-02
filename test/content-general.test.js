/**
 * General cleanup safety — src/content-general.js
 *
 * cleanInterstitials() removes fixed, high-z-index elements whose class/id looks
 * like an ad. The matcher must use word boundaries: a bare /ad/ substring matched
 * legit UI ("header", "loading", "download", "thread") and generic "modal"/
 * "overlay"/"popup", so real login modals, lightboxes and cookie overlays were
 * being deleted. This drives the REAL regex from the source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/content-general.js', import.meta.url)), 'utf8');
const m = src.match(/INTERSTITIAL_CLASS_RE\s*=\s*(\/.*\/[a-z]*)\s*;/);
assert.ok(m, 'INTERSTITIAL_CLASS_RE not found in content-general.js');
const RE = eval(m[1]); // our own source — evaluate the regex literal

test('interstitial matcher catches ad / annoyance class names', () => {
  for (const c of ['ad', 'ads', 'ad-overlay', 'admodal', 'interstitial-ad', 'promo-banner',
                   'sponsored-overlay', 'newsletter-popup', 'advertisement', 'modal-ad', 'overlay-ad']) {
    assert.ok(RE.test(c), `should match ad class: ${c}`);
  }
});

test('interstitial matcher does NOT match legit UI (the over-removal bug)', () => {
  for (const c of ['header', 'site-header', 'loading', 'loading-overlay', 'download', 'download-modal',
                   'thread', 'shadow-box', 'breadcrumb', 'modal', 'overlay', 'popup', 'login-modal',
                   'cookie-consent-overlay', 'nav-drawer', 'address-bar', 'admin-panel']) {
    assert.equal(RE.test(c), false, `must NOT match legit class: ${c}`);
  }
});
