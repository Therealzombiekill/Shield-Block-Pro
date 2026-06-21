#!/usr/bin/env node
/**
 * Build per-store packages from the single source manifest.
 *
 *   node scripts/package.mjs
 *
 * Why two packages (the repo otherwise has no build step):
 *   • Chrome Web Store — MV3 must use background.service_worker. Chrome refuses
 *     background.scripts before 121 and its upload validator dislikes it, so the
 *     Chrome build drops `scripts` and the Firefox-only browser_specific_settings.
 *   • Firefox AMO — has no service worker background; needs background.scripts and,
 *     since Nov 2025 / H1 2026, browser_specific_settings.gecko.data_collection_permissions.
 *     The Firefox build drops the Chrome-only `service_worker` + minimum_chrome_version.
 *
 * The shared source manifest.json keeps BOTH (dual-key) so unpacked dev loading works
 * in either browser; this script specialises it for store upload. No dependencies — uses
 * the system `zip` if present, otherwise leaves the staged folders for you to zip.
 */
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;

// Only the files the extension actually loads — everything else (tests, docs, scripts,
// markdown, old zips, dist) is dev cruft and must stay out of the store package.
const INCLUDE = [
  'popup.html', 'popup.js', 'blocked.html', 'welcome.html', 'privacy.html',
  'src', 'rules', 'icons',
];

function chromeManifest(m) {
  const c = structuredClone(m);
  c.background = { service_worker: 'src/background.js', type: 'module' }; // drop `scripts`
  delete c.browser_specific_settings; // Firefox-only — keep the Chrome package clean
  return c;
}

function firefoxManifest(m) {
  const f = structuredClone(m);
  f.background = { scripts: ['src/background.js'], type: 'module' }; // drop `service_worker`
  delete f.minimum_chrome_version; // Chrome-only key
  return f;
}

function build(target, manifestObj) {
  const stage = join(root, 'dist', target);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const f of INCLUDE) cpSync(join(root, f), join(stage, f), { recursive: true });
  writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifestObj, null, 2) + '\n');

  const zip = join(root, 'dist', `ShieldBlock-Pro-v${version}-${target}.zip`);
  rmSync(zip, { force: true });
  try {
    execSync(`zip -r -q -X "${zip}" . -x '*.DS_Store'`, { cwd: stage, stdio: 'pipe' });
    console.log(`  ${target}: dist/${target}/  +  ${zip.replace(root + '/', '')}`);
  } catch {
    console.log(`  ${target}: staged dist/${target}/  (zip CLI unavailable — zip that folder's contents manually)`);
  }
}

mkdirSync(join(root, 'dist'), { recursive: true });
console.log(`Packaging ShieldBlock Pro v${version}:`);
build('chrome', chromeManifest(manifest));
build('firefox', firefoxManifest(manifest));
console.log('Done. Upload the chrome zip to the Chrome Web Store and the firefox zip to addons.mozilla.org.');
