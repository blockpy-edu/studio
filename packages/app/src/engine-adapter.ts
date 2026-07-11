/**
 * RunController adapter: `@blockpy/editor` chrome → `@blockpy/engine`.
 *
 * The engine boots lazily on the FIRST Run (spec §16.3 / risk R7: the UI is
 * interactive before Pyodide loads) and is reused afterwards. Compat mode is
 * primary (S1): Stop = hard worker termination with automatic respawn, which
 * `EngineClient.interrupt` handles internally.
 *
 * Pedal `on_run` grading rides the same adapter once the worker grows its
 * pedal path (M1.5 item "final-feedback ordering"); until then a clean run
 * reports the legacy "No errors" category and errors map onto the runtime /
 * syntax categories with student-relative line numbers (§6.3).
 */
import { EngineClient, type EnginePort } from '@blockpy/engine';
import type { RunController, RunHandlers, RunOutcome } from '@blockpy/editor';

/** Adapt a browser Worker to the engine's port abstraction. */
function workerPort(worker: Worker): EnginePort {
  return {
    postMessage: (message) => worker.postMessage(message),
    onMessage: (callback) => {
      worker.onmessage = (event) => callback(event.data);
    },
    terminate: () => worker.terminate(),
  };
}

export interface EngineAdapterOptions {
  /** BootConfig.paths.pyodideIndexURL. */
  indexURL?: string;
  /** Wall-clock limit per run (legacy student default 5000 ms). */
  wallMs?: number;
  /** Called when the engine starts/finishes booting (spinner hooks). */
  onBootStateChange?: (booting: boolean) => void;
  /**
   * Instructor grading script (`!on_run.py`). When set, a clean student run
   * is followed by a Pedal `instructor.on_run` job whose resolved feedback
   * drives the pane (§10.1, §14.3). Wheels install lazily on the first
   * grading job, so that job gets a generous wall-clock limit.
   */
  onRunScript?: string;
}

export function createEngineRunController(
  options: EngineAdapterOptions = {},
): RunController {
  let client: EngineClient | null = null;
  let booted = false;
  let jobCounter = 0;
  let activeJobId: string | null = null;

  function ensureClient(): EngineClient {
    if (client === null) {
      client = new EngineClient({
        workerFactory: () =>
          workerPort(
            new Worker(
              new URL('../../engine/src/worker.entry.ts', import.meta.url),
              { type: 'module' },
            ),
          ),
        indexURL: options.indexURL,
      });
    }
    return client;
  }

  return {
    async run(code: string, handlers: RunHandlers): Promise<RunOutcome> {
      const engine = ensureClient();
      if (!booted) {
        options.onBootStateChange?.(true);
        handlers.stdout('Loading Python engine…\n');
      }
      const jobId = `harness-run-${++jobCounter}`;
      activeJobId = jobId;
      try {
        const result = await engine.run(
          {
            id: jobId,
            phase: 'student.run',
            files: {},
            code,
            filename: 'answer.py',
            limits: { wallMs: options.wallMs ?? 5000 },
          },
          {
            onStdout: (chunk) => handlers.stdout(chunk),
            onStderr: (chunk) => handlers.stderr(chunk),
          },
        );
        if (!booted) {
          booted = true;
          options.onBootStateChange?.(false);
        }
        if (result.success) {
          if (options.onRunScript) {
            return await gradeWithPedal(engine, code, options, handlers);
          }
          return {
            error: null,
            feedback: {
              category: 'no errors',
              label: '',
              message: 'Ran your code and no errors were detected.',
            },
          };
        }
        const error = result.error;
        const where =
          error?.studentLine != null ? ` on line ${error.studentLine}` : '';
        return {
          error: error?.traceback || error?.message || 'Execution failed.',
          feedback: {
            category: error?.type === 'SyntaxError' ? 'syntax' : 'runtime',
            label: `${error?.type ?? 'Error'}${where}`,
            message: escapeHtml(error?.message ?? ''),
          },
        };
      } finally {
        activeJobId = null;
      }
    },

    stop(): void {
      if (client !== null && activeJobId !== null) {
        client.interrupt(activeJobId);
      }
    },
  };
}

let pedalReady = false;

/** Run the instructor grading pass and map Pedal feedback onto the pane. */
async function gradeWithPedal(
  engine: EngineClient,
  studentCode: string,
  options: EngineAdapterOptions,
  handlers: RunHandlers,
): Promise<RunOutcome> {
  if (!pedalReady) {
    handlers.stdout('Loading feedback engine…\n');
  }
  const result = await engine.run(
    {
      id: `harness-grade-${Date.now()}`,
      phase: 'instructor.on_run',
      files: {},
      code: studentCode,
      pedal: { onRun: options.onRunScript! },
      // First grading job includes the wheel install; later ones are ~ms.
      limits: { wallMs: pedalReady ? 15_000 : 180_000 },
    },
    {},
  );
  if (!result.success || !result.feedback) {
    return {
      error: result.error?.message ?? 'Grading failed.',
      feedback: {
        category: 'internal',
        label: 'Internal Error',
        message: 'The grader could not be run.',
      },
    };
  }
  pedalReady = true;
  const feedback = result.feedback;
  if (feedback.system_error) {
    // Fail-soft grader crash (§10.1): log for instructors, generic category.
    console.error('Pedal system_error:', feedback.system_error);
  }
  return {
    error: null,
    feedback: {
      category: feedback.category,
      label: feedback.title || feedback.label,
      // Pedal messages may embed HTML (D4-A: rendered unsanitized).
      message: feedback.message,
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
