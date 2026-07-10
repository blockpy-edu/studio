/**
 * The in-worker Python runtime, embedded as a string and installed into
 * Pyodide once at boot. Implements per-job isolation (§6.2): fresh
 * `__main__` module dict per job, `sys.modules` snapshot/restore, FS
 * staging under /mnt/blockpy with artifact diff-back (spec §7.5, LD-3x),
 * scripted stdin, student-relative traceback line mapping (§6.3 —
 * instructor `answer_prefix` lines are subtracted, as legacy Skulpt did),
 * live stdout/stderr tee streaming, and opt-in sys.settrace tracing whose
 * step counter doubles as the instruction limit (E3, §6.2).
 */
export const RUNTIME_PY = `
import builtins
import contextlib
import io
import json
import os
import sys
import traceback
import types

MOUNT = '/mnt/blockpy'
TRACE_STORAGE_CAP = 10000


class TraceLimitError(Exception):
    pass


class _Tee(io.StringIO):
    """Accumulates output while forwarding each chunk to a JS callback."""

    def __init__(self, callback):
        super().__init__()
        self.callback = callback

    def write(self, text):
        # JS null arrives as JsNull (not None) — guard on callability.
        if text and callable(self.callback):
            self.callback(text)
        return super().write(text)


class StudioRuntime:
    def __init__(self):
        self.baseline_modules = set(sys.modules)
        self.last_globals = None
        self.staged = {}

    # -- filesystem staging (spec 7.5) --------------------------------------

    def stage_files(self, files):
        os.makedirs(MOUNT, exist_ok=True)
        for root, dirs, names in os.walk(MOUNT, topdown=False):
            for name in names:
                os.remove(os.path.join(root, name))
            for d in dirs:
                os.rmdir(os.path.join(root, d))
        self.staged = dict(files)
        for name, contents in files.items():
            path = os.path.join(MOUNT, name)
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as handle:
                handle.write(contents)
        os.chdir(MOUNT)

    def collect_artifacts(self):
        artifacts = {}
        for root, _dirs, names in os.walk(MOUNT):
            for name in names:
                path = os.path.join(root, name)
                rel = os.path.relpath(path, MOUNT).replace(os.sep, '/')
                try:
                    with open(path, 'r', encoding='utf-8') as handle:
                        contents = handle.read()
                except (OSError, UnicodeDecodeError):
                    continue
                if self.staged.get(rel) != contents:
                    artifacts[rel] = contents
        return artifacts

    # -- per-job isolation (spec 6.2) ----------------------------------------

    def restore_modules(self):
        for name in list(sys.modules):
            if name not in self.baseline_modules:
                del sys.modules[name]

    # -- tracing (E3): step events + instruction limit ------------------------

    def make_tracer(self, target_filename, prefix_lines, step_limit, steps):
        state = {'count': 0}

        def snapshot_locals(frame):
            snapshot = {}
            for key, value in frame.f_locals.items():
                if key.startswith('__'):
                    continue
                try:
                    snapshot[key] = repr(value)[:120]
                except Exception:  # noqa: BLE001
                    snapshot[key] = '<unrepresentable>'
            return snapshot

        def tracer(frame, event, arg):
            if frame.f_code.co_filename != target_filename:
                return None
            state['count'] += 1
            if step_limit is not None and state['count'] > step_limit:
                raise TraceLimitError(
                    'Execution exceeded the configured limit of '
                    + str(step_limit) + ' steps'
                )
            if len(steps) < TRACE_STORAGE_CAP:
                step = {
                    'event': event,
                    'line': frame.f_lineno,
                    'student_line': frame.f_lineno - prefix_lines,
                }
                if event == 'line':
                    step['locals'] = snapshot_locals(frame)
                steps.append(step)
            return tracer

        return tracer

    # -- execution ------------------------------------------------------------

    def run(self, code, filename='answer.py', prefix='', suffix='',
            inputs=None, mode='exec', extract_result=False,
            trace=False, trace_limit=None, on_stdout=None, on_stderr=None):
        full = (prefix or '') + code + (suffix or '')
        prefix_lines = (prefix or '').count('\\n')
        # JS null arrives as JsNull (not None) — normalize scalar options.
        if not isinstance(trace_limit, int):
            trace_limit = None

        module = types.ModuleType('__main__')
        module.__dict__['__file__'] = filename

        input_values = iter(inputs or [])

        def scripted_input(prompt=''):
            print(prompt, end='')
            try:
                return next(input_values)
            except StopIteration:
                raise EOFError('No scripted input available') from None

        stdout, stderr = _Tee(on_stdout), _Tee(on_stderr)
        steps = []
        old_input = builtins.input
        old_main = sys.modules.get('__main__')
        builtins.input = scripted_input
        sys.modules['__main__'] = module
        error = None
        value = None
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                compiled = compile(full, filename, mode)
                if trace:
                    sys.settrace(
                        self.make_tracer(filename, prefix_lines, trace_limit, steps),
                    )
                try:
                    result = eval(compiled, module.__dict__)
                finally:
                    if trace:
                        sys.settrace(None)
                if mode == 'eval':
                    value = repr(result)
                elif extract_result and 'result' in module.__dict__:
                    value = json.dumps(module.__dict__['result'])
        except BaseException as exc:  # noqa: BLE001 - full error report needed
            error = self.format_error(exc, filename, prefix_lines)
        finally:
            builtins.input = old_input
            if old_main is not None:
                sys.modules['__main__'] = old_main
            self.restore_modules()

        self.last_globals = module.__dict__
        return {
            'error': error,
            'value': value,
            'stdout': stdout.getvalue(),
            'stderr': stderr.getvalue(),
            'trace': steps if trace else None,
        }

    def evaluate(self, expression, on_stdout=None, on_stderr=None):
        """Persistent REPL bound to the last run's namespace (spec 6.4)."""
        target = self.last_globals if self.last_globals is not None else {}
        stdout, stderr = _Tee(on_stdout), _Tee(on_stderr)
        error = None
        value = None
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                compiled = compile(expression, 'evaluations', 'eval')
                value = repr(eval(compiled, target))
        except BaseException as exc:  # noqa: BLE001
            error = self.format_error(exc, 'evaluations', 0)
        finally:
            self.restore_modules()
        return {
            'error': error,
            'value': value,
            'stdout': stdout.getvalue(),
            'stderr': stderr.getvalue(),
            'trace': None,
        }

    def clear_namespace(self):
        self.last_globals = None

    # -- error shaping (spec 6.3) ----------------------------------------------

    def format_error(self, exc, filename, prefix_lines):
        line = None
        if isinstance(exc, SyntaxError) and exc.filename == filename:
            line = exc.lineno
        else:
            for frame, lineno in traceback.walk_tb(exc.__traceback__):
                if frame.f_code.co_filename == filename:
                    line = lineno
        formatted = ''.join(
            traceback.format_exception(type(exc), exc, exc.__traceback__),
        )
        student_line = None if line is None else line - prefix_lines
        return {
            'type': type(exc).__name__,
            'message': str(exc),
            'line': line,
            'student_line': student_line,
            'traceback': formatted,
        }


_studio_runtime = StudioRuntime()
`;
