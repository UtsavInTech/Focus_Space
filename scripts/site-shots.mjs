// Website screenshots of the real extension: the goal picker, exam Spaces and the streaming home.
// A fresh, signed-out Chromium profile, so no personal account, history or avatar appears.
//
//   npm run build
//   node scripts/site-shots.mjs [step]     → release/site-shots/*.png  (1800×1012)
//   node scripts/site-shots.mjs --webp     → web/public/light/<name>-800.webp / -1800.webp
//                                            and the Deep book's 3:2 pages in web/public/journey/
//
// Steps: picker, upsc, neet, jee, btech. Each Space is built through the same picker a student uses.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'release', 'site-shots');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn().catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`Timed out: ${message}`);
}

// The Deep home's book pages: 3:2, cropped past YouTube's sidebar so the product fills the page.
const JOURNEY = { 'exam-picker': '09-exam-picker', neet: '10-exam-home', 'learning-path': '11-learning-path', 'streaming-home': '12-streaming-home' };
const BOOK_CROP = { x: 330, y: 0, w: 1470, h: 980 };

/** Converts the PNGs to the website's WebP sizes in a browser canvas (no image tools needed). */
async function toWebp() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const encode = (src, width, crop) =>
    page.evaluate(async ([s, w, c]) => {
      const img = new Image();
      img.src = s;
      await img.decode();
      const box = c ?? { x: 0, y: 0, w: img.width, h: img.height };
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = Math.round((w * box.h) / box.w);
      const g = canvas.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', 0.86).split(',')[1];
    }, [src, width, crop]);
  const save = (dir, file, data) => {
    writeFileSync(join(ROOT, 'web', 'public', dir, file), Buffer.from(data, 'base64'));
    console.log(`  ✓ ${dir}/${file}`);
  };
  for (const file of readdirSync(OUT).filter((f) => f.endsWith('.png') && !f.startsWith('debug-'))) {
    const name = file.replace(/\.png$/, '');
    const src = `data:image/png;base64,${readFileSync(join(OUT, file)).toString('base64')}`;
    for (const width of [800, 1800]) save('light', `${name}-${width}.webp`, await encode(src, width));
    if (JOURNEY[name]) for (const width of [560, 960]) save('journey', `${JOURNEY[name]}-${width}.webp`, await encode(src, width, BOOK_CROP));
  }
  await browser.close();
}

if (process.argv.includes('--webp')) {
  await toWebp();
  process.exit(0);
}

const only = process.argv[2] ?? 'all';
let context, ext, yt;

/** A fresh profile per Space, so each one starts from the real first-run goal picker. */
async function launch() {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'focusspace-site-')), {
    channel: 'chromium',
    headless: !process.env.HEADED,
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 1.25,
    locale: 'en-IN',
    colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--disable-blink-features=AutomationControlled'],
  });
  // The one-time "Use the whole screen?" offer, answered before the page renders.
  await context.addInitScript(() => { try { localStorage.setItem('focusspace:full-screen-offer', 'done'); } catch {} });
  yt = undefined;
  await waitFor(async () => (yt = context.pages().find((p) => p.url().startsWith('https://www.youtube.com'))), 'install opens YouTube', 20000);
  await yt.bringToFront();
}

const home = (sel = '') => `focusspace-slot[data-slot="home"] ${sel}`;
const slotText = () => yt.evaluate(() => document.querySelector('focusspace-slot[data-slot="home"]')?.shadowRoot?.textContent ?? '');
/** The first-run guide panel would cover the page; close it like a user would. */
async function closeGuide() {
  await yt.evaluate(() => {
    for (const slot of document.querySelectorAll('focusspace-slot')) {
      for (const b of slot.shadowRoot?.querySelectorAll('button[aria-label]') ?? []) {
        if (b.getAttribute("aria-label") === "Close the guide") b.click();
      }
    }
  });
}
/** Scrolls so the element with this text sits just under YouTube's top bar. */
async function scrollToText(text, offset = 70) {
  const box = await yt.locator(home(`:text("${text}")`)).first().boundingBox();
  await yt.evaluate(([y, o]) => window.scrollBy(0, y - o), [box.y, offset]);
}
const shot = async (name) => {
  await yt.bringToFront();
  await closeGuide();
  await sleep(1200); // let fades and thumbnails settle
  await yt.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}.png`);
};

async function picker() {
  await waitFor(async () => (await yt.locator(home('.fs-exam-card')).count()) > 5, 'goal picker', 30000);
  await yt.evaluate(() => window.scrollTo(0, 0));
}

/** Pick a goal, take the default answers (or the given ones), create the Space and wait for its home. */
async function build(goal, answers = []) {
  await picker();
  await yt.locator(home(`.fs-exam-card:has-text("${goal}")`)).first().click();
  for (const answer of answers) await yt.locator(home(`.fs-exam-option:has-text("${answer}")`)).first().click();
  // Questions, then review, then create. Each step animates in, so wait for its button.
  for (let i = 0; i < 4; i += 1) {
    await sleep(900);
    const next = yt.locator(home('.fs-exam-actions .fs-cta-primary'));
    if (!(await next.count())) break;
    await next.first().click();
  }
  await waitFor(async () => (await yt.locator(home('.fs-exams')).count()) === 0, 'Space created', 30000);
  await waitFor(async () => (await yt.locator(home('img')).count()) >= 8, 'Space home with videos', 90000);
  await yt.evaluate(() => window.scrollTo(0, 0));
}

const steps = {
  picker: async () => { await picker(); await shot('exam-picker'); },
  upsc: async () => {
    await build('UPSC');
    await shot('upsc');
    await scrollToText('Your path through');
    await shot('learning-path');
  },
  neet: async () => {
    await build('NEET');
    await shot('neet');
    await yt.evaluate(() => window.scrollBy(0, 1500));
    await sleep(2500); // shelves load their thumbnails as they scroll in
    await shot('streaming-home');
  },
  jee: async () => { await build('JEE'); await shot('jee'); },
  btech: async () => { await build('B.Tech', ['Computer Science']); await shot('btech-cse'); },
};

for (const [name, run] of Object.entries(steps)) {
  if (only !== 'all' && only !== name) continue;
  await launch();
  try {
    await run();
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    await yt.screenshot({ path: join(OUT, `debug-${name}.png`) });
  }
  await context.close();
}
console.log(`\nScreenshots in ${OUT}`);
