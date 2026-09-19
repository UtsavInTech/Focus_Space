import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { activeModeOf, effectiveFilters, needsFirstSpace } from '@/modes/service';
import { localSidekick } from '@/ai/sidekick';
import { OverlayRootContext, Modal } from '@/ui/components/Modal';
import { CreateSpace } from '@/ui/components/CreateSpace';
import { NavigatorContext } from '@/ui/nav';
import { YouTubeDataContext } from '@/ui/data';
import type { ContentState, Store } from '../store';
import type { Controller, Slots } from '../controller';
import { spaNavigate } from '../youtube/spa';
import { pageYouTubeData } from '../data/youtube';
import { SpaceHome } from './SpaceHome';
import { WatchRail } from './WatchRail';
import { SearchStrip } from './SearchStrip';
import { GuideSpaces } from './GuideSpaces';
import { ExploreGate, OffTrackNudge } from './Overlays';
import { AiEntry } from './AiEntry';
import { FocusOffPill } from './FocusOffPill';

const navigator = { go: spaNavigate };

export function ContentApp({ store, slots, controller }: { store: Store<ContentState>; slots: Slots; controller: Controller }) {
  const s = useSyncExternalStore(store.subscribe, store.get);
  const [creating, setCreating] = useState(false);
  const mode = activeModeOf(s.settings, s.modes);
  const active = s.ready && s.settings.focusEnabled && !!mode;
  const config = effectiveFilters(s.settings, mode);
  // On youtube.com FocusSpace always follows YouTube's own light/dark theme.
  const theme = s.ytDark ? 'dark' : 'light';

  useEffect(() => {
    Object.values(slots).forEach((slot) => slot.setTheme(theme, s.settings.density));
  }, [slots, theme, s.settings.density]);

  const assessment = useMemo(() => (active && mode && s.video?.meta ? localSidekick.assess({ mode, session: null, video: s.video.meta }) : null), [active, mode, s.video]);

  const nudge = active && s.settings.offTrackNudges && s.page.type === 'watch' && !!s.video && assessment?.verdict === 'off-track' && !s.dismissedNudges.includes(s.video.id);

  useEffect(() => {
    controller.holdPlayback(nudge && config.intensity === 'strict');
  }, [controller, nudge, config.intensity, s.video?.id]);

  if (!s.ready) return null;

  const exploreGate = active && config.filters.hideExplore && s.page.type === 'explore' && !s.exploreAllowed.includes(s.page.path);
  const openCreate = () => setCreating(true);

  // A persistent AI entry point everywhere except where "Learn with AI" already sits at the top of the watch rail.
  const showAiEntry = !!mode && !(active && s.page.type === 'watch');

  return (
    <NavigatorContext.Provider value={navigator}>
      <YouTubeDataContext.Provider value={pageYouTubeData}>
        <OverlayRootContext.Provider value={slots.overlay.container}>
          {((active && config.filters.replaceHomeFeed) || (s.ready && needsFirstSpace(s.settings, s.modes))) && s.homeVisited && createPortal(<SpaceHome settings={s.settings} modes={s.modes} onCreateSpace={openCreate} />, slots.home.container)}

          {active &&
            mode &&
            s.page.type === 'watch' &&
            s.video &&
            createPortal(
              <WatchRail mode={mode} settings={s.settings} video={s.video} watch={s.watch} assessment={assessment} policy={config.filters.relatedVideos} showingNative={s.showNativeRelated} onToggleNative={controller.toggleNativeRelated} />,
              slots.watch.container,
            )}

          {active &&
            mode &&
            s.page.type === 'search' &&
            config.filters.searchResults !== 'show' &&
            createPortal(<SearchStrip mode={mode} query={s.page.query ?? ''} stats={s.searchStats} revealed={s.searchReveal} onToggleReveal={controller.toggleSearchReveal} />, slots.search.container)}

          {active && createPortal(<GuideSpaces settings={s.settings} modes={s.modes} onCreate={openCreate} />, slots.guide.container)}

          {showAiEntry && mode && createPortal(<AiEntry settings={s.settings} mode={mode} pageType={s.page.type} />, slots.aiEntry.container)}

          {nudge && mode && assessment && s.video && (
            <OffTrackNudge key={s.video.id} mode={mode} assessment={assessment} strict={config.intensity === 'strict'} channel={s.video.meta} onStay={controller.stayFocused} onWatch={() => controller.watchAnyway(s.video!.id)} />
          )}

          {exploreGate && mode && <ExploreGate mode={mode} onAllow={() => controller.allowExplore(s.page.path)} />}

          {/* Focus Mode off: YouTube is untouched, and this is the only way back in. */}
          {!s.settings.focusEnabled && <FocusOffPill />}

          <Modal open={creating} onClose={() => setCreating(false)} title="New space" width={580}>
            <CreateSpace
              modes={s.modes}
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                spaNavigate('/');
              }}
            />
          </Modal>
        </OverlayRootContext.Provider>
      </YouTubeDataContext.Provider>
    </NavigatorContext.Provider>
  );
}
