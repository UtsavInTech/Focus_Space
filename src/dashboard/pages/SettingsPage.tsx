import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, Keyboard, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import type { AiSettings, Settings } from '@/types/domain';
import type { NoteLanguage } from '@/types/notes';
import type { AiStatus } from '@/learning/ai/service';
import { downloadOnDeviceModel } from '@/ai/on-device';
import { HOSTED_AI_LABEL, usesHostedAi } from '@/config';
import { FREE_SPACE_LIMIT, GUEST_SPACE_LIMIT } from '@/billing/plans';
import { sendMessage } from '@/messaging/runtime';
import { accountIdentity, useAccountFlow } from '@/ui/account/flow';
import { ACCOUNT_DATA_FACTS, aiDataSummary, ANONYMOUS_AI_SUMMARY, LOCAL_DATA_SUMMARY } from '@/ui/account/data-facts';
import { planLabel } from '@/billing/plans';
import type { DashboardData } from '../DashboardApp';
import { navigate } from '../router';
import { Section, patch, isHttpUrl } from './section';
import { setItem } from '@/storage/storage';
import { setFocusEnabled } from '@/modes/service';
import { Button, Segmented, SettingRow, Switch, TextInput } from '@/ui/components/primitives';
import { FilterEditor } from '@/ui/components/FilterEditor';
import { Modal } from '@/ui/components/Modal';

/**
 * Settings, grouped the way a learner thinks about FocusSpace: their account,
 * their learning, the companion, their spaces, their data. Flat sections with
 * hairline separators rather than stacked cards — the page should read as one
 * document, not a control panel.
 *
 * Account state lives in the shared hook (src/ui/account/flow.ts), the same one
 * the in-YouTube account panel uses, so the two never diverge.
 */



/* ─── FocusSpace AI ────────────────────────────────────────────────────────── */

const LANGUAGE_OPTIONS: { value: NoteLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish' },
];

function AiSection({ settings }: { settings: Settings }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [url, setUrl] = useState(settings.ai.endpointUrl);
  const [download, setDownload] = useState<{ progress: number; error?: string } | null>(null);
  const refresh = useCallback(() => {
    sendMessage('ai/status', {})
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(refresh, [refresh, settings.ai.provider, settings.ai.endpointUrl]);
  useEffect(() => setUrl(settings.ai.endpointUrl), [settings.ai.endpointUrl]);

  const setAi = (p: Partial<AiSettings>) => patch({ ai: { ...settings.ai, ...p } });
  const trimmed = url.trim();
  // A store install uses FocusSpace AI; the personal-endpoint controls stay only for someone who already set one.
  const hosted = usesHostedAi(settings.ai.endpointUrl);
  const showEndpoint = !hosted || settings.ai.provider === 'endpoint';
  // Typed but not saved yet: the status line reflects *saved* settings, so without this a learner can
  // see a full URL in the box right next to "Add your endpoint URL."
  const unsavedUrl = trimmed !== settings.ai.endpointUrl && (settings.ai.provider === 'endpoint' || settings.ai.provider === 'auto');
  const statusText =
    settings.ai.provider === 'off'
      ? 'Off. The video outline and “What am I learning?” still work without AI.'
      : unsavedUrl
        ? trimmed
          ? 'Click Save to use this endpoint.'
          : 'Add your endpoint URL.'
        : !status
          ? 'Checking…'
          : status.availability === 'available'
            ? `Ready · ${status.label}`
            : status.availability === 'downloadable'
              ? 'Chrome’s on-device model needs a one-time download.'
              : status.availability === 'downloading'
                ? 'Chrome is downloading the on-device model…'
                : settings.ai.provider === 'endpoint'
                  ? 'Add your endpoint URL.'
                  : 'Not available: this browser has no on-device model, and no endpoint is set.';

  return (
    <Section id="ai" title="FocusSpace AI" description="Ask anything about the video or page you're on. It can also explain, give an example, quiz you or take notes — and it runs only when you ask.">
      <SettingRow
        title="Provider"
        description={
          hosted
            ? `${HOSTED_AI_LABEL} answers from your plan's monthly credits. On-device uses Chrome's built-in model instead: free and private, but only on computers that support it.`
            : "Automatic uses your endpoint when set, otherwise Chrome's on-device model."
        }
      >
        <Segmented
          label="AI provider"
          value={settings.ai.provider}
          onChange={(provider) => setAi({ provider })}
          options={[
            { value: 'auto', label: hosted ? HOSTED_AI_LABEL : 'Automatic' },
            { value: 'chrome', label: 'On-device' },
            ...(showEndpoint ? [{ value: 'endpoint' as const, label: 'My endpoint' }] : []),
            { value: 'off', label: 'Off' },
          ]}
        />
      </SettingRow>
      <SettingRow title="Answer language" description="Technical terms stay in English; the explanation around them follows this setting.">
        <Segmented label="Answer language" value={settings.ai.language} onChange={(language) => setAi({ language })} options={LANGUAGE_OPTIONS} />
      </SettingRow>
      {showEndpoint && (settings.ai.provider === 'auto' || settings.ai.provider === 'endpoint') && (
        <SettingRow title="Your endpoint" description="A server you run keeps the API key — the extension never has one. Reference server: server/index.ts.">
          <div className="fs-row">
            <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-server.example/v1/ai/complete" style={{ width: 240 }} aria-label="AI endpoint URL" />
            <Button size="sm" variant="secondary" disabled={trimmed === settings.ai.endpointUrl || (trimmed !== '' && !isHttpUrl(trimmed))} onClick={() => setAi({ endpointUrl: trimmed })}>
              Save
            </Button>
          </div>
        </SettingRow>
      )}
      {/* "Ready · FocusSpace AI" is not worth a row; only a problem, or a non-default setup, is. */}
      {!(hosted && status?.availability === 'available' && settings.ai.provider !== 'off' && !download) && (
      <SettingRow title="Status" description={download?.error ?? statusText}>
        {status?.provider === 'chrome' && status.availability === 'downloadable' && (
          <Button
            size="sm"
            variant="secondary"
            icon={<Download />}
            disabled={!!download && !download.error}
            onClick={async () => {
              setDownload({ progress: 0 });
              try {
                await downloadOnDeviceModel((progress) => setDownload({ progress }));
                setDownload(null);
                refresh();
              } catch (err) {
                setDownload({ progress: 0, error: err instanceof Error ? err.message : 'The download failed.' });
              }
            }}
          >
            {download && !download.error ? `${Math.round(download.progress * 100)}%` : 'Download model'}
          </Button>
        )}
      </SettingRow>
      )}
    </Section>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */

export function SettingsPage({ data }: { data: DashboardData }) {
  const { settings, modes } = data;
  const flow = useAccountFlow();
  const { user, usage } = flow;
  const [confirmReset, setConfirmReset] = useState(false);
  const version = chrome.runtime.getManifest().version;

  return (
    <div className="fs-stack fs-page-narrow fs-settings" style={{ width: '100%', margin: '0 auto' }}>
      <div className="fs-page-head">
        <div>
          <h1 className="fs-h1">Settings</h1>
          <p>Changes apply to open YouTube tabs right away.</p>
        </div>
      </div>

      <Section id="account" title="Account" description="Your plan, AI credits, payments and details live on their own page.">
        <SettingRow
          title={user ? accountIdentity(flow) : 'Not signed in'}
          description={user ? `${usage ? `${planLabel(usage.plan)} plan · ` : ''}Plan, AI credits, payments and your details.` : 'Sign in to raise your Space and AI allowance. Everything works signed out.'}
        >
          <Button size="sm" variant={user ? 'secondary' : 'primary'} onClick={() => navigate('/account')}>
            {user ? 'Open account' : 'Sign in'}
          </Button>
        </SettingRow>
      </Section>

      <Section id="learning" title="Learning" description="How FocusSpace organises YouTube around the space you're in.">
        <SettingRow
          title="Focus Mode"
          description={
            <>
              On: YouTube is filtered and organised around your space. Off: normal YouTube. Toggle anywhere with <span className="fs-kbd">Alt</span> + <span className="fs-kbd">Shift</span> + <span className="fs-kbd">F</span>.
            </>
          }
        >
          <Switch label="Focus Mode" checked={settings.focusEnabled} onChange={(v) => setFocusEnabled(v)} />
        </SettingRow>
        <SettingRow title="Default space" description="Used when Focus Mode turns on without a space selected.">
          <select className="fs-select" style={{ width: 200 }} value={settings.defaultModeId ?? ''} onChange={(e) => patch({ defaultModeId: e.target.value })} aria-label="Default space">
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow title="Remember what I watch" description="Powers Continue watching and course progress. Stored only in this browser.">
          <div className="fs-row">
            <Button size="sm" variant="ghost" onClick={() => setItem('watchHistory', [])}>
              Clear
            </Button>
            <Switch label="Remember what I watch" checked={settings.trackWatchHistory} onChange={(v) => patch({ trackWatchHistory: v })} />
          </div>
        </SettingRow>
        <SettingRow title="Ask before off-topic videos" description="If a video clearly doesn't match your space, FocusSpace asks before you continue. You can always watch anyway.">
          <Switch label="Ask before off-topic videos" checked={settings.offTrackNudges} onChange={(v) => patch({ offTrackNudges: v })} />
        </SettingRow>
        <details className="fs-advanced">
          <summary className="fs-label">Advanced filtering</summary>
          <FilterEditor config={settings.focus} onChange={(focus) => patch({ focus })} />
        </details>
      </Section>

      <AiSection settings={settings} />

      <Section
        id="spaces"
        title="Spaces"
        description={`A Space is what you came to YouTube for. ${GUEST_SPACE_LIMIT} without an account, ${FREE_SPACE_LIMIT} with a free account, more on a paid plan. Spaces live in this browser.`}
      >
        <SettingRow title={`${modes.length} ${modes.length === 1 ? 'space' : 'spaces'} in this browser`} description={modes.map((m) => m.name).join(' · ')}>
          <Button size="sm" variant="secondary" onClick={() => navigate('/modes')}>
            Manage spaces
          </Button>
        </SettingRow>
      </Section>

      <Section id="subscriptions" title="Subscribed channels" description="The channels FocusSpace ranks for each Space.">
        <SettingRow title="Refresh automatically" description="Check your channels for new uploads every 6 hours while Chrome is open.">
          <Switch label="Refresh automatically" checked={settings.autoSyncSubscriptions} onChange={(v) => patch({ autoSyncSubscriptions: v })} />
        </SettingRow>
        <details className="fs-advanced">
          <summary className="fs-label">Troubleshooting</summary>
          <SettingRow title="Show relevance details" description="Shows how FocusSpace scored each channel and video — useful when reporting a ranking that looks wrong.">
            <Switch label="Show relevance details" checked={settings.debugRelevance} onChange={(v) => patch({ debugRelevance: v })} />
          </SettingRow>
        </details>
      </Section>

      <Section id="appearance" title="Appearance" description="On youtube.com FocusSpace follows YouTube's own theme. These apply to FocusSpace's own pages.">
        <SettingRow title="Theme">
          <Segmented
            label="Theme"
            value={settings.theme}
            onChange={(theme) => patch({ theme })}
            options={[
              { value: 'system', label: 'System', icon: <Monitor /> },
              { value: 'light', label: 'Light', icon: <Sun /> },
              { value: 'dark', label: 'Dark', icon: <Moon /> },
            ]}
          />
        </SettingRow>
        {/*
          Density used to be offered here, and it did essentially nothing: `[data-density='compact']`
          only redefines --fs-pad and --fs-gap, and between them those two tokens are read by exactly
          two rules (.fs-stack's gap and .fs-card-pad's padding, the latter used on three boxes on one
          page). Clicking it changed a few pixels on Subscriptions and nothing anywhere else, which is
          worse than not offering it. The setting itself is untouched — it is still in the schema, still
          applied to <html> as data-density, and the website can still set it through
          background/external.ts — so making the tokens real is a later change, not a migration.
        */}
      </Section>

      {/*
        Four blocks of bullets used to live here — the complete account of what FocusSpace stores and
        sends, in the middle of a settings page. It was accurate and nobody read it. The full version now
        lives on the website (web/src/content/data-summary.ts), where someone deciding whether to trust
        FocusSpace can find it. What stays is the short version, and it comes from the same
        ui/account/data-facts.ts list the Account page renders — so "concise" can never quietly become
        "different from the detailed explanation".
      */}
      <Section id="privacy" title="Your data" description="Nothing is sold, and there is no advertising or tracking.">
        <SettingRow title="Your Spaces, notes and history stay in this browser" description={LOCAL_DATA_SUMMARY} />
        <SettingRow title={user ? 'Your account holds' : 'An account would hold'} description={ACCOUNT_DATA_FACTS.map((f) => f.label.replace(/^Your /, '').replace(/^The /, '')).join(' · ')} />
        <SettingRow title="The learning companion, only when you ask" description={aiDataSummary(usesHostedAi(settings.ai.endpointUrl) ? HOSTED_AI_LABEL : 'Your endpoint')} />
        {!user && <SettingRow title="Using the AI without an account" description={ANONYMOUS_AI_SUMMARY} />}
        <SettingRow title="The full explanation" description="Every one of these in detail, plus what goes to youtube.com and who else is involved.">
          <Button size="sm" variant="secondary" icon={<ExternalLink />} onClick={() => void sendMessage('site/open', { path: '/privacy#your-data' }).catch(() => undefined)}>
            Read it
          </Button>
        </SettingRow>
      </Section>

      <Section id="about" title="About">
        <SettingRow title="Keyboard shortcut" description="Change the Focus Mode shortcut in Chrome's extension shortcuts page.">
          <Button size="sm" variant="secondary" icon={<Keyboard />} onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
            Shortcuts
          </Button>
        </SettingRow>
        <SettingRow title="Reset FocusSpace" description="Deletes all local FocusSpace data and restores the default spaces.">
          <Button size="sm" variant="danger" icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>
            Reset…
          </Button>
        </SettingRow>
        <p className="fs-caption" style={{ paddingTop: 10 }}>
          FocusSpace v{version}
        </p>
      </Section>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset FocusSpace?"
        subtitle="Spaces, history, playlists, notes, channels and settings will be deleted from this browser."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await chrome.storage.local.clear();
                location.hash = '#/';
                location.reload();
              }}
            >
              Delete everything
            </Button>
          </>
        }
      >
        <p className="fs-muted">This can't be undone. Your account, if you have one, is not deleted.</p>
      </Modal>
    </div>
  );
}
