import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, Search, Trash2, Users } from 'lucide-react';
import type { Channel } from '@/types/domain';
import type { ImportResult } from '@/types/messages';
import type { DashboardData } from '../DashboardApp';
import { sendMessage } from '@/messaging/runtime';
import { updateItem } from '@/storage/storage';
import { activeModeOf, channelRuleOf, findMode, setChannelRule } from '@/modes/service';
import { relativeTime } from '@/learning/library';
import { CHANNEL_TIER_LABEL, channelKindLabel, type ChannelKind, type ChannelProfile } from '@/learning/relevance/channels';
import { channelUrl } from '@/integrations/youtube/urls';
import { useModeLibrary, useStorage } from '@/ui/hooks';
import { Alert, Badge, Button, EmptyState, IconButton, ProgressBar, Segmented, Skeleton, Switch, TextInput } from '@/ui/components/primitives';

type Filter = 'all' | 'relevant' | 'ignored';

interface Group {
  id: string;
  title: string;
  description: string;
  kinds: ChannelKind[];
}

export function SubscriptionsPage({ data }: { data: DashboardData }) {
  const [modeId, setModeId] = useState(data.settings.activeModeId);
  const mode = findMode(data.modes, modeId) ?? activeModeOf(data.settings, data.modes);
  const library = useModeLibrary(mode);
  const store = useStorage(['channels', 'videos'] as const);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [addInput, setAddInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const sync = library.sync;
  const busy = sync?.status === 'importing' || sync?.status === 'syncing';
  const modeName = mode?.name ?? 'this mode';
  const totalChannels = Object.keys(store?.channels ?? {}).length;

  const groups: Group[] = [
    { id: 'best', title: `Best matches for ${modeName}`, description: 'Channels whose recent videos consistently teach this.', kinds: ['educational'] },
    { id: 'adjacent', title: `Often covers ${modeName}`, description: 'Relevant technology and engineering channels.', kinds: ['adjacent'] },
    { id: 'news', title: `${modeName} news`, description: 'On topic, but mostly announcements and news.', kinds: ['news'] },
    { id: 'occasional', title: 'Occasionally relevant', description: 'A relevant video now and then.', kinds: ['occasional'] },
    { id: 'other', title: 'Other subscriptions', description: 'Nothing that clearly matches this mode yet.', kinds: ['general', 'entertainment', 'unknown'] },
  ];

  // Ranked order comes from the library (see compareChannelProfiles); unsynced and ignored channels follow.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ranked = library.library?.channels ?? [];
    const rankedIds = new Set(ranked.map((c) => c.channel.id));
    const rest = Object.values(store?.channels ?? {})
      .filter((c) => !rankedIds.has(c.id))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((channel) => ({ channel, profile: null as ChannelProfile | null }));
    return [...ranked.map((c) => ({ channel: store?.channels[c.channel.id] ?? c.channel, profile: c.profile as ChannelProfile | null })), ...rest]
      .filter(({ channel, profile }) =>
        filter === 'ignored' ? channel.ignored : filter === 'relevant' ? !channel.ignored && !!profile && ['educational', 'adjacent', 'news'].includes(profile.kind) : true,
      )
      .filter(({ channel }) => !q || channel.title.toLowerCase().includes(q) || channel.handle?.toLowerCase().includes(q));
  }, [library.library, store?.channels, filter, query]);

  const videoCounts = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(store?.videos ?? {}).forEach((v) => counts.set(v.channelId, (counts.get(v.channelId) ?? 0) + 1));
    return counts;
  }, [store?.videos]);

  const runImport = async () => {
    setImportResult(null);
    try {
      setImportResult(await sendMessage('subscriptions/import', {}));
    } catch (err) {
      setImportResult({ ok: false, code: 'network', error: err instanceof Error ? err.message : 'Import failed.' });
    }
  };

  const add = async () => {
    setAdding(true);
    setAddError(null);
    try {
      const res = await sendMessage('channel/add', { input: addInput });
      if (res.ok) setAddInput('');
      else setAddError(res.error);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add channel.');
    } finally {
      setAdding(false);
    }
  };

  const removeChannel = (channel: Channel) =>
    updateItem('channels', (all) => {
      const next = { ...all };
      delete next[channel.id];
      return next;
    }).then(() => updateItem('videos', (videos) => Object.fromEntries(Object.entries(videos).filter(([, v]) => v.channelId !== channel.id))));

  const renderRow = ({ channel, profile }: { channel: Channel; profile: ChannelProfile | null }) => {
    const ref = { id: channel.id, title: channel.title, handle: channel.handle };
    const rule = channelRuleOf(mode, ref) ?? 'default';
    const total = profile?.total ?? videoCounts.get(channel.id) ?? 0;
    const showTier = profile && !channel.ignored && ['educational', 'adjacent', 'news', 'occasional'].includes(profile.kind);
    return (
      <div key={channel.id} className="fs-channel-row" data-ignored={channel.ignored}>
        {channel.thumbnail ? <img className="fs-avatar" src={channel.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="fs-avatar">{channel.title.slice(0, 1).toUpperCase()}</span>}
        <div style={{ minWidth: 0 }}>
          <div className="fs-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <a className="fs-h3 fs-truncate" href={channelUrl(channel.id, channel.handle)} target="_blank" rel="noreferrer">
              {channel.title}
            </a>
            {showTier && (profile.kind === 'news' ? <Badge>News</Badge> : <Badge tone={profile.tier === 'excellent' ? 'success' : profile.tier === 'strong' ? 'accent' : 'neutral'}>{CHANNEL_TIER_LABEL[profile.tier]}</Badge>)}
            <Badge>{channel.source === 'manual' ? 'Added' : 'Subscribed'}</Badge>
          </div>
          <div className="fs-row fs-caption" style={{ gap: 8, flexWrap: 'wrap' }}>
            {channel.handle && <span>{channel.handle}</span>}
            {channel.ignored ? (
              <span>Ignored — left out of your library</span>
            ) : profile ? (
              <>
                <span>
                  {profile.relevant} of {total} recent videos match · {channelKindLabel(profile.kind, modeName)}
                </span>
                {profile.total > 0 && (
                  <span className="fs-mini-bar" aria-hidden>
                    <span style={{ width: `${profile.relevantShare * 100}%` }} />
                  </span>
                )}
              </>
            ) : (
              <span>{total ? `${total} recent videos` : 'Not synced yet'}</span>
            )}
            {channel.lastError && <span style={{ color: 'var(--fs-warning)' }}>Feed error</span>}
          </div>
          {data.settings.debugRelevance && profile && (
            <div className="fs-caption fs-mono">
              score {profile.score} · relevant {profile.relevantShare} · mean {profile.meanRelevance} · edu {profile.educationalShare} · topical {profile.topicalShare} · news {profile.newsShare} · coverage {profile.coverage}
            </div>
          )}
        </div>
        <div className="fs-channel-controls">
          {mode && (
            <Segmented
              label={`Rule for ${channel.title} in ${mode.name}`}
              value={rule}
              onChange={(v) => setChannelRule(mode.id, ref, v === 'default' ? null : v)}
              options={[
                { value: 'default', label: 'Auto' },
                { value: 'allowed', label: 'Allow' },
                { value: 'blocked', label: 'Block' },
              ]}
            />
          )}
          <label className="fs-row fs-caption" title="Ignored channels are left out of the library">
            Ignore
            <Switch label={`Ignore ${channel.title}`} checked={channel.ignored} onChange={(ignored) => updateItem('channels', (all) => ({ ...all, [channel.id]: { ...all[channel.id], ignored } }))} />
          </label>
          <IconButton size="sm" label={`Remove ${channel.title}`} icon={<Trash2 />} onClick={() => removeChannel(channel)} />
        </div>
      </div>
    );
  };

  const grouped = groups
    .map((g) => ({ ...g, rows: rows.filter((r) => !r.channel.ignored && (r.profile ? g.kinds.includes(r.profile.kind) : g.id === 'other')) }))
    .filter((g) => g.rows.length > 0);
  const ignoredRows = rows.filter((r) => r.channel.ignored);

  return (
    <>
      <div className="fs-page-head">
        <div>
          <h1 className="fs-h1">Subscribed channels</h1>
          <p>Ranked for {modeName}: channels that consistently teach it come first, then channels that often cover it, then news. Your list comes from your signed-in YouTube session; videos from each channel's public feed.</p>
        </div>
        <div className="fs-row-wrap">
          <Button variant="secondary" icon={<RefreshCw />} loading={sync?.status === 'importing'} disabled={busy} onClick={runImport}>
            Import from YouTube
          </Button>
          <Button variant="primary" icon={<RefreshCw />} loading={sync?.status === 'syncing'} disabled={busy || totalChannels === 0} onClick={() => sendMessage('library/sync', { force: true })}>
            Sync videos
          </Button>
        </div>
      </div>

      {sync?.status === 'syncing' && sync.progress && (
        <div className="fs-card fs-card-pad fs-stack-sm" aria-live="polite">
          <div className="fs-spread">
            <span className="fs-body-sm">Checking channel feeds…</span>
            <span className="fs-caption fs-nums">
              {sync.progress.done} / {sync.progress.total}
            </span>
          </div>
          <ProgressBar value={sync.progress.total ? sync.progress.done / sync.progress.total : 0} label="Sync progress" />
        </div>
      )}
      {sync?.status === 'importing' && <Alert icon={<RefreshCw />}>Reading your subscriptions from YouTube…</Alert>}
      {importResult?.ok && (
        <Alert icon={<CheckCircle2 />}>
          Found {importResult.imported} subscriptions ({importResult.added} new).{importResult.complete ? '' : ' YouTube returned a partial list; run the import again later to pick up the rest.'}
        </Alert>
      )}
      {importResult && !importResult.ok && (
        <Alert tone="danger" icon={<AlertTriangle />}>
          {importResult.error}
          {importResult.code === 'signed-out' && ' Sign in on youtube.com, then try again — or add channels manually below.'}
        </Alert>
      )}
      {sync?.lastError && !busy && !importResult && <Alert tone="warning" icon={<AlertTriangle />}>{sync.lastError}</Alert>}

      <div className="fs-stats">
        <Stat label="Channels" value={store ? totalChannels : null} />
        <Stat label="Videos indexed" value={library.library ? library.library.totalVideos : store ? 0 : null} />
        <Stat label={`Highly relevant to ${modeName}`} value={library.library ? library.library.items.length : store ? 0 : null} />
        <div className="fs-card">
          <div className="fs-stat">
            <span className="fs-stat-value" style={{ fontSize: 15, paddingTop: 6 }}>
              {sync?.lastSyncAt ? relativeTime(sync.lastSyncAt) : 'Never'}
            </span>
            <span className="fs-stat-label">Last synced{sync?.lastImportAt ? ` · imported ${relativeTime(sync.lastImportAt)}` : ''}</span>
          </div>
        </div>
      </div>

      <form
        className="fs-card fs-card-pad fs-stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (addInput.trim()) void add();
        }}
      >
        <span className="fs-label">Add a channel</span>
        <div className="fs-row-wrap">
          <div className="fs-grow" style={{ minWidth: 240 }}>
            <TextInput value={addInput} onChange={(e) => setAddInput(e.target.value)} placeholder="youtube.com/@channel, @handle, or UC… channel ID" aria-label="Channel link or handle" />
          </div>
          <Button type="submit" icon={<Plus />} loading={adding} disabled={!addInput.trim()}>
            Add channel
          </Button>
        </div>
        {addError && <span className="fs-caption" style={{ color: 'var(--fs-danger)' }}>{addError}</span>}
        <span className="fs-hint">Useful for channels you don't subscribe to, or if you prefer not to import your whole list.</span>
      </form>

      <div className="fs-spread" style={{ flexWrap: 'wrap' }}>
        <div className="fs-row-wrap">
          <label className="fs-row fs-body-sm">
            <span className="fs-muted">Ranked for</span>
            <select className="fs-select fs-input-sm" style={{ width: 'auto', height: 32 }} value={mode?.id ?? ''} onChange={(e) => setModeId(e.target.value)}>
              {data.modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <Segmented label="Filter channels" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'relevant', label: 'Relevant' }, { value: 'ignored', label: 'Ignored' }]} />
        </div>
        <div className="fs-search" style={{ width: 260, maxWidth: '100%' }}>
          <Search aria-hidden />
          <input className="fs-input" style={{ height: 36, fontSize: 13 }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter channels" aria-label="Filter channels" />
        </div>
      </div>

      {!store || library.loading ? (
        <div className="fs-card fs-card-pad fs-stack-sm">
          <Skeleton height={40} />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      ) : totalChannels === 0 ? (
        <EmptyState icon={<Users />} title="No channels yet" actions={<Button variant="primary" icon={<RefreshCw />} onClick={runImport} loading={sync?.status === 'importing'}>Import from YouTube</Button>}>
          Import your subscriptions (you need to be signed in to YouTube in this browser) or add channels one by one above.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search />} title="No channels match">
          Try a different filter{mode ? ` or check which topics ${mode.name} includes` : ''}.
        </EmptyState>
      ) : (
        <div>
          {filter !== 'ignored' &&
            grouped.map((group) => (
              <section key={group.id} className="fs-channel-group" aria-label={group.title}>
                <header>
                  <h2 className="fs-h3">{group.title}</h2>
                  <p>
                    {group.description} · {group.rows.length}
                  </p>
                </header>
                <div className="fs-card">{group.rows.map(renderRow)}</div>
              </section>
            ))}
          {(filter === 'ignored' || filter === 'all') && ignoredRows.length > 0 && (
            <section className="fs-channel-group" aria-label="Ignored">
              <header>
                <h2 className="fs-h3">Ignored</h2>
                <p>Left out of your library · {ignoredRows.length}</p>
              </header>
              <div className="fs-card">{ignoredRows.map(renderRow)}</div>
            </section>
          )}
        </div>
      )}
      <p className="fs-caption">
        Channel relevance comes from each channel's recent videos: how many clearly match {modeName}, how consistently they teach, and how many topics they cover. Public feeds include ~15 latest uploads per channel, and the library deepens with every sync.
      </p>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="fs-card">
      <div className="fs-stat">
        {value === null ? <Skeleton width={60} height={28} /> : <span className="fs-stat-value">{value.toLocaleString()}</span>}
        <span className="fs-stat-label">{label}</span>
      </div>
    </div>
  );
}
