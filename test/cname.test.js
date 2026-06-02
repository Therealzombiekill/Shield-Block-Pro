/**
 * CNAME uncloaking — src/cname-uncloak.js
 *
 * Pure matching logic plus the Firefox installer (driven with injected fake
 * browser APIs). The installer must be a hard no-op anywhere the host can't
 * support it, so the shared codebase stays safe on Chrome.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseDomain, hostOf, canonicalIsTracker, isCloakingCandidate, installCnameUncloaking,
  KNOWN_CNAME_TRACKERS,
} from '../src/cname-uncloak.js';

test('baseDomain honors simple and two-label public suffixes', () => {
  assert.equal(baseDomain('example.com'), 'example.com');
  assert.equal(baseDomain('www.example.com'), 'example.com');
  assert.equal(baseDomain('a.b.metrics.example.com'), 'example.com');
  assert.equal(baseDomain('shop.example.co.uk'), 'example.co.uk');
  assert.equal(baseDomain('example.co.uk'), 'example.co.uk');
});

test('hostOf extracts a lowercase hostname or empty string', () => {
  assert.equal(hostOf('https://Metrics.Example.com/x?y=1'), 'metrics.example.com');
  assert.equal(hostOf('not a url'), '');
});

test('canonicalIsTracker matches a known tracker anywhere in the suffix chain', () => {
  assert.equal(canonicalIsTracker('xyz.metrics.criteo.com'), 'criteo.com');
  assert.equal(canonicalIsTracker('host.eulerian.net'), 'eulerian.net');
  assert.equal(canonicalIsTracker('cdn.example.com'), null);
  assert.equal(canonicalIsTracker(''), null);
});

test('isCloakingCandidate is true only for same-site subdomains', () => {
  assert.equal(isCloakingCandidate('metrics.example.com', 'www.example.com'), true);
  assert.equal(isCloakingCandidate('metrics.example.com', 'shop.example.com'), true);
  assert.equal(isCloakingCandidate('example.com', 'example.com'), false);       // same host
  assert.equal(isCloakingCandidate('tracker.other.com', 'example.com'), false); // cross-site
});

test('KNOWN_CNAME_TRACKERS is a non-trivial set of base domains', () => {
  assert.ok(KNOWN_CNAME_TRACKERS.size >= 20);
  for (const d of KNOWN_CNAME_TRACKERS) assert.ok(/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d), `bad entry: ${d}`);
});

// ── Installer (no-op guards) ─────────────────────────────────────────────────

test('installer is a no-op without Firefox / dns / blocking webRequest', () => {
  const wr = { onBeforeRequest: { addListener() {} } };
  const dns = { resolve: async () => ({}) };
  assert.equal(installCnameUncloaking({ isFirefox: false, webRequest: wr, dns }), null);
  assert.equal(installCnameUncloaking({ isFirefox: true, webRequest: wr }), null);          // no dns
  assert.equal(installCnameUncloaking({ isFirefox: true, dns }), null);                     // no webRequest
});

// ── Installer (behavior) ─────────────────────────────────────────────────────

function harness({ canonical = '', settings = { cnameUncloak: true } } = {}) {
  const state = { listener: null, dnsCalls: 0, blocked: [] };
  const webRequest = { onBeforeRequest: { addListener: (fn) => { state.listener = fn; } } };
  const dns = { resolve: async () => { state.dnsCalls++; return { canonicalName: canonical }; } };
  installCnameUncloaking({
    isFirefox: true, webRequest, dns,
    getSettings: async () => settings,
    onBlocked: (tracker, host) => state.blocked.push([tracker, host]),
  });
  return state;
}

const req = (url, documentUrl) => ({ url, documentUrl });

test('cancels a same-site request whose CNAME resolves to a tracker', async () => {
  const h = harness({ canonical: 'edge.criteo.com' });
  const r = await h.listener(req('https://metrics.example.com/p', 'https://www.example.com/'));
  assert.deepEqual(r, { cancel: true });
  assert.deepEqual(h.blocked, [['criteo.com', 'metrics.example.com']]);
});

test('allows a same-site request whose CNAME is clean', async () => {
  const h = harness({ canonical: 'metrics.example.com.cdn.fastly.net' });
  const r = await h.listener(req('https://metrics.example.com/p', 'https://www.example.com/'));
  assert.deepEqual(r, {});
  assert.equal(h.blocked.length, 0);
});

test('never resolves DNS for a cross-site request', async () => {
  const h = harness({ canonical: 'edge.criteo.com' });
  const r = await h.listener(req('https://tracker.other.com/p', 'https://www.example.com/'));
  assert.deepEqual(r, {});
  assert.equal(h.dnsCalls, 0);
});

test('honors globalPause and the cnameUncloak toggle', async () => {
  const paused = harness({ canonical: 'edge.criteo.com', settings: { cnameUncloak: true, globalPause: true } });
  assert.deepEqual(await paused.listener(req('https://m.example.com/', 'https://example.com/')), {});
  const off = harness({ canonical: 'edge.criteo.com', settings: { cnameUncloak: false } });
  assert.deepEqual(await off.listener(req('https://m.example.com/', 'https://example.com/')), {});
});

test('caches resolution so a repeated host is not re-resolved', async () => {
  const h = harness({ canonical: 'edge.criteo.com' });
  await h.listener(req('https://metrics.example.com/a', 'https://example.com/'));
  await h.listener(req('https://metrics.example.com/b', 'https://example.com/'));
  assert.equal(h.dnsCalls, 1);
  assert.equal(h.blocked.length, 2); // still blocked both times, from cache
});
