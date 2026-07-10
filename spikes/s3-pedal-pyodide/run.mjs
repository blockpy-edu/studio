/**
 * Spike S3 — Pedal (+ curriculum-sneks) running natively in Pyodide.
 *
 * Grades a REAL assignment from courses/bakery_course.json ("4A3.1) Convert
 * Pixels" — dataclasses, unit_test, coverage, cisc108-test checks) against
 * a correct and an incorrect student submission, using the manual Pedal
 * pipeline the @blockpy/engine environment will implement:
 *   set_source → sandbox run → tifa → exec(!on_run.py) → resolve()
 *
 * Usage: node spikes/s3-pedal-pyodide/run.mjs
 */
import { loadPyodide } from 'pyodide';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const course = JSON.parse(readFileSync(join(repoRoot, 'courses', 'bakery_course.json'), 'utf8'));
const assignment = course.assignments.find(
  (a) => a.url === 'bakery_structures_dataclass_ops_convert_pixel',
);
if (!assignment) throw new Error('assignment not found');
console.log(`Assignment: ${assignment.name}`);

const CORRECT_STUDENT = `from dataclasses import dataclass
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

const INCORRECT_STUDENT = `print("I have no idea")\n`;

console.log('\nLoading Pyodide ...');
let t0 = performance.now();
const pyodide = await loadPyodide();
console.log(`  Pyodide ${pyodide.version} booted in ${(performance.now() - t0) / 1000}s`);

t0 = performance.now();
await pyodide.loadPackage('micropip');
await pyodide.runPythonAsync(`
import micropip
await micropip.install(['pedal', 'curriculum-sneks', 'bakery'])
import pedal, curriculum_sneks, bakery
from importlib.metadata import version
print('  pedal', version('pedal'), '| curriculum-sneks', version('curriculum-sneks'))
`);
console.log(`  wheels installed in ${(performance.now() - t0) / 1000}s`);

// The manual grading pipeline (what the engine's Pedal environment will do).
pyodide.globals.set('ON_RUN', assignment.on_run);

const GRADE = `
def grade(student_code):
    from pedal.core.report import MAIN_REPORT
    MAIN_REPORT.clear()
    from pedal.source import set_source
    set_source(student_code, report=MAIN_REPORT)
    from pedal.sandbox.commands import run, start_trace
    start_trace(report=MAIN_REPORT)  # coverage tracer, needed by ensure_coverage
    student = run(report=MAIN_REPORT)
    from pedal.tifa import tifa_analysis
    tifa_analysis(report=MAIN_REPORT)
    instructor_globals = {'student_code': student_code, 'student': student}
    exec(compile(ON_RUN, 'on_run.py', 'exec'), instructor_globals)
    from pedal.resolvers.simple import resolve
    final = resolve(report=MAIN_REPORT)
    return {
        'success': final.success,
        'score': final.score,
        'category': final.category,
        'label': final.label,
        'title': final.title,
        'message': final.message[:400],
    }
`;
pyodide.runPython(GRADE);
const grade = pyodide.globals.get('grade');

for (const [name, code] of [
  ['INCORRECT (print only)', INCORRECT_STUDENT],
  ['CORRECT (full solution)', CORRECT_STUDENT],
]) {
  console.log(`\n=== Grading ${name} ===`);
  t0 = performance.now();
  try {
    const result = grade(code).toJs({ dict_converter: Object.fromEntries });
    console.log(`  graded in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
    console.log(`  success=${result.success} score=${result.score}`);
    console.log(`  [${result.category}/${result.label}] ${result.title}`);
    console.log(`  ${String(result.message).split('\n').slice(0, 6).join('\n  ')}`);
  } catch (err) {
    console.log(`  FAILED: ${String(err).split('\n').slice(0, 15).join('\n  ')}`);
  }
}
