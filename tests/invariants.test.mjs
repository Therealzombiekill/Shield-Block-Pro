/**
 * Structural invariants for the rule system — the things that fail SILENTLY in
 * the browser (dropped rules, ID collisions, over-budget rulesets that Chrome
 * refuses to load). These caught nothing for years because nothing ran them.
 *
 * Zero dependencies — Node's built-in test runner. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const json = p => JSON.parse(read(p));

// Chrome limits.
const MAX_DYNAMIC_RULES = 5000;
const MAX_ENABLED_STATIC_RULES = 30000; // guaranteed minimum across enabled rulesets

// Extract FILTER_LISTS {key, max, start} straight from the background source —
// it can't be imported (uses chrome.*), so parse it like _checkRanges would see it.
function parseFilterLists() {
  const src = read('src/background.js');
  const start = src.indexOf('const FILTER_LISTS = [');
  const block = src.slice(start, src.indexOf('];', start));
  const re = /key:\s*'([^']+)'.*?max:\s*(\d+),\s*start:\s*(\d+)/g;
  const lists = [];
  let m;
  while ((m = re.exec(block))) lists.push({ key: m[1], max: +m[2], start: +m[3] });
  return lists;
}

test('FILTER_LISTS dynamic ID ranges never overlap', () => {
  const ranges = parseFilterLists().filter(l => l.max > 0)
    .map(l => [l.start, l.start + l.max - 1, l.key]);
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const overlap = ranges[i][0] <= ranges[j][1] && ranges[j][0] <= ranges[i][1];
      assert.ok(!overlap, `range overlap: ${ranges[i][2]} vs ${ranges[j][2]}`);
    }
  }
});

test('FILTER_LISTS dynamic budget stays within Chrome cap', () => {
  const sum = parseFilterLists().reduce((s, l) => s + l.max, 0);
  assert.ok(sum <= MAX_DYNAMIC_RULES, `dynamic rule budget ${sum} exceeds ${MAX_DYNAMIC_RULES}`);
});

test('EasyList/EasyPrivacy are zeroed in dynamic sync (served by static rulesets)', () => {
  const lists = parseFilterLists();
  for (const key of ['easylist', 'easyprivacy']) {
    const l = lists.find(x => x.key === key);
    assert.ok(l, `${key} missing from FILTER_LISTS`);
    assert.equal(l.max, 0, `${key} should be max:0 now that it ships as a static ruleset`);
  }
});

test('manifest rule_resources point to files that exist, with unique ids', () => {
  const rr = json('manifest.json').declarative_net_request.rule_resources;
  const ids = new Set();
  for (const rs of rr) {
    assert.ok(!ids.has(rs.id), `duplicate ruleset id ${rs.id}`);
    ids.add(rs.id);
    assert.ok(existsSync(join(ROOT, rs.path)), `missing ruleset file ${rs.path}`);
  }
});

test('every static ruleset is a valid DNR rule array with unique in-file ids', () => {
  const rr = json('manifest.json').declarative_net_request.rule_resources;
  for (const rs of rr) {
    const rules = json(rs.path);
    assert.ok(Array.isArray(rules), `${rs.path} is not an array`);
    const ids = new Set();
    for (const r of rules) {
      assert.ok(Number.isInteger(r.id) && r.id >= 1, `${rs.path}: bad id`);
      assert.ok(!ids.has(r.id), `${rs.path}: duplicate id ${r.id}`);
      ids.add(r.id);
      assert.ok(r.action && typeof r.action.type === 'string', `${rs.path}: bad action`);
      assert.ok(r.condition && typeof r.condition === 'object', `${rs.path}: bad condition`);
    }
  }
});

test('generated bulk ruleset IDs sit in their disjoint 1M/2M bands', () => {
  // Must not collide with dynamic ranges (10000-49999) — loadStaticRuleIds()
  // conflates static/dynamic ID namespaces by number.
  const bands = { 'rules/static/easylist.json': [1_000_000, 1_100_000],
                  'rules/static/easyprivacy.json': [2_000_000, 2_100_000] };
  for (const [path, [lo, hi]] of Object.entries(bands)) {
    for (const r of json(path)) {
      assert.ok(r.id > lo && r.id < hi, `${path}: id ${r.id} outside band ${lo}-${hi}`);
    }
  }
});

test('total ENABLED static rules stay under Chrome 30k guarantee', () => {
  const rr = json('manifest.json').declarative_net_request.rule_resources;
  const total = rr.filter(rs => rs.enabled !== false)
    .reduce((s, rs) => s + json(rs.path).length, 0);
  assert.ok(total <= MAX_ENABLED_STATIC_RULES,
    `enabled static rules ${total} exceed ${MAX_ENABLED_STATIC_RULES}`);
});

test('manifest.json and package.json are valid JSON', () => {
  assert.ok(json('manifest.json').manifest_version === 3);
  assert.ok(json('package.json').name);
});
