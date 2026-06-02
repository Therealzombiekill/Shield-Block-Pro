/**
 * Amazon cosmetic safety — src/content-amazon.js
 *
 * content-amazon.js removes matched elements outright (querySelectorAll().remove()).
 * A selector that matches more than ads therefore deletes real page content. The
 * generic Amazon CSA attributes [data-csa-c-slot-id] and [data-csa-c-content-id]
 * are present on huge numbers of legitimate modules — removing by them blanks the
 * page. Guard that the ad-selector list stays specific.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/content-amazon.js', import.meta.url)), 'utf8');
const block = SRC.match(/const AD_SELECTORS = \[([\s\S]*?)\];/);
assert.ok(block, 'AD_SELECTORS not found in content-amazon.js');
const selectors = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

test('Amazon ad-selector list is present and non-trivial', () => {
  assert.ok(selectors.length >= 10, `expected the ad-selector list, got ${selectors.length}`);
});

test('Amazon ad selectors never match generic CSA modules (would blank the page)', () => {
  // Selectors known to match huge numbers of legitimate Amazon modules.
  const banned = ['[data-csa-c-slot-id]', '[data-csa-c-content-id*="sp-"]', '#rhf'];
  for (const b of banned) {
    assert.ok(!selectors.includes(b), `dangerous Amazon selector present: ${b}`);
  }
  // And no bare attribute-presence on the generic CSA slot attribute.
  for (const s of selectors) {
    assert.ok(!/^\[data-csa-c-slot-id\]$/.test(s), `over-broad selector: ${s}`);
  }
});
