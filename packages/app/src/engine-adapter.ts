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
import type { PedalFeedback } from '@blockpy/engine';
import type {
  EvalOptions,
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
  /**
   * BootConfig.paths.assets: where the deployed server hosts the build's
   * `assets/` directory. The bundler bakes a base-absolute worker URL into
   * the main chunk at build time; integrating servers that mount the
   * bundle under their own path override it here. Same-origin only —
   * module workers cannot be instantiated cross-origin.
   */
  assetsBase?: string;
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

/**
 * Resolve the engine worker URL from a configured assets base. The build
 * emits the worker as a STABLE `worker.entry.js` (vite.config worker
 * naming) precisely so this URL is constructible from config alone.
 */
export function workerEntryUrl(assetsBase: string): URL {
  const base = assetsBase.endsWith('/') ? assetsBase : `${assetsBase}/`;
  // location is absent outside the browser (node-run tests).
  return new URL(`${base}worker.entry.js`, globalThis.location?.href ?? 'http://localhost/');
}

export function createEngineRunController(options: EngineAdapterOptions = {}): RunController {
  let client: EngineClient | null = null;
  let booted = false;
  let jobCounter = 0;
  let activeJobId: string | null = null;

  function ensureClient(): EngineClient {
    if (client === null) {
      client = new EngineClient({
        workerFactory: () =>
          workerPort(
            options.assetsBase
              ? new Worker(workerEntryUrl(options.assetsBase), { type: 'module' })
              : // Literal pattern kept intact so vite detects and bundles
                // the worker for the no-override path.
                new Worker(new URL('../../engine/src/worker.entry.ts', import.meta.url), {
                  type: 'module',
                }),
          ),
        indexURL: options.indexURL,
      });
    }
    return client;
  }

  return {
    async run(code: string, handlers: RunHandlers, runOptions?: RunOptions): Promise<RunOutcome> {
      const engine = ensureClient();
      if (!booted) {
        options.onBootStateChange?.(true);
        // System message: footer status + dev console, not the student
        // console.
        handlers.system?.('Loading Python engine…');
      }
      const jobId = `harness-run-${++jobCounter}`;
      activeJobId = jobId;
      // Interactive input() (spec §6.5): values the user types during the
      // run — collected so the grading pass replays the SAME stdin the
      // student run consumed (legacy execution.input()).
      const typedInputs: string[] = [];
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
            // Queued inputs from the quick-menu dialog replay first
            // (M1.3.4); when they run dry AND the caller has an input UI,
            // the run suspends on the console input line instead of
            // raising EOFError.
            inputsPrefill: runOptions?.inputs,
            interactiveInput: handlers.onInput !== undefined,
            limits: { wallMs: options.wallMs ?? 5000 },
          },
          {
            onStdout: (chunk) => handlers.stdout(chunk),
            onStderr: (chunk) => handlers.stderr(chunk),
            ...(handlers.onInput
              ? {
                  onInput: async (prompt: string) => {
                    const value = await handlers.onInput!(prompt);
                    typedInputs.push(value);
                    return value;
                  },
                }
              : {}),
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
          : result.error?.traceback || result.error?.message || 'Execution failed.';
        // Per-run script (the live !on_run.py from the VFS) beats the
        // static fallback; empty/whitespace means "no grader".
        const onRun = runOptions?.onRun !== undefined ? runOptions.onRun : options.onRunScript;
        // Legacy parity (engine.js:109-124): the grading pass chains after
        // EVERY run — `failure()` resolves, so student syntax/runtime errors
        // reach Pedal, whose own set_source → run captures them as feedback.
        // Only the disable_feedback setting skips grading.
        if (onRun && onRun.trim() !== '' && !runOptions?.disableFeedback) {
          // The grading sandbox replays queued inputs PLUS whatever the
          // user typed interactively during the run (legacy parity: the
          // sandbox sees the same stdin the student saw).
          const gradeOptions: RunOptions | undefined = typedInputs.length
            ? { ...runOptions, inputs: [...(runOptions?.inputs ?? []), ...typedInputs] }
            : runOptions;
          const graded = await gradeWithPedal(engine, code, onRun, handlers, gradeOptions);
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
        const where = error?.studentLine != null ? ` on line ${error.studentLine}` : '';
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
      evalOptions?: EvalOptions,
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
          error: result.error?.message ?? result.error?.traceback ?? 'Evaluation failed.',
        };
      }
      const outcome: EvalOutcome = { value: result.value ?? null, error: null };
      // on_eval grading (engine.js:146-156): only when an on_eval script
      // exists and feedback is enabled. Legacy chained it after the student
      // evaluation; Pedal's `evaluate` re-runs the expression inside the
      // grading sandbox retained from the last on_run pass.
      const onEval = evalOptions?.onEval;
      if (onEval && onEval.trim() !== '' && !evalOptions?.disableFeedback && pedalReady) {
        const graded = await engine.run(
          {
            id: `harness-oneval-${++jobCounter}`,
            phase: 'instructor.on_eval',
            files: evalOptions?.graderFiles ?? {},
            code: expression,
            pedal: { onRun: onEval, evaluation: expression },
            limits: { wallMs: 15_000 },
          },
          {
            onStdout: (chunk) => handlers.system?.(chunk),
            onStderr: (chunk) => handlers.system?.(chunk),
          },
        );
        if (graded.success && graded.feedback) {
          const shaped = shapePedalFeedback(graded.feedback, handlers);
          outcome.feedback = shaped.feedback;
          outcome.grade = shaped.grade;
          outcome.instructions = shaped.instructions;
        }
      }
      return outcome;
    },

    stop(): void {
      if (client !== null && activeJobId !== null) {
        client.interrupt(activeJobId);
      }
    },
  };
}

let pedalReady = false;

/**
 * Map a resolved PedalFeedback onto the pane shapes, porting legacy
 * updateFeedback's presentation behaviors (feedback.js:182-264):
 * the Instructor/"explain" and Instructor/"No errors" remaps, positives,
 * the instructions replacement, the first-error line, and system
 * log/debug messages (→ dev console via handlers.system).
 */
function shapePedalFeedback(
  feedback: PedalFeedback,
  handlers: RunHandlers,
): {
  feedback: NonNullable<RunOutcome['feedback']>;
  grade: NonNullable<RunOutcome['grade']>;
  instructions: string | null;
  errorLine: number | null;
} {
  if (feedback.system_error) {
    // Fail-soft grader crash (§10.1): log for instructors, generic category.
    console.error('Pedal system_error:', feedback.system_error);
    handlers.system?.(feedback.system_error);
  }
  // System messages (on_run.js:90-95): console_log/console_debug → the
  // instructor-only dev console.
  for (const system of feedback.systems ?? []) {
    handlers.system?.(`[${system.label}] ${system.title}: ${system.message}`);
  }
  let category = feedback.category;
  let label = feedback.title || feedback.label;
  // Remap to expected BlockPy labels (feedback.js:202-210). Pedal 3 emits
  // lowercase categories and "No Errors" (Pedal 2 said "No errors") —
  // compare case-insensitively so both eras remap.
  if (category.toLowerCase() === 'instructor' && label.toLowerCase() === 'explain') {
    label = 'Instructor Feedback';
  }
  // Don't present a lack of error as being incorrect.
  if (category.toLowerCase() === 'instructor' && label.toLowerCase() === 'no errors') {
    category = 'no errors';
  }
  return {
    feedback: {
      category,
      label,
      // Pedal messages may embed HTML (D4-A); the chrome runs the legacy
      // markdown pass on presentation (renderFeedbackMessage).
      message: feedback.message,
      positives: feedback.positives ?? [],
    },
    // The SUCCESS/SCORE/HIDE triple for the §14.3 submission lifecycle —
    // only a real resolver pass produces one (fail-softs return none).
    grade: {
      success: feedback.success,
      score: feedback.score,
      hideCorrectness: feedback.hide_correctness === true,
      unitTests: feedback.unit_tests,
    },
    instructions: feedback.instructions ?? null,
    errorLine: feedback.line ?? null,
  };
}

/** Run the instructor grading pass and map Pedal feedback onto the pane. */
async function gradeWithPedal(
  engine: EngineClient,
  studentCode: string,
  onRunScript: string,
  handlers: RunHandlers,
  runOptions?: RunOptions,
): Promise<RunOutcome> {
  if (!pedalReady) {
    handlers.system?.('Loading feedback engine…');
  }
  const result = await engine.run(
    {
      id: `harness-grade-${Date.now()}`,
      phase: 'instructor.on_run',
      // The instructor view of the VFS (grader helper imports, A1 §3).
      files: runOptions?.graderFiles ?? {},
      code: studentCode,
      pedal: {
        onRun: onRunScript,
        // Same stdin script the student run consumed (Pedal set_input).
        inputs: runOptions?.inputs,
        // The STUDENT view feeds the Pedal Submission (legacy
        // getAllStudentFiles, instructor.js:69-83).
        studentFiles: runOptions?.files,
        // Legacy settings (on_run.js:40-45 / BlockPyEnvironment).
        skipTifa: runOptions?.disableTifa,
        skipRun: runOptions?.disableInstructorRun,
        seed: runOptions?.seed,
      },
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
  const shaped = shapePedalFeedback(result.feedback, handlers);
  return {
    error: null,
    feedback: shaped.feedback,
    grade: shaped.grade,
    instructions: shaped.instructions,
    errorLine: shaped.errorLine,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
