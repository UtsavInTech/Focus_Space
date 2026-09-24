import { describe, expect, it } from 'vitest';
import { DEFAULT_MODES } from './templates';
import { OWN_CATEGORY, SPACE_CATEGORIES, categoryOf, groupByCategory, uncategorizedDefaults } from './categories';

/**
 * Categories are presentation only, so the thing worth testing is that they cannot quietly lose a Space:
 * every built-in must be offered somewhere, no id may appear twice, and a Space the learner created —
 * or a built-in added later and not yet categorised — must still come out of grouping.
 */

describe('space categories', () => {
  it('claims every built-in mode exactly once', () => {
    expect(uncategorizedDefaults()).toEqual([]);
    const all = SPACE_CATEGORIES.flatMap((c) => c.modeIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('never invents a mode id that does not exist', () => {
    const known = new Set(DEFAULT_MODES.map((m) => m.id));
    for (const category of SPACE_CATEGORIES) for (const id of category.modeIds) expect(known.has(id)).toBe(true);
  });

  it('groups the built-ins without dropping any', () => {
    const groups = groupByCategory(DEFAULT_MODES);
    const grouped = groups.flatMap((g) => g.modes.map((m) => m.id));
    expect(new Set(grouped)).toEqual(new Set(DEFAULT_MODES.map((m) => m.id)));
    expect(grouped).toHaveLength(DEFAULT_MODES.length);
    expect(groups.some((g) => g.category.id === OWN_CATEGORY.id)).toBe(false);
  });

  it('puts a learner-created Space under “Your own” rather than losing it', () => {
    const custom = { ...DEFAULT_MODES[0], id: 'my-own-space', name: 'Punjabi music' };
    const groups = groupByCategory([...DEFAULT_MODES, custom]);
    const last = groups[groups.length - 1];
    expect(last.category.id).toBe(OWN_CATEGORY.id);
    expect(last.modes.map((m) => m.id)).toEqual(['my-own-space']);
    expect(categoryOf('my-own-space')).toBeNull();
  });

  it('orders modes inside a category the way the category declares them', () => {
    const technical = SPACE_CATEGORIES.find((c) => c.id === 'technical')!;
    const shuffled = [...DEFAULT_MODES].reverse();
    const group = groupByCategory(shuffled).find((g) => g.category.id === 'technical')!;
    expect(group.modes.map((m) => m.id)).toEqual([...technical.modeIds]);
  });

  it('drops empty categories instead of showing an empty heading', () => {
    const onlyDsa = DEFAULT_MODES.filter((m) => m.id === 'dsa');
    const groups = groupByCategory(onlyDsa);
    expect(groups).toHaveLength(1);
    expect(groups[0].category.id).toBe('technical');
  });

  it('handles an empty list', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
