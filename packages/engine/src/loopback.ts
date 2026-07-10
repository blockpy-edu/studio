/**
 * In-process EnginePort: runs the WorkerHost on the current thread instead
 * of a Web Worker. Used by the Node test suite and the dev harness. Note
 * that a loopback cannot be hard-stopped mid-execution (no thread to
 * terminate) — wall-clock limits are only meaningful with a real worker.
 */
import type { EnginePort } from './client';
import type { EngineMode, WorkerToClient } from './protocol';
import type { JobRunner } from './runner';
import { WorkerHost } from './worker-host';

export function createLoopbackPort(
  loadRunner: () => Promise<JobRunner>,
  mode: EngineMode = 'compat',
): EnginePort {
  let listener: ((message: WorkerToClient) => void) | null = null;
  let terminated = false;
  const host = new WorkerHost({
    post: (message) => {
      if (!terminated) listener?.(message);
    },
    loadRunner,
    mode,
  });
  return {
    postMessage(message) {
      if (terminated) return;
      void host.handle(message);
    },
    onMessage(callback) {
      listener = callback;
    },
    terminate() {
      terminated = true;
    },
  };
}
