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
   * re-armed fresh when the response is sent. A rejection answers the
   * suspended input() with EOF (Python EOFError) so the run can finish.
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
  /**
   * The worker's Pyodide load failed (offline CDN, wrong indexURL). Every
   * job resolves as an EngineError until `restartKernel()` succeeds.
   */
  onInitError?: (error: string) => void;
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

/**
 * Boot outcome of one worker generation: null = ready; a string = the
 * init-error message. A generation superseded by a respawn also resolves
 * (null) so waiters wake up and re-check the CURRENT generation.
 */
type ReadyState = string | null;

const INTERRUPT_MESSAGES = {
  KeyboardInterrupt: 'Execution interrupted',
  TimeoutError: 'Execution exceeded its time limit',
} as const;

const interruptedResult = (
  jobId: string,
  type: keyof typeof INTERRUPT_MESSAGES,
  message: string = INTERRUPT_MESSAGES[type],
): EngineResult => ({
  jobId,
  success: false,
  stdout: '',
  stderr: '',
  error: {
    type,
    message,
    line: null,
    studentLine: null,
    traceback: `${type}: ${message}\n`,
  },
  artifacts: {},
  durationMs: 0,
});

const engineErrorResult = (jobId: string, message: string): EngineResult => ({
  jobId,
  success: false,
  stdout: '',
  stderr: '',
  error: {
    type: 'EngineError',
    message,
    line: null,
    studentLine: null,
    traceback: `EngineError: ${message}\n`,
  },
  artifacts: {},
  durationMs: 0,
});

export class EngineClient {
  private port: EnginePort | null = null;
  private ready: Promise<ReadyState> = Promise.resolve(null);
  /** Settles the CURRENT generation's ready promise (respawn/init-error). */
  private settleReady: (state: ReadyState) => void = () => undefined;
  private mode: EngineMode | null = null;
  private active: ActiveJob | null = null;
  private queue: JobQueue;
  private schedule: (fn: () => void, ms: number) => () => void;
  private disposed = false;

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
      // Coalesced on_change (or anything pending at dispose): settle the
      // caller's promise instead of leaking it forever.
      onDropped: (job) =>
        this.settlePending(
          job.id,
          interruptedResult(
            job.id,
            'KeyboardInterrupt',
            this.disposed ? 'Engine disposed' : 'Superseded by a newer job',
          ),
        ),
      // executeOnWorker never rejects by design; if it ever does, settle
      // the job as an EngineError so the caller's promise is not leaked
      // (the queue keeps pumping either way).
      onError: (job, error) => {
        const result = engineErrorResult(
          job.id,
          error instanceof Error ? error.message : String(error),
        );
        const active = this.active;
        if (active?.job.id === job.id && !active.settled) this.finish(active, result);
        else this.settlePending(job.id, result);
      },
    });
    this.spawn();
  }

  get engineMode(): EngineMode | null {
    return this.mode;
  }

  /** Enqueue a job (user phases preempt on_change - E5). */
  run(job: EngineJob, callbacks: RunCallbacks = {}): Promise<EngineResult> {
    return new Promise((resolve) => {
      if (this.disposed) {
        resolve(interruptedResult(job.id, 'KeyboardInterrupt', 'Engine disposed'));
        return;
      }
      this.pendingCallbacks.set(job.id, { callbacks, resolve });
      this.queue.enqueue(job);
    });
  }

  /**
   * Stop a job. If it is currently executing, this is the compat-mode hard
   * stop: terminate the worker, respawn, resolve the job as interrupted.
   * A job still waiting in the queue is resolved as interrupted when its
   * turn comes, without ever reaching the worker (so the interrupt cannot
   * be lost to a respawn in between).
   */
  interrupt(jobId: string): void {
    if (this.active?.job.id === jobId) {
      this.hardStop('KeyboardInterrupt');
      return;
    }
    if (this.pendingCallbacks.has(jobId)) this.interruptedQueued.add(jobId);
  }

  /** Nuclear reset (§6.2): fresh interpreter, same client. */
  restartKernel(): void {
    if (this.active) {
      this.hardStop('KeyboardInterrupt');
    } else {
      this.spawn();
    }
  }

  /**
   * Terminate the worker for good: the active job and every queued job
   * resolve as interrupted, and no watchdog/respawn fires afterwards.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const active = this.active;
    if (active && !active.settled) {
      this.finish(active, interruptedResult(active.job.id, 'KeyboardInterrupt', 'Engine disposed'));
    }
    this.queue.clear();
    for (const jobId of [...this.pendingCallbacks.keys()]) {
      this.settlePending(jobId, interruptedResult(jobId, 'KeyboardInterrupt', 'Engine disposed'));
    }
    this.interruptedQueued.clear();
    this.port?.terminate();
    this.port = null;
    this.settleReady(null); // wake any executeOnWorker still waiting on boot
  }

  // -- internals ---------------------------------------------------------------

  private pendingCallbacks = new Map<
    string,
    { callbacks: RunCallbacks; resolve: (r: EngineResult) => void }
  >();

  /** Queued (not yet started) jobs interrupted by the user. */
  private interruptedQueued = new Set<string>();

  private respawned = false;

  private spawn(): void {
    if (this.disposed) return;
    this.port?.terminate();
    // Waiters on the old generation re-check `this.ready` once woken.
    this.settleReady(null);
    // Any respawn after the first spawn discards interpreter state (§6.6).
    if (this.respawned) this.options.onRunnerReload?.();
    this.respawned = true;
    const port = this.options.workerFactory();
    this.port = port;
    this.ready = new Promise<ReadyState>((resolveReady) => {
      this.settleReady = resolveReady;
      port.onMessage((message) => {
        if (this.port !== port) return; // a terminated generation's straggler
        if (message.kind === 'ready') {
          this.mode = message.mode;
          this.options.onMode?.(message.mode);
          resolveReady(null);
          return;
        }
        if (message.kind === 'init-error') {
          this.options.onInitError?.(message.error);
          resolveReady(message.error);
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
        if (!onInput) {
          // The job asked for interactive input without an input UI: answer
          // EOF so the suspended run finishes (EOFError) instead of hanging
          // until the watchdog kills it.
          this.port?.postMessage({
            kind: 'input-response',
            jobId: active.job.id,
            value: '',
            eof: true,
          });
          return;
        }
        // Pause the watchdog while the user types (§6.5).
        active.cancelWatchdog?.();
        active.cancelWatchdog = null;
        const answer = (value: string, eof: boolean) => {
          if (this.active !== active || active.settled || !this.port) return;
          const wallMs = active.job.limits?.wallMs ?? this.options.defaultWallMs;
          if (wallMs !== undefined && Number.isFinite(wallMs)) {
            active.cancelWatchdog = this.schedule(() => this.hardStop('TimeoutError'), wallMs);
          }
          this.port.postMessage({ kind: 'input-response', jobId: active.job.id, value, eof });
        };
        onInput(message.prompt).then(
          (value) => answer(value, false),
          // A failed/dismissed prompt is EOF - the worker must not stay
          // suspended (that would also block the whole queue).
          () => answer('', true),
        );
        return;
      }
      case 'runner-reloaded':
        this.options.onRunnerReload?.();
        return;
      case 'ready':
      case 'init-error':
        return;
    }
  }

  /**
   * Wait for the CURRENT worker generation to boot. A respawn while
   * waiting settles the old generation, so loop until the promise awaited
   * is still the live one (restartKernel while idle, hard stops).
   */
  private async awaitReady(): Promise<ReadyState> {
    for (;;) {
      const ready = this.ready;
      const state = await ready;
      if (ready === this.ready || this.disposed) return state;
    }
  }

  private async executeOnWorker(job: EngineJob): Promise<void> {
    const bootError = await this.awaitReady();
    if (this.interruptedQueued.delete(job.id)) {
      this.settlePending(job.id, interruptedResult(job.id, 'KeyboardInterrupt'));
      return;
    }
    if (this.disposed) {
      this.settlePending(job.id, interruptedResult(job.id, 'KeyboardInterrupt', 'Engine disposed'));
      return;
    }
    if (bootError !== null) {
      this.settlePending(
        job.id,
        engineErrorResult(job.id, `The Python engine failed to start: ${bootError}`),
      );
      return;
    }
    const pending = this.pendingCallbacks.get(job.id);
    this.pendingCallbacks.delete(job.id);
    if (!pending || !this.port) return;

    // A non-finite wallMs (legacy disable_timeout → execLimit Infinity,
    // configurations.js:60) means NO watchdog: setTimeout(Infinity) would
    // fire immediately.
    const wallMs = job.limits?.wallMs ?? this.options.defaultWallMs;
    const active: ActiveJob = {
      job,
      callbacks: pending.callbacks,
      resolve: pending.resolve,
      cancelWatchdog: null,
      settled: false,
    };
    this.active = active;
    if (wallMs !== undefined && Number.isFinite(wallMs)) {
      active.cancelWatchdog = this.schedule(() => this.hardStop('TimeoutError'), wallMs);
    }
    // Arm the completion latch BEFORE posting: a port that delivers the
    // result synchronously (loopback/test ports) would otherwise call
    // finish() with no latch, and this promise - and the queue - would
    // hang forever.
    const settled = new Promise<void>((done) => {
      active.onSettled = done;
    });
    this.port.postMessage({ kind: 'run', job });
    if (active.settled) return;
    await settled;
  }

  /** Resolve a job that never reached the worker (queued/dropped). */
  private settlePending(jobId: string, result: EngineResult): void {
    const pending = this.pendingCallbacks.get(jobId);
    if (!pending) return;
    this.pendingCallbacks.delete(jobId);
    this.interruptedQueued.delete(jobId);
    pending.resolve(result);
  }

  private settle(result: EngineResult): void {
    const active = this.active;
    if (!active || active.settled) return;
    this.finish(active, result);
  }

  private finish(active: ActiveJob, result: EngineResult): void {
    active.settled = true;
    active.cancelWatchdog?.();
    active.cancelWatchdog = null;
    if (this.active === active) this.active = null;
    active.resolve(result);
    active.onSettled?.();
  }

  /** Compat-mode hard stop: kill the interpreter mid-execution (§6.6). */
  private hardStop(type: 'KeyboardInterrupt' | 'TimeoutError'): void {
    if (this.disposed) return; // a stale watchdog after dispose()
    const active = this.active;
    this.spawn(); // terminate + fresh worker (also serves as restart-kernel)
    if (active && !active.settled) {
      this.finish(active, interruptedResult(active.job.id, type));
    }
  }
}
