/**
 * Engine runner conformance (§16.1.3 seed) against REAL Pyodide in Node.
 * One shared instance for the whole file (boot ~1.5 s).
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { loadPyodide } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import { JobRunner } from './runner';
import type { EngineJob } from './protocol';

let runner: JobRunner;

beforeAll(async () => {
  // Vitest's module transform breaks pyodide's import.meta.url-relative
  // asset lookup; point indexURL at the real package directory.
  const require = createRequire(import.meta.url);
  const indexURL = dirname(require.resolve('pyodide'));
  const pyodide = await loadPyodide({ indexURL });
  runner = JobRunner.create(pyodide as never);
}, 60_000);

const job = (overrides: Partial<EngineJob>): EngineJob => ({
  id: 'test',
  phase: 'student.run',
  files: {},
  code: '',
  ...overrides,
});

describe('student.run', () => {
  it('captures stdout and succeeds', async () => {
    const result = await runner.execute(job({ code: 'print("Hello,", "world")' }));
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('Hello, world\n');
    expect(result.stderr).toBe('');
  });

  it('reports runtime errors with student-relative lines (§6.3)', async () => {
    const result = await runner.execute(
      job({
        answerPrefix: 'setup = 1\nscaffold = 2\n', // 2 prefix lines
        code: 'x = 1\n1/0\n',
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('ZeroDivisionError');
    expect(result.error?.line).toBe(4); // as executed (prefix + student line 2)
    expect(result.error?.studentLine).toBe(2); // prefix subtracted
  });

  it('reports syntax errors with line info', async () => {
    const result = await runner.execute(job({ code: 'def broken(:\n    pass' }));
    expect(result.error?.type).toBe('SyntaxError');
    expect(result.error?.studentLine).toBe(1);
  });

  it('feeds scripted inputs and raises EOFError when exhausted', async () => {
    const ok = await runner.execute(
      job({ code: 'name = input("Who? ")\nprint("Hi", name)', inputsPrefill: ['Ada'] }),
    );
    expect(ok.stdout).toBe('Who? Hi Ada\n');
    const exhausted = await runner.execute(job({ code: 'input()\ninput()', inputsPrefill: ['x'] }));
    expect(exhausted.error?.type).toBe('EOFError');
  });

  it('isolates namespaces between jobs (§6.2)', async () => {
    await runner.execute(job({ code: 'leaky = 42' }));
    const second = await runner.execute(job({ code: 'print("leaky" in dir())' }));
    expect(second.stdout).toBe('False\n');
  });

  it('restores sys.modules between jobs (§6.2)', async () => {
    await runner.execute(job({ code: 'import fractions' }));
    const second = await runner.execute(
      job({ code: 'import sys\nprint("fractions" in sys.modules)' }),
    );
    expect(second.stdout).toBe('False\n');
  });

  it('stages files readable by student code (§7.5)', async () => {
    const result = await runner.execute(
      job({
        files: { 'data.txt': 'a,b,c' },
        code: 'print(open("data.txt").read())',
      }),
    );
    expect(result.stdout).toBe('a,b,c\n');
  });

  it('diffs run-written files back as artifacts (LD-3x)', async () => {
    const result = await runner.execute(
      job({
        files: { 'data.txt': 'original' },
        code: 'open("out.txt", "w").write("made by run")\nopen("data.txt", "w").write("changed")',
      }),
    );
    expect(result.artifacts).toEqual({ 'out.txt': 'made by run', 'data.txt': 'changed' });
    // staged-but-unmodified files are NOT artifacts
    const clean = await runner.execute(job({ files: { 'keep.txt': 'same' }, code: 'pass' }));
    expect(clean.artifacts).toEqual({});
  });
});

describe('student.eval — persistent REPL (§6.4)', () => {
  it('evaluates against the last run namespace', async () => {
    await runner.execute(job({ code: 'total = 6 * 7' }));
    const result = await runner.execute(job({ phase: 'student.eval', code: 'total + 1' }));
    expect(result.success).toBe(true);
    expect(result.value).toBe('43');
  });

  it('reports eval errors under the legacy "evaluations" filename', async () => {
    const result = await runner.execute(job({ phase: 'student.eval', code: 'undefined_name' }));
    expect(result.error?.type).toBe('NameError');
  });

  it('clearNamespace resets the REPL binding', async () => {
    await runner.execute(job({ code: 'kept = 1' }));
    runner.clearNamespace();
    const result = await runner.execute(job({ phase: 'student.eval', code: 'kept' }));
    expect(result.error?.type).toBe('NameError');
  });
});

describe('quiz.preprocess (§6.5)', () => {
  it('returns the JSON-serialized `result` variable', async () => {
    const result = await runner.execute(
      job({
        phase: 'quiz.preprocess',
        files: { 'raw_answer.txt': ' 42 ' },
        code: 'raw = open("raw_answer.txt").read()\nresult = {"normalized": int(raw.strip())}',
      }),
    );
    expect(result.success).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({ normalized: 42 });
  });

  it('fail-soft: errors surface without a value (§6.5)', async () => {
    const result = await runner.execute(job({ phase: 'quiz.preprocess', code: 'result = 1/0' }));
    expect(result.success).toBe(false);
    expect(result.value).toBeUndefined();
  });
});
