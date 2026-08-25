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

import PEDAL_ENV_PY from './pedal-env.py?raw';

let runner: JobRunner;
let pyodide: { runPython(code: string): unknown };

beforeAll(async () => {
  // Vitest's module transform breaks pyodide's import.meta.url-relative
  // asset lookup; point indexURL at the real package directory.
  const require = createRequire(import.meta.url);
  const indexURL = dirname(require.resolve('pyodide'));
  pyodide = (await loadPyodide({ indexURL })) as never;
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

  // M7.12: the executed source is staged as a REAL file under its compile
  // filename - Python 3.13+ recovers traceback source lines via linecache,
  // so synthetic filenames would print line-less tracebacks.
  it('runtime tracebacks carry the offending SOURCE LINE (real-file staging)', async () => {
    const result = await runner.execute(job({ code: 'x = 1\nboom_here = 1 / 0\n' }));
    expect(result.success).toBe(false);
    expect(result.error?.traceback).toContain('boom_here = 1 / 0');
    // The staged write itself is not a run artifact.
    expect(Object.keys(result.artifacts)).not.toContain('answer.py');
    // ...and a SECOND run with different code shows ITS line, not a stale
    // linecache entry for the same filename.
    const second = await runner.execute(job({ code: 'y = 2\nother_bug = [][0]\n' }));
    expect(second.error?.traceback).toContain('other_bug = [][0]');
    expect(second.error?.traceback).not.toContain('boom_here');
  });

  it('student tracebacks never leak the <exec> harness frames (M7.1)', async () => {
    const runtime = await runner.execute(job({ code: 'def f():\n    return 1 / 0\nf()\n' }));
    expect(runtime.error?.traceback).toContain('answer.py');
    expect(runtime.error?.traceback).not.toContain('<exec>');
    const syntax = await runner.execute(job({ code: 'def broken(:\n    pass' }));
    expect(syntax.error?.traceback).not.toContain('<exec>');
    const evalError = await runner.execute(job({ phase: 'student.eval', code: '1 / 0' }));
    expect(evalError.error?.traceback).not.toContain('<exec>');
    // The tracer raises TraceLimitError from a harness frame at the TAIL of
    // the chain - the formatted-parts filter must catch it too.
    const traced = await runner.execute(
      job({
        code: 'for i in range(100000):\n    x = i\n',
        trace: true,
        limits: { traceSteps: 20 },
      }),
    );
    expect(traced.error?.type).toBe('TraceLimitError');
    expect(traced.error?.traceback).not.toContain('<exec>');
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

  it('requests.get resolves through ?mock_urls.blockpy (§10.4)', async () => {
    const result = await runner.execute(
      job({
        files: {
          // stageFiles strips prefixes; map keys keep legacy names.
          'mock_urls.blockpy': JSON.stringify({
            '?report.json': ['https://example.com/report'],
          }),
          'report.json': '{"x": 41}',
        },
        code: [
          'import requests',
          'response = requests.get("https://example.com/report")',
          'print(response.json()["x"] + 1)',
        ].join('\n'),
      }),
    );
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('42\n');
  });

  it('unmocked urls raise the legacy IOError texts (§10.4)', async () => {
    const unknown = await runner.execute(
      job({
        files: { 'mock_urls.blockpy': '{"data.txt": ["https://a.example"]}' },
        code: 'import requests\nrequests.get("https://b.example")',
      }),
    );
    expect(unknown.success).toBe(false);
    expect(unknown.error?.message).toBe(
      'Cannot access url: https://b.example was not made available for this assignment',
    );
    const noTable = await runner.execute(
      job({ code: 'import requests\nrequests.get("https://a.example")' }),
    );
    expect(noTable.success).toBe(false);
    expect(noTable.error?.message).toBe(
      'Cannot access url: URL Data was not made available for this assignment',
    );
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

describe('student.eval - persistent REPL (§6.4)', () => {
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

describe('staging and preprocess hardening', () => {
  it('rejects file names that escape the mount instead of writing them', async () => {
    await expect(
      runner.execute(job({ code: 'pass', files: { '../escape.txt': 'x' } })),
    ).rejects.toThrow(/escapes the working directory/);
    await expect(runner.execute(job({ code: 'pass', files: { '/etc/x': 'x' } }))).rejects.toThrow(
      /escapes the working directory/,
    );
    await expect(runner.execute(job({ code: 'pass', files: { '': 'x' } }))).rejects.toThrow(
      /empty name/,
    );
    // A healthy run still works afterwards (nothing half-staged).
    const ok = await runner.execute(
      job({ code: 'print(open("a/b.txt").read())', files: { 'a/b.txt': 'nested' } }),
    );
    expect(ok.stdout).toBe('nested\n');
  });

  it('reports a non-serializable quiz.preprocess result as a SystemError, not a student error', async () => {
    const result = await runner.execute(
      job({ phase: 'quiz.preprocess', code: 'result = {"f": lambda: 1}' }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('SystemError');
    expect(result.error?.message).toContain('not JSON-serializable');
    const fine = await runner.execute(job({ phase: 'quiz.preprocess', code: 'result = [1, 2]' }));
    expect(fine.value).toBe('[1, 2]');
  });
});

describe('console evaluation keeps the working directory (§6.4)', () => {
  it('does NOT re-stage files for eval phases (fake runtime)', async () => {
    const calls: string[] = [];
    const proxy = (value: unknown) => ({
      toJs: () => value,
      destroy: () => undefined,
    });
    const fakeRuntime = {
      stage_files: () => calls.push('stage_files'),
      collect_artifacts: () => {
        calls.push('collect_artifacts');
        return proxy({});
      },
      run: () => {
        calls.push('run');
        return proxy({ error: null, value: null, stdout: '', stderr: '', trace: null });
      },
      evaluate: () => {
        calls.push('evaluate');
        return proxy({ error: null, value: '1', stdout: '', stderr: '', trace: null });
      },
      clear_namespace: () => undefined,
      stack_canary: () => 0,
    };
    const fakePyodide = {
      runPython: (code: string) => {
        if (code.startsWith('_studio_runtime.stage_files')) fakeRuntime.stage_files();
        return undefined;
      },
      globals: { get: () => fakeRuntime },
    };
    const fake = JobRunner.create(fakePyodide as never);
    await fake.execute(job({ phase: 'student.run', code: 'x = 1', files: { 'a.txt': 'a' } }));
    expect(calls).toEqual(['stage_files', 'run', 'collect_artifacts']);
    calls.length = 0;
    await fake.execute(job({ phase: 'student.eval', code: 'x' }));
    expect(calls).toEqual(['evaluate', 'collect_artifacts']);
    calls.length = 0;
    await fake.execute(job({ phase: 'instructor.on_eval', code: 'x' }));
    expect(calls).toEqual(['evaluate', 'collect_artifacts']);
  });

  it('can open a file the previous run wrote', async () => {
    await runner.execute(job({ code: 'open("out.txt", "w").write("kept")' }));
    const result = await runner.execute(
      job({ phase: 'student.eval', code: 'open("out.txt").read()' }),
    );
    expect(result.success).toBe(true);
    expect(result.value).toBe("'kept'");
  });
});

describe('requests mock does not shadow a real requests package', () => {
  it('restores the pre-job sys.modules["requests"] after a mocked run', async () => {
    // Simulate an installed real `requests` (site-packages __file__, so the
    // module restore adopts it into the baseline exactly like micropip's).
    pyodide.runPython(
      [
        'import sys, types',
        "_real = types.ModuleType('requests')",
        "_real.__file__ = '/lib/python3.13/site-packages/requests/__init__.py'",
        "_real.marker = 'real'",
        "sys.modules['requests'] = _real",
        '_studio_runtime.baseline_modules.add("requests")',
      ].join('\n'),
    );
    try {
      const mocked = await runner.execute(
        job({ code: 'import requests\nprint(getattr(requests, "marker", "mock"))' }),
      );
      expect(mocked.stdout).toBe('mock\n');
      const real = await runner.execute(
        job({
          allowRealRequests: true,
          code: 'import requests\nprint(getattr(requests, "marker", "mock"))',
        }),
      );
      expect(real.stdout).toBe('real\n');
    } finally {
      pyodide.runPython(
        "import sys\nsys.modules.pop('requests', None)\n_studio_runtime.baseline_modules.discard('requests')",
      );
    }
    // Without a real package, the mock is evicted after the job.
    await runner.execute(job({ code: 'import requests' }));
    expect(pyodide.runPython("import sys\n'requests' in sys.modules")).toBe(false);
  });
});

describe('pedal-env staging (plain-Python logic, no pedal import)', () => {
  it('copies every staged .py into _instructor, prefixed or not', async () => {
    pyodide.runPython(PEDAL_ENV_PY);
    const listing = pyodide.runPython(
      [
        'import os, json, tempfile',
        '_d = tempfile.mkdtemp()',
        '_cwd = os.getcwd()',
        'os.chdir(_d)',
        'try:',
        '    _studio_pedal_stage({',
        "        'helpers.py': 'X = 1',",
        "        '!legacy.py': 'Y = 2',",
        "        'sub/deep.py': 'Z = 3',",
        "        'data.txt': 'not python',",
        "        '^starting.py': 'never',",
        '    })',
        '    _found = sorted(',
        "        os.path.relpath(os.path.join(r, f), _d).replace(os.sep, '/')",
        '        for r, _, fs in os.walk(_d) for f in fs',
        '    )',
        'finally:',
        '    os.chdir(_cwd)',
        'json.dumps(_found)',
      ].join('\n'),
    ) as string;
    expect(JSON.parse(listing)).toEqual([
      '_instructor/__init__.py',
      '_instructor/helpers.py',
      '_instructor/legacy.py',
      '_instructor/sub/deep.py',
      'data.txt',
      'helpers.py',
      'legacy.py',
      'sub/deep.py',
    ]);
  });
});
