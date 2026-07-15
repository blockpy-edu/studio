# The in-worker Python runtime, installed into Pyodide once at boot
# (bundled as a string via a Vite `?raw` import - see raw.d.ts). Implements
# per-job isolation (spec 6.2): fresh __main__ module dict per job,
# sys.modules snapshot/restore, FS staging under /mnt/blockpy with artifact
# diff-back (spec 7.5, LD-3x), scripted stdin, student-relative traceback
# line mapping (spec 6.3 - instructor answer_prefix lines are subtracted, as
# legacy Skulpt did), live stdout/stderr tee streaming, and opt-in
# sys.settrace tracing whose step counter doubles as the instruction limit
# (E3, spec 6.2).
import builtins
import contextlib
import io
import json
import os
import sys
import traceback
import types
import warnings

MOUNT = '/mnt/blockpy'
TRACE_STORAGE_CAP = 10000
# Pyodide tunes the recursion limit to the wasm stack at boot; remember it
# so the health canary scales to platforms with shallow stacks (§6.6).
BOOT_RECURSION_LIMIT = sys.getrecursionlimit()

# Plot capture (spec 10.2): headless Agg backend - figures are snapshotted
# into PNGs after each run instead of "shown". Set before matplotlib can be
# imported; silence Agg's "cannot be shown" warning from plt.show().
os.environ.setdefault('MPLBACKEND', 'Agg')
warnings.filterwarnings('ignore', message='.*non-interactive.*cannot be shown.*')


class TraceLimitError(Exception):
    pass


class _Tee(io.StringIO):
    """Accumulates output while forwarding each chunk to a JS callback."""

    def __init__(self, callback):
        super().__init__()
        self.callback = callback

    def write(self, text):
        # JS null arrives as JsNull (not None) - guard on callability.
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
            if name in self.baseline_modules:
                continue
            module = sys.modules[name]
            file = getattr(module, '__file__', '') or ''
            if '/site-packages/' in file:
                # Installed packages (loadPackage/micropip) are expensive to
                # re-initialize (matplotlib takes seconds) and stateless per
                # job in practice - adopt into the baseline. Per-job figure
                # state is reset by capture_figures (plt.close('all')).
                self.baseline_modules.add(name)
                continue
            # Stdlib, student/staged (/mnt/blockpy), and dynamic modules stay
            # per-job (§6.2): purge so the next run reimports fresh state.
            del sys.modules[name]

    # -- mock URLs (spec 10.4, legacy configurations.js openURL) -------------

    def install_requests_mock(self):
        """Install a per-job `requests` shim resolving `?mock_urls.blockpy`.

        Legacy parity: ALL url access goes through the mock table - the map
        is JSON `{filename: [url, ...]}`; a hit returns the staged file's
        contents, no map or an unknown url raises the legacy IOError texts
        (configurations.js:135-155). The module is dynamic (no __file__), so
        restore_modules purges it after every job.
        """
        mock_map = None
        raw = self.staged.get('mock_urls.blockpy')
        if raw is not None:
            try:
                mock_map = json.loads(raw)
            except Exception:  # noqa: BLE001 - bad JSON = no mocks (legacy)
                mock_map = None
        staged = self.staged

        class MockResponse:
            def __init__(self, text):
                self.text = text
                self.content = text.encode('utf-8')
                self.status_code = 200
                self.ok = True

            def json(self):
                return json.loads(self.text)

            def raise_for_status(self):
                return None

        def get(url, *args, **kwargs):
            if mock_map is None:
                raise OSError(
                    'Cannot access url: URL Data was not made available '
                    'for this assignment'
                )
            for filename, urls in mock_map.items():
                if url in urls:
                    contents = staged.get(filename)
                    if contents is None:
                        # Map keys use legacy prefixed names; staging is
                        # prefix-stripped.
                        contents = staged.get(filename.lstrip('!^?&$*#'))
                    if contents is None:
                        raise OSError('File not found: ' + filename)
                    return MockResponse(contents)
            raise OSError(
                'Cannot access url: ' + url +
                ' was not made available for this assignment'
            )

        module = types.ModuleType('requests')
        module.get = get
        module.Response = MockResponse
        sys.modules['requests'] = module

    # -- plot capture (spec 10.2) --------------------------------------------

    def capture_figures(self):
        """Snapshot every open matplotlib figure to base64 PNG, then close.

        Runs only when the student's code actually imported matplotlib.
        Fail-soft: a broken figure never breaks the run result.
        """
        if 'matplotlib' not in sys.modules:
            return []
        try:
            import base64
            import matplotlib.pyplot as plt
            images = []
            for number in plt.get_fignums():
                buffer = io.BytesIO()
                plt.figure(number).savefig(buffer, format='png')
                images.append(base64.b64encode(buffer.getvalue()).decode('ascii'))
            plt.close('all')
            return images
        except Exception:  # noqa: BLE001
            return []

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
                # 'line' fires BEFORE the line executes; 'return' fires as
                # the frame exits, so the module-level return carries the
                # final variable state (the trace explorer's last page).
                if event == 'line' or event == 'return':
                    step['locals'] = snapshot_locals(frame)
                steps.append(step)
            return tracer

        return tracer

    # -- execution ------------------------------------------------------------

    @staticmethod
    def can_suspend():
        """True when JSPI is available, so run_sync can suspend at input()."""
        try:
            from pyodide.ffi import can_run_sync
            return bool(can_run_sync())
        except Exception:  # noqa: BLE001 - non-Pyodide/no-JSPI hosts
            return False

    def run(self, code, filename='answer.py', prefix='', suffix='',
            inputs=None, mode='exec', extract_result=False,
            trace=False, trace_limit=None, on_stdout=None, on_stderr=None,
            allow_real_requests=False, on_input=None):
        full = (prefix or '') + code + (suffix or '')
        prefix_lines = (prefix or '').count('\n')
        # JS null arrives as JsNull (not None) - normalize scalar options.
        if not isinstance(trace_limit, int):
            trace_limit = None

        module = types.ModuleType('__main__')
        module.__dict__['__file__'] = filename

        input_values = iter(inputs or [])
        interactive = callable(on_input) and self.can_suspend()

        def scripted_input(prompt=''):
            # Queued inputs replay first (legacy Edit Queued Inputs); the
            # prompt echoes to stdout exactly as before.
            try:
                value = next(input_values)
            except StopIteration:
                value = None
            if value is not None:
                print(prompt, end='')
                return value
            if interactive:
                # Interactive input (spec §6.5): JSPI suspends this
                # synchronous call while the console shows a textbox. The
                # prompt is NOT echoed to stdout - the console's input line
                # displays (and then freezes with) it, legacy-style.
                from pyodide.ffi import run_sync
                return str(run_sync(on_input(str(prompt))))
            print(prompt, end='')
            raise EOFError('No scripted input available')

        stdout, stderr = _Tee(on_stdout), _Tee(on_stderr)
        steps = []
        old_input = builtins.input
        old_main = sys.modules.get('__main__')
        builtins.input = scripted_input
        sys.modules['__main__'] = module
        # Legacy parity (spec 10.4): requests resolves through the mock-urls
        # table, never the network - unless the allow_real_requests setting
        # is on (M3.5), in which case the REAL requests package (installed
        # host-side with pyodide-http patching) stays importable.
        if not allow_real_requests:
            self.install_requests_mock()
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
            # Snapshot plots BEFORE the module restore unloads matplotlib -
            # figures drawn before an error still surface (spec 10.2).
            images = self.capture_figures()
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
            'images': images,
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

    # -- crash recovery (spec 6.6) ---------------------------------------------

    def stack_canary(self):
        """Probe wasm stack headroom after a job (§6.6 crash recovery).

        A stack-overflow fatal (unbounded recursion through C layers, e.g. a
        recursive __getattr__ - pyodide#5959/#5987) can leave the interpreter
        dead or with a corrupted stack pointer WITHOUT failing the job that
        caused it (grading fail-softs around it). On a healthy interpreter
        this probe returns instantly; on a poisoned one it triggers the
        fatal NOW, JS-side, where the worker host answers by reloading the
        runner - instead of the fatal landing on the student's next Run.
        """
        prev = sys.getrecursionlimit()
        depth = min(500, BOOT_RECURSION_LIMIT // 2)

        def probe(n):
            return probe(n - 1) if n else 0

        try:
            sys.setrecursionlimit(max(prev, depth * 4))
            return probe(depth)
        finally:
            sys.setrecursionlimit(prev)

    # -- error shaping (spec 6.3) ----------------------------------------------

    def format_error(self, exc, filename, prefix_lines):
        line = None
        if isinstance(exc, SyntaxError) and exc.filename == filename:
            line = exc.lineno
        else:
            for frame, lineno in traceback.walk_tb(exc.__traceback__):
                if frame.f_code.co_filename == filename:
                    line = lineno
        # Students must never see the runtime harness frames. This module is
        # loaded via runPython (co_filename "<exec>"), so the caught exception
        # opens with our own run/evaluate frame - drop every leading harness
        # frame before formatting (the student's <module> frame comes right
        # after; a SyntaxError from compile() has ONLY harness frames and
        # formats fine with tb=None from its own attributes).
        tb = exc.__traceback__
        while tb is not None and tb.tb_frame.f_code.co_filename == '<exec>':
            tb = tb.tb_next
        parts = traceback.format_exception(type(exc), exc, tb)
        # Non-leading harness frames (e.g. the trace-limit tracer at the tail)
        # can't be dropped by the walk above - filter their formatted entries.
        formatted = ''.join(
            part for part in parts if not part.startswith('  File "<exec>"')
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
