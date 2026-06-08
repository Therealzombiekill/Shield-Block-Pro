import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const rulesets = manifest.declarative_net_request.rule_resources;

const VALID_ACTIONS = new Set(['block', 'allow', 'allowAllRequests', 'redirect', 'modifyHeaders', 'upgradeScheme']);
// Union of Chrome + Firefox DNR resource types.
const VALID_TYPES = new Set([
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport',
  'webbundle', 'other', 'beacon', 'imageset', 'xbl', 'xml_dtd', 'xslt',
  'web_manifest', 'speculative',
]);

const load = (rs) => JSON.parse(readFileSync(join(root, rs.path), 'utf8'));

for (const rs of rulesets) {
  test(`ruleset ${rs.id}: array, unique ids, valid rules`, () => {
    const rules = load(rs);
    assert.ok(Array.isArray(rules), `${rs.path} should be a JSON array`);
    const ids = new Set();
    for (const r of rules) {
      assert.ok(Number.isInteger(r.id) && r.id >= 1, `bad id in ${rs.id}: ${r.id}`);
      assert.ok(!ids.has(r.id), `duplicate id ${r.id} in ${rs.id}`);
      ids.add(r.id);
      assert.ok(VALID_ACTIONS.has(r.action?.type), `bad action '${r.action?.type}' in ${rs.id} #${r.id}`);
      assert.ok(r.condition && typeof r.condition === 'object', `missing condition in ${rs.id} #${r.id}`);
      for (const t of (r.condition.resourceTypes || [])) {
        assert.ok(VALID_TYPES.has(t), `invalid resourceType '${t}' in ${rs.id} #${r.id}`);
      }
    }
  });
}

test('total static rules stay under the 30k cap', () => {
  const total = rulesets.reduce((n, rs) => n + load(rs).length, 0);
  assert.ok(total < 30000, `total static rules ${total} exceeds the 30000 cap`);
});

test('block rules have a non-empty urlFilter or condition', () => {
  for (const rs of rulesets) {
    for (const r of load(rs)) {
      if (r.action?.type !== 'block') continue;
      const c = r.condition;
      assert.ok(
        (typeof c.urlFilter === 'string' && c.urlFilter.length) ||
        (typeof c.regexFilter === 'string' && c.regexFilter.length) ||
        Array.isArray(c.requestDomains),
        `block rule ${rs.id} #${r.id} has no matchable condition`,
      );
    }
  }
});
