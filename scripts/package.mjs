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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// public/manifest.json lists http://localhost:5174 (the website's dev server) so a
// locally loaded extension can talk to it. Shipped, that would let any page on
// that port on a user's machine message the extension, so the packaged copy
// drops every localhost pattern; the source manifest keeps them for development.
const isLocal = (pattern) => /^\w+:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(pattern);
const packaged = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const stripped = [];
const keepRemote = (patterns = []) =>
  patterns.filter((pattern) => {
    if (isLocal(pattern)) stripped.push(pattern);
    return !isLocal(pattern);
  });
for (const script of packaged.content_scripts ?? []) script.matches = keepRemote(script.matches);
for (const resource of packaged.web_accessible_resources ?? []) resource.matches = keepRemote(resource.matches);
if (packaged.externally_connectable) packaged.externally_connectable.matches = keepRemote(packaged.externally_connectable.matches);
if (packaged.host_permissions) packaged.host_permissions = keepRemote(packaged.host_permissions);
const packagedManifest = JSON.stringify(packaged, null, 2);
if (/localhost|127\.0\.0\.1/.test(packagedManifest)) {
  problems.push('manifest.json still mentions localhost somewhere the packager does not strip — remove it by hand.');
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}

// Package a staged copy, so dist/ stays a working development build.
const stage = mkdtempSync(join(tmpdir(), 'focusspace-package-'));
cpSync(dist, stage, { recursive: true });
writeFileSync(join(stage, 'manifest.json'), `${packagedManifest}\n`);

// Only old packages are replaced — release/ also holds the store screenshots (scripts/store-shots.mjs).
mkdirSync(out, { recursive: true });
for (const file of readdirSync(out)) if (/^focusspace-.*\.zip$/.test(file)) rmSync(join(out, file));

const zip = join(out, `focusspace-${version}.zip`);
// -r recurse, -q quiet, -X drop the macOS extended attributes the store rejects.
execFileSync('zip', ['-rqX', zip, '.'], { cwd: stage, stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });

const size = (readFileSync(zip).length / 1024).toFixed(0);
console.log(`✓ ${zip} (${size} KB) — manifest v${version}`);
if (stripped.length) console.log(`  Left out of the packaged manifest: ${[...new Set(stripped)].join(', ')}`);
console.log('  Upload at https://chrome.google.com/webstore/devconsole');
