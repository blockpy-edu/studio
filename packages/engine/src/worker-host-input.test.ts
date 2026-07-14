/**
 * Interactive input() protocol plumbing (spec §6.5) with a fake runner —
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
    // The crashing run resolves as an error (no hang)…
    await host.handle({ kind: 'run', job: job({ id: 'boom', interactiveInput: false }) });
    const boom = posts.find((m) => m.kind === 'result' && m.result.jobId === 'boom');
    expect(boom).toMatchObject({ result: { success: false, error: { type: 'EngineError' } } });
    // …and a fresh interpreter was reloaded (the corpse is not reused).
    expect(loadCount).toBe(2);
    // The next run works on the healed runner.
    shouldCrash = false;
    await host.handle({ kind: 'run', job: job({ id: 'next', interactiveInput: false }) });
    const next = posts.find((m) => m.kind === 'result' && m.result.jobId === 'next');
    expect(next).toMatchObject({ result: { jobId: 'next', success: true, stdout: 'ok' } });
  });
});
