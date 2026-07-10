# Spike S3 — Pedal Running Natively in Pyodide

**Date:** 2026-07-10
**Verdict: GO** — a real curriculum grader runs unmodified; the environment
contract is small and now partially mapped.

**Method:** `spikes/s3-pedal-pyodide/run.mjs` loads Pyodide 314.0.2 (Python
3.14) in Node, installs `pedal` + `curriculum-sneks` + `bakery` from PyPI via
micropip, and grades the real assignment **"4A3.1) Convert Pixels"** from
`courses/bakery_course.json` — its authentic `!on_run.py` uses
`prevent_printing_functions`, `ensure_dataclass`, `ensure_function`,
`ensure_coverage(.9)`, `ensure_cisc108_tests`, `unit_test`, and more — against
an incorrect and a correct student submission, using the manual pipeline the
`@blockpy/engine` Pedal environment will implement:

```
set_source → start_trace → sandbox run → tifa_analysis → exec(on_run) → resolve
```

## Results

- **Wheels:** `pedal 3.0.1`, `curriculum-sneks 1.0.1`, `bakery` install via
  micropip in ~1.1 s (network PyPI; production bundles them as local wheels
  per spec §10.1). All import cleanly on Python 3.14.
- **Grading correctness:** incorrect submission →
  `specification/missing_dataclass` "No dataclass named Pixel was found";
  correct submission → `complete/set_correct_no_errors` "Great work!",
  `success=true`. Exactly the feedback taxonomy the feedback pane renders.
- **Performance:** Pyodide boots in ~1.3 s (Node); each grading pass takes
  **10–20 ms**. TIFA runs without issue.
- **Environment contract discoveries:**
  - `ensure_coverage` requires the **coverage tracer**: the environment must
    call `pedal.sandbox.commands.start_trace(report=...)` *before* running
    student code, else `SandboxBasicTracer has no attribute 'lines'`.
  - `MAIN_REPORT.clear()` between submissions is sufficient isolation at the
    Pedal level for repeated grading in one interpreter (per-job `__main__`/
    `sys.modules` hygiene is still the engine's job, §6.2).
  - `pedal` has no `__version__`; use `importlib.metadata.version`.

## Open items for Milestone 1.5 (Pedal integration)

1. **Score semantics:** the resolver returned `score=0` alongside
   `success=true` — verify how the legacy blockpy environment derives the
   `update_submission` score (success flag vs accumulated partial credit)
   before wiring §14.3.
2. **Python 3.14 vs Skulpt deltas** feed the §6.7 compatibility appendix
   (error messages, float repr, module availability).
3. **Full regression corpus:** `courses/bakery_course.json` contains 213
   pedal graders (119 curriculum-sneks) — batch-run all of them against
   sample submissions as the §16.1.3 engine conformance suite. (The spike
   proves the harness; the corpus is already on disk.)
4. matplotlib-based graders (Pedal plot assertions, §10.2) are untested here
   — needs `loadPackage('matplotlib')` and the figure-inspection shim.
5. Production must pin/bundle wheels (`pedal`, `curriculum-ctvt`,
   `curriculum-sneks`, `bakery`) rather than pulling PyPI at runtime.

## Rerun

```
node spikes/s3-pedal-pyodide/run.mjs
```
