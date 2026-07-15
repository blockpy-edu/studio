/**
 * PedalEnvironment (spec §10.1): installs the grading wheels into a Pyodide
 * instance and exposes the environment contract instructor `!on_run.py`
 * scripts expect. The final feedback object drives the feedback pane and
 * the §14.3 submission lifecycle (`updateSubmission` → `markCorrect`).
 *
 * In production the wheels are bundled with the deployment (§10.1); the
 * default package list resolves from PyPI via micropip, which is fine for
 * dev/tests but must be pinned/bundled before Phase 2 ships.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./raw.d.ts" />
import PEDAL_ENV_PY from './pedal-env.py?raw';

/** Pyodide surface needed here (superset of the runner's PyodideLike). */
export interface PedalPyodideLike {
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
  loadPackage(name: string): Promise<unknown>;
  globals: { get(name: string): unknown };
}

/** The final feedback object (spec §10.1 taxonomy). */
export interface PedalFeedback {
  success: boolean;
  score: number;
  category: string;
  label: string;
  title: string;
  /** Rendered feedback body (may embed HTML; D4-A: rendered unsanitized). */
  message: string;
  /**
   * Legacy `HIDE` (`final.hide_correctness`): hide the correct/incorrect
   * verdict; also blocks the markCorrect navigation callback (§14.3).
   */
  hide_correctness?: boolean;
  /**
   * Legacy countTestCases tallies (feedback.js:341-368) - the `unitTests`
   * block of the Intervention event payload (A2). Key spelling is the
   * legacy wire format (`feedbackSuccess` camelCase included).
   */
  unit_tests?: {
    tests: number;
    feedbacks: number;
    successes: number;
    feedbackSuccess: number;
  };
  /**
   * Present when the grader or Pedal itself crashed (fail-soft): the full
   * Python traceback. Log as X-System.Error; never show raw to students.
   */
  system_error?: string;
  /**
   * Questions support (on_run.js:74-76): the LAST instructions-category
   * feedback replaces the instructions pane (legacy set_instructions).
   */
  instructions?: string | null;
  /** final.positives (on_run.js:78-88, else_message quirk applied). */
  positives?: { title: string; label: string; message: string }[];
  /** final.systems with label log/debug - dev-console lines (on_run.js:90-95). */
  systems?: { label: string; title: string; message: string }[];
  /** DATA['location'].line (feedback.js findFirstErrorLine) - error highlight. */
  line?: number | null;
}

export interface PedalGradeOptions {
  studentCode: string;
  /** The instructor grading script (`!on_run.py`), executed unchanged. */
  onRun: string;
  /** Support files staged into the working directory before grading. */
  files?: Record<string, string>;
  /** Scripted stdin consumed by Pedal's sandbox (queue_input). */
  inputs?: string[];
  /**
   * The STUDENT-visible file view for the Pedal Submission (legacy
   * getAllStudentFiles: answer.py + chomped ?/& extras + student extras).
   * `files` above is the instructor DISK staging; this feeds the report.
   */
  studentFiles?: Record<string, string>;
  /** Legacy disable_tifa setting → BlockPyEnvironment skip_tifa. */
  skipTifa?: boolean;
  /** Legacy disable_instructor_run setting → skip_run (sandbox not run). */
  skipRun?: boolean;
  /** Pool-question seed (legacy submission.id; LD-22 makes it stick). */
  seed?: string;
}

export interface PedalEvalOptions {
  /** The console expression the student evaluated. */
  evaluation: string;
  /** The instructor `!on_eval.py` script, executed unchanged. */
  onEval: string;
}

// curriculum-ctvt is NOT on PyPI (unlike curriculum-sneks) - it joins this
// list when its wheel is bundled with the deployment (spec §10.1).
export const DEFAULT_PEDAL_PACKAGES = ['pedal', 'curriculum-sneks', 'bakery'];

interface FeedbackProxy {
  toJs(options: { dict_converter: typeof Object.fromEntries }): PedalFeedback;
  destroy(): void;
}

interface GradeFn {
  (
    studentCode: string,
    onRun: string,
    filesJson: string,
    inputs: string[],
    optionsJson: string,
  ): FeedbackProxy;
}

interface EvalFn {
  (evaluation: string, onEval: string, optionsJson: string): FeedbackProxy;
}

export class PedalEnvironment {
  private constructor(
    private grade_: GradeFn,
    private evaluate_: EvalFn,
  ) {}

  /**
   * Install wheels (micropip) and the environment module. Call once per
   * interpreter; grading calls are then synchronous and isolated per call
   * via MAIN_REPORT.clear() (verified in Spike S3).
   */
  static async install(
    pyodide: PedalPyodideLike,
    packages: string[] = DEFAULT_PEDAL_PACKAGES,
  ): Promise<PedalEnvironment> {
    await pyodide.loadPackage('micropip');
    await pyodide.runPythonAsync(
      `import micropip\nawait micropip.install(${JSON.stringify(packages)})`,
    );
    pyodide.runPython(PEDAL_ENV_PY);
    const grade = pyodide.globals.get('_studio_pedal_grade') as GradeFn;
    const evaluate = pyodide.globals.get('_studio_pedal_evaluate') as EvalFn;
    return new PedalEnvironment(grade, evaluate);
  }

  grade(options: PedalGradeOptions): PedalFeedback {
    const proxy = this.grade_(
      options.studentCode,
      options.onRun,
      JSON.stringify(options.files ?? {}),
      options.inputs ?? [],
      JSON.stringify({
        skip_tifa: options.skipTifa ?? false,
        skip_run: options.skipRun ?? false,
        seed: options.seed ?? null,
        student_files: options.studentFiles ?? {},
      }),
    );
    const feedback = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    return feedback;
  }

  /**
   * Console-eval grading (on_eval.js): runs against the LAST grade()'s
   * report/sandbox in this interpreter - call only after a grading pass.
   */
  evaluateGrade(options: PedalEvalOptions): PedalFeedback {
    const proxy = this.evaluate_(options.evaluation, options.onEval, '{}');
    const feedback = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    return feedback;
  }
}
