/**
 * @blockpy/engine — Pyodide-backed Python execution service (spec §6).
 * Compat mode (no SharedArrayBuffer) is the primary mode — SAB is
 * unavailable in Canvas LMS iframes (maintainer testing, 2026-07-10).
 */
export { PHASE_PRIORITY, detectEngineMode } from './protocol';
export type {
  ClientToWorker,
  EngineError,
  EngineJob,
  EngineMode,
  EngineResult,
  PedalJobRequest,
  Phase,
  TraceStep,
  WorkerToClient,
} from './protocol';
export { JobQueue } from './queue';
export type { JobQueueOptions } from './queue';
export { JobRunner } from './runner';
export type { PyodideLike, StreamCallbacks } from './runner';
export { WorkerHost } from './worker-host';
export type { WorkerHostOptions } from './worker-host';
export { EngineClient } from './client';
export type { EngineClientOptions, EnginePort, RunCallbacks } from './client';
export { createLoopbackPort } from './loopback';
export { default as RUNTIME_PY } from './runtime.py?raw';

export const PACKAGE_NAME = '@blockpy/engine';
export { PedalEnvironment, DEFAULT_PEDAL_PACKAGES } from './pedal';
export type {
  PedalEvalOptions,
  PedalFeedback,
  PedalGradeOptions,
  PedalPyodideLike,
} from './pedal';
export { default as PEDAL_ENV_PY } from './pedal-env.py?raw';
