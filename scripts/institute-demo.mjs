// A local, self-contained demo of an institute Space — no real services, no YouTube API key.
//
//   node scripts/institute-demo.mjs --serve-only --keep → local site and API only; no browser automation
//   node scripts/institute-demo.mjs                 → release/institute-demo/*.png
//   node scripts/institute-demo.mjs --ids a,b,c,…   → the same, with these video ids for this run
//   node scripts/institute-demo.mjs --keep          → leaves the API, site and browser running to click around
//   node scripts/institute-demo.mjs --ids-from-playlist "https://www.youtube.com/playlist?list=PL…"
//                                                   → prints a public playlist's video ids, to paste into
//                                                     scripts/institute-demo/course.ts (VIDEO_IDS)
//
// What it does:
//   1. Starts the real FocusSpace API (dist-server, built from server/index.ts) on 127.0.0.1:8791 with a
//      throwaway SQLite identity file, and in front of it scripts/institute-demo/api.ts on :8790, which
//      answers institute routes with the real handlers over in-process PGlite (the tests' adapter) and
//      forwards everything else to the real API. It seeds a fictional "Demo IAS Academy": one batch course
//      built from VIDEO_IDS (ids only), the join code DEMO-2026-IAS, a today's class, homework, a published
//      quiz and a few fictional classmates' progress.
//   2. Builds the extension and the website against that API into release/institute-demo/ (dist/ and
//      dist-web/ are left alone) and serves the website on localhost:5174.
//   3. Screenshots the Studio funnel as the institute's owner.
//   4. In a fresh, signed-out Chromium profile with the extension: signs in the demo student, joins on the
//      website with the code, waits for the course to sync into a read-only Space, then opens YouTube and
//      screenshots the institute home, its path and a shelf.
//
// Step 4's YouTube screenshots need www.youtube.com and i.ytimg.com. Without them the script says so and
// stops after the screenshots it could take; it never fakes YouTube.
//
// Accounts (password demo-password-2026): demo-student@example.com, demo-faculty@example.com (institute
// owner, /studio), demo-staff@example.com (FocusSpace staff, /admin).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, 'release', 'institute-demo');
const EXTENSION = join(OUT, 'extension');
const WEB = join(OUT, 'web');
const API_PORT = Number(process.env.DEMO_API_PORT ?? 8790);
const REAL_PORT = Number(process.env.DEMO_REAL_PORT ?? 8791);
const SITE_PORT = 5174; // the manifest lets site.js run on localhost:5174
const API = `http://127.0.0.1:${API_PORT}`;
const SITE = `http://localhost:${SITE_PORT}`;
const PASSWORD = 'demo-password-2026';
const JOIN_CODE = 'DEMO-2026-IAS';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => console.log(line);

async function waitFor(check, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await sleep(300);
  }
  throw new Error(`Timed out: ${message}`);
}

/* ─── Video ids ──────────────────────────────────────────────────────────────── */

/** Reads a public playlist page once and prints its video ids in order. Needs YouTube, not an API key. */
async function idsFromPlaylist(url) {
  const response = await fetch(url, { headers: { 'Accept-Language': 'en-IN,en' } });
  if (!response.ok) throw new Error(`YouTube answered ${response.status} for that playlist.`);
  const html = await response.text();
  // Older pages list playlistVideoRenderer; current ones list video lockups (lockupViewModel).
  const ids = [...new Set([...html.matchAll(/"playlistVideoRenderer":\{"videoId":"([\w-]{11})"|"contentId":"([\w-]{11})","contentType":"LOCKUP_CONTENT_TYPE_VIDEO"/g)].map((m) => m[1] ?? m[2]))];
  if (!ids.length) throw new Error('No videos found on that page. Is the playlist public?');
  log(`// ${ids.length} videos, in playlist order. Paste into scripts/institute-demo/course.ts:`);
  log(`export const VIDEO_IDS: string[] = ${JSON.stringify(ids.slice(0, 40), null, 2)};`);
}

/** VIDEO_IDS from course.ts (read as text, so this file needs no TypeScript loader), or --ids. */
function videoIds() {
  const given = flag('--ids');
  if(args.includes('--serve-only')&&!given)return Array.from({length:30},(_,i)=>`demo${String(i+1).padStart(7,'0')}`);
  if (given) return given.split(',').map((id) => id.trim()).filter(Boolean);
  const source = readFileSync(join(ROOT, 'scripts', 'institute-demo', 'course.ts'), 'utf8');
  const list = /export const VIDEO_IDS: string\[\] = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
  return [...list.matchAll(/'([\w-]{11})'|"([\w-]{11})"/g)].map((m) => m[1] ?? m[2]);
}

/* ─── Processes ──────────────────────────────────────────────────────────────── */

const children = [];
function stopAll() {
  for (const child of children) child.kill('SIGTERM');
}
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed:\n${result.stderr || result.stdout}`);
}

/** Starts a long-running process and resolves once a line of its output matches `ready`. */
function start(name, command, commandArgs, env, ready) {
  return new Promise((resolveStart, reject) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    const timer = setTimeout(() => reject(new Error(`${name} did not start:\n${output}`)), 90000);
    const read = (chunk) => {
      output += chunk;
      const match = ready.exec(output);
      if (match) {
        clearTimeout(timer);
        resolveStart(match);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => code && reject(new Error(`${name} exited (${code}):\n${output}`)));
  });
}

async function startApi(ids) {
  const work = mkdtempSync(join(tmpdir(), 'focusspace-institute-demo-'));
  const env = { DEMO_STUDIO_ONLY:args.includes('--serve-only')?'1':'0', DB_PATH: join(work, 'identity.db'), AUTH_TOKEN_SECRET: randomBytes(24).toString('hex') };
  log('· building the API');
  run('npm', ['run', 'build:server']);
  // The real API. AI is not part of the demo, so its key is a placeholder that is never used.
  await start('FocusSpace API', 'node', ['dist-server/index.mjs'], { ...env, PORT: String(REAL_PORT), HOST: '127.0.0.1', OPENAI_API_KEY: 'demo-not-used' }, /FocusSpace API on/);
  const [, ready] = await start('Demo API', 'npx', ['vite-node', 'scripts/institute-demo/api.ts'], { ...env, DEMO_API_PORT: String(API_PORT), REAL_API: `http://127.0.0.1:${REAL_PORT}`, DEMO_IDS: JSON.stringify(ids) }, /DEMO_READY (.+)\n/);
  log(`· API ready on ${API} (institute data in PGlite, accounts in ${env.DB_PATH})`);
  const seed=JSON.parse(ready);log(`· Studio assistant: ${seed.assistantMode}; ${seed.assistantTokens} seed tokens.`);
  return { seed, work };
}

function buildClients() {
  const env = { VITE_API_URL: API, VITE_SITE_URL: SITE };
  log('· building the extension and the website against the demo API');
  rmSync(EXTENSION, { recursive: true, force: true });
  run('npm', ['run', 'icons']);
  run('npx', ['vite', 'build', '--outDir', EXTENSION], env);
  for (const mode of ['production', 'bridge', 'site']) run('npx', ['vite', 'build', '--config', 'vite.content.config.ts', '--mode', mode, '--outDir', EXTENSION], env);
  run('npx', ['vite', 'build', '--config', 'vite.web.config.ts', '--outDir', WEB], env);
}

async function startSite() {
  await start('Website', 'npx', ['vite', 'preview', '--config', 'vite.web.config.ts', '--outDir', WEB, '--port', String(SITE_PORT), '--strictPort', '--host', 'localhost'], {}, /Local:/);
  log(`· website on ${SITE}`);
}

/* ─── Screens ───────────────────────────────────────────────────────────────── */

const shots = [];
async function shot(page, name) {
  await sleep(1200); // fades and images settle
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  shots.push(`${name}.png`);
  log(`  ✓ ${name}.png`);
}

/** Signs in on the website's own sign-in page, like a person would. */
async function siteSignIn(page, email, next) {
  await page.goto(`${SITE}/signin?next=${encodeURIComponent(next)}`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('form.fsw-auth-form button[type=submit]').click();
  await page.waitForURL((url) => url.pathname === next, { timeout: 20000 });
}

async function studioFunnel(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, colorScheme: 'dark' });
  const page = await context.newPage();
  await siteSignIn(page, 'demo-faculty@example.com', '/studio');
  await page.locator('.fss-workspace-head, .fss-nav').first().waitFor({ timeout: 20000 });
  await shot(page, 'studio-funnel');
  await context.close();
}

async function studentFlow() {
  const profile = mkdtempSync(join(tmpdir(), 'focusspace-institute-student-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 1.25,
    locale: 'en-IN',
    colorScheme: 'dark',
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('focusspace:full-screen-offer', 'done');
    } catch {}
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 20000 });
  const extensionId = new URL(worker.url()).host;
  const dashboard = await context.newPage();
  const storage = (key) => dashboard.evaluate((k) => chrome.storage.local.get(k).then((v) => v[k]), key);

  // 1. Sign in to the extension as the demo student (Account page, the real auth/login message).
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/account`);
  await dashboard.getByLabel('Email').first().fill('demo-student@example.com');
  await dashboard.getByLabel('Password').first().fill(PASSWORD);
  await dashboard.locator('button.fs-btn-primary', { hasText: 'Sign in' }).click();
  await waitFor(async () => (await storage('auth'))?.user, 'extension sign-in', 20000);
  const keep = dashboard.getByRole('button', { name: 'Keep with my account' });
  if (await keep.count()) await keep.first().click();
  log('  ✓ the student is signed in to the extension');

  // 2. Join on the website with the code: signed-in, both sharing choices start off; the student shares progress.
  const site = await context.newPage();
  await siteSignIn(site, 'demo-student@example.com', `/join/${JOIN_CODE}`);
  // Phone first, proven by the demo's SMS code (shown on the page; no SMS is sent), then the sharing choice.
  await site.locator('input[type=tel]').fill('+919876500001');
  await site.getByRole('button', { name: 'Send code' }).click();
  const demoCode = (await site.locator('.fsw-join-fine', { hasText: 'The code is' }).innerText({ timeout: 15000 })).match(/(\d{6})/)[1];
  await site.getByLabel('SMS code').fill(demoCode);
  await site.getByRole('button', { name: 'Verify' }).click();
  await site.locator('.fsw-join-ok').waitFor({ timeout: 15000 });
  await site.locator('.fsw-join-choice input[type=checkbox]').first().check();
  await site.locator('.fsw-join-go').click();
  await site.getByText('You’re enrolled').waitFor({ timeout: 20000 });
  log(`  ✓ joined with ${JOIN_CODE}`);

  // 3. The course syncs into a read-only Space.
  await dashboard.evaluate(() => chrome.runtime.sendMessage({ type: 'institutes/sync', payload: { force: true } }));
  await waitFor(async () => ((await storage('modes')) ?? []).some((m) => m.source), 'the institute Space to sync', 30000);
  await dashboard.goto(`chrome-extension://${extensionId}/dashboard.html#/modes`);
  await dashboard.getByText('Leave course').first().waitFor({ timeout: 15000 });
  await shot(dashboard, 'dashboard-spaces');

  // 4. On YouTube: make the institute Space the active one and open the home.
  await dashboard.evaluate(async () => {
    const { modes, settings } = await chrome.storage.local.get(['modes', 'settings']);
    const course = modes.find((m) => m.source);
    await chrome.storage.local.set({ settings: { ...settings, activeModeId: course.id, focusEnabled: true, onboarded: true } });
  });
  const yt = await context.newPage();
  const reached = await yt
    .goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    .then(() => yt.locator('ytd-app').waitFor({ timeout: 20000 }))
    .then(() => true)
    .catch(() => false);
  if (!reached) {
    await context.close();
    throw Object.assign(new Error('www.youtube.com could not be reached from this machine, so the institute home on YouTube was not captured.'), { youtube: true });
  }
  const home = (selector) => yt.locator(`focusspace-slot[data-slot="home"] ${selector}`);
  await home('.fs-institute').waitFor({ timeout: 30000 });
  await waitFor(async () => (await home('.fs-poster img').count()) >= 4, 'lesson posters', 30000);
  await yt.evaluate(() => window.scrollTo(0, 0));
  await shot(yt, 'institute-home');
  await home('.fs-path').first().scrollIntoViewIfNeeded();
  await yt.evaluate(() => window.scrollBy(0, -80));
  await shot(yt, 'institute-path');
  await home('.fs-shelf').last().scrollIntoViewIfNeeded();
  await shot(yt, 'institute-shelf');
  if (!args.includes('--keep')) await context.close();
}

/* ─── Main ──────────────────────────────────────────────────────────────────── */

const playlist = flag('--ids-from-playlist');
if (playlist) {
  await idsFromPlaylist(playlist);
  process.exit(0);
}

const ids = videoIds();
if (ids.length < 5) {
  console.error(
    'The demo needs at least five video ids from a public UPSC playlist (one per topic).\n' +
      'Fill VIDEO_IDS in scripts/institute-demo/course.ts — `--ids-from-playlist <url>` prints them — or pass --ids id1,id2,…',
  );
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
let failed = false;
try {
  const { seed } = await startApi(ids);
  log(`· seeded ${seed.users.student} (student), ${seed.users.faculty} (institute owner), join code ${seed.joinCode}`);
  buildClients();
  await startSite();
  if(args.includes('--serve-only')){log(`Demo ready: ${SITE}/studio — server only, no browser automation.`);await new Promise(()=>{});}
  const browser = await chromium.launch();
  await studioFunnel(browser);
  await browser.close();
  await studentFlow();
} catch (error) {
  failed = true;
  console.error(`\n✗ ${error.message}`);
  if (error.youtube) console.error('  Everything before YouTube ran. Run the demo where www.youtube.com and i.ytimg.com are reachable to capture the institute home.');
}
log(`\nScreenshots in ${OUT}: ${shots.join(', ') || 'none'}`);
if (failed) process.exitCode = 1;
if (args.includes('--keep') && !failed) {
  log(`Still running: API ${API}, website ${SITE}. Ctrl+C to stop.`);
  await new Promise(() => {});
}
process.exit(failed ? 2 : 0);
