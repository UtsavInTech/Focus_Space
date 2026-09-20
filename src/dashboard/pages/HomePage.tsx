import { ArrowRight, BookOpen, Brain, Crown, History, Lightbulb, ListChecks, MessageCircle, Network, NotebookPen, Plus, Sparkles } from 'lucide-react';
import type { DashboardData } from '../DashboardApp';
import { openYouTube } from '../DashboardApp';
import { navigate } from '../router';
import { FREE_SPACE_LIMIT, GUEST_SPACE_LIMIT } from '@/billing/plans';
import { isPaidPlan, PlanName } from '@/ui/components/PlanName';
import { upgradeOffer } from '@/billing/upgrade';
import { selectMode } from '@/modes/service';
import { sendMessage } from '@/messaging/runtime';
import { relativeTime } from '@/learning/library';
import { allSavedNotes, FORMAT_NAME, noteLabel } from '@/learning/notes/label';
import { thumbnailUrl, watchUrl } from '@/integrations/youtube/urls';
import { useAccountFlow } from '@/ui/account/flow';
import { useStorage } from '@/ui/hooks';
import { SpaceIcon } from '@/ui/icons';
import { Button, greeting } from '@/ui/components/primitives';

/**
 * The dashboard's front page: everything the learner has made and is in the middle of, in one place —
 * Spaces, what they were watching, their notes and mind maps, their AI conversations — with the plan
 * alongside. The learning itself still happens on YouTube; this is where it is kept.
 */
export function HomePage({ data }: { data: DashboardData }) {
  const store = useStorage(['notes', 'watchHistory', 'chatSessions'] as const);
  const { user, usage, spaces } = useAccountFlow();
  const notes = allSavedNotes(store?.notes.byVideo ?? {});
  const recentNotes = notes.slice(0, 4);
  const continuing = latestPerVideo(store?.watchHistory ?? []).filter((e) => e.progress < 0.9).slice(0, 4);
  const chats = (store?.chatSessions.sessions ?? []).slice(0, 3);
  const yourName = (user?.name ?? '').trim() || data.settings.displayName.trim();

  return (
    <>
      <div className="fs-page-head">
        <div>
          <h1 className="fs-h1">
            {greeting()}
            {/* The account's name when signed in — asking again for a name the account already has is what made it feel forgetful. */}
            {yourName ? `, ${yourName}` : ''}
          </h1>
          <p>Your Spaces, what you were watching, and everything you have saved from YouTube.</p>
        </div>
        <Button variant="primary" icon={<ArrowRight />} onClick={() => openYouTube()}>
          Open YouTube
        </Button>
      </div>

      <PlanCard signedIn={!!user} modes={data.modes.length} usage={usage ?? null} spaces={spaces ?? null} />

      <section className="fs-home-section" aria-labelledby="home-spaces">
        <header>
          <h2 id="home-spaces">Your Spaces</h2>
          <button type="button" className="fs-link" onClick={() => navigate('/modes')}>
            Manage
          </button>
        </header>
        <div className="fs-row-wrap">
          {data.modes.map((m) => (
            <button key={m.id} type="button" className="fs-space-chip" aria-pressed={m.id === data.settings.activeModeId} onClick={() => void selectMode(m.id)}>
              <SpaceIcon name={m.icon} size={15} /> {m.name}
            </button>
          ))}
          <button type="button" className="fs-space-chip fs-space-chip-add" onClick={() => navigate('/modes?new=1')}>
            <Plus size={15} aria-hidden /> New Space
          </button>
        </div>
      </section>

      {continuing.length > 0 && (
        <section className="fs-home-section" aria-labelledby="home-continue">
          <header>
            <h2 id="home-continue">Continue watching</h2>
            <button type="button" className="fs-link" onClick={() => navigate('/history')}>
              History
            </button>
          </header>
          <div className="fs-home-grid">
            {continuing.map((e) => (
              <button key={e.videoId} type="button" className="fs-card fs-home-video" onClick={() => openYouTube(watchUrl(e.videoId))}>
                <span className="fs-home-thumb">
                  <img src={thumbnailUrl(e.videoId)} alt="" loading="lazy" />
                  <span className="fs-home-progress" style={{ width: `${Math.round(e.progress * 100)}%` }} />
                </span>
                <span className="fs-home-video-title">{e.title}</span>
                <span className="fs-caption">
                  {e.channelTitle} · {relativeTime(e.watchedAt)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="fs-home-section" aria-labelledby="home-library">
        <header>
          <h2 id="home-library">Recent notes and mind maps</h2>
          <button type="button" className="fs-link" onClick={() => navigate('/library')}>
            Library{notes.length ? ` (${notes.length})` : ''}
          </button>
        </header>
        {recentNotes.length ? (
          <div className="fs-card fs-list">
            {recentNotes.map((n) => (
              <button key={n.id} type="button" className="fs-list-item fs-lib-row" onClick={() => navigate(`/library/note/${encodeURIComponent(n.id)}`)}>
                <span className="fs-lib-icon">{n.format === 'mindmap' ? <Network size={16} /> : <NotebookPen size={16} />}</span>
                <span className="fs-grow fs-lib-text">
                  <span className="fs-lib-title">{n.provenance.videoTitle}</span>
                  <span className="fs-caption">
                    {FORMAT_NAME[n.format]} · {noteLabel(n)}
                  </span>
                </span>
                <span className="fs-caption">{relativeTime(n.createdAt)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="fs-home-empty">Notes and mind maps you save on a video appear here. On any lecture, open FocusSpace’s panel and choose Make Notes.</p>
        )}
      </section>

      <section className="fs-home-section" aria-labelledby="home-chats">
        <header>
          <h2 id="home-chats">AI chats</h2>
          {chats.length > 0 && (
            <button type="button" className="fs-link" onClick={() => navigate('/library/chats')}>
              All chats
            </button>
          )}
        </header>
        {chats.length ? (
          <div className="fs-card fs-list">
            {chats.map((c) => (
              <button key={c.id} type="button" className="fs-list-item fs-lib-row" onClick={() => navigate(`/library/chat/${encodeURIComponent(c.id)}`)}>
                <span className="fs-lib-icon">
                  <MessageCircle size={16} />
                </span>
                <span className="fs-grow fs-lib-text">
                  <span className="fs-lib-title">{c.messages.find((m) => m.role === 'learner')?.text ?? 'Conversation'}</span>
                  <span className="fs-caption">
                    {c.title ?? 'YouTube'} · {Math.ceil(c.messages.length / 2)} {c.messages.length > 2 ? 'questions' : 'question'}
                  </span>
                </span>
                <span className="fs-caption">{relativeTime(c.updatedAt)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="fs-home-empty">Conversations with FocusSpace AI — on a video, or from the bubble on YouTube — are kept here.</p>
        )}
      </section>

      <section className="fs-home-section" aria-labelledby="home-tools">
        <header>
          <h2 id="home-tools">AI study tools, on any video</h2>
        </header>
        <div className="fs-home-tools">
          {TOOLS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="fs-card fs-home-tool">
              <Icon size={18} aria-hidden />
              <strong>{title}</strong>
              <span>{body}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const TOOLS = [
  { icon: Lightbulb, title: 'Explain', body: 'The idea on screen right now, in plain words.' },
  { icon: ListChecks, title: 'Quiz me', body: 'Questions on what you just watched.' },
  { icon: NotebookPen, title: 'Notes', body: 'For a section, what you have watched, or the entire video.' },
  { icon: Network, title: 'Mind maps', body: 'The lecture’s structure as a diagram you can export.' },
  { icon: Brain, title: 'Ask AI', body: 'A conversation about the video, aware of where you are in it.' },
  { icon: Sparkles, title: 'FocusSpace AI', body: 'The bubble on YouTube’s home: what to watch next in your Space.' },
];

/** The plan, and the one next step that would give the learner more — never a wall of upsell. */
function PlanCard({ signedIn, modes, usage, spaces }: { signedIn: boolean; modes: number; usage: { plan: string; used: number; limit: number | null } | null; spaces: { used: number; limit: number | null } | null }) {
  const openPricing = () => void sendMessage('site/open', { path: '/pricing' }).catch(() => undefined);
  if (!signedIn) {
    const full = modes >= GUEST_SPACE_LIMIT;
    return (
      <div className="fs-card fs-plan-card" data-tone={full ? 'nudge' : undefined}>
        <BookOpen size={18} aria-hidden />
        <div className="fs-grow">
          <strong>{full ? `You’re using all ${GUEST_SPACE_LIMIT} Spaces` : 'Using FocusSpace without an account'}</strong>
          <span className="fs-caption">
            {full ? `A free account raises that to ${FREE_SPACE_LIMIT}, with a monthly AI allowance.` : `${modes} of ${GUEST_SPACE_LIMIT} Spaces. A free account gives you ${FREE_SPACE_LIMIT} and a monthly AI allowance.`}
          </span>
        </div>
        <Button size="sm" variant={full ? 'primary' : 'secondary'} onClick={() => navigate('/settings')}>
          Create free account
        </Button>
      </div>
    );
  }
  const plan = usage?.plan ?? 'free';
  const paid = isPaidPlan(plan);
  const upgrade = upgradeOffer(plan, spaces);
  const openAccount = () => void sendMessage('site/open', { path: '/account' }).catch(() => undefined);
  return (
    <div className="fs-card fs-plan-card" data-tone={upgrade ? 'nudge' : paid ? 'premium' : undefined}>
      {paid ? <Crown size={18} aria-hidden className="fs-plan-crown" /> : <History size={18} aria-hidden />}
      <div className="fs-grow">
        <strong>
          <PlanName plan={plan} />
        </strong>
        <span className="fs-caption">
          {spaces ? (spaces.limit === null ? 'Unlimited Spaces' : `${spaces.used} of ${spaces.limit} Spaces`) : ''}
          {usage ? ` · ${usage.limit === null ? 'Unlimited AI credits' : `${usage.used} of ${usage.limit} AI credits this month`}` : ''}
        </span>
      </div>
      {upgrade ? (
        <Button size="sm" variant="primary" onClick={openPricing}>
          {upgrade}
        </Button>
      ) : paid ? (
        <Button size="sm" variant="ghost" onClick={openAccount}>
          Manage plan
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={openPricing}>
          Plans
        </Button>
      )}
    </div>
  );
}

/** Watch history holds a row per viewing; the latest one per video is what "continue" means. */
function latestPerVideo<T extends { videoId: string; watchedAt: number }>(entries: T[]): T[] {
  const seen = new Map<string, T>();
  for (const e of [...entries].sort((a, b) => b.watchedAt - a.watchedAt)) if (!seen.has(e.videoId)) seen.set(e.videoId, e);
  return [...seen.values()];
}

export { latestPerVideo };
