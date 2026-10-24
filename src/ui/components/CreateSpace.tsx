import { useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { LearningMode, SpaceKind } from '@/types/domain';
import { inferModeIntent, modeFromSuggestion, STARTER_INTENTS, type IntentSuggestion } from '@/modes/intent';
import { addMode, SpaceLimitError } from '@/modes/service';
import { slugify } from '@/learning/text';
import { updateItem } from '@/storage/storage';
import { sendMessage } from '@/messaging/runtime';
import { SpaceIcon } from '../icons';
import { Button, Segmented, Switch, TextInput } from './primitives';
import { ChannelPicker, type PickedChannel } from './ChannelPicker';
import { openSignIn } from '../account/use-can-save';

const KIND_OPTIONS: { value: SpaceKind; label: string }[] = [
  { value: 'learning', label: 'Learning' },
  { value: 'media', label: 'Music & video' },
  { value: 'general', label: 'General' },
];

/**
 * "What do you want to focus on?" → FocusSpace infers the space → one click.
 * No keywords, signals or configuration required.
 */
export function CreateSpace({ modes, onCreated, onCancel }: { modes: LearningMode[]; onCreated: (mode: LearningMode) => void; onCancel: () => void }) {
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<IntentSuggestion | null>(null);
  const [channels, setChannels] = useState<PickedChannel[]>([]);
  const [discovery, setDiscovery] = useState(true);
  const [newTopic, setNewTopic] = useState('');
  const [saving, setSaving] = useState(false);
  /** The plan's Space allowance is decided by the server (Layer 2C) — shown here as a product explanation, not an error. */
  const [limit, setLimit] = useState<string | null>(null);

  const understand = (text: string) => {
    const suggestion = inferModeIntent(text);
    if (suggestion) {
      setDraft(suggestion);
      setChannels([]);
    }
  };

  const create = async (from: IntentSuggestion | null = draft) => {
    if (!from) return;
    setSaving(true);
    setLimit(null);
    const mode: LearningMode = {
      ...modeFromSuggestion(from, modes.map((m) => m.id)),
      discovery,
      allowedChannels: channels.map((c) => ({ id: c.id, title: c.title, handle: c.handle ?? undefined })),
    };
    try {
      await addMode(mode);
    } catch (err) {
      setSaving(false);
      setLimit(err instanceof SpaceLimitError ? err.message : 'FocusSpace couldn’t create that Space. Try again.');
      return;
    }
    await updateItem('settings', (s) => ({ ...s, activeModeId: mode.id, focusEnabled: true, onboarded: true }));
    for (const c of channels) void sendMessage('channel/add', { input: c.id }).catch(() => undefined);
    setSaving(false);
    onCreated(mode);
  };

  /** "System design" → Create: the Space is made straight away, with its subtopics. Customizing is optional. */
  const quickCreate = () => {
    const text = input.trim();
    if (!text) return;
    void create(inferModeIntent(text));
  };

  if (!draft) {
    return (
      <form
        className="fs-stack fs-create"
        onSubmit={(e) => {
          e.preventDefault();
          quickCreate();
        }}
      >
        <label className="fs-label" htmlFor="fs-intent" style={{ fontSize: 15 }}>
          What do you want to focus on?
        </label>
        <TextInput id="fs-intent" autoFocus value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. System Design, Punjabi music, DSA" maxLength={60} style={{ height: 46, fontSize: 16 }} />
        <div className="fs-choice-row" aria-label="Examples">
          {STARTER_INTENTS.map((s) => (
            <button key={s} type="button" className="fs-choice" aria-pressed={input === s} onClick={() => setInput(s)}>
              {s}
            </button>
          ))}
        </div>
        {limit && <LimitNotice text={limit} />}
        <div className="fs-row" style={{ justifyContent: 'space-between' }}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="fs-row">
            <Button variant="secondary" disabled={!input.trim() || saving} onClick={() => understand(input)}>
              Customize first
            </Button>
            <Button type="submit" variant="primary" iconRight={<ArrowRight />} loading={saving} disabled={!input.trim()}>
              Create space
            </Button>
          </div>
        </div>
      </form>
    );
  }

  const topicNames = new Set(draft.topics.map((t) => t.name.toLowerCase()));
  const addTopic = () => {
    const name = newTopic.trim();
    if (!name || topicNames.has(name.toLowerCase())) return;
    setDraft({ ...draft, topics: [...draft.topics, { id: slugify(name), name, keywords: [] }] });
    setNewTopic('');
  };

  return (
    <div className="fs-stack fs-create">
      <div className="fs-row" style={{ gap: 12 }}>
        <span className="fs-mode-emoji" aria-hidden>
          <SpaceIcon name={draft.icon} size={22} />
        </span>
        <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Space name" maxLength={40} style={{ height: 46, fontSize: 18, fontWeight: 600 }} />
      </div>

      <div className="fs-stack-sm">
        <span className="fs-eyebrow">We understood</span>
        <div className="fs-row-wrap" style={{ gap: 6 }}>
          {draft.topics.map((t) => (
            <span className="fs-tag" key={t.id}>
              {t.name}
              <button type="button" aria-label={`Remove ${t.name}`} onClick={() => setDraft({ ...draft, topics: draft.topics.filter((x) => x.id !== t.id) })}>
                <X />
              </button>
            </span>
          ))}
          <form
            className="fs-row"
            style={{ gap: 4 }}
            onSubmit={(e) => {
              e.preventDefault();
              addTopic();
            }}
          >
            <TextInput small value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="+ Add topic" aria-label="Add topic" style={{ width: 140 }} />
          </form>
        </div>
        <div className="fs-row-wrap" style={{ justifyContent: 'space-between' }}>
          <span className="fs-caption">FocusSpace uses these to recognise relevant videos.</span>
          <Segmented label="Kind of space" value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind })} options={KIND_OPTIONS} />
        </div>
      </div>

      <div className="fs-stack-sm">
        <span className="fs-eyebrow">Creators (optional)</span>
        <ChannelPicker selected={channels} onChange={setChannels} suggestQuery={draft.searchHint || draft.name} mode={draft} />
      </div>

      <label className="fs-spread fs-body-sm">
        <span>
          <b>Discover videos across YouTube</b>
          <span className="fs-caption" style={{ display: 'block' }}>
            Your subscriptions come first; great matches from other channels fill the gaps.
          </span>
        </span>
        <Switch label="Discover videos across YouTube" checked={discovery} onChange={setDiscovery} />
      </label>

      {limit && <LimitNotice text={limit} />}

      <div className="fs-row" style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" icon={<ArrowLeft />} onClick={() => setDraft(null)}>
          Back
        </Button>
        <Button variant="primary" loading={saving} disabled={!draft.name.trim()} onClick={() => void create()}>
          Create space
        </Button>
      </div>
    </div>
  );
}

/** The Space allowance, with the way past it right there: a free account (5 Spaces) when signed out. */
function LimitNotice({ text }: { text: string }) {
  const guest = /without an account/i.test(text);
  return (
    <p className="fs-notice" role="status">
      {text}{' '}
      {guest && (
        <button type="button" className="fs-link" onClick={openSignIn}>
          Sign in, it’s free
        </button>
      )}
    </p>
  );
}
