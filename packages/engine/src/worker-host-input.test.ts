/**
 * Interactive input() protocol plumbing (spec §6.5) with a fake runner -
 * the JSPI suspension itself is browser-only (worker-host.test.ts covers
 * the no-JSPI EOFError fallback against real Pyodide).
 */
import { describe, expect, it } from 'vitest';
import { WorkerHost } from './worker-host';
import type { EngineJob, WorkerToClient } from './protocol';
import type { JobRunner, StreamCallbacks } from './runner';

const job = (overrides: Partial<EngineJob> = {}): EngineJob => ({
  id: 'j1',
  phase: 'student.run',
  files: {},
  code: '',
  interactiveInput: true,
  ...overrides,
});

describe('WorkerHost interactive input round trip', () => {
  it('posts input-request, suspends on the promise, resumes on input-response', async () => {
    const posts: WorkerToClient[] = [];
    const fakeRunner = {
      execute: async (running: EngineJob, streams: StreamCallbacks) => {
        const value = await streams.onInput!('Fav animal?');
        return {
          jobId: running.id,
          success: true,
          stdout: value,
          stderr: '',
          artifacts: {},
          durationMs: 0,
        };
      },
    } as unknown as JobRunner;
    const host = new WorkerHost({
      post: (message) => posts.push(message),
      loadRunner: async () => fakeRunner,
      mode: 'compat',
    });
    await host.handle({ kind: 'init' });
    const running = host.handle({ kind: 'run', job: job() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts.find((m) => m.kind === 'input-request')).toMatchObject({
      jobId: 'j1',
      prompt: 'Fav animal?',
    });
    await host.handle({ kind: 'input-response', jobId: 'j1', value: 'penguin' });
    await running;
    const result = posts.find((m) => m.kind === 'result');
    expect(result).toMatchObject({ result: { jobId: 'j1', success: true, stdout: 'penguin' } });
  });

  it('ignores stale input-responses for unknown jobs', async () => {
    const posts: WorkerToClient[] = [];
    const host = new WorkerHost({
      post: (message) => posts.push(message),
      loadRunner: async () => ({ execute: async () => ({}) }) as unknown as JobRunner,
      mode: 'compat',
    });
    await host.handle({ kind: 'input-response', jobId: 'ghost', value: 'x' });
    expect(posts).toEqual([]);
  });

  it('a fatal execute error resolves the job AND reloads a fresh runner', async () => {
    const posts: WorkerToClient[] = [];
    let loadCount = 0;
    let shouldCrash = true;
    const host = new WorkerHost({
      post: (message) => posts.push(message),
      loadRunner: async () => {
        loadCount += 1;
        return {
          execute: async (running: EngineJob) => {
            if (shouldCrash) throw new RangeError('Maximum call stack size exceeded');
            return {
              jobId: running.id,
              success: true,
              stdout: 'ok',
              stderr: '',
              artifacts: {},
              durationMs: 0,
            };
          },
        } as unknown as JobRunner;
      },
      mode: 'compat',
    });
    await host.handle({ kind: 'init' });
    expect(loadCount).toBe(1);
    // The crashing run resolves as a recovered-crash error (no hang), with
    // the student-facing explanation up front and the raw cause preserved
    // in the traceback for the dev console.
    await host.handle({ kind: 'run', job: job({ id: 'boom', interactiveInput: false }) });
    const boom = posts.find((m) => m.kind === 'result' && m.result.jobId === 'boom');
    expect(boom).toMatchObject({ result: { success: false, error: { type: 'EngineCrash' } } });
    expect((boom as { result: { error: { message: string } } }).result.error.message).toContain(
      'unbounded recursion',
    );
    expect((boom as { result: { error: { traceback: string } } }).result.error.traceback).toContain(
      'Maximum call stack size exceeded',
    );
    // …a fresh interpreter was reloaded (the corpse is not reused) and the
    // client was told interpreter state is gone (§6.6).
    expect(loadCount).toBe(2);
    expect(posts.filter((m) => m.kind === 'runner-reloaded')).toHaveLength(1);
    // The next run works on the healed runner.
    shouldCrash = false;
    await host.handle({ kind: 'run', job: job({ id: 'next', interactiveInput: false }) });
    const next = posts.find((m) => m.kind === 'result' && m.result.jobId === 'next');
    expect(next).toMatchObject({ result: { jobId: 'next', success: true, stdout: 'ok' } });
  });

  it('non-fatal execute crashes keep the EngineError shape', async () => {
    const posts: WorkerToClient[] = [];
    const host = new WorkerHost({
      post: (message) => posts.push(message),
      loadRunner: async () =>
        ({
          execute: async () => {
            throw new Error('proxy already destroyed');
          },
        }) as unknown as JobRunner,
      mode: 'compat',
    });
    await host.handle({ kind: 'init' });
    await host.handle({ kind: 'run', job: job({ id: 'j', interactiveInput: false }) });
    const result = posts.find((m) => m.kind === 'result');
    expect(result).toMatchObject({
      result: { error: { type: 'EngineError', message: 'proxy already destroyed' } },
    });
  });

  it('crash and restart-kernel reloads remember the init indexURL (§6.6)', async () => {
    // Reloading without the indexURL resolves pyodide-lock.json against the
    // wrong base - the "<!doctype is not valid JSON" dead-engine failure.
    const urls: Array<string | undefined> = [];
    let crash = true;
    const host = new WorkerHost({
      post: () => undefined,
      loadRunner: async (indexURL?: string) => {
        urls.push(indexURL);
        return {
          execute: async (running: EngineJob) => {
            if (crash) throw new RangeError('Maximum call stack size exceeded');
            return {
              jobId: running.id,
              success: true,
              stdout: '',
              stderr: '',
              artifacts: {},
              durationMs: 0,
            };
          },
        } as unknown as JobRunner;
      },
      mode: 'compat',
    });
    await host.handle({ kind: 'init', indexURL: 'https://host/pyodide/' });
    await host.handle({ kind: 'run', job: job({ id: 'boom', interactiveInput: false }) });
    crash = false;
    await host.handle({ kind: 'restart-kernel' });
    expect(urls).toEqual([
      'https://host/pyodide/',
      'https://host/pyodide/',
      'https://host/pyodide/',
    ]);
  });

  it('post-job stack canary reloads a poisoned interpreter before the next job (§6.6)', async () => {
    // A grading pass can fail-soft around a stack-overflow fatal: the job
    // "succeeds" but the interpreter is poisoned. The canary catches it.
    const posts: WorkerToClient[] = [];
    let loadCount = 0;
    let healthy = false;
    const host = new WorkerHost({
      post: (message) => posts.push(message),
      loadRunner: async () => {
        loadCount += 1;
        return {
          execute: async (running: EngineJob) => ({
            jobId: running.id,
            success: true,
            stdout: '',
            stderr: '',
            artifacts: {},
            durationMs: 0,
          }),
          healthCheck: () => healthy,
        } as unknown as JobRunner;
      },
      mode: 'compat',
    });
    await host.handle({ kind: 'init' });
    healthy = false;
    await host.handle({ kind: 'run', job: job({ id: 'poisoning', interactiveInput: false }) });
    // The job's own result still delivered (it did not fail)…
    expect(posts.find((m) => m.kind === 'result')).toMatchObject({
      result: { jobId: 'poisoning', success: true },
    });
    // …then the poisoned interpreter was replaced and the client told.
    expect(loadCount).toBe(2);
    expect(posts.map((m) => m.kind)).toEqual(['ready', 'result', 'runner-reloaded']);
    // A healthy interpreter is left alone.
    healthy = true;
    await host.handle({ kind: 'run', job: job({ id: 'fine', interactiveInput: false }) });
    expect(loadCount).toBe(2);
  });

  it('a job posted during a crash reload waits for the fresh runner', async () => {
    // worker onmessage calls handle() fire-and-forget; the internal chain
    // must keep a queued run off the corpse while the reload is in flight.
    const posts: WorkerToClient[] = [];
    let loadCount = 0;
    const host = new WorkerHost({
      post: (message) => posts.push(message),
      loadRunner: async () => {
        loadCount += 1;
        const crashes = loadCount === 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          execute: async (running: EngineJob) => {
            if (crashes) throw new RangeError('Maximum call stack size exceeded');
            return {
              jobId: running.id,
              success: true,
              stdout: 'fresh',
              stderr: '',
              artifacts: {},
              durationMs: 0,
            };
          },
        } as unknown as JobRunner;
      },
      mode: 'compat',
    });
    await host.handle({ kind: 'init' });
    // Fire both without awaiting - the second arrives mid-crash-recovery.
    const first = host.handle({ kind: 'run', job: job({ id: 'boom', interactiveInput: false }) });
    const second = host.handle({ kind: 'run', job: job({ id: 'after', interactiveInput: false }) });
    await Promise.all([first, second]);
    const after = posts.find((m) => m.kind === 'result' && m.result.jobId === 'after');
    expect(after).toMatchObject({ result: { success: true, stdout: 'fresh' } });
  });
});
