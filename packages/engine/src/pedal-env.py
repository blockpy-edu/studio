# The Pedal "blockpy environment" contract for Studio (spec 10.1), validated
# by Spike S3 (docs/spikes/S3-pedal-pyodide.md): Pedal runs natively in
# Pyodide; instructor !on_run.py scripts execute unchanged.
#
# Pipeline (per spike; start_trace BEFORE run is load-bearing for
# ensure_coverage): clear -> stage files -> set_source -> queue inputs ->
# start_trace -> sandbox run -> tifa -> exec(on_run) -> resolve.
#
# File staging implements the legacy engine-virtual names (A1 section 3):
# instructor-owned files (!, ?, & prefixes) are staged prefix-stripped into
# the working directory AND (for .py files) into an _instructor package,
# because real graders do `from _instructor.helpers import ...` (verified
# against the bakery corpus).
import importlib
import json
import os
import shutil
import sys

_INSTRUCTOR_PKG = '_instructor'
_PREFIXES = '!^?&$*#'


def _studio_pedal_stage(files):
    if os.path.isdir(_INSTRUCTOR_PKG):
        shutil.rmtree(_INSTRUCTOR_PKG)
    os.makedirs(_INSTRUCTOR_PKG, exist_ok=True)
    with open(os.path.join(_INSTRUCTOR_PKG, '__init__.py'), 'w') as handle:
        handle.write('')
    for name, contents in files.items():
        prefix = name[0] if name[:1] in _PREFIXES else ''
        base = name[1:] if prefix else name
        if prefix in ('^', '$', '#'):
            continue  # never mounted for grading (A1: editor metadata/wire)
        parent = os.path.dirname(base)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(base, 'w', encoding='utf-8') as handle:
            handle.write(contents)
        if prefix in ('!', '?', '&') and base.endswith('.py'):
            with open(os.path.join(_INSTRUCTOR_PKG, base), 'w', encoding='utf-8') as handle:
                handle.write(contents)
    # fresh imports of _instructor.* each grading pass
    for module_name in list(sys.modules):
        if module_name == _INSTRUCTOR_PKG or module_name.startswith(_INSTRUCTOR_PKG + '.'):
            del sys.modules[module_name]
    importlib.invalidate_caches()


def _studio_pedal_grade(student_code, on_run, files_json, inputs):
    from pedal.core.report import MAIN_REPORT
    from pedal.source import set_source
    from pedal.sandbox.commands import run, start_trace, queue_input
    from pedal.tifa import tifa_analysis
    from pedal.resolvers.simple import resolve

    MAIN_REPORT.clear()
    _studio_pedal_stage(json.loads(files_json) if files_json else {})

    try:
        set_source(student_code, report=MAIN_REPORT)
        for value in (inputs or []):
            queue_input(value, report=MAIN_REPORT)
        # Coverage tracer must be armed BEFORE the student code runs (S3).
        start_trace(report=MAIN_REPORT)
        student = run(report=MAIN_REPORT)
        tifa_analysis(report=MAIN_REPORT)

        instructor_globals = {
            '__name__': '__main__',
            'student_code': student_code,
            'student': student,
        }
        exec(compile(on_run, 'on_run.py', 'exec'), instructor_globals)

        final = resolve(report=MAIN_REPORT)
        # Legacy countTestCases (feedback.js:341-368): tallies over ALL
        # considered feedback objects; category 'specification' = test cases,
        # inactive (condition not met) = success. bool(fb) is Pedal's
        # _met_condition, the same check Skulpt's isTrue performed. Pedal 3
        # files unmet feedback under ignored_feedback (legacy Pedal kept one
        # list), so the legacy iteration covers both.
        tests = feedback_count = successes = feedback_success = 0
        for fb in MAIN_REPORT.feedback + MAIN_REPORT.ignored_feedback:
            active = bool(fb)
            if str(fb.category) == 'specification':
                tests += 1
                if not active:
                    successes += 1
            feedback_count += 1
            if not active:
                feedback_success += 1
        return {
            'unit_tests': {
                'tests': tests,
                'feedbacks': feedback_count,
                'successes': successes,
                'feedbackSuccess': feedback_success,
            },
            'success': bool(final.success),
            'score': final.score,
            'category': str(final.category),
            'label': str(final.label),
            'title': str(final.title),
            'message': str(final.message),
            # Legacy HIDE global (on_run.js:73): suppresses correctness
            # display AND gates markCorrect in the submission POST (14.3).
            'hide_correctness': bool(final.hide_correctness),
        }
    except BaseException:  # noqa: BLE001 - grading must fail soft
        # Grader or Pedal-internal crash (e.g. Pedal 3.0.1's syntax-error
        # formatter breaks on Python 3.14 when SyntaxError.text is None —
        # see docs/appendices/skulpt-compat.md). Surface a renderable
        # system-error feedback instead of killing the run; the client logs
        # it as X-System.Error (legacy pathway).
        import traceback as _tb
        return {
            'success': False,
            'score': 0,
            'category': 'system',
            'label': 'internal_error',
            'title': 'Internal Grading Error',
            'message': 'The grading script failed to run. '
                       'Please report this to your instructor.',
            'system_error': _tb.format_exc(),
        }
