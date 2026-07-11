/**
 * JobRunner: executes EngineJobs against one Pyodide instance (spec §6.2).
 * UI-free and Node-runnable — the worker host and the browser client wrap
 * this. Wall-clock enforcement lives client-side (compat mode's hard stop
 * is worker termination, §6.6); the runner is single-job-at-a-time.
 */
import { RUNTIME_PY } from './runtime.py';
import { PedalEnvironment, type PedalPyodideLike } from './pedal';
import type { EngineJob, EngineResult, TraceStep } from './protocol';

/** The slice of the Pyodide API the runner uses (keeps tests/fakes easy). */
export interface PyodideLike {
  runPython(code: string, options?: { globals?: unknown }): unknown;
  globals: { get(name: string): unknown };
}

export interface StreamCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

interface PyProxy {
  toJs(options: { dict_converter: typeof Object.fromEntries }): RuntimePayload;
  destroy(): void;
}

type StreamCallback = ((chunk: string) => void) | null;

interface RuntimeHandle {
  stage_files(files: unknown): void;
  collect_artifacts(): PyProxy;
  run(
    code: string,
    filename: string,
    prefix: string,
    suffix: string,
    inputs: unknown,
    mode: string,
    extractResult: boolean,
    trace: boolean,
    traceLimit: number | null,
    onStdout: StreamCallback,
    onStderr: StreamCallback,
  ): PyProxy;
  evaluate(expression: string, onStdout: StreamCallback, onStderr: StreamCallback): PyProxy;
  clear_namespace(): void;
}

interface RuntimePayload {
  error?: {
    type: string;
    message: string;
    line: number | null;
    student_line: number | null;
    traceback: string;
  } | null;
  value?: string | null;
  stdout: string;
  stderr: string;
  trace?: Array<{
    event: TraceStep['event'];
    line: number;
    student_line: number;
    locals?: Record<string, string>;
  }> | null;
}

const toJsDeep = (proxy: PyProxy): RuntimePayload => {
  const value = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return value;
};

export class JobRunner {
  private runtime: RuntimeHandle;
  private pedalEnv: PedalEnvironment | null = null;

  private constructor(
    private pyodide: PyodideLike,
    runtime: RuntimeHandle,
  ) {
    this.runtime = runtime;
  }

  /** Install the runtime module into a loaded Pyodide instance. */
  static create(pyodide: PyodideLike): JobRunner {
    pyodide.runPython(RUNTIME_PY);
    const runtime = pyodide.globals.get('_studio_runtime') as RuntimeHandle;
    return new JobRunner(pyodide, runtime);
  }

  /** Clear the retained REPL namespace (legacy: cleared on new runs). */
  clearNamespace(): void {
    this.runtime.clear_namespace();
  }

  /** Lazy Pedal environment — wheels install on the first grading job. */
  private async ensurePedal(packages?: string[]): Promise<PedalEnvironment> {
    if (this.pedalEnv === null) {
      this.pedalEnv = await PedalEnvironment.install(
        this.pyodide as unknown as PedalPyodideLike,
        packages,
      );
    }
    return this.pedalEnv;
  }

  /**
   * Pedal grading job (spec §10.1): the environment re-runs the student
   * submission inside Pedal's sandbox, so no exec happens here. Grader and
   * Pedal crashes are fail-soft inside the environment (`system_error`
   * feedback); only wheel-install failures surface as job errors.
   */
  private async executePedal(job: EngineJob, started: number): Promise<EngineResult> {
    const request = job.pedal!;
    try {
      const env = await this.ensurePedal(request.packages);
      const feedback = env.grade({
        studentCode: job.code,
        onRun: request.onRun,
        files: job.files,
        inputs: request.inputs ?? job.inputsPrefill,
      });
      return {
        jobId: job.id,
        success: true,
        stdout: '',
        stderr: '',
        artifacts: {},
        feedback,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        jobId: job.id,
        success: false,
        stdout: '',
        stderr: '',
        error: {
          type: 'PedalEnvironmentError',
          message,
          line: null,
          studentLine: null,
          traceback: message + '\n',
        },
        artifacts: {},
        durationMs: Date.now() - started,
      };
    }
  }

  async execute(job: EngineJob, streams: StreamCallbacks = {}): Promise<EngineResult> {
    const started = Date.now();
    if (job.pedal) {
      return this.executePedal(job, started);
    }
    // Stage via a Python-side JSON parse to avoid proxy lifetime headaches.
    this.pyodide.runPython(
      `_studio_runtime.stage_files(__import__('json').loads(${JSON.stringify(
        JSON.stringify(job.files),
      )}))`,
    );

    const onStdout = streams.onStdout ?? null;
    const onStderr = streams.onStderr ?? null;
    const payload =
      job.phase === 'student.eval' || job.phase === 'instructor.on_eval'
        ? toJsDeep(this.runtime.evaluate(job.code, onStdout, onStderr))
        : toJsDeep(
            this.runtime.run(
              job.code,
              job.filename ?? 'answer.py',
              job.answerPrefix ?? '',
              job.answerSuffix ?? '',
              job.inputsPrefill ?? [],
              'exec',
              job.phase === 'quiz.preprocess',
              job.trace ?? false,
              job.limits?.traceSteps ?? null,
              onStdout,
              onStderr,
            ),
          );

    const artifacts = toJsDeep(this.runtime.collect_artifacts()) as unknown as Record<
      string,
      string
    >;

    return {
      jobId: job.id,
      // pyodide's toJs maps Python None to undefined (not null)
      success: !payload.error,
      stdout: payload.stdout,
      stderr: payload.stderr,
      error: payload.error
        ? {
            type: payload.error.type,
            message: payload.error.message,
            line: payload.error.line,
            studentLine: payload.error.student_line,
            traceback: payload.error.traceback,
          }
        : undefined,
      value: payload.value ?? undefined,
      trace: payload.trace
        ? payload.trace.map((step) => ({
            event: step.event,
            line: step.line,
            studentLine: step.student_line,
            locals: step.locals,
          }))
        : undefined,
      artifacts,
      durationMs: Date.now() - started,
    };
  }
}
