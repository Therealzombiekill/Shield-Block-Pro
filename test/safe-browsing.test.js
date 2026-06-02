/**
 * Safe Browsing — trusted allowlist + "Proceed" bypass (src/background.js, blocked.js)
 *
 * Two failure modes this guards:
 *   1. Threat feeds sometimes list a registrable domain (e.g. google.com) because a
 *      single subdomain hosted phishing. The parent-domain match would then block
 *      all of Drive/Gmail/Docs. A trusted allowlist must short-circuit those.
 *   2. Clicking "Proceed" must let the user through — without a session bypass the
 *      re-navigation is immediately re-blocked and the user is trapped.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const bg = readFileSync(`${ROOT}src/background.js`, 'utf8');
const blockedJs = readFileSync(`${ROOT}src/blocked.js`, 'utf8');

const trustedMatch = bg.match(/SB_TRUSTED\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
assert.ok(trustedMatch, 'SB_TRUSTED not found in background.js');
const TRUSTED = new Set([...trustedMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]));

// Mirror of background.js _sbHostAllowed (trusted-domain side), driven by the
// REAL SB_TRUSTED data parsed above.
function trustedAllows(hostname) {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    if (TRUSTED.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

test('major sites (and their subdomains) are trusted; threats are not', () => {
  for (const h of ['google.com', 'drive.google.com', 'docs.google.com', 'mail.google.com',
                   'amazon.com', 'github.com', 'login.microsoftonline.com']) {
    assert.equal(trustedAllows(h), true, `${h} must be trusted (never blocked)`);
  }
  for (const h of ['evil-phishing-xyz.com', 'malware.example', 'not-google.com.evil.ru']) {
    assert.equal(trustedAllows(h), false, `${h} must NOT be auto-trusted`);
  }
});

test('checkSafeBrowsing short-circuits on the allowlist / proceed bypass', () => {
  assert.match(bg, /const _sbProceed = new Set\(\)/);
  assert.match(bg, /if \(_sbHostAllowed\(hostname\)\) return false/);
  assert.match(bg, /case 'SB_PROCEED'/);
});

test('the warning page tells the SW to bypass before navigating on Proceed', () => {
  assert.match(blockedJs, /type: 'SB_PROCEED'/);
  // and it must await that before navigating
  assert.ok(blockedJs.indexOf('SB_PROCEED') < blockedJs.indexOf('location.href = u.href'),
    'SB_PROCEED must be sent before navigation');
});
