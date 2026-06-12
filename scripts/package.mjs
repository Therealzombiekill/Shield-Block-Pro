#!/usr/bin/env node
/**
 * Build a store-ready zip of the extension.
 *
 * Includes only what the browser loads (manifest-driven), excluding dev files,
 * docs, CI, and old release archives that live in the repo root.
 *
 * Usage:
 *   node scripts/package.mjs             →  dist/ShieldBlock-Pro-v<version>.zip   (Chrome / CWS)
 *   node scripts/package.mjs --firefox   →  dist/ShieldBlock-Pro-firefox-v<version>.zip  (AMO)
 *
 * The Firefox build rewrites the background block to an event page
 * ({ scripts, type: module }) — Firefox MV3 does not run service workers.
 * Everything else ships identically; browser differences are handled at
 * runtime (browser-compat.js, getMatchedRules guards, adGuardUrl()).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const firefox = process.argv.includes('--firefox');

const INCLUDE = [
  'manifest.json',
  'popup.html', 'popup.js',
  'blocked.html', 'welcome.html',
  'src', 'rules', 'icons',
];

for (const p of INCLUDE) {
  if (!existsSync(resolve(root, p))) {
    console.error(`Missing required path: ${p}`);
    process.exit(1);
  }
}

mkdirSync(resolve(root, 'dist'), { recursive: true });
const out = resolve(root, `dist/ShieldBlock-Pro-${firefox ? 'firefox-' : ''}v${manifest.version}.zip`);
rmSync(out, { force: true });

try {
  if (firefox) {
    const fx = structuredClone(manifest);
    fx.background = { scripts: [manifest.background.service_worker], type: 'module' };
    const stage = resolve(root, 'dist/.fx-stage');
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    writeFileSync(resolve(stage, 'manifest.json'), JSON.stringify(fx, null, 2) + '\n');
    execFileSync('zip', ['-r', '-q', out, ...INCLUDE.filter(p => p !== 'manifest.json')], { cwd: root });
    execFileSync('zip', ['-j', '-q', out, resolve(stage, 'manifest.json')]);
    rmSync(stage, { recursive: true, force: true });
  } else {
    execFileSync('zip', ['-r', '-q', out, ...INCLUDE], { cwd: root });
  }
} catch (e) {
  console.error('zip failed — is the `zip` CLI installed?', e.message);
  process.exit(1);
}

const size = execFileSync('du', ['-h', out]).toString().split('\t')[0];
console.log(`Packaged ${firefox ? 'Firefox ' : ''}v${manifest.version} → ${out} (${size})`);
