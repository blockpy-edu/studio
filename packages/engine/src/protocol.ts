/**
 * Engine job model and client↔worker protocol (spec §6.2-6.3).
 */
import type { PedalFeedback } from './pedal';

export type Phase =
  | 'student.run'
  | 'student.eval'
  | 'instructor.on_run'
  | 'instructor.on_change'
  | 'instructor.on_eval'
  | 'quiz.preprocess';

/** User-initiated phases preempt background feedback (E5). */
export const PHASE_PRIORITY: Record<Phase, 'user' | 'background'> = {
  'student.run': 'user',
  'student.eval': 'user',
  'instructor.on_run': 'user',
  'instructor.on_eval': 'user',
  'quiz.preprocess': 'user',
  'instructor.on_change': 'background',
};

export interface EngineJob {
  id: string;
  phase: Phase;
  /**
   * Resolved files to stage into the worker FS, keyed by the name student
   * code opens (visibility filtering + search-order resolution happen in
   * the VFS before the job is built - spec §7.5; `^` files never appear).
   */
  files: Record<string, string>;
  /** Code to execute (for eval phases: the expression). */
  code: string;
  /** Filename student-facing errors report (default answer.py). */
  filename?: string;
  /** Instructor scaffolding wrapped around student code (A1 §3). */
  answerPrefix?: string;
  answerSuffix?: string;
  /** Scripted stdin (sample-input replay, Pedal input scripting). */
  inputsPrefill?: string[];
  /**
   * Interactive input() (spec §6.5): when scripted inputs run dry, the
   * worker suspends the run via JSPI and posts 'input-request'; the client
   * answers with 'input-response' once the console collects a line. Set
   * only when the client actually has an input UI wired - otherwise the
   * legacy EOFError fallback applies (and always applies without JSPI).
   */
  interactiveInput?: boolean;
  /**
   * wallMs: client-side watchdog (compat hard stop = worker termination).
   * traceSteps: instruction limit enforced by the tracer when trace is on
   * (legacy `execLimit` maps here, §6.2).
   */
  limits?: { wallMs?: number; traceSteps?: number };
  /** Opt-in per run (perf) - E3. */
  trace?: boolean;
  /**
   * `allow_real_requests` setting (M3.5): skip the ?mock_urls.blockpy
   * `requests` shim and let the real requests package (pyodide-http
   * patched, installed lazily by the runner) hit the network - best-effort,
   * browser CORS still applies. Default false = legacy mock behavior.
   */
  allowRealRequests?: boolean;
  /**
   * Pedal grading request (spec §10.1) - set on `instructor.on_run` /
   * `instructor.on_eval` jobs. The job's `code` is the student submission;
   * the S3 pipeline (set_source → queue_input → start_trace → run → tifa →
   * exec(on_run) → resolve) runs inside the worker and the resolved final
   * feedback comes back on `EngineResult.feedback`.
   */
  pedal?: PedalJobRequest;
}

export interface PedalJobRequest {
  /**
   * The instructor grading script: `!on_run.py` for `instructor.on_run`
   * jobs, `!on_eval.py` for `instructor.on_eval` jobs.
   */
  onRun: string;
  /** Scripted stdin consumed by Pedal's sandbox (queue_input). */
  inputs?: string[];
  /** Override the wheel list (defaults to DEFAULT_PEDAL_PACKAGES). */
  packages?: string[];
  /**
   * Console-eval grading (on_eval.js): the expression the student
   * evaluated. Presence selects the on_eval pipeline, which reuses the
   * LAST grading pass's report/sandbox (no re-run, no re-stage).
   */
  evaluation?: string;
  /**
   * STUDENT-visible file view for the Pedal Submission (legacy
   * getAllStudentFiles); `EngineJob.files` stays the instructor DISK view.
   */
  studentFiles?: Record<string, string>;
  /** Legacy disable_tifa setting. */
  skipTifa?: boolean;
  /** Legacy disable_instructor_run setting (sandbox not re-run). */
  skipRun?: boolean;
  /** Pool-question seed (legacy submission.id; LD-22). */
  seed?: string;
}

/** One compact trace event (E3): powers the Trace/State Explorer. */
export interface TraceStep {
  event: 'call' | 'line' | 'return' | 'exception';
  line: number;
  /** Line with instructor `answer_prefix` lines subtracted. */
  studentLine: number;
  /** Variable snapshot (repr, truncated) - present on 'line' events. */
  locals?: Record<string, string>;
}

export interface EngineError {
  type: string;
  message: string;
  /** 1-indexed line in the file as executed. */
  line: number | null;
  /**
   * Line relative to the student's own code: instructor `answer_prefix`
   * lines subtracted, exactly as the legacy Skulpt integration did (§6.3).
   */
  studentLine: number | null;
  traceback: string;
}

export interface EngineResult {
  jobId: string;
  success: boolean;
  stdout: string;
  stderr: string;
  error?: EngineError;
  /** repr() of the final expression for eval phases. */
  value?: string;
  /** Trace buffer when the job opted in (E3). */
  trace?: TraceStep[];
  /** Base64 PNGs of matplotlib figures the run produced (spec §10.2). */
  images?: string[];
  /** Files created or modified by the run (LD-3x run artifacts). */
  artifacts: Record<string, string>;
  /** Resolved Pedal feedback - present when the job carried `pedal`. */
  feedback?: PedalFeedback;
  durationMs: number;
}

// -- client ↔ worker messages (worker plumbing lands with the compat-mode
//    interrupt work; the types are part of the frozen protocol now) ---------

export type ClientToWorker =
  | { kind: 'init'; indexURL?: string }
  | { kind: 'run'; job: EngineJob }
  | { kind: 'input-response'; jobId: string; value: string }
  | { kind: 'interrupt'; jobId: string }
  | { kind: 'restart-kernel' };

export type WorkerToClient =
  | { kind: 'ready'; mode: EngineMode }
  | { kind: 'stdout'; jobId: string; chunk: string }
  | { kind: 'stderr'; jobId: string; chunk: string }
  | { kind: 'input-request'; jobId: string; prompt: string }
  | { kind: 'result'; result: EngineResult }
  /**
   * Crash recovery (§6.6): the worker replaced a dead/poisoned interpreter
   * with a fresh one. All interpreter state is gone - installed wheels
   * (Pedal!), the REPL namespace, staged files. Clients re-arm anything
   * keyed on "already installed" (the engine adapter resets pedalReady).
   */
  | { kind: 'runner-reloaded' };

/**
 * Compat mode is the PRIMARY mode: SharedArrayBuffer is confirmed
 * unavailable in Canvas LMS iframes (maintainer testing, 2026-07-10).
 * Isolated mode is an opportunistic enhancement. Logged as the
 * `X-Engine.Mode` event (§6.6).
 */
export type EngineMode = 'compat' | 'isolated';

export function detectEngineMode(globalScope: {
  SharedArrayBuffer?: unknown;
  crossOriginIsolated?: boolean;
}): EngineMode {
  return globalScope.crossOriginIsolated === true &&
    typeof globalScope.SharedArrayBuffer === 'function'
    ? 'isolated'
    : 'compat';
}
