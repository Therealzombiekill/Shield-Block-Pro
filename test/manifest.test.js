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
