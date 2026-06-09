import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  finalizeDomainCosmetics,
  countProceduralInDomainCosmetics,
  finalizeScriptletRules,
} from '../src/cosmetic-utils.js';

// Cosmetic finalization runs after every filter sync — dedup, caps, and keeping
// procedural (:has-text) rules alive through the cap.

test('finalizeDomainCosmetics dedupes selectors', () => {
  const out = finalizeDomainCosmetics({ 'example.com': ['.ad', '.ad', '.banner'] });
  assert.deepEqual(out['example.com'].sort(), ['.ad', '.banner']);
});

test('procedural selectors are kept first so they survive the cap', () => {
  const sels = ['.plain0', '.plain1', '.plain2', '.plain3', '.plain4', '.box:has-text(Ad)'];
  const out = finalizeDomainCosmetics({ 'x.com': sels }, { domainMax: 1 });
  assert.equal(out['x.com'].length, 1);
  assert.equal(out['x.com'][0], '.box:has-text(Ad)');
});

test('global (*) vs per-domain caps are applied', () => {
  const many = Array.from({ length: 800 }, (_, i) => `.c${i}`);
  const out = finalizeDomainCosmetics({ '*': many, 'd.com': many }, { globalMax: 600, domainMax: 350 });
  assert.equal(out['*'].length, 600);
  assert.equal(out['d.com'].length, 350);
});

test('empty and oversize (>=513 char) selectors are dropped', () => {
  const out = finalizeDomainCosmetics({ 'x.com': ['', '.ok', 'x'.repeat(513)] });
  assert.deepEqual(out['x.com'], ['.ok']);
});

test('countProceduralInDomainCosmetics counts only procedural selectors', () => {
  const n = countProceduralInDomainCosmetics({ 'x.com': ['.a:has-text(z)', '.b', '.c:upward(1)'] });
  assert.equal(n, 2);
});

test('finalizeScriptletRules dedupes by name+args', () => {
  const rules = [
    { name: 'set-constant', args: ['a', 'true'] },
    { name: 'set-constant', args: ['a', 'true'] }, // dup
    { name: 'set-constant', args: ['b', 'false'] },
  ];
  const out = finalizeScriptletRules({ 'x.com': rules });
  assert.equal(out['x.com'].length, 2);
});

test('finalizeScriptletRules caps at 50 per domain', () => {
  const rules = Array.from({ length: 80 }, (_, i) => ({ name: 'noop', args: [String(i)] }));
  const out = finalizeScriptletRules({ 'x.com': rules });
  assert.equal(out['x.com'].length, 50);
});
