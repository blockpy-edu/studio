import { describe, expect, it } from 'vitest';
import { JobQueue } from './queue';
import { detectEngineMode, type EngineJob } from './protocol';

const job = (id: string, phase: EngineJob['phase']): EngineJob => ({
  id,
  phase,
  files: {},
  code: '',
});

function setup() {
  const executed: string[] = [];
  const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
  let resolveBlocked: (() => void) | null = null;
  let blockNext = false;
  const queue = new JobQueue({
    execute: async (j) => {
      executed.push(j.id);
      if (blockNext) {
        blockNext = false;
        await new Promise<void>((resolve) => {
          resolveBlocked = resolve;
        });
      }
    },
    schedule: (fn) => {
      const timer = { fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const fireDebounce = () => {
    for (const t of timers.splice(0)) if (!t.cancelled) t.fn();
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    queue,
    executed,
    fireDebounce,
    settle,
    block: () => {
      blockNext = true;
    },
    unblock: () => resolveBlocked?.(),
  };
}

describe('JobQueue (E5)', () => {
  it('runs user jobs FIFO', async () => {
    const s = setup();
    s.queue.enqueue(job('a', 'student.run'));
    s.queue.enqueue(job('b', 'instructor.on_run'));
    await s.settle();
    expect(s.executed).toEqual(['a', 'b']);
  });

  it('coalesces on_change jobs - only the newest survives', async () => {
    const s = setup();
    s.queue.enqueue(job('c1', 'instructor.on_change'));
    s.queue.enqueue(job('c2', 'instructor.on_change'));
    s.queue.enqueue(job('c3', 'instructor.on_change'));
    s.fireDebounce();
    await s.settle();
    expect(s.executed).toEqual(['c3']);
  });

  it('user jobs preempt a pending on_change', async () => {
    const s = setup();
    s.block(); // make the first user job hold the runner
    s.queue.enqueue(job('run1', 'student.run'));
    await s.settle();
    s.queue.enqueue(job('change', 'instructor.on_change'));
    s.fireDebounce();
    s.queue.enqueue(job('run2', 'student.run'));
    s.unblock();
    await s.settle();
    expect(s.executed).toEqual(['run1', 'run2', 'change']);
  });

  it('on_change does not run before its debounce fires', async () => {
    const s = setup();
    s.queue.enqueue(job('change', 'instructor.on_change'));
    await s.settle();
    expect(s.executed).toEqual([]);
    s.fireDebounce();
    await s.settle();
    expect(s.executed).toEqual(['change']);
  });
});

describe('engine mode detection (§6.6)', () => {
  it('compat is the default; isolated requires COOP/COEP + SAB', () => {
    expect(detectEngineMode({})).toBe('compat');
    expect(detectEngineMode({ crossOriginIsolated: false, SharedArrayBuffer: class {} })).toBe(
      'compat',
    );
    expect(detectEngineMode({ crossOriginIsolated: true, SharedArrayBuffer: class {} })).toBe(
      'isolated',
    );
  });
});
