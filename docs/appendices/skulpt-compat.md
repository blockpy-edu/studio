# Skulpt → Pyodide/CPython Compatibility Appendix (spec §6.7)

**Status:** Living document — updated whenever an engine delta surfaces.
Audience: instructors maintaining `!on_run.py` graders and curriculum
packages; the Pedal integration layer is the shim point, never the engine
core (spec §6.7).

Engine baseline: Pyodide 314.x = **CPython 3.14** (legacy Skulpt implemented
a ~3.7-subset). First sweep source: running all 213 bakery-course graders
through the Studio Pedal environment (`tools/run-grader-corpus.mjs`,
2026-07-10: 194 clean, 19 fail-soft).

## Pedal / grading deltas

1. **Pedal 3.0.1 syntax-error formatter crashes on Python 3.14** when
   `SyntaxError.text` is `None` (`pedal/utilities/text.py:84 inject_line` →
   `'NoneType' object has no attribute 'split'`; related `len()` variant in
   the same path). Hits any assignment whose starting/student code does not
   parse — 7 of 213 bakery graders. The Studio environment fails soft
   (`system_error` feedback) instead of crashing the run. **Action: upstream
   fix to Pedal.**
2. **`ast.Str` (and friends) removed in Python 3.12** — graders using the
   deprecated `ast` constant node classes crash (1 bakery grader:
   `bakery_sequences_strings_code_double_mutation`). **Action: curriculum
   fix** (`ast.Constant`).
3. **`SyntaxWarning: invalid escape sequence`** now surfaces when compiling
   graders containing `"\ "`-style strings (warning today, error in a future
   CPython). **Action: curriculum sweep for raw strings.**
4. **Pedal `Formatter.html_code` missing** in pedal 3.0.1 (1 grader relies
   on an older/newer formatter API). **Action: verify pedal version pin vs
   the grader's expectation.**

## Modules graders import that the environment must provide

| Module | Seen in | Plan |
| --- | --- | --- |
| `curriculum_ctvt` | 1 bakery grader | Not on PyPI (unlike curriculum-sneks) — bundle the wheel with the deployment (§10.1) |
| `bakery_canvas` | 5 graders (project 3) | Course-specific drawing lib — bundle or install per-course |
| `utility` | 3 graders | Legacy Skulpt-side helper module (`src/lib/utility/`) — needs a Studio port or wheel |
| `drafter` | 1 grader | Drafter integration is §10.3 (deferred from the Phase-1 gate) |
| `_instructor.<name>` | 9 graders | ✅ Implemented: instructor `!`/`?`/`&` `.py` files are exposed as an `_instructor` package (legacy engine-virtual names, A1 §3) |

## Environment behaviors (implemented, verified by tests)

- Instructor files stage prefix-stripped into the working directory
  (`&rainfall.txt` → `rainfall.txt`), matching how student code opens them.
- `^`, `$`, `#` files are never mounted for grading (A1: editor
  metadata / local / wire format).
- Coverage tracing (`ensure_coverage`) requires `start_trace()` before the
  sandbox run — the environment always arms it (Spike S3).
- TIFA feedback (e.g. unused-variable) can outrank `set_success()` in the
  resolver — expected Pedal semantics, worth remembering when writing
  fixtures.

## Open items

- Float `repr`, error-message wording, and `time` behavior deltas: to be
  cataloged when the curriculum regression corpus gains real student
  submissions (§16.1.3).
- `score` semantics: the resolver returns `score=0` alongside
  `success=true` for simple correct runs — verify legacy blockpy's
  `update_submission` score derivation before wiring §14.3 (S3 open item).
