/**
 * Job queue (E5, spec §6.1): one engine worker serves the whole page.
 * User-initiated jobs (runs, evals, grading) are FIFO and preempt
 * `on_change` background jobs, which are debounced and coalesced — only the
 * newest pending on_change survives, and it only runs when nothing
 * user-initiated is waiting.
 */
import { PHASE_PRIORITY, type EngineJob } from './protocol';

export interface JobQueueOptions {
  /** Runs one job to completion; the queue serializes calls. */
  execute: (job: EngineJob) => Promise<void>;
  /** on_change debounce window (legacy feel; configurable). */
  debounceMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export class JobQueue {
  private userJobs: EngineJob[] = [];
  private pendingOnChange: EngineJob | null = null;
  private cancelDebounce: (() => void) | null = null;
  private running = false;
  private schedule: (fn: () => void, ms: number) => () => void;

  constructor(private options: JobQueueOptions) {
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      });
  }

  enqueue(job: EngineJob): void {
    if (PHASE_PRIORITY[job.phase] === 'background') {
      // coalesce: newest on_change replaces any pending one
      this.pendingOnChange = job;
      this.cancelDebounce?.();
      this.cancelDebounce = this.schedule(() => {
        this.cancelDebounce = null;
        void this.pump();
      }, this.options.debounceMs ?? 500);
      return;
    }
    this.userJobs.push(job);
    void this.pump();
  }

  /** Jobs waiting (excluding the one executing). */
  pendingCount(): number {
    return this.userJobs.length + (this.pendingOnChange ? 1 : 0);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.next();
        if (!job) break;
        await this.options.execute(job);
      }
    } finally {
      this.running = false;
    }
  }

  private next(): EngineJob | null {
    const user = this.userJobs.shift();
    if (user) return user;
    // background job runs only when idle AND its debounce elapsed
    if (this.pendingOnChange && this.cancelDebounce === null) {
      const job = this.pendingOnChange;
      this.pendingOnChange = null;
      return job;
    }
    return null;
  }
}
