import { ApiError } from '../http';
import type { InstitutesDb } from './db';
import { STAGE_RANK, type ProgressEvent } from './types';

/** Distinct org/course/user/video keys that may wait for a flush at once. */
const MAX_PENDING_KEYS = 5000;
/** Callers that may be waiting for an acknowledgment at once (several can share one key). */
const MAX_WAITERS = 20000;
/** Distinct keys written in one database transaction. */
const BATCH_SIZE = 500;

interface Waiter {
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface Entry {
  event: ProgressEvent;
  waiters: Waiter[];
}

const keyOf = (event: ProgressEvent) => JSON.stringify([event.orgId, event.courseId, event.userId, event.videoId]);

/** Keeps the furthest stage and the most seconds: a late "started" never undoes an earlier "done". */
function coalesce(into: ProgressEvent, event: ProgressEvent): void {
  if (STAGE_RANK[event.stage] > STAGE_RANK[into.stage]) into.stage = event.stage;
  into.seconds = Math.max(into.seconds, event.seconds);
}

/** Bounded, coalescing queue. Acknowledges only committed batches; retries are idempotent in SQL. */
export class ProgressQueue {
  private pending = new Map<string, Entry>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private waiting = 0;

  constructor(
    private readonly db: Pick<InstitutesDb, 'recordProgress'>,
    private readonly delay = 150,
  ) {}

  enqueue(event: ProgressEvent): Promise<void> {
    const key = keyOf(event);
    const full = this.waiting >= MAX_WAITERS || (!this.pending.has(key) && this.pending.size >= MAX_PENDING_KEYS);
    if (full) return Promise.reject(new ApiError(429, 'rate_limited', 'Progress queue is busy. Retry this milestone shortly.'));

    let entry = this.pending.get(key);
    if (!entry) {
      entry = { event: { ...event }, waiters: [] };
      this.pending.set(key, entry);
    } else {
      coalesce(entry.event, event);
    }

    this.waiting++;
    const target = entry;
    const result = new Promise<void>((resolve, reject) => target.waiters.push({ resolve, reject }));
    this.schedule();
    return result;
  }

  async flush(): Promise<void> {
    // One flush at a time: a flush requested mid-write runs after it, so nothing is written twice at once.
    if (this.running) {
      await this.running;
      return this.flush();
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const batch = [...this.pending.entries()].slice(0, BATCH_SIZE);
    if (!batch.length) return;
    for (const [key] of batch) this.pending.delete(key);

    this.running = this.write(batch.map(([, entry]) => entry));
    await this.running;
    this.running = undefined;
    if (this.pending.size) await this.flush();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delay);
  }

  /** Every waiter learns the outcome of the commit itself — success is never reported before it. */
  private async write(entries: Entry[]): Promise<void> {
    try {
      await this.db.recordProgress(entries.map((entry) => entry.event));
      for (const entry of entries) for (const waiter of entry.waiters) waiter.resolve();
    } catch (err) {
      for (const entry of entries) for (const waiter of entry.waiters) waiter.reject(err);
    } finally {
      this.waiting -= entries.reduce((n, entry) => n + entry.waiters.length, 0);
    }
  }
}
