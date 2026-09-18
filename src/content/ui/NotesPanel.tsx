import { useEffect, useRef, useState } from 'react';
import { Download, Maximize2, Network, NotebookPen, Save, Text, Trash2, X } from 'lucide-react';
import type { LearningMode } from '@/types/domain';
import type { GeneratedNote, MindMapNode, NoteFormat, NoteLanguage, SavedNote } from '@/types/notes';
import type { KnowledgeMap, TranscriptSegment } from '@/learning/knowledge/types';
import { formatTimestamp } from '@/learning/knowledge/timestamps';
import type { LearningPath } from '@/learning/path/path';
import type { NoteRequestInputs } from '@/learning/notes/generator';
import type { NoteScope } from '@/learning/notes/scope';
import { sendMessage } from '@/messaging/runtime';
import { Modal } from '@/ui/components/Modal';
import { RichText } from './LearningPanel';
import { MindMapDiagram, MindMapOutline, downloadMindMapSvg } from './MindMapDiagram';

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
  durationSec: number | null;
  currentTime: () => number;
  defaultLanguage: NoteLanguage;
  onSeek: (sec: number) => void;
  onClose: () => void;
}

type GenState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; note: GeneratedNote; saved: boolean } | { kind: 'no-evidence'; reason: string } | { kind: 'error'; error: string; code?: string };

export function NotesPanel({ video, mode, topicId, path, map, transcript, durationSec, currentTime, defaultLanguage, onSeek, onClose }: NotesPanelProps) {
  const [scope, setScope] = useState<NoteScope>(SCOPE_OPTIONS[0].scope);
  const [format, setFormat] = useState<NoteFormat>('notes');
  const [language, setLanguage] = useState<NoteLanguage>(defaultLanguage);
  const [gen, setGen] = useState<GenState>({ kind: 'idle' });
  const [saved, setSaved] = useState<SavedNote[] | null>(null);
  const [expanded, setExpanded] = useState(false);

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
    const inputs: NoteRequestInputs = { video, mode, topicId, path, map, transcript, currentTime: currentTime(), durationSec, scope, format, language };
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
    if (!savedNote) return;
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
              {gen.note.provenance.sources.length ? `Grounded in: ${gen.note.provenance.sources.join(', ')}` : ''}
              {!gen.note.provenance.hasTranscript && ' · no transcript for this part'}
            </div>
            {gen.note.markdown && <RichText text={gen.note.markdown} />}
            {gen.note.mindmap && <MindMapResult node={gen.note.mindmap} title={video.title} />}
            <button type="button" className="fs-ai-chip" style={{ marginTop: 8 }} disabled={gen.saved} onClick={() => void save()}>
              <Save size={14} aria-hidden /> {gen.saved ? 'Saved' : 'Save note'}
            </button>
          </div>
        )}

        {!!saved?.length && (
          <div style={{ marginTop: 14 }}>
            <button type="button" className="fs-text-button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Hide' : `${saved.length} saved note${saved.length > 1 ? 's' : ''}`}
            </button>
            {expanded && (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                {saved.map((n) => (
                  <li key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
                    <button type="button" className="fs-text-button" style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => onSeek(n.range?.startSec ?? 0)}>
                      {n.range ? formatTimestamp(n.range.startSec) : 'Full video'} · {n.provenance.scope} · {n.language}
                    </button>
                    <button type="button" className="fs-icon-plain" aria-label="Delete note" onClick={() => void remove(n.id)}>
                      <Trash2 size={14} aria-hidden />
                    </button>
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
 * A generated mind map, as a diagram and as an outline — both, not one or the
 * other. The diagram is how you take the shape of a lecture in at a glance;
 * the outline is what you copy into your own notes and what a screen reader
 * can actually read. The view is remembered for the session, not persisted:
 * it is a preference about this note, not about the learner.
 */
function MindMapResult({ node, title }: { node: MindMapNode; title: string }) {
  const [view, setView] = useState<'diagram' | 'text'>('diagram');
  const [full, setFull] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const fullHolder = useRef<HTMLDivElement>(null);

  const safeName = title.replace(/[^\w\s-]/g, '').trim().slice(0, 60).replace(/\s+/g, '-') || 'mind-map';
  const filename = `${safeName}-mindmap.svg`;

  return (
    <div style={{ marginTop: 8 }}>
      <div className="fs-ai-actions" role="group" aria-label="Mind map view">
        <button type="button" className={`fs-ai-chip${view === 'diagram' ? ' is-active' : ''}`} aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>
          <Network size={14} aria-hidden /> Diagram
        </button>
        <button type="button" className={`fs-ai-chip${view === 'text' ? ' is-active' : ''}`} aria-pressed={view === 'text'} onClick={() => setView('text')}>
          <Text size={14} aria-hidden /> Text
        </button>
        {/* The rail is ~300px wide; anything past the second level runs off the edge. */}
        {view === 'diagram' && (
          <button type="button" className="fs-ai-chip" onClick={() => setFull(true)}>
            <Maximize2 size={14} aria-hidden /> Expand
          </button>
        )}
        {view === 'diagram' && (
          <button type="button" className="fs-ai-chip" onClick={() => downloadMindMapSvg(holder.current, filename)}>
            <Download size={14} aria-hidden /> SVG
          </button>
        )}
      </div>
      <div ref={holder} style={{ marginTop: 8 }}>
        {view === 'diagram' ? <MindMapDiagram root={node} /> : <MindMapOutline node={node} />}
      </div>

      <Modal open={full} onClose={() => setFull(false)} title="Mind map" subtitle={title} width={1100}>
        <div ref={fullHolder} className="fs-mindmap-full">
          <MindMapDiagram root={node} />
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
