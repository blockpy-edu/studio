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
   * the VFS before the job is built — spec §7.5; `^` files never appear).
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
   * wallMs: client-side watchdog (compat hard stop = worker termination).
   * traceSteps: instruction limit enforced by the tracer when trace is on
   * (legacy `execLimit` maps here, §6.2).
   */
  limits?: { wallMs?: number; traceSteps?: number };
  /** Opt-in per run (perf) — E3. */
  trace?: boolean;
  /**
   * Pedal grading request (spec §10.1) — set on `instructor.on_run` /
   * `instructor.on_eval` jobs. The job's `code` is the student submission;
   * the S3 pipeline (set_source → queue_input → start_trace → run → tifa →
   * exec(on_run) → resolve) runs inside the worker and the resolved final
   * feedback comes back on `EngineResult.feedback`.
   */
  pedal?: PedalJobRequest;
}

export interface PedalJobRequest {
  /** The instructor grading script (`!on_run.py`), executed unchanged. */
  onRun: string;
  /** Scripted stdin consumed by Pedal's sandbox (queue_input). */
  inputs?: string[];
  /** Override the wheel list (defaults to DEFAULT_PEDAL_PACKAGES). */
  packages?: string[];
}

/** One compact trace event (E3): powers the Trace/State Explorer. */
export interface TraceStep {
  event: 'call' | 'line' | 'return' | 'exception';
  line: number;
  /** Line with instructor `answer_prefix` lines subtracted. */
  studentLine: number;
  /** Variable snapshot (repr, truncated) — present on 'line' events. */
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
  /** Files created or modified by the run (LD-3x run artifacts). */
  artifacts: Record<string, string>;
  /** Resolved Pedal feedback — present when the job carried `pedal`. */
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
  | { kind: 'result'; result: EngineResult };

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
