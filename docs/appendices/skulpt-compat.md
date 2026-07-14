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
- **Legacy-wrapper fidelity pass (2026-07-12).** The environment is now
  built on `pedal.environments.blockpy.setup_environment`, the same call
  legacy's WRAP_INSTRUCTOR_CODE used (on_run.js:38-53): HtmlFormatter,
  source `verify`, tifa-unless-`disable_tifa`, `set_input`,
  `start_trace → run` (or `get_sandbox` under `disable_instructor_run`).
  The instructor namespace is preloaded with `parse_program` + the
  sandbox/core command star-imports (on_run.js:33-36); bakery's
  `student_tests.reset()` runs per pass (on_run.js:30-31 — REQUIRED here
  because site-packages modules are baseline-adopted and survive across
  runs); pool seeding happens AFTER environment setup (LD-22 — the legacy
  before-setup ordering was erased by `report.clear()`, so legacy pools
  were never actually seeded). `final.instructions` / `final.positives`
  (else_message quirk) / `final.systems` (log/debug → dev console) /
  `DATA['location'].line` all extract into the payload. **on_eval** is the
  on_eval.js port: keep the last pass's report + sandbox, clear the
  presented feedback (legacy's "backup" list was never read — effectively
  a clear), pedal-`evaluate` the console expression, exec `!on_eval.py`,
  re-resolve. Client side, feedback messages get the legacy markdown pass
  at PRESENTATION (feedback.js:213 — Pedal sends raw markdown; the
  HtmlFormatter only formats structured pieces) plus the Instructor/
  "explain" and Instructor/"No errors" remaps, compared case-insensitively
  because Pedal 3 emits "No Errors" where Pedal 2 said "No errors".
- **Still absent from the CPython environment (deferred, fail-soft):** the
  Skulpt-side `utility` module (`get_model_info`, `set_instructions`,
  `console_log` as callables INSIDE grader code — the wrapper-level uses
  are ported natively); `instructionsPool` extraction of on_run from pools
  (M2 pools deferral); `GracefulExit`; the instructor full-feedback table
  (feedback.js getAllFeedbacks/updateFullFeedback).

## Student-runtime behaviors (implemented, verified by tests)

- **`requests` is always the mock (§10.4, legacy parity).** Legacy Skulpt
  routed every `requests.get` through `openURL` → the `?mock_urls.blockpy`
  table (`{filename: [url, ...]}`) with no real-network path
  (configurations.js:135-155). Studio installs a per-job `requests` shim in
  `sys.modules` before student code runs, reproducing the exact IOError
  texts ("URL Data was not made available…" / "Cannot access url: …").
  Consequence: student code can NEVER reach the real network via
  `requests`, even though Pyodide could — a deliberate parity/determinism
  choice. The mock `Response` exposes `.text`, `.content`, `.json()`,
  `.status_code`, `.ok`, `.raise_for_status()`.
- **matplotlib is real (Agg), not the Skulpt mock (§10.2).** Figures are
  snapshotted to PNGs after each run and closed; `plt.show()` is a silenced
  no-op — this applies to the STUDENT run job only (see next bullet for
  grading).
- **`assert_plot` graders work with no engine shim (§10.2, resolved
  2026-07-11).** `MockPlt` is Pedal-internal, not Skulpt-side: Pedal's own
  sandbox mocks `matplotlib.pyplot` by default (`Sandbox.
  reset_default_overrides` → `mock_module('matplotlib.pyplot', MockPlt(),
  'plotting')`), and `pedal.extensions.plotting.assert_plot` reads
  `get_sandbox().modules.plotting.plots` — the call log from the GRADER's
  sandboxed re-execution of student code, entirely independent of the
  student-run job's real Agg backend. Verified against the real pedal 3.0.1
  wheel (`runner-pedal.test.ts`, PEDAL_IT=1): correct data → Complete,
  wrong data → `wrong_plt_data` feedback. Side effect: the grading job
  never imports real matplotlib, keeping Pedal runs fast.
- **Pyodide packages auto-load from imports** (`numpy`, `matplotlib`, …)
  and are adopted into the module baseline after first import — module-level
  state in site-packages persists across runs (unlike legacy Skulpt's fully
  fresh state). Stdlib and staged modules still purge per job (§6.2).
- **Student tracebacks carry no harness frames (M7.1, 2026-07-14).**
  `runtime.py` loads via `runPython` (co_filename `"<exec>"`), so a caught
  student error's traceback opened with our own `run`/`evaluate` frame —
  `File "<exec>", line N, in run` — before the student's `answer.py`
  frame. `format_error` now drops leading `<exec>` frames from the chain
  and filters formatted entries for non-leading ones (the trace-limit
  tracer raises from a tail harness frame). Skulpt never had this class of
  frame (legacy built tracebacks frame-by-frame client-side,
  feedback.js:452), so the cleaned output is the parity shape. Verified in
  runner.test.ts across runtime/syntax/eval/trace-limit paths.

## Open items

- Float `repr`, error-message wording, and `time` behavior deltas: to be
  cataloged when the curriculum regression corpus gains real student
  submissions (§16.1.3).
- ~~Pedal plot-inspection shim~~ **RESOLVED (2026-07-11): no shim needed**
  — see "Student-runtime behaviors" above; Pedal's own sandbox `MockPlt`
  provides the call log during grading.
- CORGIS dataset modules (`import weather` style) resolved through legacy
  remote files (`filesToUrls`). The VFS remote-file half landed with the
  uploads layer (2026-07-11): uploaded files fetch into
  `Vfs.setRemoteContents` and stage into runs at the lowest search-order
  priority, so `open()` sees them. Remaining: the CORGIS import flow itself
  (dataset toolbar → download `.py`/`.data` modules) and the
  `preload_files` JSON variant (§10.4).
- ~~`score` semantics (S3 open item)~~ **RESOLVED (2026-07-11), verified
  against both legacy repos — the §14.3 wiring contract:**
  - **Client** (blockpy `on_run.js:154-175`): reads the `SUCCESS`/`SCORE`/
    `HIDE` globals from the executed on_run module (Pedal's Skulpt env
    published the resolver output there). `score = clamp(SCORE, 0, 1)` then
    `max(previousScore, score)` — monotonic, never decreases. `correct` in
    the POST is the RAW `SUCCESS` of THIS run (the monotonic OR is display
    state only). Payload adds `hidden_override`, `force_update: false`, and
    `image` = block-workspace PNG (`getPngFromBlocks`).
  - **Ordering** (§14.3): `presentFeedback` FIRST → `updateSubmission` POST
    → navigation `markCorrect` (`callbacks.success(assignment_id)`) fires in
    the response handler when `!hidden_override && correct` — note the
    legacy quirk that it fires even when the server responded
    `success: false`.
  - **Server** (blockpy-server `post_grade.py:178-`, `submission.py:540,
    555-`): stores `score` as `int(round(100*score))` and `correct` as
    sent; LMS passback `full_score()` for non-reviewed assignments is
    `(float(correct) or score/100) * points` — **`correct` DOMINATES; the
    stored score only matters when correct is false (partial credit) or the
    assignment is reviewed** (`(score + reviews)/100 * points`).
  - **Consequence:** modern Pedal `resolve()` returning `success=true,
    score=0` needs NO client-side fixup — send it as-is and the LMS grade
    is full credit. Studio must replicate the clamp + client-side
    monotonic-max, send raw success as `correct`, and preserve the
    feedback → POST → markCorrect ordering.
