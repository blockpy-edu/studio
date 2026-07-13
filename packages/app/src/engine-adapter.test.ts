/**
 * M3.2: the grading pass chains after EVERY run (legacy engine.js:109-124 —
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
}

const runCalls: FakeJob[] = [];
let cannedResults: unknown[] = [];

vi.mock('@blockpy/engine', () => ({
  EngineClient: class {
    run(job: FakeJob): Promise<unknown> {
      runCalls.push(job);
      return Promise.resolve(cannedResults.shift());
    }
    interrupt(): void {}
  },
}));

import { createEngineRunController } from './engine-adapter';

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
