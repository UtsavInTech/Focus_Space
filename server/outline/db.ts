import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { OutlineSection } from '@/learning/outline/outline';

/**
 * Stored video outlines — one row per (video, transcript). Its own connection to the same SQLite file
 * as the rest of the API (`DB_PATH`, on the Railway volume in production), exactly like
 * server/usage/db.ts, so it costs nothing beyond a few kilobytes of disk per video.
 *
 * Holds only public video data: the outline of a public video, keyed by the hash of its public
 * captions. Nothing about who asked for it is stored.
 */
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS video_outlines (
  video_id          TEXT NOT NULL,
  transcript_key    TEXT NOT NULL,
  sections_json     TEXT NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        INTEGER NOT NULL,
  PRIMARY KEY (video_id, transcript_key)
);
`;

export interface StoredOutline {
  sections: OutlineSection[];
  model: string;
  createdAt: number;
}

export class OutlineDb {
  private readonly db: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  get(videoId: string, transcriptKey: string): StoredOutline | null {
    const row = this.db.prepare('SELECT sections_json, model, created_at FROM video_outlines WHERE video_id = ? AND transcript_key = ?').get(videoId, transcriptKey) as
      | { sections_json: string; model: string; created_at: number }
      | undefined;
    if (!row) return null;
    try {
      return { sections: JSON.parse(row.sections_json) as OutlineSection[], model: row.model, createdAt: row.created_at };
    } catch {
      return null;
    }
  }

  put(videoId: string, transcriptKey: string, outline: { sections: OutlineSection[]; model: string; promptTokens: number | null; completionTokens: number | null }, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO video_outlines (video_id, transcript_key, sections_json, model, prompt_tokens, completion_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (video_id, transcript_key) DO NOTHING`,
      )
      .run(videoId, transcriptKey, JSON.stringify(outline.sections), outline.model, outline.promptTokens, outline.completionTokens, now);
  }

  /** Outlines made since `since` — the global daily cap in service.ts counts these. */
  countSince(since: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM video_outlines WHERE created_at >= ?').get(since) as { n: number }).n;
  }
}

let shared: OutlineDb | null = null;

export function getOutlineDb(): OutlineDb {
  if (!shared) shared = new OutlineDb(process.env.DB_PATH ?? 'data/focusspace.db');
  return shared;
}
