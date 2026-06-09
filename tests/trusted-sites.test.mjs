import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hostMatchesSet, isDomainProtected, isSafeBrowsingAllowlisted, shouldSkipPrivacyUrlClean,
  SB_DOMAIN_ALLOWLIST, PROTECTED_DOMAINS,
} from '../src/trusted-sites.js';

// Security/correctness-relevant: the safe-browsing allowlist must not flag
// trusted file/cloud hosts, and the URL-clean skip must spare OAuth/SPA hosts.

test('hostMatchesSet matches exact host, subdomains, and strips www', () => {
  const set = new Set(['example.com']);
  assert.equal(hostMatchesSet('example.com', set), true);
  assert.equal(hostMatchesSet('www.example.com', set), true);
  assert.equal(hostMatchesSet('sub.example.com', set), true);
  assert.equal(hostMatchesSet('notexample.com', set), false);
  assert.equal(hostMatchesSet('', set), false);
});

test('hostMatchesSet only matches on label boundaries', () => {
  // example.com must NOT match a set entry of ample.com
  assert.equal(hostMatchesSet('example.com', new Set(['ample.com'])), false);
});

test('isSafeBrowsingAllowlisted protects trusted file/cloud/login hosts', () => {
  for (const h of ['github.com', 'raw.githubusercontent.com', 'drive.google.com',
                   'apple.com', 'claude.ai', 'wikipedia.org', 'dropbox.com', 'microsoft.com']) {
    assert.equal(isSafeBrowsingAllowlisted(h), true, `${h} must be safe-browsing allowlisted`);
  }
});

test('isSafeBrowsingAllowlisted is false for an arbitrary host', () => {
  assert.equal(isSafeBrowsingAllowlisted('totally-random-host-xyz.example'), false);
});

test('shouldSkipPrivacyUrlClean spares OAuth/SPA hosts (avoids breaking logins)', () => {
  assert.equal(shouldSkipPrivacyUrlClean('accounts.google.com'), true);
  assert.equal(shouldSkipPrivacyUrlClean('github.com'), true);
  assert.equal(shouldSkipPrivacyUrlClean('some-random-news-site.example'), false);
});

test('isDomainProtected recognizes protected domains from filter syntax', () => {
  assert.equal(isDomainProtected('||youtube.com^'), true);
  assert.equal(isDomainProtected('||i.ytimg.com^'), true);     // subdomain of a protected base
  assert.equal(isDomainProtected('||cloudflare.com^'), true);
  assert.equal(isDomainProtected('||doubleclick.net^'), false); // a tracker — not protected
});

test('allowlists are non-empty (guards against an accidental wipe)', () => {
  assert.ok(SB_DOMAIN_ALLOWLIST.size > 10);
  assert.ok(PROTECTED_DOMAINS.size > 10);
});
