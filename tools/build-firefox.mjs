/**
 * Generate manifest.firefox.json from manifest.json (dev tool).
 *
 * CNAME uncloaking needs the dns + webRequest + webRequestBlocking permissions,
 * which Chrome stable rejects (dns is dev-channel, webRequestBlocking is MV2-only).
 * So the shipped manifest.json stays Chrome-clean and the Firefox build adds them
 * as optional_permissions here. To build for Firefox: run this, then load (or
 * rename to manifest.json) the generated file. test/firefox-manifest.test.js keeps
 * the two manifests in sync.
 *
 * Usage: node tools/build-firefox.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FOX_PERMS = ['dns', 'webRequest', 'webRequestBlocking'];

const m = JSON.parse(readFileSync(`${ROOT}manifest.json`, 'utf8'));
const fox = {};
for (const [k, v] of Object.entries(m)) {
  fox[k] = v;
  if (k === 'host_permissions') fox.optional_permissions = FOX_PERMS; // insert right after, for readability
}
if (!fox.optional_permissions) fox.optional_permissions = FOX_PERMS;

writeFileSync(`${ROOT}manifest.firefox.json`, JSON.stringify(fox, null, 2) + '\n');
console.log(`wrote manifest.firefox.json (+ optional_permissions: ${FOX_PERMS.join(', ')})`);
