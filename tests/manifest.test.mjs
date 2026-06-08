import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

test('manifest_version is 3', () => assert.equal(manifest.manifest_version, 3));

test('version is semver', () => assert.match(manifest.version, /^\d+\.\d+\.\d+$/));

test('every content_scripts js file exists on disk', () => {
  for (const cs of manifest.content_scripts || []) {
    for (const f of cs.js || []) {
      assert.ok(existsSync(join(root, f)), `missing content script: ${f}`);
    }
  }
});

test('every rule_resources path exists and is a JSON array', () => {
  for (const rs of manifest.declarative_net_request.rule_resources) {
    const p = join(root, rs.path);
    assert.ok(existsSync(p), `missing ruleset file: ${rs.path}`);
    assert.ok(Array.isArray(JSON.parse(readFileSync(p, 'utf8'))), `${rs.path} is not an array`);
  }
});

test('trusted-sites.js is web-accessible (content-privacy module import needs it)', () => {
  const war = (manifest.web_accessible_resources || []).flatMap(e => e.resources || []);
  assert.ok(war.includes('src/trusted-sites.js'), 'src/trusted-sites.js must be web-accessible');
});

test('core permissions are present', () => {
  for (const p of ['storage', 'unlimitedStorage', 'declarativeNetRequest']) {
    assert.ok(manifest.permissions.includes(p), `missing permission: ${p}`);
  }
});

test('no duplicate static ruleset ids', () => {
  const ids = manifest.declarative_net_request.rule_resources.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ruleset id in manifest');
});
