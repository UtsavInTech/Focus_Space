import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { sendMessage } from '@/messaging/runtime';
import { createPortal } from 'react-dom';
import { domAnimation, LazyMotion } from 'motion/react';
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
import { FocusPill } from './FocusPill';
import { WelcomeGuide } from './WelcomeGuide';
import { shouldShowAiEntry } from './ai-entry-visibility';
import { SurfaceBoundary } from './SurfaceBoundary';
import { ExamPicker } from './ExamPicker';
import { homeNav } from './home/nav';
import { syncFocusView } from './home/FullScreen';
import { examInfo, type ExamId } from '@/modes/exams';

const navigator = { go: spaNavigate };

export function ContentApp({ store, slots, controller }: { store: Store<ContentState>; slots: Slots; controller: Controller }) {
  useEffect(()=>{void sendMessage('institutes/sync',{force:true}).catch(()=>undefined);},[]);
  const s = useSyncExternalStore(store.subscribe, store.get);
  const [creating, setCreating] = useState(false);
  const [settingUpExam, setSettingUpExam] = useState<ExamId | null>(null);
  const mode = activeModeOf(s.settings, s.modes);
  const active = s.ready && s.settings.focusEnabled && !!mode;
  const config = effectiveFilters(s.settings, mode);
  // On youtube.com FocusSpace always follows YouTube's own light/dark theme.
  const theme = s.ytDark ? 'dark' : 'light';

  useEffect(() => {
    // With the cinema look on (the default), YouTube itself is dark here, so every slot follows it.
    Object.values(slots).forEach((slot) => slot.setTheme(theme, s.settings.density));
  }, [slots, theme, s.settings.density]);

  // In full screen, YouTube's top bar and sidebar are hidden on the FocusSpace home only: a video opened
  // from it plays on YouTube's normal watch page (still full screen), and the bars go again back home.
  const homeShown = active && config.filters.replaceHomeFeed && s.page.type === 'home';
  useEffect(() => syncFocusView(homeShown), [homeShown]);

  const assessment = useMemo(() => (active && mode && s.video?.meta ? localSidekick.assess({ mode, session: null, video: s.video.meta }) : null), [active, mode, s.video]);

  const nudge = active && s.settings.offTrackNudges && s.page.type === 'watch' && !!s.video && assessment?.verdict === 'off-track' && !s.dismissedNudges.includes(s.video.id);

  useEffect(() => {
    controller.holdPlayback(nudge && config.intensity === 'strict');
  }, [controller, nudge, config.intensity, s.video?.id]);

  if (!s.ready) return null;

  const exploreGate = active && config.filters.hideExplore && s.page.type === 'explore' && !s.exploreAllowed.includes(s.page.path);
  const openCreate = () => setCreating(true);

  // The AI entry point follows Focus Mode exactly like every other FocusSpace surface: FocusSpace OFF means
  // no FocusSpace UI at all, AI included. See ai-entry-visibility.ts for the (independently tested) rule.
  const showAiEntry = shouldShowAiEntry(active, s.page.type);

  return (
    // Motion's small DOM feature set, loaded once for every FocusSpace surface on youtube.com: the
    // components use `m.*`, so the full animation engine never ships in this content script.
    <LazyMotion features={domAnimation}>
    <NavigatorContext.Provider value={navigator}>
      <YouTubeDataContext.Provider value={pageYouTubeData}>
        <OverlayRootContext.Provider value={slots.overlay.container}>
          {((active && config.filters.replaceHomeFeed) || (s.ready && needsFirstSpace(s.settings, s.modes))) && s.homeVisited && createPortal(<SurfaceBoundary feature="home" failOpen="home"><SpaceHome settings={s.settings} modes={s.modes} onCreateSpace={openCreate} /></SurfaceBoundary>, slots.home.container)}

          {active &&
            mode &&
            s.page.type === 'watch' &&
            s.video &&
            createPortal(
              <SurfaceBoundary feature="watch-rail" failOpen="related-hide">
                <WatchRail mode={mode} settings={s.settings} video={s.video} watch={s.watch} assessment={assessment} policy={config.filters.relatedVideos} showingNative={s.showNativeRelated} onToggleNative={controller.toggleNativeRelated} />
              </SurfaceBoundary>,
              slots.watch.container,
            )}

          {active &&
            mode &&
            s.page.type === 'search' &&
            config.filters.searchResults !== 'show' &&
            createPortal(<SurfaceBoundary feature="search" failOpen="search-focus" quiet><SearchStrip mode={mode} query={s.page.query ?? ''} stats={s.searchStats} revealed={s.searchReveal} onToggleReveal={controller.toggleSearchReveal} /></SurfaceBoundary>, slots.search.container)}

          {active && createPortal(<SurfaceBoundary feature="sidebar" quiet><GuideSpaces settings={s.settings} modes={s.modes} onCreate={openCreate} /></SurfaceBoundary>, slots.guide.container)}

          {showAiEntry && mode && createPortal(<SurfaceBoundary feature="masthead" quiet><AiEntry settings={s.settings} mode={mode} pageType={s.page.type} /></SurfaceBoundary>, slots.aiEntry.container)}

          {nudge && mode && assessment && s.video && (
            <OffTrackNudge key={s.video.id} mode={mode} assessment={assessment} strict={config.intensity === 'strict'} channel={s.video.meta} onStay={controller.stayFocused} onWatch={() => controller.watchAnyway(s.video!.id)} />
          )}

          {exploreGate && mode && <ExploreGate mode={mode} onAllow={() => controller.allowExplore(s.page.path)} />}

          {/* Focus Mode off: YouTube is untouched, and this is the only way back in. */}
          {/* Always there: the switch is how Focus Mode goes off as well as on. */}
          {s.ready && <FocusPill on={s.settings.focusEnabled} />}

          {/* Full screen away from the home: the Space bar's Exit button is not there, so this is. */}

          {/* The first-run guide. With FocusSpace switched off there is nothing on the page for it to point at. */}
          {/* Not on a watch page, where it would sit on the player's controls; it is there again on the way back. */}
          {s.settings.focusEnabled && s.page.type !== 'watch' && <WelcomeGuide settings={s.settings} modes={s.modes} />}

          <Modal open={creating} onClose={() => setCreating(false)} title="New space" width={580}>
            <CreateSpace
              modes={s.modes}
              current={mode}
              onExam={(id) => {
                setCreating(false);
                setSettingUpExam(id);
              }}
              onAddedInside={(modeId, topicId) => {
                setCreating(false);
                homeNav.set({ modeId, topicId });
                spaNavigate('/');
              }}
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                spaNavigate('/');
              }}
            />
          </Modal>

          {/* An exam or course picked from "New space": its own short setup (subjects, year, teachers). */}
          <Modal open={!!settingUpExam} onClose={() => setSettingUpExam(null)} title={settingUpExam ? `Set up ${examInfo(settingUpExam)?.label}` : 'Set up'} subtitle="A couple of quick choices, then your Space is ready." width={720}>
            {settingUpExam && (
              <ExamPicker
                initialExam={settingUpExam}
                onChosen={() => {
                  setSettingUpExam(null);
                  spaNavigate('/');
                }}
              />
            )}
          </Modal>
        </OverlayRootContext.Provider>
      </YouTubeDataContext.Provider>
    </NavigatorContext.Provider>
    </LazyMotion>
  );
}
