/**
 * Worker-side message handling (spec §6.2), factored out of the worker
 * entry so it is Node-testable (and reusable as an in-process "loopback"
 * engine for the dev harness). One host = one Pyodide runtime.
 *
 * Interrupts: in compat mode (the primary mode — SAB is unavailable in
 * Canvas iframes) a running job cannot be interrupted cooperatively; the
 * client performs the hard stop by terminating the worker (§6.6). The
 * 'interrupt' message is therefore only honored between jobs here; the SAB
 * interrupt buffer is the isolated-mode enhancement (future work).
 */
import type { ClientToWorker, EngineMode, WorkerToClient } from './protocol';
import type { JobRunner } from './runner';

export interface WorkerHostOptions {
  post: (message: WorkerToClient) => void;
  /** Loads (or reloads, for restart-kernel) the Pyodide runtime. */
  loadRunner: (indexURL?: string) => Promise<JobRunner>;
  mode: EngineMode;
}

export class WorkerHost {
  private runner: JobRunner | null = null;
  private interrupted = new Set<string>();
  /** Per-job resolver for the in-flight interactive input() request. */
  private pendingInputs = new Map<string, (value: string) => void>();

  constructor(private options: WorkerHostOptions) {}

  async handle(message: ClientToWorker): Promise<void> {
    switch (message.kind) {
      case 'init': {
        this.runner = await this.options.loadRunner(message.indexURL);
        this.options.post({ kind: 'ready', mode: this.options.mode });
        return;
      }
      case 'run': {
        const { job } = message;
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
          // A crash inside execute (e.g. a fatal Pyodide error — JSPI stack
          // exhaustion, unbounded recursion) must still resolve the job,
          // otherwise the client waits forever. A fatal error leaves the
          // interpreter DEAD, so reload a fresh runner before the next job
          // rather than reusing the corpse (which would fault again, often
          // as "Maximum call stack size exceeded" on the very next
          // runPython). Reload failures are swallowed — the next run's own
          // error surfaces them.
          this.pendingInputs.delete(job.id);
          const message = error instanceof Error ? error.message : String(error);
          try {
            this.runner = await this.options.loadRunner();
          } catch {
            this.runner = null; // next 'run' throws "not initialized", handled above
          }
          this.options.post({
            kind: 'result',
            result: {
              jobId: job.id,
              success: false,
              stdout: '',
              stderr: '',
              error: {
                type: 'EngineError',
                message,
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
        return;
      }
      case 'interrupt': {
        // Honored only for jobs not yet started (compat mode, §6.6).
        this.interrupted.add(message.jobId);
        return;
      }
      case 'restart-kernel': {
        this.runner = await this.options.loadRunner();
        this.options.post({ kind: 'ready', mode: this.options.mode });
        return;
      }
      case 'input-response': {
        // Resumes the JSPI-suspended run (spec §6.5). Unknown/stale job
        // ids are ignored — the run may have been hard-stopped meanwhile.
        const resolve = this.pendingInputs.get(message.jobId);
        this.pendingInputs.delete(message.jobId);
        resolve?.(message.value);
        return;
      }
    }
  }
}
