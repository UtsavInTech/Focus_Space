import { readVideoDuration } from '../data/knowledge';
import { fetchOutline, outlineRequest } from '../data/outline';
import { useEffect, useRef, useState } from 'react';
import { Cloud, Download, Maximize2, Network, NotebookPen, Save, Text, Trash2, X } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import type { GeneratedNote, MindMapNode, NoteFormat, NoteLanguage, SavedNote } from '@/types/notes';
import type { KnowledgeMap, KnowledgeSource, TranscriptSegment } from '@/learning/knowledge/types';
import type { OutlineSection } from '@/learning/outline/outline';
import { formatTimestamp } from '@/learning/knowledge/timestamps';
import type { LearningPath } from '@/learning/path/path';
import type { NoteRequestInputs } from '@/learning/notes/generator';
import type { NoteScope } from '@/learning/notes/scope';
import { sendMessage } from '@/messaging/runtime';
import { Modal } from '@/ui/components/Modal';
import { RichText } from '@/ui/components/RichText';
import { FORMAT_NAME, noteLabel, noteStartSec } from '@/learning/notes/label';
import { MindMapDiagram, MindMapOutline, downloadMindMapSvg, type MindMapVariant } from '@/ui/mindmap/MindMapDiagram';
import { MindMapCanvas } from '@/ui/mindmap/MindMapCanvas';
import { useCanSave } from '@/ui/account/use-can-save';
import { SignInToSave } from './SignInToSave';

/**
 * "Make Notes": the minimum UI to pick a scope, a format and a language,
 * generate through WS2's generator (wired to a real provider by
 * notes-integration.ts, via the 'notes/generate' message), and save/view/
 * delete the result. No new page, no redesign — one more card in the
 * existing "Learn with AI" section, styled with the same fs-ai-chip/
 * fs-answer classes the point actions already use.
 */

const SCOPE_OPTIONS: { scope: NoteScope; label: string }[] = [
  { scope: { kind: 'current-section' }, label: 'Current section' },
  { scope: { kind: 'watched-so-far' }, label: 'Watched so far' },
  { scope: { kind: 'full-video' }, label: 'Full video' },
  { scope: { kind: 'revision' }, label: 'Revision' },
];

/** What a note was grounded in, in words — never the internal source ids. */
const SOURCE_NAME: Record<KnowledgeSource, string> = { transcript: 'transcript', chapters: 'chapters', 'auto-chapters': 'chapters', description: 'description', comments: 'viewer comments', ai: 'outline' };

const scopeKey = (s: NoteScope) => (s.kind === 'range' ? `range:${s.range.startSec}-${s.range.endSec}` : s.kind);

const LANGUAGES: { id: NoteLanguage; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिंदी' },
  { id: 'hinglish', label: 'Hinglish' },
];

export interface NotesPanelProps {
  video: { id: string; title: string; channelTitle: string };
  mode: LearningMode;
  topicId: string | null;
  path: LearningPath | null;
  map: KnowledgeMap | null;
  transcript: TranscriptSegment[] | null;
  /** The whole-video outline, when it has already arrived (content/data/outline.ts). */
  outline?: OutlineSection[] | null;
  /** Fetches the captions when they have not arrived yet (see ChatPanel's prop of the same name). */
  loadTranscript?: () => Promise<TranscriptSegment[] | null>;
  durationSec: number | null;
  currentTime: () => number;
  defaultLanguage: NoteLanguage;
  onSeek: (sec: number) => void;
  onClose: () => void;
}

type GenState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; note: GeneratedNote; saved: boolean } | { kind: 'no-evidence'; reason: string } | { kind: 'error'; error: string; code?: string };

export function NotesPanel({ video, mode, topicId, path, map, transcript: known, outline, loadTranscript, durationSec, currentTime, defaultLanguage, onSeek, onClose }: NotesPanelProps) {
  const [scope, setScope] = useState<NoteScope>(SCOPE_OPTIONS[0].scope);
  const [format, setFormat] = useState<NoteFormat>('notes');
  const [language, setLanguage] = useState<NoteLanguage>(defaultLanguage);
  const [gen, setGen] = useState<GenState>({ kind: 'idle' });
  const [saved, setSaved] = useState<SavedNote[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /** Generating is open to everyone; keeping the result needs an account (ui/account/save-gate.ts). */
  const canSave = useCanSave();

  useEffect(() => {
    let alive = true;
    sendMessage('notes/list', { videoId: video.id })
      .then((list) => alive && setSaved(list))
      .catch(() => alive && setSaved([]));
    return () => {
      alive = false;
    };
  }, [video.id]);

  async function generate() {
    setGen({ kind: 'loading' });
    // The polled length can lag the player by a moment (e.g. just after an ad); ask the player directly rather than
    // turn an "Entire video" request into a watched-so-far note.
    // Notes of a part never played still need its words: fetch the captions rather than write from chapters alone.
    const transcript = known?.length || !loadTranscript ? known : await loadTranscript().catch(() => null);
    const duration = durationSec ?? readVideoDuration(video.id);
    // A map or notes of more than one section are organised by the video's topics. The first viewer's
    // outline is still being made, so wait for it briefly rather than build this one without it.
    const wide = scope.kind !== 'current-section';
    const topics = outline ?? (wide && transcript?.length ? await fetchOutline(outlineRequest(video, transcript, duration, map)) : null);
    const inputs: NoteRequestInputs = { video, mode, topicId, path, map, transcript, outline: topics, currentTime: currentTime(), durationSec: duration, scope, format, language };
    const result = await sendMessage('notes/generate', { inputs }).catch(() => null);
    if (!result) {
      setGen({ kind: 'error', error: 'FocusSpace couldn’t reach its AI service. Reload the page and try again.' });
      return;
    }
    if (!result.ok) {
      setGen(result.code === 'no-evidence' ? { kind: 'no-evidence', reason: result.reason } : { kind: 'error', error: result.reason, code: result.code });
      return;
    }
    setGen({ kind: 'ready', note: result.note, saved: false });
  }

  async function save() {
    if (gen.kind !== 'ready') return;
    const savedNote = await sendMessage('notes/save', { note: gen.note }).catch(() => null);
    // A refused save comes back as { ok: false, error }, not a rejection — it is not a note.
    if (!savedNote || !('id' in savedNote)) return;
    setGen({ ...gen, saved: true });
    setSaved((prev) => [savedNote, ...(prev ?? [])]);
  }

  async function remove(id: string) {
    setSaved((prev) => (prev ?? []).filter((n) => n.id !== id));
    await sendMessage('notes/delete', { videoId: video.id, id }).catch(() => undefined);
  }

  return (
    <div className="fs-answer" role="region" aria-label="Make Notes">
      <div className="fs-answer-head">
        <span>Make Notes</span>
        <button type="button" className="fs-icon-plain" aria-label="Close" onClick={onClose}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="fs-answer-body">
        <div className="fs-ai-actions" role="group" aria-label="Notes scope">
          {SCOPE_OPTIONS.map((o) => (
            <button key={scopeKey(o.scope)} type="button" className={`fs-ai-chip${scopeKey(scope) === scopeKey(o.scope) ? ' is-active' : ''}`} aria-pressed={scopeKey(scope) === scopeKey(o.scope)} onClick={() => setScope(o.scope)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className="fs-ai-actions" role="group" aria-label="Format" style={{ marginTop: 8 }}>
          {(['notes', 'mindmap'] as NoteFormat[]).map((f) => (
            <button key={f} type="button" className={`fs-ai-chip${format === f ? ' is-active' : ''}`} aria-pressed={format === f} onClick={() => setFormat(f)}>
              {f === 'notes' ? 'Notes' : 'Mind map'}
            </button>
          ))}
          {LANGUAGES.map((l) => (
            <button key={l.id} type="button" className={`fs-ai-chip${language === l.id ? ' is-active' : ''}`} aria-pressed={language === l.id} onClick={() => setLanguage(l.id)}>
              {l.label}
            </button>
          ))}
        </div>

        <button type="button" className="fs-ai-chip" style={{ marginTop: 10 }} disabled={gen.kind === 'loading'} onClick={() => void generate()}>
          <NotebookPen size={14} aria-hidden /> {gen.kind === 'loading' ? 'Generating…' : 'Generate'}
        </button>

        {gen.kind === 'no-evidence' && <p className="fs-answer-note" style={{ marginTop: 10 }}>{gen.reason}</p>}
        {/* A monthly-allowance message (Layer 2C) is an expected, calm state, not a failure — it gets the plain note style, never the red "danger" tint. */}
        {gen.kind === 'error' && (
          <p className={`fs-answer-note${gen.code === 'quota_exceeded' ? '' : ' fs-error'}`} style={{ marginTop: 10 }}>
            {gen.error}
            {gen.code === 'quota_exceeded' && (
              <button type="button" className="fs-link" onClick={() => void sendMessage('site/open', { path: '/pricing' })}>
                See plans
              </button>
            )}
          </p>
        )}

        {gen.kind === 'ready' && (
          <div style={{ marginTop: 10 }}>
            <div className="fs-answer-note">
              {gen.note.provenance.sources.length ? `From the video’s ${[...new Set(gen.note.provenance.sources.map((x) => SOURCE_NAME[x] ?? 'video'))].join(', ')}` : ''} · {noteLabel(gen.note)}
              {!gen.note.provenance.hasTranscript && ' · no transcript for this part'}
            </div>
            {gen.note.markdown && <RichText text={gen.note.markdown} />}
            {gen.note.mindmap && <MindMapResult node={gen.note.mindmap} title={video.title} />}
            {canSave ? (
              <button type="button" className="fs-ai-chip" style={{ marginTop: 8 }} disabled={gen.saved} onClick={() => void save()}>
                <Save size={14} aria-hidden /> {gen.saved ? 'Saved' : gen.note.format === 'mindmap' ? 'Save mind map' : 'Save note'}
              </button>
            ) : (
              canSave === false && <SignInToSave kind="note" />
            )}
          </div>
        )}

        {!!saved?.length && (
          <div style={{ marginTop: 14 }}>
            <button type="button" className="fs-text-button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Hide saved' : `${saved.length} saved on this video`}
            </button>
            {expanded && (
              <ul className="fs-saved-list">
                {saved.map((n) => (
                  <li key={n.id}>
                    <div className="fs-saved-row">
                      {/* Opens the saved note itself — reading it is the point; jumping the video is a separate action. */}
                      <button type="button" className="fs-text-button fs-saved-open" aria-expanded={openId === n.id} onClick={() => setOpenId((id) => (id === n.id ? null : n.id))}>
                        {FORMAT_NAME[n.format]} · {noteLabel(n)}
                      </button>
                      <button type="button" className="fs-icon-plain" aria-label="Delete note" onClick={() => void remove(n.id)}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                    {openId === n.id && (
                      <div className="fs-saved-body">
                        {n.markdown ? <RichText text={n.markdown} /> : n.mindmap ? <MindMapResult node={n.mindmap} title={video.title} /> : null}
                        <div className="fs-ai-actions" style={{ marginTop: 8 }}>
                          {noteStartSec(n) > 0 && (
                            <button type="button" className="fs-ai-chip" onClick={() => onSeek(noteStartSec(n))}>
                              Watch from {formatTimestamp(noteStartSec(n))}
                            </button>
                          )}
                          <button type="button" className="fs-ai-chip" onClick={() => void sendMessage('dashboard/open', { route: `/library/note/${encodeURIComponent(n.id)}` }).catch(() => undefined)}>
                            Open in Library
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A generated mind map, drawn two ways and written out once — all three, not
 * one. The tree shows how ideas nest; the cloud shows what belongs together
 * (ui/mindmap/cloud-layout.ts); the text outline is what you copy into your
 * own notes and what a screen reader can actually read. The view is remembered for the session, not persisted:
 * it is a preference about this note, not about the learner.
 */
function MindMapResult({ node, title }: { node: MindMapNode; title: string }) {
  const [view, setView] = useState<MindMapVariant | 'text'>('tree');
  const [full, setFull] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const fullHolder = useRef<HTMLDivElement>(null);
  const drawing = view === 'text' ? null : view;

  const safeName = title.replace(/[^\w\s-]/g, '').trim().slice(0, 60).replace(/\s+/g, '-') || 'mind-map';
  const filename = `${safeName}-mindmap${view === 'cloud' ? '-cloud' : ''}.svg`;
  const views: { id: MindMapVariant | 'text'; label: string; icon: JSX.Element }[] = [
    { id: 'tree', label: 'Tree', icon: <Network size={14} aria-hidden /> },
    { id: 'cloud', label: 'Cloud', icon: <Cloud size={14} aria-hidden /> },
    { id: 'text', label: 'Text', icon: <Text size={14} aria-hidden /> },
  ];

  return (
    <div style={{ marginTop: 8 }}>
      <div className="fs-ai-actions" role="group" aria-label="Mind map view">
        {views.map((v) => (
          <button key={v.id} type="button" className={`fs-ai-chip${view === v.id ? ' is-active' : ''}`} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
            {v.icon} {v.label}
          </button>
        ))}
        {/* The rail is ~300px wide; anything past the second level runs off the edge. */}
        {drawing && (
          <button type="button" className="fs-ai-chip" onClick={() => setFull(true)}>
            <Maximize2 size={14} aria-hidden /> Expand
          </button>
        )}
        {drawing && (
          <button type="button" className="fs-ai-chip" onClick={() => downloadMindMapSvg(holder.current, filename)}>
            <Download size={14} aria-hidden /> SVG
          </button>
        )}
      </div>
      <div ref={holder} style={{ marginTop: 8 }}>
        {drawing ? <MindMapDiagram root={node} variant={drawing} /> : <MindMapOutline node={node} />}
        {drawing && <p className="fs-mm-hint">Click a topic to open it · Expand for the full map</p>}
      </div>

      <Modal open={full} onClose={() => setFull(false)} title="Mind map" subtitle={title} width={1100}>
        <div ref={fullHolder} className="fs-mindmap-full">
          <MindMapCanvas root={node} maxHeight="70vh" variant={drawing ?? 'tree'} />
        </div>
        <div className="fs-ai-actions" style={{ marginTop: 12 }}>
          <button type="button" className="fs-ai-chip" onClick={() => downloadMindMapSvg(fullHolder.current, filename)}>
            <Download size={14} aria-hidden /> Download SVG
          </button>
        </div>
      </Modal>
    </div>
  );
}
