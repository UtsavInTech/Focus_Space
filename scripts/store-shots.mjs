// Chrome Web Store screenshots (1280×800), taken from the real store build against the live API —
// so AI answers, notes and the mind map are genuine output, not the e2e test double.
//
//   VITE_API_URL=https://api.focusspace.xyz VITE_SITE_URL=https://focusspace.xyz npm run build
//   node scripts/store-shots.mjs            → release/store-assets/*.png
//
// Signed out, so AI draws on the anonymous allowance (a handful of requests per run).
// Order and choice of screens follow docs/STORE.md → Screenshots.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'release', 'store-assets');
mkdirSync(OUT, { recursive: true });

const built = ['background.js', ...readdirSync(join(DIST, 'assets')).map((f) => join('assets', f))].filter((f) => f.endsWith('.js'));
if (!built.some((f) => readFileSync(join(DIST, f), 'utf8').includes('https://api.focusspace.xyz'))) {
  console.error('dist/ is not a store build — rebuild with VITE_API_URL=https://api.focusspace.xyz (see header).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn().catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`Timed out: ${message}`);
}

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'focusspace-shots-')), {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: 'en-US',
  // Same reasons as scripts/e2e/run.mjs: YouTube withholds captions from headless and automated Chrome.
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'],
});

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 });
const EXT = `chrome-extension://${new URL(worker.url()).host}`;

let yt;
await waitFor(async () => (yt = context.pages().find((p) => p.url().startsWith('https://www.youtube.com'))), 'install opens YouTube', 20000);
const ext = await context.newPage();
await ext.goto(`${EXT}/dashboard.html#/`);
const message = (type, payload = {}) => ext.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload]);

const home = (sel = '') => `focusspace-slot[data-slot="home"] ${sel}`;
const rail = (sel = '') => `focusspace-slot[data-slot="watch"] ${sel}`;
const slotText = (slot) => yt.evaluate((s) => document.querySelector(`focusspace-slot[data-slot="${s}"]`)?.shadowRoot?.textContent ?? '', slot);
const shot = async (name) => {
  await sleep(600); // let hover states and fades settle
  await yt.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}.png`);
};

/** Ads would end up in the screenshot; skip or fast-forward them (as the e2e harness does). */
async function clearAd() {
  await yt.bringToFront();
  await waitFor(
    () =>
      yt.evaluate(() => {
        if (!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')) return true;
        document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button')?.click();
        const v = document.querySelector('#movie_player video');
        if (v && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.5) v.currentTime = v.duration - 0.1;
        return false;
      }),
    'ad finished',
    90000,
  );
}

// 5 · First run — taken first because it only exists before a space is chosen.
await yt.waitForLoadState('domcontentloaded');
await waitFor(async () => (await slotText('home')).includes('What do you want to focus on?'), 'first-run prompt');
await shot('5-first-run');
await yt.click(home('.fs-first-run button:has-text("DSA")'));

// A realistic DSA library: channels a placement student would actually follow.
for (const input of ['@takeUforward', '@NeetCodeIO', '@abdul_bari', '@ApnaCollegeOfficial']) {
  const res = await message('channel/add', { input });
  if (!res.ok) console.log(`  (channel ${input} skipped: ${res.error})`);
}

// The background rebuilds the space's feed from the new channels; shooting before that shows an empty library.
await waitFor(
  () => ext.evaluate(async () => ((await chrome.storage.local.get('feedViews')).feedViews?.modes?.dsa?.items.length ?? 0) > 8),
  'DSA feed rebuilt from the added channels',
  60000,
);

// 1 · Home
await yt.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
await waitFor(async () => !(await slotText('home')).includes('No subscriptions in FocusSpace yet'), 'home shows the added channels', 30000);
await waitFor(async () => (await yt.locator(home('.fs-vcard')).count()) >= 6, 'home feed', 60000);
await yt.evaluate(() => window.scrollTo(0, 0));
await shot('1-home');

// 2 · Watch page — a lecture with a creator playlist and description timestamps, mid-lesson.
await yt.goto('https://www.youtube.com/watch?v=oAja8-Ulz6o', { waitUntil: 'domcontentloaded' });
await yt.waitForFunction(() => document.querySelector('#movie_player video')?.readyState >= 2, null, { timeout: 30000 });
await clearAd();
await yt.evaluate(() => { const v = document.querySelector('#movie_player video'); v.currentTime = 1100; v.pause(); });
await waitFor(async () => (await yt.locator(rail('.fs-learning-title')).textContent()) === 'Insert in a Linked List (First & Last)', 'rail on the current concept');
await yt.locator(rail('.fs-ai-chip:has-text("Explain")')).click();
await waitFor(async () => ((await yt.locator(rail('.fs-answer-text')).textContent().catch(() => '')) ?? '').length > 80, 'real Explain answer', 60000);
await shot('2-watch-explain');

// 3 · Mind map, expanded to full size.
await yt.locator(rail('.fs-ai-chip:has-text("Make Notes")')).click();
await yt.locator(rail('[aria-label="Format"] .fs-ai-chip:has-text("Mind map")')).click();
await yt.locator(rail('.fs-ai-chip:has-text("Generate")')).click();
await waitFor(async () => (await yt.locator(rail('.fs-mindmap svg')).count()) > 0, 'mind map generated', 90000);
await yt.locator(rail('.fs-ai-chip:has-text("Expand")')).click();
await sleep(800);
await shot('3-mind-map');
await yt.keyboard.press('Escape');

// 4 · Notes in Hinglish — the language choice is the point of this screen.
await yt.locator(rail('[aria-label="Format"] .fs-ai-chip:has-text("Notes")')).click();
await yt.locator(rail('[aria-label="Format"] .fs-ai-chip:has-text("Hinglish")')).click();
await yt.locator(rail('.fs-ai-chip:has-text("Generate")')).click();
await waitFor(async () => !(await slotText('watch')).includes('Generating…') && (await yt.locator(rail('.fs-ai-chip:has-text("Save")')).count()) > 0, 'notes generated', 90000);
await yt.locator(rail('[aria-label="Make Notes"]')).scrollIntoViewIfNeeded();
await shot('4-notes-hinglish');

// Small promo tile (440×280), required by the store. Drawn here so it is regenerated with everything else.
const icon = readFileSync(join(ROOT, 'public/icons/icon-128.png')).toString('base64');
const tile = await context.newPage();
await tile.setViewportSize({ width: 440, height: 280 });
await tile.setContent(`<!doctype html><html><head><style>
  body { margin: 0; width: 440px; height: 280px; overflow: hidden; font-family: Inter, -apple-system, 'Segoe UI', Roboto, sans-serif;
    background: #6d5dfc; color: #fff; } /* flat brand colour — FocusSpace uses no gradients */
  .wrap { box-sizing: border-box; height: 100%; padding: 34px 36px; display: flex; flex-direction: column; justify-content: space-between; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 22px; letter-spacing: -0.01em; }
  .brand img { width: 44px; height: 44px; border-radius: 11px; box-shadow: 0 4px 14px rgba(0,0,0,.18); }
  h1 { margin: 0; font-size: 31px; line-height: 1.12; font-weight: 750; letter-spacing: -0.02em; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .chips span { font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.28); }
</style></head><body><div class="wrap">
  <div class="brand"><img src="data:image/png;base64,${icon}" alt="">FocusSpace</div>
  <h1>Tell YouTube what<br>you came to learn.</h1>
  <div class="chips"><span>Focused feed</span><span>Notes</span><span>Mind maps</span><span>AI tutor</span></div>
</div></body></html>`);
await tile.screenshot({ path: join(OUT, 'promo-tile-440x280.png') });
console.log('  ✓ promo-tile-440x280.png');

await context.close();
console.log(`\nScreenshots in ${OUT}`);
