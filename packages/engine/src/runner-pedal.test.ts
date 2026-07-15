/**
 * JobRunner Pedal-job integration (spec §10.1): the `pedal` request on an
 * `instructor.on_run` job routes through PedalEnvironment inside the same
 * interpreter the runner owns. Installs wheels from PyPI via micropip -
 * gated behind PEDAL_IT=1 like pedal.test.ts:
 *
 *   PEDAL_IT=1 pnpm vitest run packages/engine/src/runner-pedal.test.ts
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { loadPyodide } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import { JobRunner } from './runner';

const enabled = process.env['PEDAL_IT'] === '1';

const ON_RUN = `from pedal import *
if get_output() == ["0"]:
    set_success()
else:
    gently("Try printing the value of a.", label="printing_a")
`;

describe.skipIf(!enabled)('JobRunner pedal jobs (PEDAL_IT=1)', () => {
  let runner: JobRunner;

  beforeAll(async () => {
    const require = createRequire(import.meta.url);
    const pyodide = await loadPyodide({
      indexURL: dirname(require.resolve('pyodide')),
    });
    runner = JobRunner.create(pyodide as never);
  }, 300_000);

  it('grades a correct submission as complete', async () => {
    const result = await runner.execute({
      id: 'pedal-1',
      phase: 'instructor.on_run',
      files: {},
      code: 'a = 0\nprint(a)',
      pedal: { onRun: ON_RUN },
    });
    expect(result.success).toBe(true);
    expect(result.feedback).toBeDefined();
    expect(result.feedback!.success).toBe(true);
    expect(result.feedback!.category.toLowerCase()).toBe('complete');
  }, 300_000);

  it('grades an incorrect submission with the gentle message', async () => {
    const result = await runner.execute({
      id: 'pedal-2',
      phase: 'instructor.on_run',
      files: {},
      code: 'a = 1\nprint(a)',
      pedal: { onRun: ON_RUN },
    });
    expect(result.success).toBe(true);
    expect(result.feedback!.success).toBe(false);
    expect(result.feedback!.message).toContain('Try printing the value');
  }, 60_000);

  // Plot-inspection (§10.2 open item): Pedal's OWN sandbox mocks
  // matplotlib.pyplot with MockPlt by default (sandbox.py
  // reset_default_overrides), so assert_plot reads the call log from the
  // grader's re-execution of student code - independent of the student-run
  // job's real Agg backend. No Studio engine shim required.
  const PLOT_ON_RUN = `from pedal import *
from pedal.extensions.plotting import assert_plot
if not assert_plot('line', [1, 2, 3]):
    set_success()
`;

  it('assert_plot sees plots via the sandbox MockPlt (§10.2)', async () => {
    const result = await runner.execute({
      id: 'pedal-plot-1',
      phase: 'instructor.on_run',
      files: {},
      code: 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.show()',
      pedal: { onRun: PLOT_ON_RUN },
    });
    expect(result.success).toBe(true);
    expect(result.feedback!.success).toBe(true);
    expect(result.feedback!.category.toLowerCase()).toBe('complete');
  }, 300_000);

  it('assert_plot rejects wrong plot data with Pedal feedback (§10.2)', async () => {
    const result = await runner.execute({
      id: 'pedal-plot-2',
      phase: 'instructor.on_run',
      files: {},
      code: 'import matplotlib.pyplot as plt\nplt.plot([4, 5, 6])\nplt.show()',
      pedal: { onRun: PLOT_ON_RUN },
    });
    expect(result.success).toBe(true);
    expect(result.feedback!.success).toBe(false);
    expect(result.feedback!.message).toContain('right data');
  }, 60_000);

  it('reports countTestCases tallies for the Intervention event (§14.4)', async () => {
    const result = await runner.execute({
      id: 'pedal-tallies',
      phase: 'instructor.on_run',
      files: {},
      code: 'a = 0\nprint(a)',
      pedal: {
        onRun: [
          'from pedal import *',
          'from pedal.assertions import assert_equal',
          'assert_equal(1, 1)', // passing specification feedback
          'assert_equal(1, 2)', // failing specification feedback
        ].join('\n'),
      },
    });
    expect(result.success).toBe(true);
    const tallies = result.feedback!.unit_tests!;
    expect(tallies.tests).toBe(2); // both assert_equal are 'specification'
    expect(tallies.successes).toBe(1); // only the passing one
    expect(tallies.feedbacks).toBeGreaterThanOrEqual(2);
    expect(result.feedback!.hide_correctness).toBe(false);
  }, 60_000);

  it('normal student.run jobs still work on the same runner', async () => {
    const result = await runner.execute({
      id: 'pedal-3',
      phase: 'student.run',
      files: {},
      code: 'print(40 + 2)',
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('42');
  }, 60_000);
});
