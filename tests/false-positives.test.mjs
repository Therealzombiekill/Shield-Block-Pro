import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Regression guard for the false-positive cleanup. Scoped to the hand-maintained
// rulesets (the generated EasyList/EasyPrivacy/etc. ones are upstream + auto-
// refreshed, so we don't assert on their exact content).

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const HAND = new Set(['rules/base.json', 'rules/extended.json', 'rules/hosts.json', 'rules/tracking.json']);

const apexBlocked = new Set();
for (const rs of manifest.declarative_net_request.rule_resources) {
  if (!HAND.has(rs.path)) continue;
  for (const r of JSON.parse(readFileSync(join(root, rs.path), 'utf8'))) {
    if (r.action?.type !== 'block') continue;
    const m = (r.condition?.urlFilter || '').match(/^\|\|([^/^*|]+)\^$/);
    if (m) apexBlocked.add(m[1].toLowerCase());
  }
}

// Legit sites/services we deliberately un-blocked must never be apex-blocked again.
const MUST_NOT_BLOCK = [
  'facebook.com', 'www.facebook.com', 'web.facebook.com', 'yahoo.com', 'fidelity.com',
  'speedtest.net', 'imdb.com', 'nytimes.com', 'edgesuite.net', 'algolia.net', 'swifttype.com',
  'wayfair.com', 'ecosia.org', 'vodafone.com', 'zynga.com', 'bigcommerce.com', 'healthline.com',
  'monster.com', 't.co', 'msn.com', 'yandex.ru', 'yandex.com', 'apis.google.com',
];
for (const d of MUST_NOT_BLOCK) {
  test(`legit domain is NOT apex-blocked: ${d}`, () => {
    assert.ok(!apexBlocked.has(d), `${d} is apex-blocked again — false-positive regression`);
  });
}

// Core trackers must stay apex-blocked.
const MUST_BLOCK = [
  'doubleclick.net', 'google-analytics.com', 'googlesyndication.com',
  'scorecardresearch.com', 'quantserve.com', 'samsungads.com', 'asadcdn.com',
];
for (const d of MUST_BLOCK) {
  test(`tracker stays apex-blocked: ${d}`, () => {
    assert.ok(apexBlocked.has(d), `${d} lost its apex block`);
  });
}
