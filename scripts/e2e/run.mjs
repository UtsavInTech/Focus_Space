// End-to-end tests for FocusSpace (V3 + V4): loads dist/ into Chromium and drives the
// real youtube.com (signed out), the popup and the space manager.
//
//   npm run build && npm run e2e            (headless)
//   HEADED=1 npm run e2e                     (watch it run)
//
// Requires network access to youtube.com. Screenshots → e2e-artifacts/.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const DIST = join(ROOT, 'dist');
const ART = join(ROOT, 'e2e-artifacts');
mkdirSync(ART, { recursive: true });

const results = [];
const errors = [];
const timings = {};
let shotIndex = 0;

/** E2E_ONLY="regex" runs only matching steps (e.g. E2E_ONLY="Creator playlist|viewer comments|AI runs|What am I learning"). */
const ONLY = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null;

async function step(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
}
const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, message, timeout = 20000, interval = 200) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out: ${message}${last instanceof Error ? ` (${last.message})` : ''}`);
}
const shot = (page, name, opts = {}) => page.screenshot({ path: join(ART, `${String(++shotIndex).padStart(2, '0')}-${name}.png`), ...opts });

function trackErrors(page, label) {
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const loc = msg.location()?.url ?? '';
    if (label.startsWith('ext') || loc.startsWith('chrome-extension://') || /FocusSpace|content\.js|bridge\.js/.test(`${text} ${loc}`)) errors.push(`[${label}] ${text} @ ${loc}`);
  });
}

// Test double for the learner's AI endpoint: records what FocusSpace sends and echoes it back.
// (A real endpoint is scripts/ai-endpoint/server.mjs; no LLM is called in tests.)
const aiRequests = [];
const aiServer = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const json = JSON.parse(body || '{}');
    aiRequests.push(json);
    const ctx = json.context ?? {};
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ answer: `Test endpoint received ${json.action} at ${ctx.timestamp} about "${ctx.currentConcept}"${json.question ? ` — question: ${json.question}` : ''}` }));
  });
});
await new Promise((resolve) => aiServer.listen(0, '127.0.0.1', resolve));
const AI_URL = `http://127.0.0.1:${aiServer.address().port}/v1/moment`;

const userDataDir = mkdtempSync(join(tmpdir(), 'focusspace-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  // YouTube's player refuses captions to "HeadlessChrome"; real users run Chrome.
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  // Without AutomationControlled, navigator.webdriver is true and YouTube serves empty captions even to its own player.
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'],
});

let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker', { timeout: 15000 });
const EXT = `chrome-extension://${new URL(worker.url()).host}`;
console.log(`FocusSpace loaded (${EXT})\n`);

const youtubePages = () => context.pages().filter((p) => p.url().startsWith('https://www.youtube.com'));
const yt = await waitFor(() => youtubePages()[0], 'install opens YouTube', 20000);
trackErrors(yt, 'youtube');

const ext = await context.newPage();
trackErrors(ext, 'ext:dashboard');
await ext.goto(`${EXT}/dashboard.html#/`);
const storage = {
  get: (keys) => ext.evaluate((k) => chrome.storage.local.get(k), keys),
  set: (values) => ext.evaluate((v) => chrome.storage.local.set(v), values),
  patchSettings: (patch) =>
    ext.evaluate(async (p) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, ...p } });
    }, patch),
};
const message = (type, payload = {}) => ext.evaluate(([t, p]) => chrome.runtime.sendMessage({ type: t, payload: p }), [type, payload]);
const home = (sel = '') => `focusspace-slot[data-slot="home"] ${sel}`;
const slotText = (slot) => yt.evaluate((s) => document.querySelector(`focusspace-slot[data-slot="${s}"]`)?.shadowRoot?.textContent ?? '', slot);
const displayOf = (selector) => yt.evaluate((sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : null; }, selector);
const markPage = () => yt.evaluate(() => { window.__fsMarker = Math.random(); return window.__fsMarker; });
const pageMarker = () => yt.evaluate(() => window.__fsMarker ?? null);
const playerReady = () => yt.waitForFunction(() => { const v = document.querySelector('#movie_player video'); return v && v.readyState >= 2; }, null, { timeout: 30000 });
const rail = (sel = '') => `focusspace-slot[data-slot="watch"] ${sel}`;
const RAIL_SECTIONS = ['Your course', 'Continue this series', 'More from', 'From your subscriptions', 'Best from YouTube', 'More related'];
const railText = (el) => el.textContent().catch(() => '');

/** Signed-out YouTube often plays a pre-roll ad; its time must never count as progress. */
async function waitForAd() {
  await yt.bringToFront(); // YouTube pauses ads in hidden tabs
  return waitFor(
    () =>
      yt.evaluate(() => {
        if (!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting')) return true;
        document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button')?.click();
        const v = document.querySelector('#movie_player video');
        if (v?.paused) v.play().catch(() => undefined);
        // Unskippable ads can outlast any timeout (one ran 174s); jump to the end instead of waiting it out.
        if (v && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.5) v.currentTime = v.duration - 0.1;
        return false;
      }),
    'pre-roll ad finished',
    90000,
    500,
  ).catch(async (err) => {
    const state = await yt.evaluate(() => { const v = document.querySelector('#movie_player video'); return { visibility: document.visibilityState, paused: v?.paused, t: v?.currentTime, d: v?.duration, classes: document.querySelector('#movie_player')?.className }; });
    throw new Error(`${err.message} — player state ${JSON.stringify(state)}`);
  });
}
async function openLecture(url) {
  await yt.goto(url, { waitUntil: 'domcontentloaded' });
  await playerReady();
  await waitForAd();
}
const seekTo = (sec) => yt.evaluate((s) => { const v = document.querySelector('#movie_player video'); v.currentTime = s; }, sec);
const playerState = () => yt.evaluate(() => { const v = document.querySelector('#movie_player video'); return `${Math.round(v?.currentTime ?? -1)}s${document.querySelector('#movie_player.ad-showing') ? ' (ad)' : ''}${v?.paused ? ' paused' : ''}`; });
/** Seek into the lesson and wait until FocusSpace shows the expected concept (ads can restart the content). */
async function atMoment(sec, concept, trace) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitForAd();
    await seekTo(sec);
    trace?.push(`seek ${sec} → ${await playerState()}`);
    const ok = await waitFor(async () => (await railText(yt.locator(rail('.fs-learning-title')))) === concept, `concept "${concept}"`, 15000).catch(() => false);
    await sleep(500);
    trace?.push(`after wait → ${await playerState()}`);
    if (ok && !(await yt.evaluate(() => !!document.querySelector('#movie_player.ad-showing')))) return;
  }
  throw new Error(`never reached "${concept}" at ${sec}s: ${trace?.join(' · ')}`);
}

console.log('First run on YouTube');

await step('Install opens one YouTube tab asking "What do you want to focus on?"', async () => {
  assert(youtubePages().length === 1, `expected one YouTube tab, got ${youtubePages().length}`);
  await yt.waitForLoadState('domcontentloaded');
  await waitFor(async () => (await slotText('home')).includes('What do you want to focus on?'), 'first-run prompt', 30000);
  await shot(yt, 'first-run');
  await yt.click(home('.fs-first-run button:has-text("DSA")'));
  await waitFor(async () => (await slotText('home')).includes('From your subscriptions') || (await slotText('home')).includes('Best matches from YouTube'), 'DSA home after choosing', 20000);
  const { settings } = await storage.get(['settings']);
  assert(settings.onboarded && settings.activeModeId === 'dsa', 'onboarding not saved');
});

await step('Channels are added without subscribing (public uploads, RSS is down)', async () => {
  for (const input of ['@abdul_bari', '@NeetCodeIO', '@takeUforward', '@AndrejKarpathy', '@statquest', '@MrBeast']) {
    const res = await message('channel/add', { input });
    assert(res.ok, `channel/add ${input}: ${res.error}`);
  }
  const { videos } = await storage.get(['videos']);
  assert(Object.keys(videos).length > 60, `library too small: ${Object.keys(videos).length}`);
  await waitFor(async () => ((await storage.get(['feedViews'])).feedViews.modes?.dsa?.items.length ?? 0) > 8, 'background built the DSA feed view', 30000);
});

console.log('\nHome feed');

await step('Home: space bar, subscriptions first, a discovery after four', async () => {
  await waitFor(async () => (await yt.locator(home('.fs-vcard .fs-source')).count()) >= 6, 'feed cards', 40000);
  const sources = await yt.locator(home('.fs-grid > article .fs-source, .fs-grid > article.fs-spotlight')).evaluateAll((els) => els.map((e) => (e.classList.contains('fs-spotlight') ? 'discovery' : e.textContent)));
  const firstFive = await yt.locator(home('.fs-section .fs-grid > article')).evaluateAll((els) => els.slice(0, 5).map((e) => (e.classList.contains('fs-spotlight') ? 'Discovery' : e.querySelector('.fs-source')?.textContent)));
  assert(firstFive.slice(0, 4).every((s) => s === 'Subscribed' || s === 'Your channel'), `first four should be your channels: ${firstFive}`);
  assert(firstFive[4] === 'Discovery', `fifth should be a discovery: ${firstFive}`);
  assert(sources.length >= 5, 'too few cards');
  assert((await displayOf('ytd-browse[page-subtype="home"] > ytd-two-column-browse-results-renderer')) === 'none', "YouTube's recommendation feed still visible");
  const sessionUi = await yt.locator(home('.fs-session, button:has-text("Start session"), button:has-text("End session"), :text("Today\'s focus")')).count();
  assert(sessionUi === 0, 'session UI should be gone');
  await shot(yt, 'home');
});

await step('Home: topics filter the feed; infinite scroll loads more', async () => {
  await yt.click(home('.fs-chips button:has-text("Stacks & Queues")'));
  await waitFor(async () => (await slotText('home')).includes('Your playlist'), 'topic view', 10000);
  await waitFor(async () => (await yt.locator(home('.fs-vcard')).count()) > 2, 'topic videos');
  await yt.click(home('.fs-chips button:has-text("All")'));
  const before = await yt.locator(home('.fs-grid > article')).count();
  for (let i = 0; i < 6; i++) {
    await yt.mouse.wheel(0, 2500);
    await sleep(700);
  }
  await waitFor(async () => (await yt.locator(home('.fs-grid > article')).count()) > before, `more cards after scrolling (had ${before})`, 30000);
  await yt.evaluate(() => window.scrollTo(0, 0));
});

console.log('\nNavigation');

await step('Video click: same tab, no reload, player first, rail after', async () => {
  await yt.click(home('.fs-chips button:has-text("Stacks & Queues")'));
  await waitFor(async () => (await yt.locator(home('.fs-vcard')).count()) > 2, 'topic videos');
  await yt.evaluate(() => window.scrollTo(0, 600));
  await sleep(400);
  const scrollBefore = await yt.evaluate(() => scrollY);
  const marker = await markPage();
  const pagesBefore = context.pages().length;
  const t0 = Date.now();
  await yt.locator(home('.fs-vcard .fs-vcard-title')).first().click();
  await yt.waitForURL(/\/watch\?v=/, { timeout: 15000 });
  timings.clickToUrl = Date.now() - t0;
  await playerReady();
  timings.clickToPlayer = Date.now() - t0;
  await waitFor(async () => { const text = await slotText('watch'); return RAIL_SECTIONS.some((s) => text.includes(s)); }, 'rail content', 20000);
  timings.clickToRail = Date.now() - t0;
  assert((await pageMarker()) === marker, 'page reloaded — navigation was not SPA');
  assert(context.pages().length === pagesBefore, 'a new tab was opened');
  globalThis.__scrollBefore = scrollBefore;
  await sleep(800);
  await shot(yt, 'watch');
});

await step('Watch rail replaces YouTube suggestions with relevant learning only', async () => {
  assert((await displayOf('ytd-watch-flexy #related')) === 'none', "YouTube's related rail should be hidden");
  const inSecondary = await yt.evaluate(() => document.querySelector('focusspace-slot[data-slot="watch"]')?.parentElement?.id);
  assert(inSecondary === 'secondary-inner' || inSecondary === 'below', `rail mounted in ${inSecondary}`);
  const titles = await yt.locator('focusspace-slot[data-slot="watch"] .fs-rail-title, focusspace-slot[data-slot="watch"] .fs-path-name').allTextContents();
  assert(titles.length >= 3, `rail too thin: ${titles.length}`);
  const offTopic = titles.filter((t) => /trailer|vlog|prank|reaction|funny|song|movie|podcast/i.test(t));
  assert(offTopic.length === 0, `distracting items in rail: ${offTopic.join(' | ')}`);
  await yt.click('focusspace-slot[data-slot="watch"] button:has-text("Show YouTube\'s suggestions")');
  await waitFor(async () => (await displayOf('ytd-watch-flexy #related')) !== 'none', 'native suggestions revealed');
  await yt.click('focusspace-slot[data-slot="watch"] button:has-text("Hide YouTube\'s suggestions")');
});

await step('Back returns to the same home: same tab, same topic, same scroll', async () => {
  const marker = await pageMarker();
  const pages = context.pages().length;
  const t0 = Date.now();
  await yt.goBack();
  await yt.waitForURL('https://www.youtube.com/', { timeout: 15000 });
  timings.back = Date.now() - t0;
  assert((await pageMarker()) === marker, 'back reloaded the page');
  assert(context.pages().length === pages, 'back opened a tab');
  await waitFor(async () => (await yt.locator(home('.fs-chips button[aria-selected="true"]')).textContent()) === 'Stacks & Queues', 'topic preserved', 5000);
  await sleep(600);
  const y = await waitFor(async () => { const v = await yt.evaluate(() => scrollY); return Math.abs(v - globalThis.__scrollBefore) < 200 ? v || 1 : null; }, 'scroll restored', 5000).catch(async () => yt.evaluate(() => scrollY));
  await yt.click(home('.fs-chips button:has-text("All")'));
  assert(Math.abs(y - globalThis.__scrollBefore) < 200, `scroll ${globalThis.__scrollBefore} → ${y}`);
});

await step('Watching is remembered: "Continue watching" resumes the video', async () => {
  const marker = await markPage();
  await yt.locator(home('.fs-vcard .fs-vcard-title')).first().click();
  await yt.waitForURL(/\/watch\?v=/);
  const videoId = new URL(yt.url()).searchParams.get('v');
  await playerReady();
  const adGone = await waitForAd();
  assert(adGone, 'ad still showing');
  const early = ((await storage.get(['watchHistory'])).watchHistory ?? []).find((e) => e.videoId === videoId);
  assert(!early || early.progress < 0.5, `ad time was recorded as progress (${early?.progress})`);
  await yt.evaluate(() => { const v = document.querySelector('#movie_player video'); v.currentTime = Math.max(15, v.duration * 0.3); });
  const saved = await waitFor(async () => ((await storage.get(['watchHistory'])).watchHistory ?? []).find((e) => e.videoId === videoId && e.progress > 0.2), 'progress saved', 20000);
  assert(saved.progress < 0.85, `progress ${saved.progress} should be ~0.3`);
  await yt.goBack();
  await yt.waitForURL('https://www.youtube.com/');
  assert((await pageMarker()) === marker, 'reload on back');
  await waitFor(async () => (await slotText('home')).includes('Continue watching'), 'continue watching section', 15000);
  const resume = await yt.locator(home('.fs-continue')).evaluateAll((els) => els.map((e) => e.querySelector('a')?.getAttribute('href')));
  assert(resume.some((h) => h?.includes(videoId)), `resume card missing ${videoId}: ${resume}`);
  await shot(yt, 'continue-watching');
});

await step('Series continuity: numbered lecture shows where you are and what is next', async () => {
  const fx = JSON.parse(readFileSync(join(ROOT, 'src/learning/relevance/__fixtures__/real-channels.json'), 'utf8'));
  const tuf = fx.channels.find((c) => c.handle === '@takeUforward');
  const lecture = tuf.videos.find((v) => v.title.startsWith('L12.'));
  await yt.goto(`https://www.youtube.com/watch?v=${lecture.id}`, { waitUntil: 'domcontentloaded' });
  await waitFor(async () => { const t = await slotText('watch'); return t.includes('Continue this series') || t.includes('Your course'); }, 'series panel', 30000);
  const text = await slotText('watch');
  // take U forward links the playlist from the description, so this may resolve to the real playlist.
  assert(/You are here: #\d+/.test(text), `position missing: ${text.slice(0, 300)}`);
  assert(/L13\./.test(text), 'next lecture (L13) missing');
  await shot(yt, 'series-numbered');
});

await step('Series continuity: playlist position from YouTube', async () => {
  await yt.goto('https://www.youtube.com/watch?v=V42FBiohc6c&list=PL2_aWCzGMAwI9HK8YPVBjElbLbI3ufctn', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await slotText('watch')).includes('Time Complexity Analysis'), 'playlist series', 30000);
  const text = await slotText('watch');
  assert(/You are here: #1 of 4/.test(text), `playlist position missing: ${text.slice(0, 300)}`);
});

await step('Save to topic from the watch page, then see it in the topic playlist', async () => {
  const rail = yt.locator('focusspace-slot[data-slot="watch"]');
  await rail.locator('select[aria-label="Topic playlist"]').selectOption({ label: 'Searching' });
  await rail.locator('.fs-save button').click();
  await waitFor(async () => ((await storage.get(['topicPlaylists'])).topicPlaylists?.dsa?.searching ?? []).length === 1, 'saved to topic');
});

console.log('\nLearning intelligence (V4)');

await step('Creator playlist from the description is the course; description timestamps are the outline', async () => {
  await openLecture('https://www.youtube.com/watch?v=oAja8-Ulz6o');
  await waitFor(async () => (await yt.locator(rail('.fs-learning')).count()) === 1, 'learning card', 30000);
  const course = await waitFor(async () => { const t = await slotText('watch'); return t.includes('Your course') || t.includes('Continue this series') ? t : null; }, 'course panel', 30000);
  assert(course.includes("Creator's playlist"), `expected the playlist linked in the description: ${course.slice(0, 240)}`);
  assert(/You are here: #\d+ of \d+/.test(course), 'course position');
  await seekTo(1052); // 17:32
  await waitFor(async () => (await railText(yt.locator(rail('.fs-learning-title')))) === 'Insert in a Linked List (First & Last)', 'current concept at 17:32', 20000);
  const sub = await railText(yt.locator(rail('.fs-learning-sub')).first());
  assert(sub.includes('From the description'), `source label: ${sub}`);
  assert((await railText(yt.locator(rail('.fs-learning-next')))).includes('Display/Print a Linked List'), 'up next');
  const items = await yt.locator(rail('.fs-map-item .fs-map-title')).allTextContents();
  assert(items.length === 5 && items[2] === 'Delete in a Linked List (First & Last)', `outline: ${items.join(' | ')}`);
  await yt.locator(rail('.fs-map-item')).nth(2).click();
  await waitFor(async () => (await railText(yt.locator(rail('.fs-learning-title')))) === 'Delete in a Linked List (First & Last)', 'seek from the outline', 10000);
  const t = await yt.evaluate(() => document.querySelector('#movie_player video').currentTime);
  assert(Math.abs(t - 1850) < 5, `seeked to ${t}`);
  await shot(yt, 'watch-learning');
});

await step('No chapters or timestamps: viewer comments become the outline, labelled as such', async () => {
  await openLecture('https://www.youtube.com/watch?v=LusTv0RlnSU');
  await waitFor(async () => (await railText(yt.locator(rail('.fs-map .fs-sec-meta')))).includes('viewer comments'), 'outline from comments', 45000);
  const count = await yt.locator(rail('.fs-map-item')).count();
  assert(count >= 8, `comment outline too small: ${count}`);
  const { knowledgeMaps } = await storage.get(['knowledgeMaps']);
  const map = knowledgeMaps.entries['LusTv0RlnSU']?.map;
  assert(map?.backbone === 'comments' && map.nodes.every((n) => n.confidence < 0.9), `cached map: ${JSON.stringify(map)?.slice(0, 200)}`);
  await shot(yt, 'watch-comments-outline');
});

await step('AI runs only when asked, with only this moment’s context (test endpoint)', async () => {
  await storage.patchSettings({ ai: { provider: 'endpoint', endpointUrl: AI_URL } });
  await openLecture('https://www.youtube.com/watch?v=oAja8-Ulz6o');
  const persistence = await yt.evaluate(() => localStorage.getItem('yt-player-caption-persistence'));
  const trace = [];
  await atMoment(1100, 'Insert in a Linked List (First & Last)', trace);
  // Don't await play(): its promise can stay pending while an ad interrupts.
  await yt.evaluate(() => {
    document.querySelector('#movie_player video')?.play().catch(() => undefined);
  });
  await sleep(6000); // playback keeps ticking…
  trace.push(`after playback → ${await playerState()}`);
  assert(aiRequests.length === 0, `AI was called during playback (${aiRequests.length})`);

  await atMoment(1100, 'Insert in a Linked List (First & Last)', trace);
  // YouTube may have turned captions on by itself; FocusSpace must leave them exactly as it found them.
  const ccBefore = await yt.evaluate(() => document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed'));
  trace.push(`click → ${await playerState()}`);
  await yt.click(rail('.fs-ai-chip:has-text("Explain")'));
  await waitFor(async () => (await railText(yt.locator(rail('.fs-answer-text')))).includes('Test endpoint received explain'), 'answer shown', 45000);
  assert(aiRequests.length === 1, `requests: ${aiRequests.length}`);
  const { context } = aiRequests[0];
  assert(context.videoId === 'oAja8-Ulz6o' && context.currentConcept === 'Insert in a Linked List (First & Last)', `concept "${context.currentConcept}" at ${context.currentTime}s (${context.timestamp}) · ${trace.join(' · ')}`);
  assert(context.currentTime >= 1100 && context.currentTime < 1500, `time ${context.currentTime}`);
  assert(context.upcomingConcepts[0] === 'Display/Print a Linked List', `upcoming ${context.upcomingConcepts}`);
  assert(context.transcriptWindow && context.transcriptWindow.text.length > 100 && context.transcriptWindow.text.length <= 2400, `transcript window: ${context.transcriptWindow?.text?.length}`);
  assert(context.playlist?.source === 'creator-playlist', `playlist: ${JSON.stringify(context.playlist)}`);
  assert((await yt.evaluate(() => localStorage.getItem('yt-player-caption-persistence'))) === persistence, 'YouTube caption preference changed');
  const ccAfter = await yt.evaluate(() => document.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed'));
  assert(ccAfter === ccBefore, `caption visibility changed (${ccBefore} → ${ccAfter})`);

  await yt.click(rail('.fs-ai-chip:has-text("Explain")'));
  await sleep(1500);
  assert(aiRequests.length === 1, `the same moment should be answered from cache (${aiRequests.length})`);

  await yt.fill(rail('.fs-ask input'), 'Why do we need the head reference?');
  await yt.press(rail('.fs-ask input'), 'Enter');
  await waitFor(async () => (await railText(yt.locator(rail('.fs-answer-text')))).includes('question: Why do we need the head reference?'), 'ask answer', 30000);
  assert(aiRequests[1]?.action === 'ask' && aiRequests[1].question === 'Why do we need the head reference?', 'ask request');
  await shot(yt, 'watch-ai-answer');
});

await step('"What am I learning?" works without any AI; other actions say AI is turned off', async () => {
  await storage.patchSettings({ ai: { provider: 'off', endpointUrl: AI_URL } });
  await sleep(800);
  const before = aiRequests.length;
  await atMoment(1700, 'Display/Print a Linked List');
  await yt.click(rail('.fs-ai-chip:has-text("What am I learning?")'));
  await waitFor(async () => (await railText(yt.locator(rail('.fs-answer-headline')))) !== '', 'local answer', 10000);
  const headline = await railText(yt.locator(rail('.fs-answer-headline')));
  const title = await railText(yt.locator(rail('.fs-learning-title')));
  assert(headline === title, `headline "${headline}" vs current concept "${title}" at ${await yt.evaluate(() => document.querySelector('#movie_player video')?.currentTime)}s`);
  await yt.click(rail('.fs-ai-chip:has-text("Example")'));
  await waitFor(async () => (await slotText('watch')).includes('AI is turned off'), 'honest fallback', 20000);
  assert(aiRequests.length === before, 'no AI request when AI is off');
});

await step('Search keeps the space: unrelated results hidden, library matches first', async () => {
  const marker = await markPage();
  const box = yt.locator('input[name="search_query"], input.ytSearchboxComponentInput').first();
  await box.fill('next greater element');
  await box.press('Enter');
  await yt.waitForURL(/results\?search_query=next/, { timeout: 20000 });
  await waitFor(async () => (await slotText('search')).includes('In your DSA library'), 'search strip with library hits', 20000);
  assert((await pageMarker()) === marker, 'search reloaded the page');
  await waitFor(() => yt.evaluate(() => document.querySelectorAll('ytd-search [data-fs-rel]').length > 3), 'results marked');
  const visibleOff = await yt.evaluate(() => [...document.querySelectorAll('ytd-search [data-fs-rel="off"]')].filter((e) => e.getClientRects().length).length);
  assert(visibleOff === 0, `${visibleOff} unrelated results still visible`);
  await shot(yt, 'search');
});

await step('Shorts open as a regular video; channel Shorts tab hidden', async () => {
  await yt.goto('https://www.youtube.com/shorts/aqz-KE-bpKQ', { waitUntil: 'domcontentloaded' });
  await yt.waitForURL(/watch\?v=aqz-KE-bpKQ/, { timeout: 20000 });
  await yt.goto('https://www.youtube.com/@freecodecamp', { waitUntil: 'domcontentloaded' });
  await yt.waitForSelector('yt-tab-shape', { timeout: 20000 });
  await sleep(1500);
  const tab = await displayOf('yt-tab-shape[tab-title="Shorts"]');
  assert(tab === 'none' || tab === null, `Shorts tab display ${tab}`);
});

console.log('\nSpaces');

/** Adds a suggested Space the way a learner does: from the suggestions in the Space manager. */
async function addSuggestedSpace(name) {
  await ext.goto(`${EXT}/dashboard.html#/modes`);
  await ext.locator(`button:has-text("${name}")`).first().click();
  await waitFor(async () => ((await storage.get(['modes'])).modes ?? []).some((m) => m.name === name), `${name} added`, 10000);
}

await step('A new install owns only the Space it picked; the rest are suggestions', async () => {
  const { modes } = await storage.get(['modes']);
  assert(modes.length === 1 && modes[0].id === 'dsa', `owned spaces: ${modes.map((m) => m.id)}`);
});

await step('Switch space from the YouTube sidebar — same tab, new feed', async () => {
  await addSuggestedSpace('AI / ML');
  await yt.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await yt.locator('focusspace-slot[data-slot="guide"] button:has-text("AI / ML")').count()) > 0, 'FocusSpace section in the sidebar', 20000);
  await shot(yt, 'sidebar');
  const marker = await markPage();
  const pages = context.pages().length;
  await yt.click('focusspace-slot[data-slot="guide"] button:has-text("AI / ML")');
  await waitFor(async () => (await yt.locator(home('.fs-space-button')).textContent())?.includes('AI / ML'), 'AI / ML home', 15000);
  assert((await pageMarker()) === marker && context.pages().length === pages, 'space switch reloaded or opened a tab');
  await waitFor(async () => (await yt.locator(home('.fs-vcard')).count()) >= 3, 'AI / ML videos', 30000);
  const titles = await yt.locator(home('.fs-vcard .fs-vcard-title')).allTextContents();
  assert(!titles.some((t) => /Stack and Queue Playlist|Leetcode \d+/i.test(t)), 'DSA videos leaked into AI / ML');
});

await step('Create a space from one sentence: "Punjabi music" + channel search "Karan"', async () => {
  await yt.click(home('.fs-space-button'));
  await yt.click(home('.fs-menu button:has-text("New space")'));
  const modal = yt.locator('focusspace-slot[data-slot="overlay"] .fs-modal');
  await modal.locator('#fs-intent').fill('Punjabi music');
  await modal.locator('button:has-text("Continue")').click();
  await waitFor(async () => (await modal.locator('input[aria-label="Space name"]').inputValue()) === 'Punjabi Music', 'inferred name');
  const understood = await modal.locator('.fs-tag').allTextContents();
  assert(understood.some((t) => t.includes('Punjabi Songs')), `understood: ${understood}`);
  await modal.locator('input[aria-label="Search YouTube channels"]').fill('Karan');
  await waitFor(async () => (await modal.locator('.fs-channel-result').count()) > 2, 'real channel suggestions for "Karan"', 20000);
  const suggestions = await modal.locator('.fs-channel-result').allTextContents();
  assert(suggestions.some((s) => /karan/i.test(s)), `suggestions: ${suggestions.slice(0, 3)}`);
  await shot(yt, 'create-space');
  await modal.locator('.fs-channel-result').first().click();
  await modal.locator('button:has-text("Create space")').click();
  await waitFor(async () => (await yt.locator(home('.fs-space-button')).textContent())?.includes('Punjabi Music'), 'new space active', 15000);
  const { modes } = await storage.get(['modes']);
  const space = modes.find((m) => m.name === 'Punjabi Music');
  assert(space && space.kind === 'media' && space.allowedChannels.length === 1 && space.icon === 'music', `stored space: ${JSON.stringify(space)?.slice(0, 200)}`);
  await waitFor(async () => (await yt.locator(home('.fs-vcard, .fs-spotlight')).count()) >= 3, 'Punjabi music videos', 40000);
  await shot(yt, 'punjabi-music-home');
});

await step('Without an account, a 4th Space is refused with the guest limit — and deleting one makes room', async () => {
  // DSA, AI / ML and Punjabi Music: the 3 a guest may keep.
  assert((await storage.get(['modes'])).modes.length === 3, 'expected three spaces');
  await ext.goto(`${EXT}/dashboard.html#/modes`);
  await ext.locator('button:has-text("Web Development")').first().click();
  await ext.waitForSelector('text=Without an account, FocusSpace keeps 3 Spaces', { timeout: 10000 });
  assert(!(await storage.get(['modes'])).modes.some((m) => m.name === 'Web Development'), 'the 4th space was created');
  await ext.locator('button[aria-label="Delete Punjabi Music"]').click();
  await ext.locator('button:has-text("Delete space")').click();
  await waitFor(async () => (await storage.get(['modes'])).modes.length === 2, 'space deleted', 10000);
  await addSuggestedSpace('Web Development');
});

await step('Topic playlist: Web Development → HTML & CSS → add a video by link', async () => {
  await yt.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await yt.locator('focusspace-slot[data-slot="guide"] button:has-text("Web Development")').count()) > 0, 'Web Development in the sidebar', 20000);
  await yt.click('focusspace-slot[data-slot="guide"] button:has-text("Web Development")');
  await waitFor(async () => (await yt.locator(home('.fs-space-button')).textContent())?.includes('Web Development'), 'web dev');
  await yt.click(home('.fs-chips button:has-text("HTML & CSS")'));
  const form = yt.locator(home('.fs-playlist-add'));
  await form.locator('input').fill('https://www.youtube.com/watch?v=qz0aGYrrlhU');
  await form.locator('button').click();
  await waitFor(async () => (await yt.locator(home('.fs-playlist-list li')).count()) === 1, 'video added to playlist', 15000);
  await shot(yt, 'topic-playlist');
});

await step('Focus Mode off = normal YouTube', async () => {
  await storage.patchSettings({ focusEnabled: false });
  await waitFor(async () => (await displayOf('ytd-browse[page-subtype="home"] > ytd-two-column-browse-results-renderer')) !== 'none', 'YouTube feed visible');
  await waitFor(() => yt.evaluate(() => !document.querySelector('focusspace-slot[data-slot="guide"]')?.isConnected), 'sidebar section removed');
  // The switch is the only way back in when everything else is unmounted.
  const pillText = () => yt.evaluate(() => document.querySelector('focusspace-slot[data-slot="overlay"]')?.shadowRoot?.querySelector('.fs-off-pill')?.textContent ?? '');
  await waitFor(async () => (await pillText()).includes('Turn on'), 'the switch offers to turn FocusSpace on');
  await storage.patchSettings({ focusEnabled: true, activeModeId: 'dsa' });
  await waitFor(async () => (await yt.locator(home('.fs-space-button')).count()) === 1, 'focus back on');
  // And it stays, so Focus Mode can be turned off again without hunting for it.
  await waitFor(async () => (await pillText()).length > 0, 'the switch stays while FocusSpace is on');
});

console.log('\nExtension pages');

await step('Popup: toggle, space picker, "Open YouTube" reuses the tab', async () => {
  const popup = await context.newPage();
  trackErrors(popup, 'ext:popup');
  await popup.setViewportSize({ width: 368, height: 560 });
  await popup.goto(`${EXT}/popup.html`);
  await popup.waitForSelector('text=Focus Mode on');
  assert(!(await popup.textContent('body')).match(/session/i), 'popup still shows sessions');
  await shot(popup, 'popup');
  await popup.click('.fs-dropdown-trigger');
  await popup.click('.fs-dropdown-item:has-text("DSA")');
  await waitFor(async () => (await storage.get(['settings'])).settings.activeModeId === 'dsa', 'space switched from popup');
  const ytTabs = youtubePages().length;
  await popup.click('button:has-text("Open YouTube")').catch(() => undefined);
  await sleep(1500);
  assert(youtubePages().length === ytTabs, `Open YouTube created a tab (${ytTabs} → ${youtubePages().length})`);
  if (!popup.isClosed()) await popup.close();
});

await step('Space manager: spaces, one-sentence creation with channel search, simple editor', async () => {
  await ext.goto(`${EXT}/dashboard.html#/modes`);
  await ext.waitForSelector('text=Spaces');
  // A guest holds 3 Spaces at most; make room for the one this step creates.
  await ext.locator('button[aria-label="Delete AI / ML"]').click();
  await ext.locator('button:has-text("Delete space")').click();
  await waitFor(async () => !(await storage.get(['modes'])).modes.some((m) => m.name === 'AI / ML'), 'space deleted', 10000);
  await ext.click('button:has-text("New space")');
  await ext.fill('#fs-intent', 'System Design');
  await ext.click('.fs-modal button:has-text("Continue")');
  await ext.waitForSelector('.fs-modal .fs-tag:has-text("Low Level Design")');
  await ext.waitForSelector('.fs-modal .fs-channel-result', { timeout: 20000 });
  await ext.click('.fs-modal button:has-text("Create space")');
  await ext.waitForURL(/#\/modes\/system-design/);
  await ext.waitForSelector('text=What this space is about');
  await shot(ext, 'space-editor', { fullPage: true });
  await ext.goto(`${EXT}/dashboard.html#/subscriptions`);
  await ext.waitForSelector('.fs-channel-group', { timeout: 20000 });
  await ext.goto(`${EXT}/dashboard.html#/settings`);
  await ext.waitForSelector('text=Advanced filtering');
});

await step('Dashboard Home, Library and History open, and saved notes are listed', async () => {
  await ext.goto(`${EXT}/dashboard.html#/`);
  await ext.waitForSelector('text=Your Spaces');
  await ext.waitForSelector('text=AI study tools, on any video');
  await ext.goto(`${EXT}/dashboard.html#/library`);
  await ext.waitForSelector('h1:has-text("Library")');
  await ext.goto(`${EXT}/dashboard.html#/history`);
  await ext.waitForSelector('h1:has-text("History")');
  await ext.goto(`${EXT}/dashboard.html#/account`);
  await ext.waitForSelector('h1:has-text("Account")');
  await shot(ext, 'dashboard-history');
});

await step('Narrow YouTube window: home has no horizontal overflow', async () => {
  await yt.setViewportSize({ width: 900, height: 900 });
  await yt.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await waitFor(async () => (await yt.locator(home('.fs-vcard')).count()) > 2, 'home at 900px', 30000);
  const overflow = await yt.evaluate(() => { const h = document.querySelector('focusspace-slot[data-slot="home"]'); return h.scrollWidth - h.clientWidth; });
  assert(overflow <= 1, `overflow ${overflow}px`);
  await shot(yt, 'home-900');
});

await step('No extension errors in pages or on YouTube', async () => {
  assert(errors.length === 0, `errors:\n${errors.join('\n')}`);
});

await context.close();
aiServer.close();
rmSync(userDataDir, { recursive: true, force: true });

console.log(`\nTimings (ms): ${JSON.stringify(timings)}`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed · screenshots in e2e-artifacts/`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`- ${f.name}\n  ${f.error}`);
  process.exit(1);
}
