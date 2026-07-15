/**
 * EngineClient (spec §6.2-6.3): the main-thread service every editor and
 * quiz on the page shares. Owns the worker lifecycle, the priority queue,
 * per-job streaming callbacks, the wall-clock watchdog, and the compat-mode
 * hard stop (worker termination + respawn - §6.6, the PRIMARY interrupt
 * path since SAB is unavailable in Canvas iframes).
 */
import { JobQueue } from './queue';
import type {
  EngineJob,
  EngineMode,
  EngineResult,
  WorkerToClient,
  ClientToWorker,
} from './protocol';

/** Worker abstraction so tests and the dev harness can inject loopbacks. */
export interface EnginePort {
  postMessage(message: ClientToWorker): void;
  onMessage(callback: (message: WorkerToClient) => void): void;
  terminate(): void;
}

export interface RunCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /**
   * Interactive input() (spec §6.5): resolves with the user's line once
   * the console collects it. The wall-clock watchdog is PAUSED while the
   * request is outstanding (thinking time is not execution time) and
   * re-armed fresh when the response is sent.
   */
  onInput?: (prompt: string) => Promise<string>;
}

export interface EngineClientOptions {
  workerFactory: () => EnginePort;
  /** Passed to the worker's Pyodide load (BootConfig.paths.pyodideIndexURL). */
  indexURL?: string;
  /** Reported once per (re)spawn - log as the X-Engine.Mode event (§6.6). */
  onMode?: (mode: EngineMode) => void;
  /**
   * Fired whenever the interpreter is replaced with a fresh one - the
   * worker healing a fatal crash ('runner-reloaded', §6.6) or a client
   * respawn (hard stop / restart-kernel). Interpreter state (installed
   * wheels, REPL namespace) is gone; callers reset caches keyed on it.
   */
  onRunnerReload?: () => void;
  /** Default wall-clock limit applied when a job has none. */
  defaultWallMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

interface ActiveJob {
  job: EngineJob;
  callbacks: RunCallbacks;
  resolve: (result: EngineResult) => void;
  cancelWatchdog: (() => void) | null;
  settled: boolean;
  /** Completion latch releasing the queue's execute() promise. */
  onSettled?: () => void;
}

const interruptedResult = (jobId: string, type: 'KeyboardInterrupt' | 'TimeoutError') => ({
  jobId,
  success: false,
  stdout: '',
  stderr: '',
  error: {
    type,
    message:
      type === 'TimeoutError' ? 'Execution exceeded its time limit' : 'Execution interrupted',
    line: null,
    studentLine: null,
    traceback: `${type}\n`,
  },
  artifacts: {},
  durationMs: 0,
});

export class EngineClient {
  private port: EnginePort | null = null;
  private ready: Promise<void> = Promise.resolve();
  private mode: EngineMode | null = null;
  private active: ActiveJob | null = null;
  private queue: JobQueue;
  private schedule: (fn: () => void, ms: number) => () => void;

  constructor(private options: EngineClientOptions) {
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      });
    this.queue = new JobQueue({
      execute: (job) => this.executeOnWorker(job),
      schedule: this.schedule,
    });
    this.spawn();
  }

  get engineMode(): EngineMode | null {
    return this.mode;
  }

  /** Enqueue a job (user phases preempt on_change - E5). */
  run(job: EngineJob, callbacks: RunCallbacks = {}): Promise<EngineResult> {
    return new Promise((resolve) => {
      this.pendingCallbacks.set(job.id, { callbacks, resolve });
      this.queue.enqueue(job);
    });
  }

  /**
   * Stop a job. If it is currently executing, this is the compat-mode hard
   * stop: terminate the worker, respawn, resolve the job as interrupted.
   */
  interrupt(jobId: string): void {
    if (this.active?.job.id === jobId) {
      this.hardStop('KeyboardInterrupt');
      return;
    }
    this.port?.postMessage({ kind: 'interrupt', jobId });
  }

  /** Nuclear reset (§6.2): fresh interpreter, same client. */
  restartKernel(): void {
    if (this.active) {
      this.hardStop('KeyboardInterrupt');
    } else {
      this.spawn();
    }
  }

  dispose(): void {
    this.port?.terminate();
    this.port = null;
  }

  // -- internals ---------------------------------------------------------------

  private pendingCallbacks = new Map<
    string,
    { callbacks: RunCallbacks; resolve: (r: EngineResult) => void }
  >();

  private respawned = false;

  private spawn(): void {
    this.port?.terminate();
    // Any respawn after the first spawn discards interpreter state (§6.6).
    if (this.respawned) this.options.onRunnerReload?.();
    this.respawned = true;
    const port = this.options.workerFactory();
    this.port = port;
    this.ready = new Promise((resolveReady) => {
      port.onMessage((message) => {
        if (message.kind === 'ready') {
          this.mode = message.mode;
          this.options.onMode?.(message.mode);
          resolveReady();
          return;
        }
        this.dispatch(message);
      });
    });
    port.postMessage({ kind: 'init', indexURL: this.options.indexURL });
  }

  private dispatch(message: WorkerToClient): void {
    const active = this.active;
    switch (message.kind) {
      case 'stdout':
        if (active?.job.id === message.jobId) active.callbacks.onStdout?.(message.chunk);
        return;
      case 'stderr':
        if (active?.job.id === message.jobId) active.callbacks.onStderr?.(message.chunk);
        return;
      case 'result':
        if (active?.job.id === message.result.jobId) this.settle(message.result);
        return;
      case 'input-request': {
        if (active?.job.id !== message.jobId) return;
        const onInput = active.callbacks.onInput;
        if (!onInput) return; // jobs without an input UI never set interactiveInput
        // Pause the watchdog while the user types (§6.5).
        active.cancelWatchdog?.();
        active.cancelWatchdog = null;
        void onInput(message.prompt).then((value) => {
          if (this.active !== active || active.settled || !this.port) return;
          const wallMs = active.job.limits?.wallMs ?? this.options.defaultWallMs;
          if (wallMs !== undefined) {
            active.cancelWatchdog = this.schedule(() => this.hardStop('TimeoutError'), wallMs);
          }
          this.port.postMessage({ kind: 'input-response', jobId: active.job.id, value });
        });
        return;
      }
      case 'runner-reloaded':
        this.options.onRunnerReload?.();
        return;
      case 'ready':
        return;
    }
  }

  private async executeOnWorker(job: EngineJob): Promise<void> {
    await this.ready;
    const pending = this.pendingCallbacks.get(job.id);
    this.pendingCallbacks.delete(job.id);
    if (!pending || !this.port) return;

    const wallMs = job.limits?.wallMs ?? this.options.defaultWallMs;
    const active: ActiveJob = {
      job,
      callbacks: pending.callbacks,
      resolve: pending.resolve,
      cancelWatchdog: null,
      settled: false,
    };
    this.active = active;
    if (wallMs !== undefined) {
      active.cancelWatchdog = this.schedule(() => this.hardStop('TimeoutError'), wallMs);
    }
    this.port.postMessage({ kind: 'run', job });
    await new Promise<void>((done) => {
      active.onSettled = done;
    });
  }

  private settle(result: EngineResult): void {
    const active = this.active;
    if (!active || active.settled) return;
    active.settled = true;
    active.cancelWatchdog?.();
    this.active = null;
    active.resolve(result);
    active.onSettled?.();
  }

  /** Compat-mode hard stop: kill the interpreter mid-execution (§6.6). */
  private hardStop(type: 'KeyboardInterrupt' | 'TimeoutError'): void {
    const active = this.active;
    this.spawn(); // terminate + fresh worker (also serves as restart-kernel)
    if (active && !active.settled) {
      active.settled = true;
      active.cancelWatchdog?.();
      this.active = null;
      active.resolve(interruptedResult(active.job.id, type));
      active.onSettled?.();
    }
  }
}
