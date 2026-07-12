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
import type {
  EvalOutcome,
  RunController,
  RunHandlers,
  RunOptions,
  RunOutcome,
} from '@blockpy/editor';

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
   * FALLBACK instructor grading script (`!on_run.py`) for callers without a
   * VFS. When the chrome passes a per-run `RunOptions.onRun` (the live VFS
   * contents), that always wins — including an empty string meaning "no
   * grader". A clean student run is followed by a Pedal `instructor.on_run`
   * job whose resolved feedback drives the pane (§10.1, §14.3). Wheels
   * install lazily on the first grading job, so that job gets a generous
   * wall-clock limit.
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
    async run(
      code: string,
      handlers: RunHandlers,
      runOptions?: RunOptions,
    ): Promise<RunOutcome> {
      const engine = ensureClient();
      if (!booted) {
        options.onBootStateChange?.(true);
        // System message: footer status + dev console, not the student
        // console.
        handlers.system?.('Loading Python engine…');
      }
      const jobId = `harness-run-${++jobCounter}`;
      activeJobId = jobId;
      try {
        const result = await engine.run(
          {
            id: jobId,
            phase: 'student.run',
            // The student search-order view of the VFS (open() targets).
            files: runOptions?.files ?? {},
            code,
            filename: 'answer.py',
            trace: runOptions?.trace ?? false,
            allowRealRequests: runOptions?.allowRealRequests,
            // Queued inputs from the quick-menu dialog (compat-mode input
            // strategy, M1.3.4: the UI collects stdin up front).
            inputsPrefill: runOptions?.inputs,
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
        const trace = result.trace ?? [];
        const images = result.images;
        // The student's raw traceback always reaches the student console
        // (M3.2) — grading never swallows it.
        const studentError = result.success
          ? null
          : result.error?.traceback ||
            result.error?.message ||
            'Execution failed.';
        // Per-run script (the live !on_run.py from the VFS) beats the
        // static fallback; empty/whitespace means "no grader".
        const onRun =
          runOptions?.onRun !== undefined
            ? runOptions.onRun
            : options.onRunScript;
        // Legacy parity (engine.js:109-124): the grading pass chains after
        // EVERY run — `failure()` resolves, so student syntax/runtime errors
        // reach Pedal, whose own set_source → run captures them as feedback.
        // Only the disable_feedback setting skips grading.
        if (onRun && onRun.trim() !== '' && !runOptions?.disableFeedback) {
          const graded = await gradeWithPedal(
            engine,
            code,
            onRun,
            handlers,
            runOptions?.inputs,
            runOptions?.graderFiles,
          );
          return {
            ...graded,
            error: studentError ?? graded.error,
            trace,
            images,
          };
        }
        if (result.success) {
          return {
            error: null,
            trace,
            images,
            feedback: {
              category: 'no errors',
              label: '',
              message: 'Ran your code and no errors were detected.',
            },
          };
        }
        // No grader (or feedback disabled): hand-built runtime/syntax
        // feedback with student-relative lines (§6.3).
        const error = result.error;
        const where =
          error?.studentLine != null ? ` on line ${error.studentLine}` : '';
        return {
          error: studentError,
          trace,
          images,
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

    /** REPL evaluation against the persistent run namespace (§6.4). */
    async evaluate(
      expression: string,
      handlers: RunHandlers,
    ): Promise<EvalOutcome> {
      const engine = ensureClient();
      const result = await engine.run(
        {
          id: `harness-eval-${++jobCounter}`,
          phase: 'student.eval',
          files: {},
          code: expression,
          limits: { wallMs: options.wallMs ?? 5000 },
        },
        {
          onStdout: (chunk) => handlers.stdout(chunk),
          onStderr: (chunk) => handlers.stderr(chunk),
        },
      );
      if (!result.success) {
        return {
          value: null,
          error:
            result.error?.message ?? result.error?.traceback ?? 'Evaluation failed.',
        };
      }
      return { value: result.value ?? null, error: null };
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
  onRunScript: string,
  handlers: RunHandlers,
  inputs?: string[],
  graderFiles?: Record<string, string>,
): Promise<RunOutcome> {
  if (!pedalReady) {
    handlers.system?.('Loading feedback engine…');
  }
  const result = await engine.run(
    {
      id: `harness-grade-${Date.now()}`,
      phase: 'instructor.on_run',
      // The instructor view of the VFS (grader helper imports, A1 §3).
      files: graderFiles ?? {},
      code: studentCode,
      // Same stdin script the student run consumed (Pedal queue_input).
      pedal: { onRun: onRunScript, inputs },
      // First grading job includes the wheel install; later ones are ~ms.
      limits: { wallMs: pedalReady ? 15_000 : 180_000 },
    },
    {
      // Instructor-code output belongs to the dev console, not the
      // student's.
      onStdout: (chunk) => handlers.system?.(chunk),
      onStderr: (chunk) => handlers.system?.(chunk),
    },
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
    // The SUCCESS/SCORE/HIDE triple for the §14.3 submission lifecycle —
    // only a real resolver pass produces one (fail-softs above return none).
    grade: {
      success: feedback.success,
      score: feedback.score,
      hideCorrectness: feedback.hide_correctness === true,
      unitTests: feedback.unit_tests,
    },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
