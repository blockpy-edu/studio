/**
 * JobRunner Pedal-job integration (spec §10.1): the `pedal` request on an
 * `instructor.on_run` job routes through PedalEnvironment inside the same
 * interpreter the runner owns. Installs wheels from PyPI via micropip —
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
