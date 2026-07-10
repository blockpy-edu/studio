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

  constructor(private options: WorkerHostOptions) {}

  async handle(message: ClientToWorker): Promise<void> {
    switch (message.kind) {
      case 'init': {
        this.runner = await this.options.loadRunner(message.indexURL);
        this.options.post({ kind: 'ready', mode: this.options.mode });
        return;
      }
      case 'run': {
        if (!this.runner) throw new Error('Engine worker not initialized');
        const { job } = message;
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
        const result = await this.runner.execute(job, {
          onStdout: (chunk) => this.options.post({ kind: 'stdout', jobId: job.id, chunk }),
          onStderr: (chunk) => this.options.post({ kind: 'stderr', jobId: job.id, chunk }),
        });
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
      case 'input-response':
        // Interactive stdin lands with the isolated-mode SAB path; compat
        // interactive input is collected UI-side and replayed via
        // inputsPrefill (see DEVELOPMENT_PLAN M1.4).
        return;
    }
  }
}
