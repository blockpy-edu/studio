/**
 * @blockpy/engine — Pyodide-backed Python execution service (spec §6).
 * Compat mode (no SharedArrayBuffer) is the primary mode — see
 * docs/spikes and memory: SAB is unavailable in Canvas LMS iframes.
 */
export { PHASE_PRIORITY, detectEngineMode } from './protocol';
export type {
  ClientToWorker,
  EngineError,
  EngineJob,
  EngineMode,
  EngineResult,
  Phase,
  WorkerToClient,
} from './protocol';
export { JobQueue } from './queue';
export type { JobQueueOptions } from './queue';
export { JobRunner } from './runner';
export type { PyodideLike } from './runner';
export { RUNTIME_PY } from './runtime.py';

export const PACKAGE_NAME = '@blockpy/engine';
