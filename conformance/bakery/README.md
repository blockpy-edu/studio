# Bakery curriculum conformance

Automated walk of the ENTIRE bakery course (`courses/bakery_course.json`, an
untracked blockpy-server export — ask a maintainer). Every assignment is
exercised through the student journey — make a mistake, get feedback, fix
it, submit successfully — and everything that doesn't work completely lands
in a categorized report for investigation.

Two layers share the answer-derivation, course-loading, and report modules
in this directory:

## Layer 1 — Node conformance (`bakery-conformance.test.ts`)

All 409 assignments in ~10 seconds through the PRODUCTION grading paths
(real Pyodide + `JobRunner`/`PedalEnvironment`; quizzes via the quizzer's
`processQuiz` with answers derived from the checks document).

```
BAKERY_CONFORMANCE=1 npx vitest run conformance/bakery
```

Filters: `BAKERY_GROUPS=6b),10a)` (group-name substrings),
`BAKERY_TYPES=blockpy,quiz,reading`.

Per assignment:

- **blockpy** — three grading passes: the starting code (the student's
  first mistake: must produce presentable, non-success feedback without a
  grader crash), a syntax-broken variant (must degrade to feedback, not an
  internal error), and the known-good solution (must grade success).
  Solutions come from the curriculum's own `!correct.py`
  (`extra_instructor_files`, 45 assignments) or from `solutions.json`.
- **quiz** — derives a correct AND a deliberately-wrong submission from the
  checks (`derive-quiz-answers.ts`), grades both: wrong must not be
  correct, correct must score 100%.
- **reading** — settings JSON parses; a body exists.

## Layer 2 — browser UI walk (`e2e/bakery-walk.spec.ts`)

The same journey through the real UI against the dev harness, which serves
every course group when the export is on disk (`?group=full_<url>`, wired
in `packages/app/vite.config.ts` → `registerDemoGroups`).

```
PYODIDE_E2E=1 BAKERY_E2E_GROUPS=1a),6b) npx playwright test bakery-walk
BAKERY_E2E_GROUPS=all   # the whole course (hours; run per-group instead)
```

Per assignment: readings render and mark themselves read (load ⇒ correct);
quizzes Start → wrong answers → Submit → not correct → Try Again → correct
answers → Submit → correct; coding assignments Run the starting code, check
feedback appears, paste the solution, Run, and require the
`update_submission correct=true` echo. Interactive `input()` prompts are
answered live with `42`.

## Output

`bakery-report.{md,json}` (Node layer) and `ui-report.{md,json}` (UI
layer), gitignored. Categories (`report.ts`) are investigation queues —
`grader-crash`, `grader-system-error`, `empty-work-passes`,
`broken-code-mishandled`, `solution-missing`, `solution-rejected`,
`no-feedback`, `quiz-*`, `reading-*`, `ui-flow-failure`.

## Growing the solutions corpus

`solutions.json` maps assignment url → known-good code. Work the report's
`solution-missing` queue: author a solution, add it, re-run the Node layer
— the suite itself validates it (a rejected entry shows the grader's
feedback). Entries that still fail are deliberate probes documenting
assignments that can never grade correct (e.g.
`bakery_intro_eval_code_quick_calc`, whose grader never sets success).
