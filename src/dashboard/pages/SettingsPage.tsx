import { useCallback, useEffect, useState } from 'react';
import { Download, Keyboard, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import type { AiSettings, Settings } from '@/types/domain';
import type { NoteLanguage } from '@/types/notes';
import type { AiStatus } from '@/learning/ai/service';
import { downloadOnDeviceModel } from '@/ai/on-device';
import { HOSTED_AI_LABEL, usesHostedAi } from '@/config';
import { FREE_SPACE_LIMIT, GUEST_SPACE_LIMIT } from '@/billing/plans';
import { sendMessage } from '@/messaging/runtime';
import { accountIdentity, useAccountFlow } from '@/ui/account/flow';
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



/* ─── Learning companion ───────────────────────────────────────────────────── */

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
    <Section id="ai" title="Learning companion" description="Explain, give an example, quiz you, take notes, or answer a question about the moment you're watching. It runs only when you ask.">
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
  const user = flow.user;
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
        <SettingRow title={user ? accountIdentity(flow) : 'Not signed in'} description={user ? 'Plan, AI credits, payments and your details.' : 'Sign in to raise your Space and AI allowance. Everything works signed out.'}>
          <Button size="sm" variant="secondary" onClick={() => navigate('/account')}>
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

      <Section id="subscriptions" title="Subscriptions" description="The channels FocusSpace ranks for each Space.">
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
        <SettingRow title="Density">
          <Segmented
            label="Density"
            value={settings.density}
            onChange={(density) => patch({ density })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </SettingRow>
      </Section>

      <Section id="privacy" title="Privacy" description="Exactly what stays here, and what leaves.">
        <div className="fs-privacy">
          <div className="fs-privacy-block">
            <span className="fs-h3">Stays in this browser</span>
            <ul className="fs-bullets">
              <li>Spaces, topics, playlists, notes, channel choices and settings</li>
              <li>What you watch with Focus Mode on (for Continue watching and course progress)</li>
              <li>Your channel library and discovery results</li>
            </ul>
          </div>
          <div className="fs-privacy-block">
            <span className="fs-h3">Your account (only if you create one)</span>
            <ul className="fs-bullets">
              <li>Your email or phone number, and a securely hashed password — never the password itself. Verification codes are stored only as keyed hashes.</li>
              <li>Your plan, AI usage count and the ids and names of your Spaces, so your plan’s limits apply wherever you sign in. Not their contents.</li>
              <li>Nothing else: spaces' contents, history and notes stay in this browser.</li>
            </ul>
          </div>
          <div className="fs-privacy-block">
            <span className="fs-h3">Requests to youtube.com</span>
            <ul className="fs-bullets">
              <li>The same requests the page itself makes, with your existing session: searches for your space, the current video's details and playlist, the course playlist its description links to, the first comments of learning videos without detailed chapters, your subscriptions (when you import) and, signed in, your YouTube history and recommendations.</li>
              <li>In the background, anonymous requests for your channels' public uploads and channel search.</li>
            </ul>
          </div>
          <div className="fs-privacy-block">
            <span className="fs-h3">Learning companion (only when you ask)</span>
            <ul className="fs-bullets">
              <li>On-device AI runs inside Chrome: nothing leaves your browser.</li>
              <li>
                {usesHostedAi(settings.ai.endpointUrl) ? `${HOSTED_AI_LABEL} receives` : 'Your endpoint receives'} only the moment you ask about: video title and channel, timestamp, nearby outline items, your course position, your space's topic names, a short transcript excerpt and your question.
                {usesHostedAi(settings.ai.endpointUrl) && ' Our AI provider, OpenRouter, processes it on our behalf. We don’t store your prompts or the answers.'}
              </li>
              <li>To answer about a moment, FocusSpace may ask YouTube's player to load the video's captions, then restores your caption setting.</li>
            </ul>
          </div>
        </div>
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
