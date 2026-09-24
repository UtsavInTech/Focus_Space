import type { PageType } from '@/integrations/youtube/urls';

/**
 * Whether the FocusSpace AI bubble should be portalled onto the page right now.
 *
 * Pulled out of ContentApp.tsx as its own pure function so the FocusSpace-OFF regression (the AI staying
 * visible/usable while Focus Mode was off, because this used to check only "is there a Space" and never
 * "is FocusSpace active") has a test that doesn't need a DOM or a React renderer — this repo's test setup
 * is unit/logic-only (no React Testing Library / jsdom environment configured), so a pure predicate is
 * what makes this behavior verifiable at all without adding a new test framework for one component.
 *
 * `active` already means "FocusSpace is on and a Space exists" (see modes/service.ts's `activeModeOf`
 * combined with `settings.focusEnabled` in ContentApp.tsx) — FocusSpace OFF must mean no FocusSpace UI at
 * all, AI included, exactly like every other surface (WatchRail, SearchStrip, GuideSpaces, SpaceHome).
 * The watch page is the one exception while active: "Learn with AI" already sits at the top of the watch
 * rail there, so the floating bubble would be a redundant second entry point.
 */
export function shouldShowAiEntry(active: boolean, pageType: PageType): boolean {
  return active && pageType !== 'watch';
}
