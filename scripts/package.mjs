#!/usr/bin/env node
/**
 * Build a store-ready zip of the extension.
 *
 * Includes only what the browser loads (manifest-driven), excluding dev files,
 * docs, CI, and old release archives that live in the repo root.
 *
 * Usage: node scripts/package.mjs   →  dist/ShieldBlock-Pro-v<version>.zip
 */
import { readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

const INCLUDE = [
  'manifest.json',
  'popup.html', 'popup.js',
  'blocked.html', 'welcome.html', 'privacy.html',
  'src', 'rules', 'icons',
];

for (const p of INCLUDE) {
  if (!existsSync(resolve(root, p))) {
    console.error(`Missing required path: ${p}`);
    process.exit(1);
  }
}

mkdirSync(resolve(root, 'dist'), { recursive: true });
const out = resolve(root, `dist/ShieldBlock-Pro-v${manifest.version}.zip`);
rmSync(out, { force: true });

try {
  execFileSync('zip', ['-r', '-q', out, ...INCLUDE], { cwd: root });
} catch (e) {
  console.error('zip failed — is the `zip` CLI installed?', e.message);
  process.exit(1);
}

const size = execFileSync('du', ['-h', out]).toString().split('\t')[0];
console.log(`Packaged v${manifest.version} → ${out} (${size})`);
