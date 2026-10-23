import { describe, expect, it } from 'vitest';
import { checkLayout, recentIssues, recordIssues, type LayoutContext } from './health';

/** A tiny stand-in for YouTube's page: which selectors match. */
const page = (present: string[]) => ({ querySelector: (s: string) => (present.includes(s) ? ({} as Element) : null) }) as unknown as ParentNode;

const ok = ['#masthead-container, ytd-masthead', 'ytd-masthead#masthead #end #buttons'];
const base: LayoutContext = { page: 'home', homeReplaced: true, active: true, mounted: { home: true, watch: true, search: true }, searchFiltered: false };

describe('YouTube layout health', () => {
  it('finds nothing wrong on a page with every anchor', () => {
    expect(checkLayout(page([...ok, 'ytd-browse[page-subtype="home"]']), base)).toEqual([]);
  });

  it('flags the home when YouTube renames its home container, or the FocusSpace home never showed', () => {
    expect(checkLayout(page(ok), base)).toEqual(['home']);
    expect(checkLayout(page([...ok, 'ytd-browse[page-subtype="home"]']), { ...base, mounted: { ...base.mounted, home: false } })).toEqual(['home']);
  });

  it('flags the watch rail and player, but only while FocusSpace is active', () => {
    const watch = { ...base, page: 'watch' as const, mounted: { ...base.mounted, watch: false } };
    expect(checkLayout(page([...ok, 'ytd-watch-flexy']), watch).sort()).toEqual(['player', 'watch-rail']);
    expect(checkLayout(page([...ok, 'ytd-watch-flexy']), { ...watch, active: false })).toEqual([]);
  });

  it('keeps one row per feature, and reports only what broke in the last day', () => {
    const day = 86_400_000;
    let health = recordIssues({ issues: [] }, ['home'], 0);
    health = recordIssues(health, ['home', 'player'], day * 2);
    expect(health.issues.find((r) => r.feature === 'home')?.count).toBe(2);
    expect(recentIssues(health, day * 2 + 1000).sort()).toEqual(['home', 'player']);
    expect(recentIssues(health, day * 4)).toEqual([]);
  });
});
