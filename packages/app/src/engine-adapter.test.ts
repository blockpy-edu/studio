/**
 * M3.2: the grading pass chains after EVERY run (legacy engine.js:109-124 -
 * `failure()` resolves), so student syntax/runtime errors reach Pedal as
 * feedback while the raw traceback still surfaces on the student console.
 * Only `disable_feedback` skips grading.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunHandlers } from '@blockpy/editor';

interface FakeJob {
  id: string;
  phase: string;
  pedal?: { onRun: string };
  limits?: { wallMs: number };
}

const runCalls: FakeJob[] = [];
let cannedResults: unknown[] = [];
const interruptCalls: string[] = [];
const disposeCalls: number[] = [];
// When set, a job of this phase parks until `releaseHeld()` runs.
let holdPhase: string | null = null;
let releaseHeld: () => void = () => undefined;

vi.mock('@blockpy/engine', () => ({
  EngineClient: class {
    async run(job: FakeJob): Promise<unknown> {
      runCalls.push(job);
      if (holdPhase === job.phase) {
        await new Promise<void>((resolve) => {
          releaseHeld = resolve;
        });
      }
      return cannedResults.shift();
    }
    interrupt(jobId: string): void {
      interruptCalls.push(jobId);
    }
    dispose(): void {
      disposeCalls.push(1);
    }
  },
}));

import { createEngineRunController, workerPort } from './engine-adapter';

const RUNTIME_ERROR_RESULT = {
  success: false,
  error: {
    type: 'ZeroDivisionError',
    message: 'division by zero',
    studentLine: 2,
    traceback: 'Traceback (most recent call last):\n  ...\nZeroDivisionError: division by zero',
  },
  trace: [],
  images: [],
};

const CLEAN_RESULT = { success: true, error: null, trace: [], images: [] };

const PEDAL_RESULT = {
  success: true,
  error: null,
  feedback: {
    category: 'runtime',
    label: 'division_by_zero',
    title: 'Division By Zero',
    message: 'You divided by zero on line 2.',
    success: false,
    score: 0,
    hide_correctness: false,
  },
};

function handlers(): RunHandlers {
  return { stdout: () => {}, stderr: () => {}, system: () => {} };
}

beforeEach(() => {
  runCalls.length = 0;
  cannedResults = [];
  interruptCalls.length = 0;
  disposeCalls.length = 0;
  holdPhase = null;
});

describe('engine adapter grading resilience (M3.2)', () => {
  it('still grades when the student run raised, keeping the traceback', async () => {
    cannedResults = [RUNTIME_ERROR_RESULT, PEDAL_RESULT];
    const controller = createEngineRunController();
    const outcome = await controller.run('1/0', handlers(), {
      onRun: 'from pedal import *',
    });
    expect(runCalls.map((job) => job.phase)).toEqual(['student.run', 'instructor.on_run']);
    // Pedal's resolved feedback drives the pane...
    expect(outcome.feedback?.category).toBe('runtime');
    expect(outcome.feedback?.label).toBe('Division By Zero');
    expect(outcome.grade?.success).toBe(false);
    // ...while the student's raw traceback still reaches the console.
    expect(outcome.error).toContain('ZeroDivisionError');
  });

  it('skips grading when disable_feedback is set (engine.js:115)', async () => {
    cannedResults = [RUNTIME_ERROR_RESULT];
    const controller = createEngineRunController();
    const outcome = await controller.run('1/0', handlers(), {
      onRun: 'from pedal import *',
      disableFeedback: true,
    });
    expect(runCalls.map((job) => job.phase)).toEqual(['student.run']);
    // Hand-built fallback feedback with the student-relative line.
    expect(outcome.feedback?.category).toBe('runtime');
    expect(outcome.feedback?.label).toBe('ZeroDivisionError on line 2');
  });

  it('grades clean runs exactly as before', async () => {
    cannedResults = [CLEAN_RESULT, PEDAL_RESULT];
    const controller = createEngineRunController();
    const outcome = await controller.run('x = 1', handlers(), {
      onRun: 'from pedal import *',
    });
    expect(runCalls.map((job) => job.phase)).toEqual(['student.run', 'instructor.on_run']);
    expect(outcome.error).toBeNull();
    expect(outcome.grade).toBeDefined();
  });

  it('reports "no errors" for graderless clean runs', async () => {
    cannedResults = [CLEAN_RESULT];
    const controller = createEngineRunController();
    const outcome = await controller.run('x = 1', handlers(), { onRun: '' });
    expect(runCalls.map((job) => job.phase)).toEqual(['student.run']);
    expect(outcome.feedback?.category).toBe('no errors');
  });
});

describe('workerEntryUrl (BootConfig paths.assets)', () => {
  it('appends worker.entry.js with slash normalization, resolved against the page', async () => {
    const { workerEntryUrl } = await import('./engine-adapter');
    expect(workerEntryUrl('/static/studio/assets').pathname).toBe(
      '/static/studio/assets/worker.entry.js',
    );
    expect(workerEntryUrl('/static/studio/assets/').pathname).toBe(
      '/static/studio/assets/worker.entry.js',
    );
    // Absolute (same-origin) URLs pass through untouched.
    expect(workerEntryUrl('https://example.edu/blockpy/assets').href).toBe(
      'https://example.edu/blockpy/assets/worker.entry.js',
    );
  });
});

describe('job ids, Stop during grading, per-controller pedal state', () => {
  it('grade jobs use the counter (no Date.now collisions) and Stop interrupts them', async () => {
    cannedResults = [CLEAN_RESULT, PEDAL_RESULT];
    holdPhase = 'instructor.on_run';
    const controller = createEngineRunController();
    const running = controller.run('x = 1', handlers(), { onRun: 'from pedal import *' });
    // Let the student run settle and the grading job start (and park).
    await vi.waitFor(() => expect(runCalls).toHaveLength(2));
    expect(runCalls[1]!.id).toBe('harness-grade-2');
    controller.stop!();
    expect(interruptCalls).toEqual(['harness-grade-2']);
    releaseHeld();
    await running;
  });

  it('Stop interrupts an in-flight evaluate', async () => {
    cannedResults = [{ success: true, value: '1' }];
    holdPhase = 'student.eval';
    const controller = createEngineRunController();
    const evaluating = controller.evaluate!('1', handlers());
    await vi.waitFor(() => expect(runCalls).toHaveLength(1));
    controller.stop!();
    expect(interruptCalls).toEqual([runCalls[0]!.id]);
    releaseHeld();
    await evaluating;
  });

  it('pedalReady is per controller: a fresh controller gets the install-length wall clock', async () => {
    cannedResults = [CLEAN_RESULT, PEDAL_RESULT];
    const first = createEngineRunController();
    await first.run('x = 1', handlers(), { onRun: 'from pedal import *' });
    expect(runCalls[1]!.limits?.wallMs).toBe(180_000);
    cannedResults = [CLEAN_RESULT, PEDAL_RESULT];
    await first.run('x = 1', handlers(), { onRun: 'from pedal import *' });
    expect(runCalls[3]!.limits?.wallMs).toBe(15_000); // wheels installed here

    cannedResults = [CLEAN_RESULT, PEDAL_RESULT];
    const second = createEngineRunController(); // its own worker: no wheels yet
    await second.run('x = 1', handlers(), { onRun: 'from pedal import *' });
    expect(runCalls[5]!.limits?.wallMs).toBe(180_000);
  });

  it('dispose() releases the engine client', async () => {
    cannedResults = [CLEAN_RESULT];
    const controller = createEngineRunController();
    await controller.run('x = 1', handlers(), { onRun: '' });
    controller.dispose!();
    expect(disposeCalls).toHaveLength(1);
    controller.dispose!(); // no client: nothing to dispose
    expect(disposeCalls).toHaveLength(1);
  });
});

describe('workerPort', () => {
  it('turns a worker script load failure into an init-error message', () => {
    const fake = {
      postMessage: () => {},
      terminate: () => {},
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: unknown) => void) | null,
    };
    const port = workerPort(fake as unknown as Worker);
    const received: unknown[] = [];
    port.onMessage((message) => received.push(message));
    fake.onerror!({ message: 'Failed to fetch worker.entry.js' });
    expect(received).toEqual([
      {
        kind: 'init-error',
        error: 'Engine worker failed to load: Failed to fetch worker.entry.js',
      },
    ]);
  });
});
