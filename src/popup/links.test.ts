import { describe, expect, it } from 'vitest';
import { DASHBOARD_HOME, POPUP_LINKS } from './links';

/**
 * A regression test for a navigation bug that was invisible in types: "FocusSpace Home" in the popup
 * opened the public marketing website instead of the learner's own dashboard home. Nothing about that is
 * a type error, and nothing about it fails a build — so it is asserted here.
 */

describe('popup links', () => {
  it('sends “FocusSpace Home” to the extension dashboard home, never the website', () => {
    const home = POPUP_LINKS.find((l) => l.id === 'home');
    expect(home).toBeDefined();
    expect(home!.surface).toBe('dashboard');
    expect(home!.target).toBe(DASHBOARD_HOME);
  });

  it('keeps every popup link inside the extension — the popup is workspace navigation, not marketing', () => {
    expect(POPUP_LINKS.every((l) => l.surface === 'dashboard')).toBe(true);
  });

  it('points each remaining link at a real dashboard route', () => {
    // The routes DashboardApp's switch actually understands.
    const routes = new Set(['/', '/library', '/history', '/modes', '/subscriptions', '/account', '/settings']);
    for (const link of POPUP_LINKS) {
      expect(link.label.trim()).not.toBe('');
      expect(routes.has(link.target.split('?')[0])).toBe(true);
    }
  });

  it('has no duplicate ids or targets', () => {
    expect(new Set(POPUP_LINKS.map((l) => l.id)).size).toBe(POPUP_LINKS.length);
    expect(new Set(POPUP_LINKS.map((l) => l.target)).size).toBe(POPUP_LINKS.length);
  });
});
