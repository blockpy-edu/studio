/**
 * Pedal environment integration tests (spec §10.1). These install wheels
 * from PyPI via micropip, so they need network access — gated behind
 * PEDAL_IT=1 to keep offline/CI runs green:
 *
 *   PEDAL_IT=1 pnpm vitest run packages/engine/src/pedal.test.ts
 *
 * The correct/incorrect fixtures use the real "Convert Pixels" grader from
 * courses/bakery_course.json (the Spike S3 assignment) so expectations rest
 * on verified curriculum behavior, not guesses about Pedal's API.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { loadPyodide } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import { PedalEnvironment } from './pedal';

const enabled = process.env['PEDAL_IT'] === '1';

const CORRECT_PIXELS = `from dataclasses import dataclass
from bakery import assert_equal

@dataclass
class Pixel:
    red: float
    green: float
    blue: float

def make_pixel(name: str) -> Pixel:
    if name == 'black':
        return Pixel(0.0, 0.0, 0.0)
    elif name == 'yellow':
        return Pixel(1.0, 1.0, 0.0)
    elif name == 'cyan':
        return Pixel(0.0, 1.0, 1.0)
    elif name == 'magenta':
        return Pixel(1.0, 0.0, 1.0)
    else:
        return Pixel(1.0, 1.0, 1.0)

assert_equal(make_pixel('black'), Pixel(0.0, 0.0, 0.0))
assert_equal(make_pixel('yellow'), Pixel(1.0, 1.0, 0.0))
assert_equal(make_pixel('cyan'), Pixel(0.0, 1.0, 1.0))
assert_equal(make_pixel('magenta'), Pixel(1.0, 0.0, 1.0))
assert_equal(make_pixel('white'), Pixel(1.0, 1.0, 1.0))
`;

describe.runIf(enabled)('PedalEnvironment (network: PyPI wheels)', () => {
  let env: PedalEnvironment;
  let pixelsOnRun: string;

  beforeAll(async () => {
    const repoRoot = join(__dirname, '..', '..', '..');
    const course = JSON.parse(
      readFileSync(join(repoRoot, 'courses', 'bakery_course.json'), 'utf8'),
    ) as { assignments: Array<{ url: string; on_run: string }> };
    pixelsOnRun = course.assignments.find(
      (a) => a.url === 'bakery_structures_dataclass_ops_convert_pixel',
    )!.on_run;

    const require = createRequire(import.meta.url);
    const pyodide = await loadPyodide({ indexURL: dirname(require.resolve('pyodide')) });
    env = await PedalEnvironment.install(pyodide as never);
  }, 120_000);

  it('grades an incorrect submission with instructive feedback', () => {
    const feedback = env.grade({ studentCode: 'print("hi")', onRun: pixelsOnRun });
    expect(feedback.success).toBe(false);
    expect(feedback.label).toBe('missing_dataclass'); // verified in Spike S3
    expect(feedback.title.length).toBeGreaterThan(0);
  });

  it('grades the correct submission as complete', () => {
    const feedback = env.grade({ studentCode: CORRECT_PIXELS, onRun: pixelsOnRun });
    expect(feedback.success).toBe(true);
    expect(feedback.category).toBe('complete'); // verified in Spike S3
  });

  it('isolates grading state between calls (MAIN_REPORT.clear)', () => {
    const bad = env.grade({ studentCode: 'x = 1/0', onRun: pixelsOnRun });
    expect(bad.success).toBe(false);
    const good = env.grade({ studentCode: CORRECT_PIXELS, onRun: pixelsOnRun });
    expect(good.success).toBe(true);
  });

  it('feeds scripted inputs through the Pedal sandbox', () => {
    const onRun = `
from pedal import *
assert_output(student, "? Hi Ada")
`;
    const matching = env.grade({
      studentCode: 'name = input("? ")\nprint("Hi", name)',
      onRun,
      inputs: ['Ada'],
    });
    expect(matching.success).toBe(true); // assertion passed, resolver marks complete
    const differing = env.grade({
      studentCode: 'name = input("? ")\nprint("Bye", name)',
      onRun,
      inputs: ['Ada'],
    });
    expect(differing.success).toBe(false);
  });

  it('stages support files readable by graders and student code', () => {
    // Note: the variable must be USED, else TIFA's unused-variable feedback
    // outranks set_success in the resolver — correct grading behavior.
    const feedback = env.grade({
      studentCode: 'data = open("config.txt").read().strip()\nprint(data)',
      onRun: `
from pedal import *
if student.data.get("data") == "expected-value":
    set_success()
`,
      files: { 'config.txt': 'expected-value\n' },
    });
    expect(feedback.success).toBe(true);
  });
});

describe.runIf(!enabled)('PedalEnvironment (skipped)', () => {
  it('is gated behind PEDAL_IT=1 (needs network for PyPI wheels)', () => {
    expect(enabled).toBe(false);
  });
});
