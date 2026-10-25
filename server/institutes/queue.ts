import { ApiError } from '../http';
import type { InstitutesDb } from './db';
import { STAGE_RANK, type ProgressEvent } from './types';

/** Bounded, coalescing queue. Acknowledges only committed batches; retries are idempotent in SQL. */
export class ProgressQueue {
  private pending = new Map<string, { event: ProgressEvent; waiters: { resolve: () => void; reject: (err: unknown) => void }[] }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private waiting = 0;
  constructor(private readonly db: Pick<InstitutesDb,'recordProgress'>, private readonly delay = 150) {}
  enqueue(event: ProgressEvent): Promise<void> {
    const key=JSON.stringify([event.orgId,event.courseId,event.userId,event.videoId]);
    if (this.waiting>=20000 || (!this.pending.has(key) && this.pending.size>=5000)) return Promise.reject(new ApiError(429,'rate_limited','Progress queue is busy. Retry this milestone shortly.'));
    let entry=this.pending.get(key);
    if (!entry) { entry={event:{...event},waiters:[]}; this.pending.set(key,entry); }
    else {
      if (STAGE_RANK[event.stage]>STAGE_RANK[entry.event.stage]) entry.event.stage=event.stage;
      entry.event.seconds=Math.max(entry.event.seconds,event.seconds);
    }
    this.waiting++;
    const result=new Promise<void>((resolve,reject)=>entry!.waiters.push({resolve,reject}));
    if (!this.timer) this.timer=setTimeout(()=>{ this.timer=undefined; void this.flush(); },this.delay);
    return result;
  }
  async flush(): Promise<void> {
    if (this.running) { await this.running; return this.flush(); }
    if (this.timer) { clearTimeout(this.timer); this.timer=undefined; }
    const batch=[...this.pending.entries()].slice(0,500);
    if (!batch.length) return;
    for (const [key] of batch) this.pending.delete(key);
    this.running=(async()=>{
      try {
        await this.db.recordProgress(batch.map(([,entry])=>entry.event));
        for (const [,entry] of batch) for (const waiter of entry.waiters) waiter.resolve();
      } catch (err) {
        for (const [,entry] of batch) for (const waiter of entry.waiters) waiter.reject(err);
      } finally { this.waiting-=batch.reduce((n,[,entry])=>n+entry.waiters.length,0); }
    })();
    await this.running; this.running=undefined;
    if (this.pending.size) await this.flush();
  }
}
