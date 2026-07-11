/**
 * End-to-end: EngineClient ↔ WorkerHost (loopback) ↔ real Pyodide.
 * Covers streaming, tracing (E3), the traceSteps instruction limit (§6.2),
 * and kernel restart giving a fresh interpreter state.
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { loadPyodide } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineClient } from './client';
import { createLoopbackPort } from './loopback';
import { JobRunner } from './runner';
import type { EngineJob } from './protocol';

let client: EngineClient;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const indexURL = dirname(require.resolve('pyodide'));
  // One Pyodide instance shared across (re)loads — recreating the runner
  // reinstalls the runtime module, which is exactly what restart needs here.
  const pyodide = await loadPyodide({ indexURL });
  client = new EngineClient({
    workerFactory: () => createLoopbackPort(async () => JobRunner.create(pyodide as never)),
  });
}, 60_000);

const job = (overrides: Partial<EngineJob>): EngineJob => ({
  id: `job-${Math.random().toString(36).slice(2)}`,
  phase: 'student.run',
  files: {},
  code: '',
  ...overrides,
});

describe('end-to-end through the worker protocol', () => {
  it('streams stdout chunks live and returns the full result', async () => {
    const chunks: string[] = [];
    const result = await client.run(job({ code: 'print("one")\nprint("two")' }), {
      onStdout: (c) => chunks.push(c),
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('one\ntwo\n');
    expect(chunks.join('')).toBe('one\ntwo\n');
    expect(chunks.length).toBeGreaterThan(1); // actually streamed, not one blob
  });

  it('captures a trace with per-line variable snapshots (E3)', async () => {
    const result = await client.run(
      job({
        answerPrefix: 'scaffold = 0\n',
        code: 'x = 1\ny = x + 1\n',
        trace: true,
      }),
    );
    expect(result.success).toBe(true);
    const lines = result.trace!.filter((s) => s.event === 'line');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    // after `x = 1` executes, the next line event's snapshot contains x
    const afterX = lines.find((s) => s.locals && 'x' in s.locals && !('y' in s.locals));
    expect(afterX?.locals?.['x']).toBe('1');
    // student-relative lines subtract the one-line prefix
    expect(lines.at(-1)!.studentLine).toBe(lines.at(-1)!.line - 1);
    // The final (module return) step snapshots the END state — the trace
    // explorer's last page shows all final variables.
    const last = result.trace!.at(-1)!;
    expect(last.event).toBe('return');
    expect(last.locals?.['x']).toBe('1');
    expect(last.locals?.['y']).toBe('2');
    expect(last.locals?.['scaffold']).toBe('0');
  });

  // Downloads matplotlib+numpy from the Pyodide CDN — opt in with MPL_IT=1.
  it.skipIf(!process.env.MPL_IT)(
    'captures matplotlib figures as base64 PNGs (§10.2)',
    async () => {
      const result = await client.run(
        job({
          code: [
            'import matplotlib.pyplot as plt',
            'plt.plot([1, 2, 3], [4, 5, 6])',
            'plt.show()',
            'print("done")',
          ].join('\n'),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.stdout).toBe('done\n');
      // No Agg "cannot be shown" warning leaked to the student.
      expect(result.stderr).toBe('');
      expect(result.images).toHaveLength(1);
      // PNG magic bytes in base64.
      expect(result.images![0]!.startsWith('iVBOR')).toBe(true);
      // Figures were closed — a following run starts clean.
      const clean = await client.run(job({ code: 'print("next")' }));
      expect(clean.images).toBeUndefined();
    },
    240_000,
  );

  it('enforces the traceSteps instruction limit (execLimit mapping, §6.2)', async () => {
    const result = await client.run(
      job({
        code: 'while True:\n    pass',
        trace: true,
        limits: { traceSteps: 50 },
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('TraceLimitError');
  });

  it('restartKernel yields a fresh interpreter state', async () => {
    await client.run(job({ code: 'kept = 123' }));
    client.restartKernel();
    const result = await client.run(job({ phase: 'student.eval', code: 'kept' }));
    expect(result.error?.type).toBe('NameError');
  });
});
