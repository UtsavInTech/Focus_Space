#!/usr/bin/env node
/**
 * Packages `dist/` into the .zip the Chrome Web Store expects.
 *
 * It refuses to build a package that would break once installed: a store
 * build must point at the deployed API and site, and a build made with the
 * defaults (or worse, a localhost URL left over from testing) would ship an
 * extension whose AI silently does nothing. Better to fail here than to find
 * out after a three-day review.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const dist = join(root, 'dist');
const out = join(root, 'release');

const manifest = JSON.parse(readFileSync(join(root, 'public/manifest.json'), 'utf8'));
const { version } = manifest;

if (!existsSync(join(dist, 'manifest.json'))) {
  console.error('No dist/manifest.json — run the build first:\n  VITE_API_URL=… VITE_SITE_URL=… npm run build');
  process.exit(1);
}

// The built service worker carries whatever URLs were baked in. Read them back
// rather than trusting that the right env vars were set. Vite moves code shared
// with the pages (src/config.ts among it) into chunks the worker imports, so
// the check follows those imports — reading background.js alone misses them.
function withImports(file, seen = new Set()) {
  if (seen.has(file)) return '';
  seen.add(file);
  const code = readFileSync(join(dist, file), 'utf8');
  const chunks = [...code.matchAll(/from\s*["']\.\/([^"']+\.js)["']/g)].map((m) => join(file, '..', m[1]));
  return code + chunks.map((chunk) => withImports(chunk, seen)).join('\n');
}
const background = withImports('background.js');
const problems = [];
if (background.includes('127.0.0.1') || background.includes('localhost')) {
  problems.push('The service worker contains a localhost URL — rebuild with the production VITE_API_URL and VITE_SITE_URL.');
}
// The site URL has a built-in default, so "mentions focusspace" proves nothing; the API URL has none.
if (!background.includes('https://api.focusspace.xyz')) {
  problems.push('The service worker has no https://api.focusspace.xyz baked in — VITE_API_URL was probably unset, so sign-in and AI would not work for anyone.');
}
if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const zip = join(out, `focusspace-${version}.zip`);
// -r recurse, -q quiet, -X drop the macOS extended attributes the store rejects.
execFileSync('zip', ['-rqX', zip, '.'], { cwd: dist, stdio: 'inherit' });

const size = (readFileSync(zip).length / 1024).toFixed(0);
console.log(`✓ ${zip} (${size} KB) — manifest v${version}`);
console.log('  Upload at https://chrome.google.com/webstore/devconsole');
