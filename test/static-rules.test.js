/**
 * Static ruleset validity — rules/*.json
 *
 * These ship with the extension and load before any sync. A malformed rule, a
 * duplicate id, or an id that strays into the dynamic range (10000+) is a silent
 * failure: Chrome rejects the bad rule (or this codebase's filterStaticConflicts
 * drops the colliding dynamic rule) and blocking quietly degrades. CLAUDE.md
 * reserves ids 1–9999 for static rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['base', 'extended', 'tracking', 'hosts'];
const STATIC_ID_MAX = 9999; // ids 10000+ belong to dynamic filter-list rules

const load = (name) => JSON.parse(readFileSync(`${ROOT}rules/${name}.json`, 'utf8'));
const all = Object.fromEntries(FILES.map(f => [f, load(f)]));

for (const name of FILES) {
  test(`${name}.json is a non-empty array of well-formed DNR rules`, () => {
    const rules = all[name];
    assert.ok(Array.isArray(rules) && rules.length > 0, `${name}.json must be a non-empty array`);
    for (const r of rules) {
      assert.equal(typeof r.id, 'number', `rule id must be a number in ${name}.json`);
      assert.ok(Number.isInteger(r.id) && r.id >= 1, `rule id must be a positive integer (${r.id})`);
      assert.equal(typeof r.priority, 'number', `rule ${r.id} missing numeric priority`);
      assert.ok(r.action && typeof r.action.type === 'string', `rule ${r.id} missing action.type`);
      assert.ok(r.condition && typeof r.condition === 'object', `rule ${r.id} missing condition`);
    }
  });

  test(`${name}.json has no duplicate ids`, () => {
    const ids = all[name].map(r => r.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate id within ${name}.json`);
  });
}

test('static rule ids stay inside the reserved 1–9999 range', () => {
  // The regression guard: base.json once leaked YouTube redirect rules at 21300+.
  for (const name of FILES) {
    for (const r of all[name]) {
      assert.ok(r.id <= STATIC_ID_MAX,
        `${name}.json rule id ${r.id} exceeds static range (>${STATIC_ID_MAX}) — collides with dynamic ids`);
    }
  }
});

test('static rule ids are unique across ALL rulesets (shared id namespace)', () => {
  const seen = new Map(); // id -> file
  for (const name of FILES) {
    for (const r of all[name]) {
      assert.ok(!seen.has(r.id),
        `id ${r.id} duplicated across rulesets: ${seen.get(r.id)}.json and ${name}.json`);
      seen.set(r.id, name);
    }
  }
});

test('redirect rules point at extension files that actually exist', () => {
  for (const name of FILES) {
    for (const r of all[name]) {
      const p = r.action?.redirect?.extensionPath;
      if (!p) continue;
      const rel = p.replace(/^\//, '').split('?')[0];
      assert.ok(existsSync(`${ROOT}${rel}`),
        `${name}.json rule ${r.id} redirects to missing file: ${p}`);
    }
  }
});
