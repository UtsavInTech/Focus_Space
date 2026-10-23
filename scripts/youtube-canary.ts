// Daily YouTube canary: loads real youtube.com (signed out, no extension) and checks that every element
// FocusSpace hangs on still exists — the same list the extension checks on the learner's page
// (src/content/youtube/health.ts → CRITICAL_ANCHORS). When YouTube renames something, this run fails and
// GitHub emails the repository's owners, usually before learners notice anything.
//
//   npx vite-node scripts/youtube-canary.ts            (needs: npx playwright install chromium)
//
// Exit code 1 with the broken features listed when an anchor is gone. YouTube sometimes serves a
// consent page or an experiment; a failure is retried once before it counts.
import { chromium, type Page } from 'playwright';
import { CRITICAL_ANCHORS } from '../src/content/youtube/health';

const PAGES = {
  home: 'https://www.youtube.com/',
  // "Me at the zoo": the first YouTube video, as stable as anything there.
  watch: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  search: 'https://www.youtube.com/results?search_query=data+structures+tutorial',
} as const;

async function missing(page: Page, kind: keyof typeof PAGES): Promise<string[]> {
  await page.goto(PAGES[kind], { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // Dismiss a cookie-consent wall if one is shown (EU runners).
  await page.locator('button:has-text("Accept all"), button:has-text("Reject all")').first().click({ timeout: 4000 }).catch(() => undefined);
  await page.waitForTimeout(8000);
  const broken: string[] = [];
  for (const anchor of CRITICAL_ANCHORS.filter((a) => a.page === kind || a.page === 'any')) {
    const found = await page.evaluate((selectors) => selectors.some((s) => {
      try {
        return !!document.querySelector(s);
      } catch {
        return false;
      }
    }), anchor.selectors);
    if (!found) broken.push(`${anchor.feature} (${kind}): none of ${anchor.selectors.join(' | ')}`);
  }
  return broken;
}

// CANARY_CHANNEL=chrome uses an installed Google Chrome instead of Playwright's Chromium (handy locally).
const browser = await chromium.launch({ headless: true, channel: process.env.CANARY_CHANNEL || undefined });
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const failures: string[] = [];
for (const kind of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
  let broken = await missing(page, kind).catch((err) => [`${kind}: page did not load (${err instanceof Error ? err.message : err})`]);
  if (broken.length) broken = await missing(page, kind).catch((err) => [`${kind}: page did not load (${err instanceof Error ? err.message : err})`]);
  console.log(`${broken.length ? '✗' : '✓'} ${kind}`);
  failures.push(...broken);
}
await browser.close();

if (failures.length) {
  console.error(`\nYouTube changed something FocusSpace relies on:\n- ${failures.join('\n- ')}\n\nUpdate src/content/youtube/selectors.ts (add the new selector as a fallback, keep the old one).`);
  process.exit(1);
}
console.log('\nAll FocusSpace anchors found on youtube.com.');
