/**
 * Tracking-parameter stripping — STATIC_REMOVE_PARAMS in src/background.js
 *
 * This set is applied to every navigation regardless of filter-list sync, so it's
 * a core privacy surface. Guard that it's well-formed (no dupes, no stray regex or
 * whitespace that would silently break the DNR removeParams action) and that it
 * keeps covering the common modern tracking-param families.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/background.js', import.meta.url)), 'utf8');
const block = SRC.match(/STATIC_REMOVE_PARAMS = new Set\(\[([\s\S]*?)\]\)/);
assert.ok(block, 'could not locate STATIC_REMOVE_PARAMS in background.js');
const params = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

test('STATIC_REMOVE_PARAMS is non-trivial, unique, and well-formed', () => {
  assert.ok(params.length >= 90, `expected the expanded set, got ${params.length}`);
  assert.equal(new Set(params).size, params.length, 'duplicate tracking parameter');
  for (const p of params) {
    // A real URL query-parameter name: no spaces, quotes, or regex metacharacters.
    assert.ok(/^[A-Za-z0-9_.-]+$/.test(p), `suspicious param name: ${JSON.stringify(p)}`);
  }
});

test('covers the common modern tracking-param families', () => {
  const need = ['utm_source', 'fbclid', 'gclid', 'msclkid', 'mtm_source', 'pk_source', 'srsltid', 'igshid'];
  for (const p of need) assert.ok(params.includes(p), `missing expected tracking param: ${p}`);
});
