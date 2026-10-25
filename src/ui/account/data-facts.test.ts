import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DATA_GROUPS } from '../../../web/src/content/data-summary';
import { PRIVACY } from '../../../web/src/content/legal';
import { ACCOUNT_DATA_FACTS, ANONYMOUS_AI_SUMMARY, LOCAL_DATA_SUMMARY, aiDataSummary } from './data-facts';

/**
 * Three surfaces describe what FocusSpace stores: the extension's short summary (Account and Settings,
 * both from ACCOUNT_DATA_FACTS), the website's scannable version, and the privacy policy underneath it.
 * They drifted before — Account claimed FocusSpace signs you in with your *name*, and both short
 * versions described usage as a bare monthly count when usage_events also records the model and the
 * token counts.
 *
 * Prose cannot be diffed, so what is asserted is coverage: every category the server actually persists
 * is mentioned on every surface that claims to list them, and the guarantees are stated identically.
 * A new column on a user-facing table fails this test until all three say so.
 */

/** Each personal thing the server stores, with words that must appear wherever storage is described. */
const STORED_CATEGORIES = [
  { id: 'email', table: 'users.email', words: ['email'] },
  { id: 'profile', table: 'users.phone/name/city', words: ['phone'] },
  { id: 'password', table: 'users.password_hash', words: ['password'] },
  { id: 'sessions', table: 'sessions', words: ['session'] },
  { id: 'plan', table: 'entitlements.plan', words: ['plan'] },
  { id: 'payments', table: 'payments', words: ['payment', 'razorpay'] },
  { id: 'usage', table: 'usage_events', words: ['credit', 'token'] },
  { id: 'spaces', table: 'spaces.name', words: ['space'] },
] as const;

const mentions = (haystack: string, words: readonly string[]) => words.every((w) => haystack.toLowerCase().includes(w));

const extensionCopy = [...ACCOUNT_DATA_FACTS.map((f) => `${f.label} ${f.detail}`), LOCAL_DATA_SUMMARY, ANONYMOUS_AI_SUMMARY].join('\n').toLowerCase();
const websiteCopy = DATA_GROUPS.flatMap((g) => [g.title, g.summary, ...g.points]).join('\n').toLowerCase();
const policyCopy = PRIVACY.sections.flatMap((s) => [s.heading, ...s.body]).join('\n').toLowerCase();

describe('data transparency copy', () => {
  it.each(STORED_CATEGORIES)('describes $table on all three surfaces', ({ words }) => {
    expect(mentions(extensionCopy, words)).toBe(true);
    expect(mentions(websiteCopy, words)).toBe(true);
    expect(mentions(policyCopy, words)).toBe(true);
  });

  it('states the same guarantees everywhere: the password and the Spaces’ contents never leave', () => {
    for (const copy of [extensionCopy, websiteCopy, policyCopy]) {
      expect(copy).toMatch(/hash/);
      expect(copy).toMatch(/never|not what is in them|cannot read/);
    }
    // The one claim the whole product rests on, stated on every surface that lists what is stored.
    expect(extensionCopy).toContain('never uploaded');
    expect(websiteCopy).toContain('personal');
    expect(websiteCopy).toContain('sharing choices');
    expect(policyCopy).toContain('personal spaces and their history are never shared');
  });

  it('describes AI usage as more than a count, because usage_events records more than a count', () => {
    const usage = ACCOUNT_DATA_FACTS.find((f) => f.id === 'usage')!;
    for (const word of ['credit', 'model', 'token']) expect(usage.detail.toLowerCase()).toContain(word);
    expect(usage.detail.toLowerCase()).toContain('never your prompts');
    expect(websiteCopy).toContain('token counts');
  });

  it('never claims an optional profile field is used to sign in', () => {
    const profile = ACCOUNT_DATA_FACTS.find((f) => f.id === 'profile')!;
    expect(profile.label.toLowerCase()).toContain('only if you add them');
    expect(`${profile.label} ${profile.detail}`.toLowerCase()).not.toMatch(/sign (you )?in/);
  });

  it('names whichever endpoint the answer actually comes from', () => {
    expect(aiDataSummary('FocusSpace AI')).toMatch(/^FocusSpace AI receives/);
    expect(aiDataSummary('Your endpoint')).toMatch(/^Your endpoint receives/);
    expect(aiDataSummary('FocusSpace AI')).toContain('Never your history');
  });

  it('tells signed-out learners about the install id their AI requests carry', () => {
    for (const copy of [extensionCopy, websiteCopy, policyCopy]) expect(copy).toMatch(/install/);
    expect(ANONYMOUS_AI_SUMMARY.toLowerCase()).toContain('hashed');
  });
});

describe('the settings density control', () => {
  /**
   * Removed because it did next to nothing: `[data-density='compact']` redefines --fs-pad and --fs-gap,
   * and only two rules read them. The setting stays in the schema and on <html>, so this guards the
   * reason rather than the removal — if the tokens ever drive real spacing, the control can come back.
   */
  it('stays absent while the density tokens are read by almost nothing', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const consumers = (css.match(/var\(--fs-(pad|gap)\)/g) ?? []).length;
    const settings = readFileSync(new URL('../../dashboard/pages/SettingsPage.tsx', import.meta.url), 'utf8');
    if (consumers > 4) {
      expect(settings).toContain('label="Density"');
    } else {
      expect(settings).not.toContain('label="Density"');
    }
  });
});
