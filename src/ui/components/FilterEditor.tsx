import type { FilterConfig, FilterPrefs, FocusIntensity } from '@/types/domain';
import { presetConfig } from '@/modes/service';
import { Segmented, SettingRow, Switch } from './primitives';

const INTENSITY_HINT: Record<FocusIntensity, string> = {
  gentle: 'Hides Shorts and replaces the home feed. Everything else stays.',
  balanced: 'Also filters unrelated suggestions, end screens and Explore.',
  strict: 'Removes suggestions, comments and notifications entirely.',
  custom: 'Your own combination of the rules below.',
};

export function FilterEditor({ config, onChange }: { config: FilterConfig; onChange: (next: FilterConfig) => void }) {
  const set = <K extends keyof FilterPrefs>(key: K, value: FilterPrefs[K]) => onChange({ intensity: 'custom', filters: { ...config.filters, [key]: value } });
  const f = config.filters;

  return (
    <div className="fs-stack-sm" style={{ gap: 0 }}>
      <SettingRow title="Focus intensity" description={INTENSITY_HINT[config.intensity]}>
        <Segmented<FocusIntensity>
          label="Focus intensity"
          value={config.intensity}
          onChange={(v) => v !== 'custom' && onChange(presetConfig(v))}
          options={[
            { value: 'gentle', label: 'Gentle' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'strict', label: 'Strict' },
            ...(config.intensity === 'custom' ? [{ value: 'custom' as const, label: 'Custom' }] : []),
          ]}
        />
      </SettingRow>
      <SettingRow title="Hide Shorts" description="Removes Shorts shelves, tabs and the sidebar entry. Shorts links open as regular videos.">
        <Switch label="Hide Shorts" checked={f.hideShorts} onChange={(v) => set('hideShorts', v)} />
      </SettingRow>
      <SettingRow title="Replace the home feed" description="Show your FocusSpace learning home instead of “Recommended for you”.">
        <Switch label="Replace the home feed" checked={f.replaceHomeFeed} onChange={(v) => set('replaceHomeFeed', v)} />
      </SettingRow>
      <SettingRow title="Suggested videos next to the player" description="“Only relevant” hides suggestions with no connection to your mode's topics.">
        <Segmented
          label="Suggested videos"
          value={f.relatedVideos}
          onChange={(v) => set('relatedVideos', v)}
          options={[
            { value: 'show', label: 'Show' },
            { value: 'relevant', label: 'Only relevant' },
            { value: 'hide', label: 'Hide' },
          ]}
        />
      </SettingRow>
      <SettingRow title="Search results" description="Hide results that clearly don't match your space (and dim weak matches), or just dim them.">
        <Segmented
          label="Search results"
          value={f.searchResults}
          onChange={(v) => set('searchResults', v)}
          options={[
            { value: 'show', label: 'Show all' },
            { value: 'dim', label: 'Dim unrelated' },
            { value: 'focus', label: 'Hide unrelated' },
          ]}
        />
      </SettingRow>
      <SettingRow title="Hide end screens" description="End cards and the wall of suggestions when a video finishes. The player itself is untouched.">
        <Switch label="Hide end screens" checked={f.hideEndScreens} onChange={(v) => set('hideEndScreens', v)} />
      </SettingRow>
      <SettingRow title="Hide Explore & Trending" description="Explore, Trending, Shopping and “More from YouTube” in the sidebar. Those pages ask before opening.">
        <Switch label="Hide Explore and Trending" checked={f.hideExplore} onChange={(v) => set('hideExplore', v)} />
      </SettingRow>
      <SettingRow title="Hide comments" description="Keep attention on the lesson.">
        <Switch label="Hide comments" checked={f.hideComments} onChange={(v) => set('hideComments', v)} />
      </SettingRow>
      <SettingRow title="Hide notifications bell" description="No unread counts pulling you elsewhere.">
        <Switch label="Hide notifications bell" checked={f.hideNotifications} onChange={(v) => set('hideNotifications', v)} />
      </SettingRow>
    </div>
  );
}
