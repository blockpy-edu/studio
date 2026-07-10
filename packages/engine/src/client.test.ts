/**
 * EngineClient behavior with fake ports: watchdog hard stop, interrupt,
 * kernel restart, mode reporting (§6.2, §6.6). The end-to-end path with a
 * real runtime is covered in worker-host.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { EngineClient, type EnginePort } from './client';
import type { ClientToWorker, WorkerToClient } from './protocol';

/** A scriptable fake worker port. */
function fakePortFactory(behavior: {
  onRun?: (job: ClientToWorker & { kind: 'run' }, post: (m: WorkerToClient) => void) => void;
}) {
  const spawned: Array<{ terminated: boolean }> = [];
  const factory = (): EnginePort => {
    const record = { terminated: false };
    spawned.push(record);
    let listener: ((m: WorkerToClient) => void) | null = null;
    const post = (m: WorkerToClient) => {
      if (!record.terminated) listener?.(m);
    };
    return {
      postMessage(message) {
        if (record.terminated) return;
        if (message.kind === 'init') {
          queueMicrotask(() => post({ kind: 'ready', mode: 'compat' }));
        } else if (message.kind === 'run') {
          behavior.onRun?.(message, post);
        }
      },
      onMessage(callback) {
        listener = callback;
      },
      terminate() {
        record.terminated = true;
      },
    };
  };
  return { factory, spawned };
}

const job = (id: string) => ({ id, phase: 'student.run' as const, files: {}, code: '' });

describe('EngineClient', () => {
  it('runs a job and streams stdout to its callbacks', async () => {
    const { factory } = fakePortFactory({
      onRun: (message, post) => {
        post({ kind: 'stdout', jobId: message.job.id, chunk: 'hi\n' });
        post({
          kind: 'result',
          result: {
            jobId: message.job.id,
            success: true,
            stdout: 'hi\n',
            stderr: '',
            artifacts: {},
            durationMs: 1,
          },
        });
      },
    });
    const modes: string[] = [];
    const client = new EngineClient({ workerFactory: factory, onMode: (m) => modes.push(m) });
    const chunks: string[] = [];
    const result = await client.run(job('a'), { onStdout: (c) => chunks.push(c) });
    expect(result.success).toBe(true);
    expect(chunks).toEqual(['hi\n']);
    expect(modes).toEqual(['compat']); // X-Engine.Mode source
  });

  it('wall-clock watchdog hard-stops a hung job and respawns the worker', async () => {
    const { factory, spawned } = fakePortFactory({ onRun: () => undefined /* hangs */ });
    const timers: Array<() => void> = [];
    const client = new EngineClient({
      workerFactory: factory,
      defaultWallMs: 100,
      schedule: (fn, ms) => {
        if (ms > 0)
          timers.push(fn); // watchdog only (queue debounce unused here)
        else queueMicrotask(fn);
        return () => undefined;
      },
    });
    const pending = client.run(job('hung'));
    await new Promise((r) => setTimeout(r, 0));
    timers.forEach((fire) => fire()); // watchdog fires
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('TimeoutError');
    expect(spawned).toHaveLength(2); // original + respawn
    expect(spawned[0]!.terminated).toBe(true);
  });

  it('interrupt() on the active job is the compat hard stop', async () => {
    const { factory, spawned } = fakePortFactory({ onRun: () => undefined });
    const client = new EngineClient({ workerFactory: factory });
    const pending = client.run(job('stuck'));
    await new Promise((r) => setTimeout(r, 0));
    client.interrupt('stuck');
    const result = await pending;
    expect(result.error?.type).toBe('KeyboardInterrupt');
    expect(spawned).toHaveLength(2);
  });

  it('restartKernel respawns and re-reports the mode', async () => {
    const { factory, spawned } = fakePortFactory({});
    const modes: string[] = [];
    const client = new EngineClient({ workerFactory: factory, onMode: (m) => modes.push(m) });
    await new Promise((r) => setTimeout(r, 0));
    client.restartKernel();
    await new Promise((r) => setTimeout(r, 0));
    expect(spawned).toHaveLength(2);
    expect(modes).toEqual(['compat', 'compat']);
  });
});
