/**
 * Timestamps in free text: descriptions ("16:20 - Insert in a Linked List"),
 * comment outlines ("00:06:50 ▶ Guess the Number"), moments ("@5:45 she means…")
 * and the noise around them ("day 1) 00:00 - 36:33", "Feb 7 2:09:50").
 */

const TS = String.raw`(?:(\d{1,2}):)?(\d{1,3}):(\d{2})`;
const TS_ANY = new RegExp(String.raw`(?<![\d:.\/])@?${TS}(?![\d:])`, 'g');

/** "1:05:20" → 3920, "75:30" → 4530. Invalid clock values → null. */
export function parseTimestamp(text: string): number | null {
  const m = text.trim().match(new RegExp(`^@?${TS}$`));
  if (!m) return null;
  const [h, min, sec] = [m[1] === undefined ? 0 : Number(m[1]), Number(m[2]), Number(m[3])];
  if (sec >= 60 || (m[1] !== undefined && min >= 60)) return null;
  return h * 3600 + min * 60 + sec;
}

export function formatTimestamp(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export interface TimestampLine {
  startSec: number;
  /** Set for ranges ("00:00 - 36:33"). */
  endSec: number | null;
  label: string;
  /** Indentation / sub-numbering depth. */
  depth: number;
  raw: string;
}

const MONTH = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
const DAY_MONTH = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;
const DATE = /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/;

/** Strip bullets, arrows, emoji and separators around a label. */
export function cleanLabel(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\p{Extended_Pictographic}|️/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:|•·*>▶►→=~#.()[\]]+/u, '')
    .replace(/[\s\-–—:|•·*<=~(\[]+$/u, '')
    .replace(/\s+\)/g, ')')
    .replace(/\(\s*\)/g, '')
    .trim();
}

function depthOf(line: string, label: string): number {
  const indent = line.match(/^(\s*)/)?.[1].replace(/\t/g, '  ').length ?? 0;
  if (/^\d+\.\d+/.test(label)) return 1;
  if (/^\s*(?:[-–•·*]|[a-z][).])\s/.test(line) && indent >= 2) return 1;
  return indent >= 4 ? 1 : 0;
}

/** Every line of `text` that carries a timestamp, with the label around it. */
export function timestampLines(text: string): TimestampLine[] {
  const out: TimestampLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const matches = [...raw.matchAll(TS_ANY)];
    if (!matches.length) continue;
    const times = matches.map((m) => parseTimestamp(m[0]));
    if (times[0] === null) continue;
    const first = matches[0];
    const before = raw.slice(0, first.index);
    let after = raw.slice(first.index! + first[0].length);
    let endSec: number | null = null;
    // "00:00 - 36:33" or "00:00 to 36:33"
    const range = matches[1] && /^\s*(?:-|–|—|to)\s*$/i.test(raw.slice(first.index! + first[0].length, matches[1].index)) ? matches[1] : null;
    if (range && times[1] !== null) {
      endSec = times[1];
      after = raw.slice(range.index! + range[0].length);
    }
    // "(4:37)" after a title is the clip's length, not another position.
    after = after.replace(new RegExp(String.raw`\(\s*${TS}\s*\)`, 'g'), ' ');
    const lead = cleanLabel(before);
    const trail = cleanLabel(after.replace(/^\s*\([^)]*\)?/, ''));
    // "Insertion - 17:32" (label, separator, time) and "17:32 Insertion" both work.
    const labelFirst = !!lead && (/[-–—:|]\s*@?$/.test(before) || !trail);
    const label = labelFirst ? lead : trail || lead;
    out.push({ startSec: times[0], endSec, label, depth: depthOf(raw, label), raw: raw.trim() });
  }
  return out;
}

/** Lines that log personal progress or dates rather than describing content. */
export function isProgressNoise(line: TimestampLine): boolean {
  const l = line.label.toLowerCase();
  if (MONTH.test(line.raw) || DAY_MONTH.test(line.raw) || DATE.test(line.raw.replace(/\d{1,2}:\d{2}/g, ''))) return true;
  if (line.endSec !== null && /^(?:day|week|session|part|sitting)?\s*\d{0,3}\s*\)?\s*[:-]?\s*$/i.test(l)) return true;
  if (/^(?:day|week)\s*\d+\b/i.test(l)) return true;
  return /\b(?:finished|completed|done till|done upto|stopped|paused|left (?:at|off)|resume|i am here|i'm here|reached|watching again|revision)\b/i.test(l);
}

/** A usable topic label: real words, not a whole sentence, not a reaction. */
export function isTopicLabel(label: string): boolean {
  const words = label.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w));
  if (!words.length || words.length > 12 || label.length > 90) return false;
  if (!/\p{L}{3,}/u.test(label)) return false;
  return !/\b(?:lol|lmao|haha|funny|expression|face|cute|legend|goat|who is|anyone|still watching|love (?:you|this)|thank(?:s| you)|subscribe|like if)\b/i.test(label);
}
