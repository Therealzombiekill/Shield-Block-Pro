/**
 * Cookie-consent reject coverage — src/content-cookies.js
 *
 * Guards that the named reject-button selector list stays comprehensive (so a
 * refactor can't silently gut CMP coverage) and well-formed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/content-cookies.js', import.meta.url)), 'utf8');
const block = src.match(/const REJECT_SELECTORS = \[([\s\S]*?)\];/);
assert.ok(block, 'REJECT_SELECTORS not found in content-cookies.js');
const selectors = block[1].match(/'[^']+'/g).map(s => s.slice(1, -1));

test('reject-selector list is comprehensive', () => {
  assert.ok(selectors.length >= 40, `expected a broad CMP list, got ${selectors.length}`);
});

test('covers the major consent platforms', () => {
  const needles = ['onetrust', 'Cybot', 'didomi', 'qc-cmp2', 'uc-', 'iubenda',
                   'tarteaucitron', 'cookiescript', 'osano', 'cmplz', 'cky'];
  const joined = selectors.join(' ').toLowerCase();
  for (const n of needles) {
    assert.ok(joined.includes(n.toLowerCase()), `missing CMP coverage: ${n}`);
  }
});
