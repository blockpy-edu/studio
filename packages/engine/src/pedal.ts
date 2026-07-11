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
import { PEDAL_ENV_PY } from './pedal-env.py';

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
   * Present when the grader or Pedal itself crashed (fail-soft): the full
   * Python traceback. Log as X-System.Error; never show raw to students.
   */
  system_error?: string;
}

export interface PedalGradeOptions {
  studentCode: string;
  /** The instructor grading script (`!on_run.py`), executed unchanged. */
  onRun: string;
  /** Support files staged into the working directory before grading. */
  files?: Record<string, string>;
  /** Scripted stdin consumed by Pedal's sandbox (queue_input). */
  inputs?: string[];
}

// curriculum-ctvt is NOT on PyPI (unlike curriculum-sneks) — it joins this
// list when its wheel is bundled with the deployment (spec §10.1).
export const DEFAULT_PEDAL_PACKAGES = ['pedal', 'curriculum-sneks', 'bakery'];

interface GradeFn {
  (
    studentCode: string,
    onRun: string,
    filesJson: string,
    inputs: string[],
  ): {
    toJs(options: { dict_converter: typeof Object.fromEntries }): PedalFeedback;
    destroy(): void;
  };
}

export class PedalEnvironment {
  private constructor(private grade_: GradeFn) {}

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
    return new PedalEnvironment(grade);
  }

  grade(options: PedalGradeOptions): PedalFeedback {
    const proxy = this.grade_(
      options.studentCode,
      options.onRun,
      JSON.stringify(options.files ?? {}),
      options.inputs ?? [],
    );
    const feedback = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    return feedback;
  }
}
