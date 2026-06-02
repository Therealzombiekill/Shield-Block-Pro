/**
 * Amazon is fully excluded from blocking — manifest + rules/base.json
 *
 * Amazon's own ad/cosmetic handling repeatedly broke the site, so per request the
 * extension does NOT touch Amazon at all: the Amazon content script is removed,
 * every broad content script excludes Amazon hosts, and a high-priority
 * allowAllRequests rule exempts Amazon pages from all network blocking.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${ROOT}manifest.json`, 'utf8'));
const base = JSON.parse(readFileSync(`${ROOT}rules/base.json`, 'utf8'));
const AMZ_HOST = '*://*.amazon.com/*';
const BROAD = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);

test('the Amazon-specific content script is no longer injected', () => {
  const loaded = manifest.content_scripts.some(cs => (cs.js || []).some(j => j.includes('content-amazon.js')));
  assert.equal(loaded, false, 'content-amazon.js must not be registered — Amazon is fully excluded');
});

test('every broad content script excludes Amazon hosts', () => {
  for (const cs of manifest.content_scripts) {
    if (!(cs.matches || []).some(p => BROAD.has(p))) continue;
    const ex = new Set(cs.exclude_matches || []);
    assert.ok(ex.has(AMZ_HOST), `content script ${(cs.js || []).join(',')} must exclude Amazon`);
  }
});

test('a high-priority allowAllRequests rule disables network blocking on Amazon', () => {
  const r = base.find(x => x.action && x.action.type === 'allowAllRequests'
    && (x.condition && x.condition.requestDomains || []).includes('amazon.com'));
  assert.ok(r, 'missing allowAllRequests rule for amazon.com');
  assert.ok(r.priority >= 100, 'the allow rule must outrank block rules');
  assert.deepEqual(r.condition.resourceTypes, ['main_frame', 'sub_frame']);
});
