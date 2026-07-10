/**
 * Browser Web Worker entry (spec §6.2): thin shell over WorkerHost.
 * Bundled by the app's Vite build as a module worker; Pyodide loads from
 * `paths.pyodideIndexURL` (BootConfig) passed in the 'init' message.
 */
/// <reference lib="webworker" />
import { loadPyodide } from 'pyodide';
import { detectEngineMode, type ClientToWorker } from './protocol';
import { JobRunner } from './runner';
import { WorkerHost } from './worker-host';

declare const self: DedicatedWorkerGlobalScope;

const host = new WorkerHost({
  post: (message) => self.postMessage(message),
  loadRunner: async (indexURL?: string) => {
    const pyodide = await loadPyodide(indexURL ? { indexURL } : undefined);
    return JobRunner.create(pyodide as never);
  },
  mode: detectEngineMode(self as never),
});

self.onmessage = (event: MessageEvent<ClientToWorker>) => {
  void host.handle(event.data);
};
