import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Copy, Download, LogIn, MessageCircle, Network, NotebookPen, Play, Search, Trash2 } from 'lucide-react';
import type { SavedNote } from '@/types/notes';
import type { ChatSession } from '@/types/chat';
import type { LearningMode } from '@/types/domain';
import { openYouTube } from '../DashboardApp';
import { navigate } from '../router';
import { relativeTime } from '@/learning/library';
import { formatTimestamp } from '@/learning/knowledge/timestamps';
import { allSavedNotes, FORMAT_NAME, noteLabel, noteStartSec } from '@/learning/notes/label';
import { groupBySpace, type LibraryItem } from '@/learning/notes/grouping';
import { deleteNote } from '@/storage/notes-store';
import { deleteChatSession } from '@/storage/chat-store';
import { watchUrl } from '@/integrations/youtube/urls';
import { useStorage } from '@/ui/hooks';
import { RichText } from '@/ui/components/RichText';
import { MindMapOutline, downloadMindMapSvg } from '@/ui/mindmap/MindMapDiagram';
import { MindMapCanvas } from '@/ui/mindmap/MindMapCanvas';
import { Alert, Button, EmptyState, Segmented, TextInput } from '@/ui/components/primitives';
import { SAVE_PROMPT } from '@/ui/account/save-gate';
import { openSignIn, useCanSave } from '@/ui/account/use-can-save';
import { Modal } from '@/ui/components/Modal';

/**
 * Everything the learner has made from YouTube: notes, mind maps and AI conversations. Until this page,
 * a saved note could only be found again on its own video's panel, and clicking it merely seeked the
 * video. Here every item is listed, searchable, and opens to its actual content.
 */

type Tab = 'notes' | 'mindmaps' | 'chats';
const TABS: { value: Tab; label: string }[] = [
  { value: 'notes', label: 'Notes' },
  { value: 'mindmaps', label: 'Mind maps' },
  { value: 'chats', label: 'AI chats' },
];

const atTime = (videoId: string, sec: number) => `${watchUrl(videoId)}${sec > 0 ? `&t=${sec}s` : ''}`;

export function LibraryPage({ segments }: { segments: string[] }) {
  const store = useStorage(['notes', 'chatSessions', 'modes'] as const);
  const [, view, id] = segments;
  if (!store) return null;
  const notes = allSavedNotes(store.notes.byVideo);
  const chats = store.chatSessions.sessions;

  if (view === 'note') {
    const note = notes.find((n) => n.id === decodeURIComponent(id ?? ''));
    return note ? <NoteReader note={note} /> : <Missing />;
  }
  if (view === 'chat') {
    const chat = chats.find((c) => c.id === decodeURIComponent(id ?? ''));
    return chat ? <ChatReader chat={chat} /> : <Missing />;
  }
  const tab: Tab = view === 'mindmaps' || view === 'chats' ? view : 'notes';
  return <LibraryList tab={tab} notes={notes} chats={chats} modes={store.modes} />;
}

function LibraryList({ tab, notes, chats, modes }: { tab: Tab; notes: SavedNote[]; chats: ChatSession[]; modes: LearningMode[] }) {
  const [query, setQuery] = useState('');
  const [space, setSpace] = useState<string | null>(null);
  const canSave = useCanSave();
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const matches = (text: string) => !q || text.toLowerCase().includes(q);
    if (tab === 'chats') return chats.filter((c) => matches(`${c.title ?? ''} ${c.messages.map((m) => m.text).join(' ')}`));
    return notes.filter((n) => (tab === 'mindmaps' ? n.format === 'mindmap' : n.format === 'notes') && matches(`${n.provenance.videoTitle} ${n.provenance.channel} ${n.provenance.topic ?? ''} ${n.markdown ?? ''}`));
  }, [tab, notes, chats, q]);

  // Filed under its Space (learning/notes/grouping.ts), so the shelf reads the way revision does.
  const spaces = useMemo(() => modes.map((m) => ({ id: m.id, name: m.name })), [modes]);
  const groups = useMemo(() => groupBySpace(shown as LibraryItem[], spaces), [shown, spaces]);
  const grouped = groups.filter((g) => space === null || g.space.id === space);
  const filtered = grouped.flatMap((g) => g.items);

  return (
    <>
      <div className="fs-page-head">
        <div>
          <h1 className="fs-h1">Library</h1>
          <p>Every note, mind map and AI conversation you saved while watching, kept in this browser for your account.</p>
        </div>
      </div>
      {/* Anything saved before signing out is still shown below; only new saves need an account (ui/account/save-gate.ts). */}
      {canSave === false && (
        <Alert
          action={
            <Button size="sm" icon={<LogIn />} onClick={openSignIn}>
              {SAVE_PROMPT.action}
            </Button>
          }
        >
          {SAVE_PROMPT.library}
        </Alert>
      )}
      <div className="fs-row-wrap" style={{ justifyContent: 'space-between' }}>
        <Segmented label="Library section" value={tab} options={TABS} onChange={(next) => navigate(next === 'notes' ? '/library' : `/library/${next}`)} />
        <div className="fs-lib-search">
          <Search size={15} aria-hidden />
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your library" aria-label="Search your library" small />
        </div>
      </div>

      {groups.length > 1 && (
        <div className="fs-row-wrap">
          <button type="button" className="fs-space-chip" aria-pressed={space === null} onClick={() => setSpace(null)}>
            All ({shown.length})
          </button>
          {groups.map((g) => (
            <button key={g.space.id || 'none'} type="button" className="fs-space-chip" aria-pressed={space === g.space.id} onClick={() => setSpace(g.space.id)}>
              {g.space.name} ({g.items.length})
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={tab === 'chats' ? <MessageCircle /> : tab === 'mindmaps' ? <Network /> : <NotebookPen />}
          title={q ? 'Nothing matches that search' : tab === 'chats' ? 'No AI chats yet' : tab === 'mindmaps' ? 'No mind maps yet' : 'No notes yet'}
          actions={q ? undefined : <Button onClick={() => openYouTube()}>Open YouTube</Button>}
        >
          {q ? 'Try a word from the video title or the note.' : tab === 'chats' ? 'Ask FocusSpace AI about a video, or use the bubble on YouTube’s home. Conversations are kept here.' : 'On any video, open FocusSpace’s panel, choose Make Notes, then Save.'}
        </EmptyState>
      ) : (
        grouped.map(({ space: s, items }) => (
          <section key={s.id || 'none'} className="fs-home-section">
            <header>
              <h2>
                {s.name} <span className="fs-caption">({items.length})</span>
              </h2>
            </header>
            <div className="fs-card fs-list">
              {items.map((item) =>
                'provenance' in item ? (
                  <button key={item.id} type="button" className="fs-list-item fs-lib-row" onClick={() => navigate(`/library/note/${encodeURIComponent(item.id)}`)}>
                    <span className="fs-lib-icon">{item.format === 'mindmap' ? <Network size={16} /> : <NotebookPen size={16} />}</span>
                    <span className="fs-grow fs-lib-text">
                      <span className="fs-lib-title">{item.provenance.videoTitle}</span>
                      <span className="fs-caption">{[item.provenance.channel, item.provenance.topic, noteLabel(item)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="fs-caption">{relativeTime(item.createdAt)}</span>
                  </button>
                ) : (
                  <button key={item.id} type="button" className="fs-list-item fs-lib-row" onClick={() => navigate(`/library/chat/${encodeURIComponent(item.id)}`)}>
                    <span className="fs-lib-icon">
                      <MessageCircle size={16} />
                    </span>
                    <span className="fs-grow fs-lib-text">
                      <span className="fs-lib-title">{item.messages.find((m) => m.role === 'learner')?.text ?? 'Conversation'}</span>
                      <span className="fs-caption">
                        {item.title ?? 'YouTube'} · {Math.ceil(item.messages.length / 2)} {item.messages.length > 2 ? 'questions' : 'question'}
                      </span>
                    </span>
                    <span className="fs-caption">{relativeTime(item.updatedAt)}</span>
                  </button>
                ),
              )}
            </div>
          </section>
        ))
      )}
    </>
  );
}

function ReaderHead({ back, title, meta, actions }: { back: string; title: string; meta: string; actions: ReactNode }) {
  return (
    <div className="fs-reader-head">
      <Button size="sm" variant="ghost" icon={<ArrowLeft />} onClick={() => navigate(back)}>
        Library
      </Button>
      <h1 className="fs-h1">{title}</h1>
      <p className="fs-caption">{meta}</p>
      <div className="fs-row-wrap">{actions}</div>
    </div>
  );
}

function DeleteButton({ what, onDelete }: { what: string; onDelete: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => setAsking(true)}>
        Delete
      </Button>
      <Modal
        open={asking}
        onClose={() => setAsking(false)}
        title={`Delete this ${what}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void onDelete()}>
              Delete
            </Button>
          </>
        }
      >
        <p>It is removed from this browser and cannot be brought back.</p>
      </Modal>
    </>
  );
}

function NoteReader({ note }: { note: SavedNote }) {
  const back = note.format === 'mindmap' ? '/library/mindmaps' : '/library';
  const start = noteStartSec(note);
  const [copied, setCopied] = useState(false);
  const meta = [note.provenance.channel, FORMAT_NAME[note.format], noteLabel(note), `saved ${relativeTime(note.createdAt)}`].filter(Boolean).join(' · ');
  return (
    <>
      <ReaderHead
        back={back}
        title={note.provenance.videoTitle}
        meta={meta}
        actions={
          <>
            <Button size="sm" variant="secondary" icon={<Play />} onClick={() => openYouTube(atTime(note.videoId, start))}>
              {start > 0 ? `Watch from ${formatTimestamp(start)}` : 'Watch the video'}
            </Button>
            {note.markdown && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Copy />}
                onClick={() => void navigator.clipboard.writeText(note.markdown ?? '').then(() => setCopied(true), () => undefined)}
              >
                {copied ? 'Copied' : 'Copy text'}
              </Button>
            )}
            <DeleteButton
              what={note.format === 'mindmap' ? 'mind map' : 'note'}
              onDelete={async () => {
                await deleteNote(note.videoId, note.id);
                navigate(back);
              }}
            />
          </>
        }
      />
      <article className="fs-card fs-reader-body">{note.markdown ? <RichText text={note.markdown} /> : note.mindmap ? <MindMapView note={note} /> : <p>This note is empty.</p>}</article>
    </>
  );
}

/** Tree, cloud or outline, with SVG export — the same views the YouTube panel offers, at full width. */
function MindMapView({ note }: { note: SavedNote }) {
  const [view, setView] = useState<'tree' | 'cloud' | 'text'>('tree');
  const holder = useRef<HTMLDivElement>(null);
  const filename = `${note.provenance.videoTitle.replace(/[^\w\s-]/g, '').trim().slice(0, 60).replace(/\s+/g, '-') || 'mind-map'}-mindmap${view === 'cloud' ? '-cloud' : ''}.svg`;
  if (!note.mindmap) return null;
  return (
    <div className="fs-reader-mindmap">
      <div className="fs-row-wrap">
        <Segmented
          label="Mind map view"
          value={view}
          onChange={setView}
          options={[
            { value: 'tree', label: 'Tree' },
            { value: 'cloud', label: 'Cloud' },
            { value: 'text', label: 'Outline' },
          ]}
        />
        {view !== 'text' && (
          <Button size="sm" variant="ghost" icon={<Download />} onClick={() => downloadMindMapSvg(holder.current, filename)}>
            SVG
          </Button>
        )}
      </div>
      <div ref={holder} className="fs-reader-mindmap-canvas">
        {view === 'text' ? <MindMapOutline node={note.mindmap} /> : <MindMapCanvas root={note.mindmap} maxHeight="70vh" variant={view} />}
      </div>
    </div>
  );
}

function ChatReader({ chat }: { chat: ChatSession }) {
  const first = chat.messages.find((m) => m.role === 'learner');
  return (
    <>
      <ReaderHead
        back="/library/chats"
        title={first?.text ?? 'Conversation'}
        meta={`${chat.title ?? 'YouTube'} · ${relativeTime(chat.updatedAt)}`}
        actions={
          <>
            {chat.videoId && (
              <Button size="sm" variant="secondary" icon={<Play />} onClick={() => openYouTube(atTime(chat.videoId, Math.floor(first?.currentTime ?? 0)))}>
                Watch the video
              </Button>
            )}
            <DeleteButton
              what="conversation"
              onDelete={async () => {
                await deleteChatSession(chat.id);
                navigate('/library/chats');
              }}
            />
          </>
        }
      />
      <div className="fs-chat-log">
        {chat.messages.map((m) => (
          <div key={m.id} className="fs-chat-turn" data-role={m.role}>
            <span className="fs-caption">{m.role === 'learner' ? 'You' : 'FocusSpace AI'}{m.videoId && m.currentTime > 0 ? ` · ${formatTimestamp(m.currentTime)}` : ''}</span>
            {m.role === 'assistant' ? <RichText text={m.text} /> : <p>{m.text}</p>}
          </div>
        ))}
      </div>
    </>
  );
}

function Missing() {
  return (
    <EmptyState icon={<NotebookPen />} title="This item isn’t in your library" actions={<Button onClick={() => navigate('/library')}>Back to Library</Button>}>
      It may have been deleted, or it belongs to another account on this browser.
    </EmptyState>
  );
}
