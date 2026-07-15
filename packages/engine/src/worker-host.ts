/**
 * Worker-side message handling (spec §6.2), factored out of the worker
 * entry so it is Node-testable (and reusable as an in-process "loopback"
 * engine for the dev harness). One host = one Pyodide runtime.
 *
 * Interrupts: in compat mode (the primary mode - SAB is unavailable in
 * Canvas iframes) a running job cannot be interrupted cooperatively; the
 * client performs the hard stop by terminating the worker (§6.6). The
 * 'interrupt' message is therefore only honored between jobs here; the SAB
 * interrupt buffer is the isolated-mode enhancement (future work).
 *
 * Crash recovery (§6.6): a fatal Pyodide error (stack overflow from
 * unbounded recursion - students will do this) kills the interpreter but
 * not the worker. Every reload remembers the init indexURL (reloading
 * without it resolves pyodide-lock.json against the wrong base and fails
 * with an HTML-as-JSON parse error), a post-job stack canary catches
 * fatals that a fail-soft grading pass swallowed, and 'runner-reloaded'
 * tells the client that interpreter state (installed wheels, REPL
 * namespace) is gone.
 */
import type { ClientToWorker, EngineJob, EngineMode, WorkerToClient } from './protocol';
import type { JobRunner } from './runner';

export interface WorkerHostOptions {
  post: (message: WorkerToClient) => void;
  /** Loads (or reloads, for restart-kernel/crash recovery) the Pyodide runtime. */
  loadRunner: (indexURL?: string) => Promise<JobRunner>;
  mode: EngineMode;
}

/** JS-level signatures of a dead or dying interpreter (Pyodide fatal errors). */
const FATAL_SIGNATURE = /call stack|stack overflow|fatally failed/i;

const ENGINE_CRASH_MESSAGE =
  'The Python engine crashed - this usually means unbounded recursion ' +
  '(a function calling itself forever). The engine has been restarted; ' +
  'check your code and run again.';

export class WorkerHost {
  private runner: JobRunner | null = null;
  private interrupted = new Set<string>();
  /** Per-job resolver for the in-flight interactive input() request. */
  private pendingInputs = new Map<string, (value: string) => void>();
  /** Remembered from 'init' so crash/restart reloads hit the same base. */
  private indexURL: string | undefined;
  /**
   * Serializes init/run/restart handling. Without this, a job posted while
   * a crash reload is in flight would execute against the dead interpreter
   * (worker onmessage fires handle() fire-and-forget). input-response and
   * interrupt bypass the chain - a queued run job AWAITS input-response,
   * so serializing those would deadlock.
   */
  private chain: Promise<void> = Promise.resolve();

  constructor(private options: WorkerHostOptions) {}

  handle(message: ClientToWorker): Promise<void> {
    switch (message.kind) {
      case 'interrupt': {
        // Honored only for jobs not yet started (compat mode, §6.6).
        this.interrupted.add(message.jobId);
        return Promise.resolve();
      }
      case 'input-response': {
        // Resumes the JSPI-suspended run (spec §6.5). Unknown/stale job
        // ids are ignored - the run may have been hard-stopped meanwhile.
        const resolve = this.pendingInputs.get(message.jobId);
        this.pendingInputs.delete(message.jobId);
        resolve?.(message.value);
        return Promise.resolve();
      }
      default: {
        this.chain = this.chain.then(() => this.process(message));
        return this.chain;
      }
    }
  }

  private async process(message: ClientToWorker): Promise<void> {
    switch (message.kind) {
      case 'init': {
        this.indexURL = message.indexURL;
        this.runner = await this.options.loadRunner(message.indexURL);
        this.options.post({ kind: 'ready', mode: this.options.mode });
        return;
      }
      case 'run': {
        await this.runJob(message.job);
        return;
      }
      case 'restart-kernel': {
        this.runner = await this.options.loadRunner(this.indexURL);
        this.options.post({ kind: 'ready', mode: this.options.mode });
        return;
      }
    }
  }

  /**
   * Replace a dead/poisoned interpreter with a fresh one. Reload failures
   * are swallowed - the next run reports "not initialized". The client is
   * always told: installed wheels and the REPL namespace are gone either
   * way (the engine adapter re-arms the Pedal install path on this).
   */
  private async reloadRunner(): Promise<void> {
    try {
      this.runner = await this.options.loadRunner(this.indexURL);
    } catch {
      this.runner = null;
    }
    this.options.post({ kind: 'runner-reloaded' });
  }

  private async runJob(job: EngineJob): Promise<void> {
    if (!this.runner) {
      // No live interpreter (init never ran, or a prior fatal's reload
      // failed). Resolve the job rather than throwing into the void.
      this.options.post({
        kind: 'result',
        result: {
          jobId: job.id,
          success: false,
          stdout: '',
          stderr: '',
          error: {
            type: 'EngineError',
            message: 'Engine worker not initialized',
            line: null,
            studentLine: null,
            traceback: 'Engine worker not initialized\n',
          },
          artifacts: {},
          durationMs: 0,
        },
      });
      return;
    }
    if (this.interrupted.delete(job.id)) {
      this.options.post({
        kind: 'result',
        result: {
          jobId: job.id,
          success: false,
          stdout: '',
          stderr: '',
          error: {
            type: 'KeyboardInterrupt',
            message: 'Execution interrupted',
            line: null,
            studentLine: null,
            traceback: 'KeyboardInterrupt: Execution interrupted\n',
          },
          artifacts: {},
          durationMs: 0,
        },
      });
      return;
    }
    let result: Awaited<ReturnType<JobRunner['execute']>>;
    try {
      result = await this.runner.execute(job, {
        onStdout: (chunk) => this.options.post({ kind: 'stdout', jobId: job.id, chunk }),
        onStderr: (chunk) => this.options.post({ kind: 'stderr', jobId: job.id, chunk }),
        // Interactive input() (spec §6.5): the run suspends on this
        // promise until an 'input-response' arrives for the job.
        onInput: (prompt) =>
          new Promise<string>((resolve) => {
            this.pendingInputs.set(job.id, resolve);
            this.options.post({ kind: 'input-request', jobId: job.id, prompt });
          }),
      });
    } catch (error) {
      // A crash inside execute (e.g. a fatal Pyodide error - JSPI stack
      // exhaustion, unbounded recursion) must still resolve the job,
      // otherwise the client waits forever. A fatal error leaves the
      // interpreter DEAD, so reload a fresh runner before the next job
      // rather than reusing the corpse (which would fault again, often
      // as "Maximum call stack size exceeded" on the very next
      // runPython).
      this.pendingInputs.delete(job.id);
      const message = error instanceof Error ? error.message : String(error);
      await this.reloadRunner();
      const crashed = FATAL_SIGNATURE.test(message);
      this.options.post({
        kind: 'result',
        result: {
          jobId: job.id,
          success: false,
          stdout: '',
          stderr: '',
          error: {
            // EngineCrash = recovered fatal: the student-facing message is
            // instructive; the raw cause stays in the traceback for the
            // dev console / bug-icon dialog.
            type: crashed ? 'EngineCrash' : 'EngineError',
            message: crashed ? ENGINE_CRASH_MESSAGE : message,
            line: null,
            studentLine: null,
            traceback: message + '\n',
          },
          artifacts: {},
          durationMs: 0,
        },
      });
      return;
    }
    this.pendingInputs.delete(job.id);
    this.options.post({ kind: 'result', result });
    // A stack-overflow fatal can poison the interpreter WITHOUT failing
    // the job (a fail-soft grading pass catches around it, or a caught
    // deep-recursion unwind corrupts the stack pointer - pyodide#5987).
    // Probe now so the fatal never lands on the student's next Run. The
    // message chain holds any queued job until the reload settles.
    if (this.runner.healthCheck?.() === false) {
      await this.reloadRunner();
    }
  }
}
