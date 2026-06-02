/**
 * DNR rule-ID range + budget guards — src/background.js
 *
 * Declarative Net Request rules share ONE integer ID namespace in this codebase
 * (filterStaticConflicts drops dynamic rules whose id matches a static id). An
 * overlap therefore silently deletes blocking rules with no error. Chrome also
 * hard-caps updateDynamicRules at 5,000 rules — exceed it and the excess is
 * dropped silently. These tests pin both invariants against the real source.
 *
 * background.js imports chrome.* at module-load, so it can't be imported under
 * Node. We parse the FILTER_LISTS table and the ID constants out of its text;
 * the self-check test fails loudly if that extraction ever stops matching.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/background.js', import.meta.url)), 'utf8');

function parseFilterLists() {
  const block = SRC.match(/const FILTER_LISTS = \[([\s\S]*?)\n\];/);
  assert.ok(block, 'could not locate the FILTER_LISTS array in background.js');
  return [...block[1].matchAll(/\{[^{}]*\}/g)].map(([entry]) => {
    const name  = entry.match(/name:\s*'([^']*)'/);
    const start = entry.match(/start:\s*(\d+)/);
    const max   = entry.match(/max:\s*(\d+)/);
    assert.ok(name && start && max, `malformed FILTER_LISTS entry: ${entry}`);
    return { name: name[1], start: Number(start[1]), max: Number(max[1]) };
  });
}

function constant(name) {
  const m = SRC.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, `could not find constant ${name} in background.js`);
  return Number(m[1]);
}

const LISTS = parseFilterLists();
const MAX_DYNAMIC_RULES = constant('MAX_DYNAMIC_RULES');
const REMOVEPARAM_BASE  = constant('REMOVEPARAM_BASE');
const MATRIX_BASE       = constant('MATRIX_BASE');
const USER_DNR_BASE     = constant('USER_DNR_BASE');
const USER_DNR_END      = constant('USER_DNR_END');
const PAUSE_ALL_RULE_ID = constant('PAUSE_ALL_RULE_ID');

const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];
const rangeOf = (l) => [l.start, l.start + l.max - 1];

test('self-check: FILTER_LISTS and ID constants were actually extracted', () => {
  // Guards the regex above — if formatting drifts and we parse nothing, fail here
  // instead of silently "passing" every other test with an empty list.
  assert.ok(LISTS.length >= 25, `expected to parse the full registry, got ${LISTS.length}`);
  assert.equal(MAX_DYNAMIC_RULES, 5000);
  assert.ok(LISTS.every(l => l.start >= 10000 && l.max >= 1 && l.name));
});

test('no two filter-list ID ranges overlap', () => {
  for (let i = 0; i < LISTS.length; i++) {
    for (let j = i + 1; j < LISTS.length; j++) {
      assert.ok(!overlaps(rangeOf(LISTS[i]), rangeOf(LISTS[j])),
        `ID range overlap: ${LISTS[i].name} [${rangeOf(LISTS[i])}] vs ${LISTS[j].name} [${rangeOf(LISTS[j])}]`);
    }
  }
});

test('total dynamic-rule budget stays within Chrome’s 5,000 cap', () => {
  const total = LISTS.reduce((s, l) => s + l.max, 0);
  assert.ok(total <= MAX_DYNAMIC_RULES, `sum of max (${total}) exceeds ${MAX_DYNAMIC_RULES}`);
});

test('every filter-list range ends below the feature ID space (REMOVEPARAM_BASE)', () => {
  const maxEnd = Math.max(...LISTS.map(l => rangeOf(l)[1]));
  assert.ok(maxEnd < REMOVEPARAM_BASE,
    `highest filter id ${maxEnd} must stay below REMOVEPARAM_BASE ${REMOVEPARAM_BASE}`);
});

test('feature ID ranges are mutually disjoint and sit above all filter ranges', () => {
  const features = [
    ['removeparam', REMOVEPARAM_BASE, REMOVEPARAM_BASE + 999],
    ['matrix',      MATRIX_BASE,      MATRIX_BASE + 999],
    ['user-dnr',    USER_DNR_BASE,    USER_DNR_END],
    ['pause-all',   PAUSE_ALL_RULE_ID, PAUSE_ALL_RULE_ID],
  ];
  const maxFilterEnd = Math.max(...LISTS.map(l => rangeOf(l)[1]));
  for (const [, lo] of features) {
    assert.ok(lo > maxFilterEnd, `feature range start ${lo} must sit above filter ranges (max ${maxFilterEnd})`);
  }
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const [an, ...a] = features[i];
      const [bn, ...b] = features[j];
      assert.ok(!overlaps(a, b), `feature range overlap: ${an} vs ${bn}`);
    }
  }
});
