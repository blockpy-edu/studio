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

  it('fires onRunnerReload for worker heals AND client respawns (§6.6)', async () => {
    let reloads = 0;
    // Worker-side heal: the 'runner-reloaded' message reaches the callback.
    const { factory } = fakePortFactory({
      onRun: (message, post) => {
        post({ kind: 'runner-reloaded' });
        post({
          kind: 'result',
          result: {
            jobId: message.job.id,
            success: true,
            stdout: '',
            stderr: '',
            artifacts: {},
            durationMs: 1,
          },
        });
      },
    });
    const client = new EngineClient({
      workerFactory: factory,
      onRunnerReload: () => {
        reloads += 1;
      },
    });
    await client.run(job('healed'));
    expect(reloads).toBe(1);
    // Client-side respawn (compat hard stop) discards the interpreter too.
    const hang = fakePortFactory({ onRun: () => undefined });
    let respawnReloads = 0;
    const hardStopClient = new EngineClient({
      workerFactory: hang.factory,
      onRunnerReload: () => {
        respawnReloads += 1;
      },
    });
    expect(respawnReloads).toBe(0); // the FIRST spawn is not a reload
    const pending = hardStopClient.run(job('stuck'));
    await new Promise((r) => setTimeout(r, 0));
    hardStopClient.interrupt('stuck');
    await pending;
    expect(respawnReloads).toBe(1);
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

describe('EngineClient interactive input (§6.5)', () => {
  it('pauses the watchdog during input-request and answers input-response', async () => {
    const posted: ClientToWorker[] = [];
    let postToClient: ((m: WorkerToClient) => void) | null = null;
    const factory = (): EnginePort => ({
      postMessage(message) {
        posted.push(message);
        if (message.kind === 'init') {
          queueMicrotask(() => postToClient?.({ kind: 'ready', mode: 'compat' }));
        } else if (message.kind === 'run') {
          queueMicrotask(() =>
            postToClient?.({ kind: 'input-request', jobId: message.job.id, prompt: 'Name?' }),
          );
        } else if (message.kind === 'input-response') {
          queueMicrotask(() =>
            postToClient?.({
              kind: 'result',
              result: {
                jobId: message.jobId,
                success: true,
                stdout: message.value + '\n',
                stderr: '',
                artifacts: {},
                durationMs: 1,
              },
            }),
          );
        }
      },
      onMessage(callback) {
        postToClient = callback;
      },
      terminate() {},
    });
    const watchdogs: Array<() => void> = [];
    const client = new EngineClient({
      workerFactory: factory,
      defaultWallMs: 100,
      schedule: (fn, ms) => {
        if (ms > 0) {
          watchdogs.push(fn);
          return () => {
            const index = watchdogs.indexOf(fn);
            if (index >= 0) watchdogs.splice(index, 1);
          };
        }
        queueMicrotask(fn);
        return () => {};
      },
    });
    let promptSeen = '';
    let watchdogsDuringInput = -1;
    const result = await client.run(job('i1'), {
      onInput: (prompt) => {
        promptSeen = prompt;
        // Thinking time is not execution time: the watchdog is paused.
        watchdogsDuringInput = watchdogs.length;
        return Promise.resolve('penguin');
      },
    });
    expect(promptSeen).toBe('Name?');
    expect(watchdogsDuringInput).toBe(0);
    expect(posted.find((m) => m.kind === 'input-response')).toMatchObject({
      jobId: 'i1',
      value: 'penguin',
    });
    expect(result.stdout).toBe('penguin\n');
  });
});

describe('disable_timeout (non-finite wallMs)', () => {
  it('schedules no watchdog when the job wallMs is Infinity', async () => {
    const { factory } = fakePortFactory({ onRun: () => undefined /* hangs */ });
    const scheduled: number[] = [];
    const client = new EngineClient({
      workerFactory: factory,
      defaultWallMs: 100,
      schedule: (fn, ms) => {
        if (ms > 0) scheduled.push(ms);
        else queueMicrotask(fn);
        return () => undefined;
      },
    });
    const pending = client.run({ ...job('forever'), limits: { wallMs: Number.POSITIVE_INFINITY } });
    await new Promise((r) => setTimeout(r, 0));
    expect(scheduled).toEqual([]);
    client.interrupt('forever');
    const result = await pending;
    expect(result.success).toBe(false);
  });
});

describe('EngineClient failure paths', () => {
  const okResult = (jobId: string) => ({
    jobId,
    success: true,
    stdout: '',
    stderr: '',
    artifacts: {},
    durationMs: 1,
  });

  it('settles coalesced on_change jobs as superseded instead of leaking them', async () => {
    const { factory } = fakePortFactory({
      onRun: (message, post) => post({ kind: 'result', result: okResult(message.job.id) }),
    });
    const client = new EngineClient({
      workerFactory: factory,
      schedule: (fn, ms) => {
        if (ms > 0) return () => undefined; // debounce never fires here
        queueMicrotask(fn);
        return () => undefined;
      },
    });
    const first = client.run({ ...job('c1'), phase: 'instructor.on_change' });
    void client.run({ ...job('c2'), phase: 'instructor.on_change' });
    const result = await first;
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('KeyboardInterrupt');
    expect(result.error?.message).toMatch(/superseded/i);
    expect(client['pendingCallbacks'].has('c1')).toBe(false);
  });

  it('a job waiting on boot survives restartKernel() while idle', async () => {
    // The first worker never says ready; restartKernel replaces it with
    // one that does. The job must run on the NEW worker, not hang.
    let spawnCount = 0;
    const factory = (): EnginePort => {
      const generation = ++spawnCount;
      let listener: ((m: WorkerToClient) => void) | null = null;
      return {
        postMessage(message) {
          if (message.kind === 'init' && generation > 1) {
            queueMicrotask(() => listener?.({ kind: 'ready', mode: 'compat' }));
          } else if (message.kind === 'run') {
            queueMicrotask(() => listener?.({ kind: 'result', result: okResult(message.job.id) }));
          }
        },
        onMessage(callback) {
          listener = callback;
        },
        terminate() {},
      };
    };
    const client = new EngineClient({ workerFactory: factory });
    const pending = client.run(job('waits'));
    await new Promise((r) => setTimeout(r, 0));
    client.restartKernel();
    const result = await pending;
    expect(result.success).toBe(true);
    expect(spawnCount).toBe(2);
  });

  it('a Pyodide load failure resolves runs as EngineError and reports onInitError', async () => {
    const factory = (): EnginePort => {
      let listener: ((m: WorkerToClient) => void) | null = null;
      return {
        postMessage(message) {
          if (message.kind === 'init') {
            queueMicrotask(() => listener?.({ kind: 'init-error', error: 'offline' }));
          }
        },
        onMessage(callback) {
          listener = callback;
        },
        terminate() {},
      };
    };
    const errors: string[] = [];
    const client = new EngineClient({ workerFactory: factory, onInitError: (e) => errors.push(e) });
    const result = await client.run(job('never'));
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('EngineError');
    expect(result.error?.message).toContain('offline');
    expect(errors).toEqual(['offline']);
  });

  it('dispose() settles the active and queued jobs and disarms the watchdog', async () => {
    const { factory, spawned } = fakePortFactory({ onRun: () => undefined /* hangs */ });
    const timers: Array<() => void> = [];
    const client = new EngineClient({
      workerFactory: factory,
      defaultWallMs: 100,
      schedule: (fn, ms) => {
        if (ms > 0) timers.push(fn);
        else queueMicrotask(fn);
        return () => undefined;
      },
    });
    const active = client.run(job('active'));
    const queued = client.run(job('queued'));
    const change = client.run({ ...job('change'), phase: 'instructor.on_change' });
    await new Promise((r) => setTimeout(r, 0));
    client.dispose();
    for (const result of await Promise.all([active, queued, change])) {
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Engine disposed');
    }
    // The stale watchdog is a no-op: no respawn after dispose.
    timers.forEach((fire) => fire());
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.terminated).toBe(true);
    // Runs after dispose settle immediately.
    const late = await client.run(job('late'));
    expect(late.error?.message).toBe('Engine disposed');
  });

  it('interrupting a QUEUED job resolves it without reaching the worker', async () => {
    const ran: string[] = [];
    const { factory } = fakePortFactory({
      onRun: (message, post) => {
        ran.push(message.job.id);
        if (message.job.id !== 'blocker') {
          post({ kind: 'result', result: okResult(message.job.id) });
        }
      },
    });
    const client = new EngineClient({ workerFactory: factory });
    const blocker = client.run(job('blocker'));
    const queued = client.run(job('queued'));
    await new Promise((r) => setTimeout(r, 0));
    client.interrupt('queued');
    client.interrupt('blocker'); // hard stop → respawn; the queued interrupt survives it
    expect((await blocker).error?.type).toBe('KeyboardInterrupt');
    expect((await queued).error?.type).toBe('KeyboardInterrupt');
    expect(ran).toEqual(['blocker']);
  });
});

describe('EngineClient interactive input failure paths (§6.5)', () => {
  function inputPort() {
    const posted: ClientToWorker[] = [];
    let postToClient: ((m: WorkerToClient) => void) | null = null;
    const factory = (): EnginePort => ({
      postMessage(message) {
        posted.push(message);
        if (message.kind === 'init') {
          queueMicrotask(() => postToClient?.({ kind: 'ready', mode: 'compat' }));
        } else if (message.kind === 'run') {
          queueMicrotask(() =>
            postToClient?.({ kind: 'input-request', jobId: message.job.id, prompt: '?' }),
          );
        } else if (message.kind === 'input-response') {
          queueMicrotask(() =>
            postToClient?.({
              kind: 'result',
              result: {
                jobId: message.jobId,
                success: !message.eof,
                stdout: '',
                stderr: '',
                artifacts: {},
                durationMs: 1,
              },
            }),
          );
        }
      },
      onMessage(callback) {
        postToClient = callback;
      },
      terminate() {},
    });
    return { factory, posted };
  }

  it('a rejected onInput answers EOF so the run finishes', async () => {
    const { factory, posted } = inputPort();
    const client = new EngineClient({ workerFactory: factory });
    const result = await client.run(job('i1'), {
      onInput: () => Promise.reject(new Error('prompt dismissed')),
    });
    expect(posted.find((m) => m.kind === 'input-response')).toMatchObject({
      jobId: 'i1',
      eof: true,
    });
    expect(result.success).toBe(false);
  });

  it('a job with interactiveInput but no onInput is answered EOF, not left suspended', async () => {
    const { factory, posted } = inputPort();
    const client = new EngineClient({ workerFactory: factory });
    const result = await client.run({ ...job('i2'), interactiveInput: true });
    expect(posted.find((m) => m.kind === 'input-response')).toMatchObject({
      jobId: 'i2',
      eof: true,
    });
    expect(result.success).toBe(false);
  });
});

describe('EngineClient with a synchronous port', () => {
  it('runs two jobs back to back when results arrive synchronously inside postMessage', async () => {
    // A port that answers `run` synchronously (loopback-style) settles the
    // job before executeOnWorker's completion latch used to be armed -
    // the first job hung the queue forever and the second never ran.
    const ran: string[] = [];
    const { factory } = fakePortFactory({
      onRun: (message, post) => {
        ran.push(message.job.id);
        post({
          kind: 'result',
          result: {
            jobId: message.job.id,
            success: true,
            stdout: '',
            stderr: '',
            artifacts: {},
            durationMs: 1,
          },
        });
      },
    });
    const client = new EngineClient({ workerFactory: factory });
    const first = await client.run(job('one'));
    expect(first.success).toBe(true);
    const second = await client.run(job('two'));
    expect(second.success).toBe(true);
    expect(ran).toEqual(['one', 'two']);
    await new Promise((r) => setTimeout(r, 0)); // let the pump loop unwind
    expect(client['queue']['running']).toBe(false);
    expect(client['active']).toBeNull();
  });

  it('settles a job whose execute rejects instead of leaking its promise', async () => {
    const { factory } = fakePortFactory({});
    const client = new EngineClient({ workerFactory: factory });
    client['executeOnWorker'] = () => Promise.reject(new Error('worker exploded'));
    const result = await client.run(job('broken'));
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('EngineError');
    expect(result.error?.message).toContain('worker exploded');
  });
});
