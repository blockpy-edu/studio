# The Pedal "blockpy environment" contract for Studio (spec 10.1) - a
# faithful port of the legacy instructor wrappers:
#   blockpy/src/engine/on_run.js   WRAP_INSTRUCTOR_CODE  (grading pass)
#   blockpy/src/engine/on_eval.js  WRAP_INSTRUCTOR_CODE  (console-eval pass)
# built on pedal.environments.blockpy.setup_environment, exactly like legacy:
# the environment supplies the HtmlFormatter, source verify, tifa (unless
# skipped), set_input, and the load-bearing start_trace -> run ordering
# (Spike S3) in one call.
#
# Ported wrapper behaviors: bakery student_tests.reset() per pass, the
# preloaded instructor namespace (parse_program + sandbox/core commands),
# skip_run (disable_instructor_run) / skip_tifa (disable_tifa) settings,
# pool-question seeding by submission id (LD-22 fixes the legacy
# order-of-operations bug that erased the seed), final.instructions /
# final.positives (with the else_message quirk) / final.systems extraction,
# and the on_eval pipeline: keep the last run's report + sandbox, clear the
# presented feedback, pedal `evaluate` the console expression, exec on_eval,
# re-resolve.
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


# The names legacy preloaded into the instructor script's namespace
# (on_run.js:33-36 / on_eval.js:15-18) - graders may use parse_program and
# the sandbox/core commands without importing them.
_INSTRUCTOR_PRELUDE = (
    'from pedal.cait.cait_api import parse_program\n'
    'from pedal.sandbox.commands import *\n'
    'from pedal.core.commands import *\n'
)


def _studio_instructor_globals(student, student_code):
    from pedal.core.report import MAIN_REPORT
    namespace = {
        '__name__': '__main__',
        'student': student,
        'student_code': student_code,
        'MAIN_REPORT': MAIN_REPORT,
    }
    exec(compile(_INSTRUCTOR_PRELUDE, '<pedal prelude>', 'exec'), namespace)
    return namespace


def _studio_pedal_resolve():
    from pedal.core.report import MAIN_REPORT
    from pedal.resolvers.simple import resolve

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

    # Questions (on_run.js:74-76): the LAST instructions feedback replaces
    # the instructions pane (legacy set_instructions).
    instructions = None
    if final.instructions:
        instructions = str(final.instructions[-1].message)

    # Positive feedback (on_run.js:78-88), quirk preserved: an INACTIVE
    # positive presents its else_message.
    positives = []
    for positive in final.positives:
        message = positive.message
        if not positive:
            message = positive.else_message
        positives.append({
            'title': str(positive.title),
            'label': str(positive.label),
            'message': str(message),
        })

    # System messages (on_run.js:90-95): log/debug go to the dev console
    # (legacy console_log / console_debug).
    systems = []
    for system in final.systems:
        if str(system.label) in ('log', 'debug'):
            systems.append({
                'label': str(system.label),
                'title': str(system.title),
                'message': str(system.message),
            })

    # First error line (feedback.js:155-165 findFirstErrorLine reads
    # DATA['location'].line) - drives the editor-error-line highlight.
    line = None
    try:
        data = final.data
        location = data.get('location') if isinstance(data, dict) else None
        if location is not None:
            line = getattr(location, 'line', None)
    except Exception:  # noqa: BLE001 - highlight is best-effort
        line = None

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
        'instructions': instructions,
        'positives': positives,
        'systems': systems,
        'line': line,
    }


def _studio_fail_soft():
    # Grader or Pedal-internal crash (e.g. Pedal 3.0.1's syntax-error
    # formatter breaks on Python 3.14 when SyntaxError.text is None -
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


def _studio_pedal_grade(student_code, on_run, files_json, inputs, options_json):
    from pedal.core.report import MAIN_REPORT

    MAIN_REPORT.clear()
    options = json.loads(options_json) if options_json else {}
    _studio_pedal_stage(json.loads(files_json) if files_json else {})

    try:
        # bakery's module-level student_tests ledger lives in site-packages
        # and survives across runs - legacy reset it every grading pass
        # (on_run.js:30-31). Optional: bakery may not be installed.
        try:
            from bakery import student_tests
            student_tests.reset()
        except Exception:  # noqa: BLE001
            pass

        skip_run = bool(options.get('skip_run'))
        skip_tifa = bool(options.get('skip_tifa'))
        # Legacy: no inputs at all when the student run is skipped
        # (on_run.js:40-41).
        run_inputs = None if skip_run else list(inputs or [])

        # The submission carries the STUDENT-visible files: answer.py +
        # chomped ?/& instructor extras + student extras (legacy
        # getAllStudentFiles, instructor.js:69-83). The instructor staging
        # view lives on DISK (open() + _instructor imports), not here.
        student_files = dict(options.get('student_files') or {})
        student_files['answer.py'] = student_code

        # setup_environment = BlockPyEnvironment: HtmlFormatter + verify +
        # (unless skipped) tifa + set_input + start_trace -> run, exactly
        # the legacy pipeline (on_run.js:38-53).
        from pedal.environments.blockpy import setup_environment
        env = setup_environment(
            files=student_files,
            main_file='answer.py',
            main_code=student_code,
            skip_tifa=skip_tifa,
            skip_run=skip_run,
            inputs=run_inputs,
            report=MAIN_REPORT,
        )

        # Pool-question seed = submission id (on_run.js:43-45). LEGACY BUG
        # FIXED (ledger LD-22): legacy called set_seed BEFORE
        # setup_environment, whose report.clear() erased the stored seed
        # (report['questions']['seed']) - pools were never actually seeded.
        # Seeding AFTER setup makes it stick.
        seed = options.get('seed')
        if seed is not None and seed != '':
            try:
                from pedal.questions import set_seed
                set_seed(str(seed))
            except Exception:  # noqa: BLE001
                pass

        student = env.fields['student']
        exec(compile(on_run, 'on_run.py', 'exec'),
             _studio_instructor_globals(student, student_code))
        return _studio_pedal_resolve()
    except BaseException:  # noqa: BLE001 - grading must fail soft
        return _studio_fail_soft()


def _studio_pedal_evaluate(evaluation, on_eval, options_json):
    # Console-evaluation grading (on_eval.js): KEEP the last grading pass's
    # report and sandbox; clear the presented feedback (legacy "backed up"
    # MAIN_REPORT.feedback into a local it never read again - the effective
    # behavior is a plain clear, on_eval.js:20-24); pedal-`evaluate` the
    # console expression inside the student's sandbox; exec the instructor's
    # on_eval script; re-resolve.
    from pedal.core.report import MAIN_REPORT

    del options_json  # reserved (parity with _studio_pedal_grade)
    try:
        MAIN_REPORT.feedback.clear()
        from pedal.sandbox.commands import evaluate, get_sandbox
        student = get_sandbox(report=MAIN_REPORT)
        evaluate(evaluation, report=MAIN_REPORT)
        exec(compile(on_eval, 'on_eval.py', 'exec'),
             _studio_instructor_globals(student, evaluation))
        return _studio_pedal_resolve()
    except BaseException:  # noqa: BLE001 - grading must fail soft
        return _studio_fail_soft()
