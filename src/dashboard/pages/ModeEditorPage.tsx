import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, FlaskConical, Trash2, X } from 'lucide-react';
import type { LearningMode, SpaceKind, Topic } from '@/types/domain';
import type { DashboardData } from '../DashboardApp';
import { navigate } from '../router';
import { deleteMode, effectiveFilters, findMode, updateMode } from '@/modes/service';
import { SPACE_ICON_NAMES } from '@/modes/icons';
import { uniqueId } from '@/learning/text';
import { getClassifier } from '@/ai/registry';
import { FEED_MIN_SCORE, TIER_LABEL } from '@/learning/classifier';
import { sendMessage } from '@/messaging/runtime';
import { useStorage } from '@/ui/hooks';
import { SpaceIcon } from '@/ui/icons';
import { Badge, Button, EmptyState, Field, IconButton, Segmented, SettingRow, Switch, TextInput } from '@/ui/components/primitives';
import { TagInput } from '@/ui/components/TagInput';
import { FilterEditor } from '@/ui/components/FilterEditor';
import { Modal } from '@/ui/components/Modal';
import { ChannelPicker, type PickedChannel } from '@/ui/components/ChannelPicker';

type Draft = Omit<LearningMode, 'id' | 'createdAt' | 'updatedAt'>;

const toDraft = ({ id: _id, createdAt: _c, updatedAt: _u, ...rest }: LearningMode): Draft => structuredClone(rest);

const KIND_OPTIONS: { value: SpaceKind; label: string }[] = [
  { value: 'learning', label: 'Learning' },
  { value: 'media', label: 'Music & video' },
  { value: 'general', label: 'General' },
];

export function ModeEditorPage({ data, modeId }: { data: DashboardData; modeId: string }) {
  const mode = findMode(data.modes, modeId);
  const library = useStorage(['channels'] as const);
  const [draft, setDraft] = useState<Draft | null>(() => (mode ? toDraft(mode) : null));
  const [baseline, setBaseline] = useState(() => (mode ? JSON.stringify(toDraft(mode)) : ''));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  // Adopt external changes (e.g. a channel allowed from YouTube) when there are no local edits.
  useEffect(() => {
    if (!mode) return;
    const incoming = JSON.stringify(toDraft(mode));
    setDraft((current) => (current && JSON.stringify(current) !== baseline ? current : toDraft(mode)));
    setBaseline(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode?.updatedAt]);

  if (!mode || !draft) {
    return (
      <EmptyState icon={<X />} title="This space doesn't exist" actions={<Button onClick={() => navigate('/modes')}>Back to spaces</Button>}>
        It may have been deleted in another window.
      </EmptyState>
    );
  }

  const dirty = JSON.stringify(draft) !== baseline;
  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const valid = draft.name.trim().length > 0;
  const knownIds = new Set(Object.keys(library?.channels ?? {}));
  const picked: PickedChannel[] = draft.allowedChannels.map((c) => ({ id: c.id, title: c.title, handle: c.handle ?? null, thumbnail: library?.channels[c.id]?.thumbnail ?? null }));

  const save = async () => {
    setSaving(true);
    const clean: Draft = { ...draft, name: draft.name.trim(), topics: draft.topics.filter((t) => t.name.trim()).map((t) => ({ ...t, name: t.name.trim() })) };
    await updateMode(mode.id, clean);
    // Channels added to a space join the library even when the user isn't subscribed.
    for (const c of clean.allowedChannels) if (c.id && !knownIds.has(c.id)) void sendMessage('channel/add', { input: c.id }).catch(() => undefined);
    setBaseline(JSON.stringify(clean));
    setDraft(clean);
    setSaving(false);
  };

  return (
    <>
      <div>
        <Button size="sm" variant="ghost" icon={<ArrowLeft />} onClick={() => navigate('/modes')}>
          All spaces
        </Button>
      </div>
      <div className="fs-page-head">
        <div className="fs-row" style={{ gap: 12, flex: 1, minWidth: 260 }}>
          <IconPicker value={draft.icon} onChange={(icon) => patch({ icon })} />
          <TextInput value={draft.name} onChange={(e) => patch({ name: e.target.value })} maxLength={40} aria-label="Space name" style={{ height: 52, fontSize: 24, fontWeight: 650, letterSpacing: '-0.02em' }} />
        </div>
        {mode.id === data.settings.activeModeId && <Badge tone="accent">Active space</Badge>}
      </div>

      <section className="fs-card fs-editor-section">
        <Field label="What this space is about" htmlFor="desc">
          <TextInput id="desc" value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="e.g. Data structures & algorithms for interviews" maxLength={140} />
        </Field>
        <SettingRow title="Kind of space" description="Learning spaces favour tutorials and lectures; music & video spaces favour the real thing (official videos, albums, live sets).">
          <Segmented label="Kind of space" value={draft.kind} onChange={(kind) => patch({ kind })} options={KIND_OPTIONS} />
        </SettingRow>
      </section>

      <section className="fs-card fs-editor-section">
        <header>
          <h2 className="fs-h3">Topics</h2>
          <p>They appear as chips on your YouTube home and group videos. FocusSpace recognises each topic by its name{draft.topics.some((t) => t.keywords.length) ? ' and keywords (Advanced)' : ''}.</p>
        </header>
        <TopicChips topics={draft.topics} onChange={(topics) => patch({ topics })} />
      </section>

      <section className="fs-card fs-editor-section">
        <header>
          <h2 className="fs-h3">Channels</h2>
          <p>Videos from these channels always count in this space — you don't need to be subscribed.</p>
        </header>
        <ChannelPicker
          selected={picked}
          knownIds={knownIds}
          onChange={(next) => patch({ allowedChannels: next.map((c) => ({ id: c.id, title: c.title, handle: c.handle ?? undefined })) })}
          suggestQuery={draft.searchHint || draft.name}
        />
        {draft.blockedChannels.length > 0 && (
          <div className="fs-stack-sm">
            <span className="fs-eyebrow">Never in this space</span>
            <div className="fs-row-wrap fs-tags-danger" style={{ gap: 6 }}>
              {draft.blockedChannels.map((c) => (
                <span className="fs-tag" key={`${c.id}${c.handle}`}>
                  {c.title}
                  <button type="button" aria-label={`Remove ${c.title}`} onClick={() => patch({ blockedChannels: draft.blockedChannels.filter((x) => x !== c) })}>
                    <X />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="fs-card fs-editor-section">
        <SettingRow title="YouTube discovery" description="Your subscriptions come first; relevant videos from other channels fill the gaps. Discovered videos go through the same relevance checks.">
          <Switch label="YouTube discovery" checked={draft.discovery} onChange={(discovery) => patch({ discovery })} />
        </SettingRow>
      </section>

      <details className="fs-card fs-editor-section fs-advanced">
        <summary className="fs-h3">Advanced</summary>
        <div className="fs-stack">
          <Field label="Search context" htmlFor="search-hint" hint={`Added to YouTube searches that don't already name a topic, e.g. “transformers” → “transformers ${draft.searchHint || draft.name}”.`}>
            <TextInput id="search-hint" value={draft.searchHint} onChange={(e) => patch({ searchHint: e.target.value })} placeholder={draft.name} maxLength={60} />
          </Field>
          <Field label="Relevance signals" hint="Phrases (“dynamic programming”) are strong; broad words (“ai”, “code”) only support other evidence. Prefix with ~ for a supporting signal (“~probability”).">
            <TagInput label="Space keywords" values={draft.keywords} onChange={(keywords) => patch({ keywords })} placeholder="e.g. leetcode, data structures" />
          </Field>
          <Field label="Blocked words" hint="Videos whose titles contain these never count in this space.">
            <TagInput label="Blocked keywords" tone="danger" values={draft.blockedKeywords} onChange={(blockedKeywords) => patch({ blockedKeywords })} placeholder="e.g. prank, reaction" />
          </Field>
          <div className="fs-stack-sm">
            <span className="fs-label">Topic keywords</span>
            <TopicsEditor topics={draft.topics} onChange={(topics) => patch({ topics })} />
          </div>
          <div className="fs-stack-sm">
            <SettingRow title="Distraction rules" description="Use your global Focus settings, or give this space its own.">
              <Segmented
                label="Distraction rules source"
                value={draft.filterOverride ? 'custom' : 'global'}
                onChange={(v) => patch({ filterOverride: v === 'custom' ? structuredClone(effectiveFilters(data.settings, null)) : null })}
                options={[
                  { value: 'global', label: 'Global' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </SettingRow>
            {draft.filterOverride && <FilterEditor config={draft.filterOverride} onChange={(filterOverride) => patch({ filterOverride })} />}
          </div>
          <ClassifierTester draft={draft} modeId={mode.id} />
        </div>
      </details>

      <section className="fs-card fs-editor-section" style={{ borderColor: 'var(--fs-danger-soft)' }}>
        <div className="fs-spread">
          <header>
            <h2 className="fs-h3">Delete space</h2>
            <p>Removes this space, its topics and playlists.</p>
          </header>
          <Button variant="danger" icon={<Trash2 />} disabled={data.modes.length <= 1} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </section>

      {dirty && (
        <div className="fs-savebar" role="region" aria-label="Unsaved changes">
          <span className="fs-body-sm" style={{ fontWeight: 550 }}>
            {valid ? 'You have unsaved changes' : 'A space needs a name'}
          </span>
          <div className="fs-row">
            <Button variant="ghost" onClick={() => setDraft(JSON.parse(baseline))}>
              Discard
            </Button>
            <Button variant="primary" loading={saving} disabled={!valid} onClick={save}>
              Save changes
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${mode.name}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await deleteMode(mode.id);
                navigate('/modes');
              }}
            >
              Delete space
            </Button>
          </>
        }
      >
        <p className="fs-muted">This can't be undone. Built-in spaces can be restored from the Spaces page.</p>
      </Modal>
    </>
  );
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !e.composedPath().includes(ref.current) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="fs-icon-picker" ref={ref}>
      <button type="button" className="fs-icon-picker-button" aria-label="Choose icon" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <SpaceIcon name={value} size={24} />
      </button>
      {open && (
        <div className="fs-icon-grid" role="listbox" aria-label="Icons">
          {SPACE_ICON_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={name === value}
              title={name}
              onClick={() => {
                onChange(name);
                setOpen(false);
              }}
            >
              <SpaceIcon name={name} size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopicChips({ topics, onChange }: { topics: Topic[]; onChange: (t: Topic[]) => void }) {
  const [name, setName] = useState('');
  const add = () => {
    const n = name.trim();
    if (!n || topics.some((t) => t.name.toLowerCase() === n.toLowerCase())) return;
    onChange([...topics, { id: uniqueId(n, topics.map((t) => t.id)), name: n, keywords: [] }]);
    setName('');
  };
  return (
    <div className="fs-row-wrap" style={{ gap: 6 }}>
      {topics.map((t) => (
        <span className="fs-tag" key={t.id}>
          {t.name}
          <button type="button" aria-label={`Remove ${t.name}`} onClick={() => onChange(topics.filter((x) => x.id !== t.id))}>
            <X />
          </button>
        </span>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextInput small value={name} onChange={(e) => setName(e.target.value)} placeholder="+ Add topic" aria-label="New topic name" style={{ width: 160 }} />
      </form>
    </div>
  );
}

function TopicsEditor({ topics, onChange }: { topics: Topic[]; onChange: (t: Topic[]) => void }) {
  const update = (id: string, p: Partial<Topic>) => onChange(topics.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const move = (index: number, delta: number) => {
    const next = [...topics];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  if (!topics.length) return <p className="fs-caption">No topics yet.</p>;
  return (
    <div>
      {topics.map((topic, i) => (
        <div className="fs-topic-row" key={topic.id}>
          <span className="fs-topic-index">{String(i + 1).padStart(2, '0')}</span>
          <div className="fs-stack-sm">
            <TextInput small value={topic.name} onChange={(e) => update(topic.id, { name: e.target.value })} aria-label={`Topic ${i + 1} name`} maxLength={40} />
            <TagInput label={`${topic.name} keywords`} values={topic.keywords} onChange={(keywords) => update(topic.id, { keywords })} placeholder="Keywords, e.g. memoization, knapsack" />
          </div>
          <div className="fs-row" style={{ gap: 2 }}>
            <IconButton size="sm" label="Move up" icon={<ArrowUp />} disabled={i === 0} onClick={() => move(i, -1)} />
            <IconButton size="sm" label="Move down" icon={<ArrowDown />} disabled={i === topics.length - 1} onClick={() => move(i, 1)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ClassifierTester({ draft, modeId }: { draft: Draft; modeId: string }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const result = useMemo(() => {
    if (!title.trim()) return null;
    const mode: LearningMode = { ...draft, id: `${modeId}__test`, createdAt: 0, updatedAt: Date.now() };
    return { ...getClassifier().explain({ videoId: 'test', title, description }, mode), mode };
  }, [title, description, draft, modeId]);
  const tone = { excellent: 'success', strong: 'success', relevant: 'accent', weak: 'warning', none: 'neutral', blocked: 'danger' } as const;

  return (
    <div className="fs-stack-sm">
      <span className="fs-label fs-row">
        <FlaskConical size={15} /> Test your rules
      </span>
      <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Paste a video title" aria-label="Video title to test" />
      <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" aria-label="Video description to test" />
      {result && (
        <div className="fs-classify-result fs-animate-in">
          <div className="fs-row-wrap">
            <Badge tone={tone[result.classification.strength]}>{result.classification.strength === 'blocked' ? 'Blocked' : TIER_LABEL[result.classification.tier]}</Badge>
            <span className="fs-body-sm">
              Topic: <b>{result.mode.topics.find((t) => t.id === result.classification.topicId)?.name ?? '—'}</b>
            </span>
            <span className="fs-body-sm fs-muted fs-mono">score {result.classification.relevance.toFixed(2)}</span>
            <span className="fs-caption">{result.classification.relevance >= FEED_MIN_SCORE ? 'Shown in this space' : 'Not shown'}</span>
          </div>
          <div className="fs-why" style={{ background: 'var(--fs-surface)' }}>
            <ul>
              {result.signals.map((signal, i) => (
                <li key={i} data-kind={signal.kind}>
                  <span>{signal.label}</span>
                  <span className="fs-mono">{signal.value > 0 ? `+${signal.value}` : signal.value || ''}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
