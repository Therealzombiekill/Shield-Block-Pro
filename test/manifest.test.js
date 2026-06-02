/**
 * Manifest integrity — manifest.json
 *
 * The manifest is a web of file references. A typo'd path or a renamed script
 * fails silently: Chrome just doesn't load that piece and a feature quietly dies.
 * These tests assert every referenced file exists on disk and that load-order
 * invariants documented in CLAUDE.md hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(`${ROOT}${rel}`, 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const exists = (rel) => existsSync(`${ROOT}${rel.replace(/^\//, '')}`);

test('manifest is MV3 and carries a version', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+/);
});

test('manifest version matches package.json version', () => {
  assert.equal(manifest.version, pkg.version);
});

test('background service worker is a module and exists', () => {
  assert.equal(manifest.background.type, 'module');
  assert.ok(exists(manifest.background.service_worker),
    `missing service worker: ${manifest.background.service_worker}`);
});

test('every content-script file referenced by the manifest exists', () => {
  for (const cs of manifest.content_scripts) {
    for (const js of cs.js) {
      assert.ok(exists(js), `content script file missing: ${js}`);
    }
  }
});

test('CNAME uncloaking permissions are opt-in (declared as optional, not required)', () => {
  // These must NOT be in required permissions — webRequestBlocking/dns would break
  // or warn on Chrome at load. They live in optional_permissions, requested at
  // runtime on Firefox only.
  const required = new Set(manifest.permissions ?? []);
  const optional = new Set(manifest.optional_permissions ?? []);
  for (const p of ['dns', 'webRequest', 'webRequestBlocking']) {
    assert.ok(optional.has(p), `${p} should be in optional_permissions`);
    assert.ok(!required.has(p), `${p} must not be a required permission`);
  }
});

test('tiktok-ads.js is loaded before content-social.js (defines __sbTikTok first)', () => {
  const social = manifest.content_scripts.find(cs => cs.js.includes('src/content-social.js'));
  assert.ok(social, 'content-social.js entry not found');
  const ti = social.js.indexOf('src/tiktok-ads.js');
  const ci = social.js.indexOf('src/content-social.js');
  assert.ok(ti !== -1, 'tiktok-ads.js must be in the same entry as content-social.js');
  assert.ok(ti < ci, 'tiktok-ads.js must load before content-social.js');
});

test('the procedural cosmetic engine is registered as a content script', () => {
  // Gap #1 fix is pointless if content-procedural.js never runs. Pin the wiring.
  const wired = manifest.content_scripts.some(cs => cs.js.includes('src/content-procedural.js'));
  assert.ok(wired, 'content-procedural.js is not registered in manifest content_scripts');
});

test('browser-compat.js is loaded first in every isolated-world content script', () => {
  for (const cs of manifest.content_scripts) {
    if (cs.world === 'MAIN') continue; // MAIN-world injectors use no chrome.* shim
    assert.equal(cs.js[0], 'src/browser-compat.js',
      `browser-compat.js must be first; got ${JSON.stringify(cs.js)}`);
  }
});

test('every declarative_net_request static ruleset file exists', () => {
  const resources = manifest.declarative_net_request?.rule_resources ?? [];
  assert.ok(resources.length > 0, 'no static rule_resources declared');
  for (const rs of resources) {
    assert.ok(exists(rs.path), `static ruleset missing: ${rs.path}`);
  }
});

test('every web_accessible_resource and declared icon exists on disk', () => {
  for (const war of manifest.web_accessible_resources ?? []) {
    for (const res of war.resources) {
      if (res.includes('*')) continue; // skip glob patterns
      assert.ok(exists(res), `web_accessible_resource missing: ${res}`);
    }
  }
  for (const size of Object.keys(manifest.icons ?? {})) {
    assert.ok(exists(manifest.icons[size]), `icon missing: ${manifest.icons[size]}`);
  }
});
