/**
 * Engine regression harness (§16.1.3 seed): run every Pedal grader in
 * courses/bakery_course.json through the PedalEnvironment against the
 * assignment's starting code. This is a smoke regression — it proves every
 * grader in the curriculum *executes* under Pyodide and returns feedback
 * (correctness verdicts need recorded student submissions; see plan).
 *
 * Usage: node tools/run-grader-corpus.mjs [--limit N]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);

const course = JSON.parse(readFileSync(join(repoRoot, 'courses', 'bakery_course.json'), 'utf8'));
const graders = course.assignments.filter((a) => (a.on_run ?? '').includes('pedal'));
console.log(`${graders.length} pedal graders in the corpus`);

const { loadPyodide } = await import('pyodide');
const pyodide = await loadPyodide({ indexURL: dirname(require.resolve('pyodide')) });

// Import the environment source without a build step.
const pedalSrc = readFileSync(
  join(repoRoot, 'packages', 'engine', 'src', 'pedal-env.py.ts'),
  'utf8',
);
const PEDAL_ENV_PY = pedalSrc.match(/export const PEDAL_ENV_PY = `([\s\S]*)`;/)[1];

console.log('Installing wheels ...');
await pyodide.loadPackage('micropip');
await pyodide.runPythonAsync(
  "import micropip\nawait micropip.install(['pedal', 'curriculum-sneks', 'bakery'])",
);
pyodide.runPython(PEDAL_ENV_PY);
const grade = pyodide.globals.get('_studio_pedal_grade');

const outcomes = { feedback: 0, systemError: 0, crashed: 0 };
const errors = new Map(); // error head -> [assignment urls]
const started = performance.now();

let n = 0;
for (const assignment of graders) {
  if (n++ >= limit) break;
  try {
    // Stage the assignment's instructor extras (?, &, ! files) like the
    // engine does — graders import them via _instructor and open() them.
    const extra = (assignment.extra_instructor_files ?? '').trim();
    const files = extra.startsWith('{') ? extra : '{}';
    const proxy = grade(assignment.starting_code ?? '', assignment.on_run, files, []);
    const feedback = proxy.toJs({ dict_converter: Object.fromEntries });
    proxy.destroy();
    if (feedback.system_error) {
      outcomes.systemError += 1;
      const head = feedback.system_error.split('\n').filter(Boolean).at(-1)?.slice(0, 100);
      if (!errors.has(head)) errors.set(head, []);
      errors.get(head).push(assignment.url);
    } else {
      outcomes.feedback += 1;
    }
  } catch (err) {
    outcomes.crashed += 1;
    const head = String(err).split('\n').filter(Boolean).at(-1)?.slice(0, 100) ?? 'unknown';
    if (!errors.has(head)) errors.set(head, []);
    errors.get(head).push(assignment.url);
  }
}

const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  `\nGraded ${outcomes.feedback + outcomes.systemError + outcomes.crashed} in ${seconds}s`,
);
console.log(`  returned feedback:        ${outcomes.feedback}`);
console.log(`  fail-soft system errors:  ${outcomes.systemError}`);
console.log(`  crashed (env-level):      ${outcomes.crashed}`);
if (errors.size > 0) {
  console.log('\nError signatures:');
  for (const [head, urls] of [...errors.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(urls.length).padStart(3)}x ${head}`);
    console.log(`       e.g. ${urls[0]}`);
  }
}
