import { Fragment, type ReactNode } from 'react';
import { parseTimestamp } from '@/learning/knowledge/timestamps';

/**
 * "[42:18]" or "[42:18–43:05]": a moment an answer cites (learning/ai/chat.ts asks for exactly this form).
 * Only a whole bracketed clock time matches — "[1]", "[note]" or a bare "42:18" never do.
 */
const CITE = /\[((?:\d{1,2}:)?\d{1,3}:\d{2})(?:\s*[–—-]\s*((?:\d{1,2}:)?\d{1,3}:\d{2}))?\]/g;

/** Plain text with the cited times as buttons that seek the video; the rest untouched. */
function withCites(text: string, key: string, onSeek: (sec: number) => void, maxSec: number | null): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    const start = parseTimestamp(m[1]);
    const end = m[2] === undefined ? null : parseTimestamp(m[2]);
    // A time that is not a real clock value, a span that runs backwards, or a time past the video's end stays text.
    if (start === null || (m[2] !== undefined && (end === null || end < start)) || (maxSec != null && start > maxSec)) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    const label = m[2] === undefined ? m[1] : `${m[1]}–${m[2]}`;
    out.push(
      <button key={`${key}-t${m.index}`} type="button" className="fs-ts-cite" title={`Play from ${m[1]}`} onClick={() => onSeek(start)}>
        {label}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;

type Block = { kind: 'p'; text: string } | { kind: 'ul'; items: string[] } | { kind: 'ol'; start: number; items: string[] };

/**
 * One paragraph as text and lists: "- a" / "• a" lines become a bulleted list, "1. a" lines a numbered
 * one, an indented line continues the item above it, and anything else stays a paragraph.
 */
function blocks(paragraph: string): Block[] {
  const out: Block[] = [];
  for (const line of paragraph.split('\n')) {
    const last = out[out.length - 1];
    const bullet = line.match(BULLET);
    const numbered = line.match(NUMBERED);
    if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1]);
      else out.push({ kind: 'ul', items: [bullet[1]] });
    } else if (numbered) {
      if (last?.kind === 'ol') last.items.push(numbered[2]);
      else out.push({ kind: 'ol', start: Number(numbered[1]), items: [numbered[2]] });
    } else if (last && last.kind !== 'p' && /^\s/.test(line)) {
      last.items[last.items.length - 1] += `\n${line.trim()}`;
    } else if (last?.kind === 'p') {
      last.text += `\n${line}`;
    } else {
      out.push({ kind: 'p', text: line });
    }
  }
  return out;
}

/**
 * Plain text with paragraphs, lists, **bold**, `code` and ``` blocks. Never HTML.
 *
 * With `onSeek`, cited times become buttons that move the player there (the same seek the Knowledge Map
 * uses); without it — the Library, notes, every other screen — they stay plain text, exactly as before.
 * Times inside code are never touched.
 */
export function RichText({ text, onSeek, maxSec = null }: { text: string; onSeek?: (sec: number) => void; maxSec?: number | null }) {
  const parts = text.split(/```[\w-]*\n?([\s\S]*?)```/g);
  const inline = (line: string, key: string) =>
    line.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((chunk, i) =>
      chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4 ? (
        <strong key={`${key}-${i}`}>{chunk.slice(2, -2)}</strong>
      ) : chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2 ? (
        <code key={`${key}-${i}`}>{chunk.slice(1, -1)}</code>
      ) : onSeek ? (
        <Fragment key={`${key}-${i}`}>{withCites(chunk, `${key}-${i}`, onSeek, maxSec)}</Fragment>
      ) : (
        chunk
      ),
    );
  return (
    <div className="fs-answer-text">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i}>
            <code>{part.trimEnd()}</code>
          </pre>
        ) : (
          part
            .split(/\n{2,}/)
            .filter((p) => p.trim())
            .flatMap((p, j) =>
              blocks(p.trim().replace(/^#{1,4}\s+/gm, '')).map((b, k) => {
                const key = `${i}-${j}-${k}`;
                if (b.kind === 'p') return <p key={key}>{inline(b.text, key)}</p>;
                const items = b.items.map((item, n) => <li key={`${key}-${n}`}>{inline(item, `${key}-${n}`)}</li>);
                return b.kind === 'ul' ? <ul key={key}>{items}</ul> : <ol key={key} start={b.start}>{items}</ol>;
              }),
            )
        ),
      )}
    </div>
  );
}
