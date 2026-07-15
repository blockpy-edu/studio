# Appendix A3 - Frozen Quiz JSON Schema, Attempt Rules, and Grading Flags

Status: **frozen** (documents legacy behavior; the React `@blockpy/quizzer` must accept and emit exactly these shapes; see README §11.3).

All paths are relative to the authoritative legacy repo `blockpy-server/` unless noted. Citations use `file:line` against the working copies read on 2026-07-10:

- Frontend (Knockout): `frontend/components/quizzes/{questions.ts, quiz.ts, quizzer.ts, quiz_ui.ts, questions_ui.html, quizzer_question_status.ts, quiz_schema.md}`
- Server grading: `models/data_formats/quizzes.py`, `models/submission.py`, `controllers/pylti/post_grade.py`
- Endpoints: `controllers/endpoints/blockpy.py`
- Read-only grading views: `controllers/jinja_filters.py`

The legacy author-facing prose spec lives at `frontend/components/quizzes/quiz_schema.md` and largely agrees with the code; where they disagree, **the code wins** and the discrepancy is noted.

## 0. Where the three JSON documents live

A quiz assignment (`assignment.type == "quiz"`, `models/submission.py:736`) stores three JSON documents in pre-existing string columns:

| Document                                                        | Storage slot                                                                              | Written via                                                                        | Read by                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Instructions** (authored quiz: settings, pools, questions)    | `assignment.instructions` (the `!instructions.md` "file", `models/assignment.py:355-356`) | `saveFile("!instructions.md", ...)` (`frontend/components/quizzes/quizzer.ts:197`) | `Quiz.loadAssignment` (`frontend/components/quizzes/quiz.ts:197`), `process_quiz_str` (`models/submission.py:738-739`) |
| **Checks** (correct answers + feedback strings)                 | `assignment.on_run` (the `!on_run.py` "file", `models/assignment.py:345-346`)             | `saveFile("!on_run.py", ...)` (`quizzer.ts:198`)                                   | `process_quiz_str` (`models/submission.py:738-739`); **blanked for students** (`models/assignment.py:153-160`)         |
| **Submission** (student answers + attempt + feedback + summary) | `submission.code` (the `answer.py` "file", `models/submission.py:519, 524-527`)           | `saveFile("answer.py", ...)` (`quizzer.ts:146, 152`)                               | `Quiz.loadAssignment` (`quiz.ts:193-194`), `regrade_if_quiz` (`models/submission.py:738-750`)                          |

Top-level shape of the instructions document - `QuizInstructions` (`quiz.ts:45-49`): `{ questions?: Record<QuestionId, Question>, settings?: QuizInstructionsSettings, pools?: QuestionPool[] }`. Missing fields are backfilled with defaults by `fillInMissingQuizInstructionFields` (`quiz.ts:98-114`) and `EMPTY_QUIZ_INSTRUCTIONS_STRING` (`quiz.ts:70-81`).

Top-level shape of the checks document (`quiz_schema.md:82-90`, `models/data_formats/quizzes.py:61`): `{ questions: Record<QuestionId, QuestionCheck> }` - question IDs mirror the instructions.

Top-level shape of the submission document - `QuizSubmission` (`quiz.ts:58-62`): `{ studentAnswers?: Record<QuestionId, StudentAnswer>, attempt?: QuizSubmissionAttempt, feedback?: Record<QuestionId, Feedback> }`; defaults via `fillInMissingQuizSubmissionFields` (`quiz.ts:83-96`) and `EMPTY_QUIZ_SUBMISSION_STRING` (`quiz.ts:64-68`). After server grading, the server also injects `summary: { points_possible, score }` (`models/submission.py:744-747`).

## 1. Question types

The discriminator is the `type` string on each question object. The full enum (`frontend/components/quizzes/questions.ts:7-22`):

```
multiple_choice_question, multiple_answers_question, true_false_question,
text_only_question, matching_question, multiple_dropdowns_question,
short_answer_question, fill_in_multiple_blanks_question,
calculated_question, essay_question, file_upload_question, numerical_question
```

Common authored fields on every question - `Question` interface (`questions.ts:117-133`): `body: string` (Markdown, rendered via the `markdowned` binding, `questions_ui.html:30`), `id: string` (the key in the `questions` map, reinjected at load, `quiz.ts:206-207`), `title: string` (declared but not rendered anywhere in the quiz UI), `type: string`, `points: number` (weight within the quiz only, `quiz_schema.md:69`; defaults to 1 when grading, `quizzes.py:78`), plus optional `answers`, `statements`, `retainOrder`. Server-side grading also reads an optional `tags: string[]` on the question, attached to feedback when the answer is wrong (`models/data_formats/quizzes.py:91-93`) - this field is **absent** from the TS interface and from `quiz_schema.md`.

Feedback checks live in the separate checks document keyed by the same question ID (`quizzes.py:72-77`).

### 1.1 `true_false_question`

- **Authored**: `body`, `points` only (no `answers`; `quiz_schema.md:72`). UI renders two fixed radios (`questions_ui.html:34-55`).
- **Student answer**: the string `"true"` or `"false"` (radio `value` attributes, `questions_ui.html:41, 51`; default `ko.observable(answer || "")`, `questions.ts:67-68`).
- **Check fields**: `correct: boolean`, `wrong?: string` (HTML shown when wrong). Grading: `student.lower() == str(check['correct']).lower()`; score is 0 or 1 (`quizzes.py:109-111`; `quiz_schema.md:94-97`).

### 1.2 `multiple_choice_question`

- **Authored**: `answers: string[]` - radio options, rendered as Markdown, **never shuffled** (`questions_ui.html:57-72`; `quiz_schema.md:74`).
- **Student answer**: the selected answer string (`questions_ui.html:61-62`).
- **Check fields**: `correct: string | string[]` (list = any accepted), `feedback?: {[answer: string]: string}` (per-chosen-answer HTML). Score 0/1 (`quizzes.py:120-125`; `quiz_schema.md:104-107`).

### 1.3 `multiple_answers_question`

- **Authored**: `answers: string[]` - checkbox options, rendered as raw HTML (`questions_ui.html:74-88`), never shuffled (`quiz_schema.md:75`).
- **Student answer**: `string[]` of checked answer texts (`ko.observableArray`, `questions.ts:43-44`; `getValue` returns the array, `questions.ts:104-106`).
- **Check fields**: `correct: string[]`; optional `wrong: (string|null)[]` (per-option feedback, index-aligned with `answers`, used only for options answered wrongly, `quizzes.py:131-136`); optional `wrong_any: string` fallback (`quizzes.py:137-138`). Correctness compares the _sets restricted to known answers_ (`quizzes.py:129`); **partial credit** = `(# options where checked-state matches) / len(answers)` (`quizzes.py:131-142`; `quiz_schema.md:109-112`).

### 1.4 `matching_question`

- **Authored**: `statements: string[]` (left column, rendered as Markdown, `questions_ui.html:93-96`), `answers: string[]` (shared dropdown options), `retainOrder?: boolean`. When `retainOrder` is falsy the options are shuffled **with unseeded `Math.random`, in place, on every render** (`questions_ui.html:99`).
- **Student answer**: `(string|undefined)[]`, one entry per statement, in statement order (`questions.ts:45-48, 95-96`).
- **Check fields**: `correct: (string | string[])[]` in statement order (a list entry accepts any of its values, `quizzes.py:102-105`); `feedback?: ({[answer: string]: string} | string)[]` in statement order (`quizzes.py:115-117`; `quiz_schema.md:99-102`). **Partial credit** = `# correct statements / # statements` (`quizzes.py:119`).

### 1.5 `multiple_dropdowns_question`

- **Authored**: `body` containing `[blank_id]` placeholders (escape literal brackets as `[[`/`]]`; `questions.ts:4-5`, `quiz.ts:330-331`), `answers: {[blank_id: string]: string[]}`, `retainOrder?: boolean`. `Quiz.makeBody` replaces each `[blank_id]` with an inline `<select>`; options get a leading empty option and are shuffled with unseeded `Math.random` unless `retainOrder` (`quiz.ts:315-331`). The type-switch UI block is intentionally empty (`questions_ui.html:109-110`).
- **Student answer**: `{[blank_id: string]: string}` (`questions.ts:49-54, 97-103`).
- **Check fields**: `correct: {[blank_id: string]: string}`; `feedback?: {[blank_id: string]: string | {[answer: string]: string}}`; `wrong_any?: string` (`quizzes.py:143-166`; `quiz_schema.md:114-117`). **Partial credit** = `# correct blanks / # blanks in check.correct` (`quizzes.py:166`).

### 1.6 `short_answer_question` and `numerical_question`

Graded identically; numerical renders `<input type="number">`, short answer `<input type="text">` (`questions_ui.html:112-120, 128-136`).

- **Authored**: `body` only.
- **Student answer**: `string` (rate-limited observable, `questions.ts:62-66`; note the numerical answer is still a _string_ in the payload).
- **Check fields** (exactly one of): `correct` or `correct_exact`: `string | string[]` (trimmed exact match via `compare_string_equality`, `common/text.py:6-14`), or `correct_regex: string[]` (`re.match` any, `quizzes.py:167-182`). Feedback: `feedback?: {[exactAnswerOrRegex: string]: string}` and/or `wrong_any?: string` (`quizzes.py:168-179`; `quiz_schema.md:119-133`). Score 0/1. No numeric tolerance exists (`quiz_schema.md:121`).

### 1.7 `fill_in_multiple_blanks_question`

- **Authored**: `body` with `[blank_id]` placeholders converted to inline text inputs (`quiz.ts:332-344`; blank keys extracted by `getBracketed`, `questions.ts:72-77`). Type-switch UI block empty (`questions_ui.html:138-139`).
- **Student answer**: `{[blank_id: string]: string}` (`questions.ts:55-61`).
- **Check fields** (exactly one of): `correct` / `correct_exact`: `{[blank_id]: string | string[]}` or `correct_regex: {[blank_id]: string[]}` (`quizzes.py:185-197`). Feedback: `wrong_any?: string`, plus a (buggy - iterates a dict without `.items()`, `quizzes.py:202`) `feedback` structure of per-blank strings / regex→message dicts / lists thereof (`quizzes.py:200-221`). **Partial credit** = `# correct blanks / # blanks` (`quizzes.py:225`).

### 1.8 `essay_question` and `text_only_question`

- **Authored**: `body` only. Essay renders a `<textarea>` (`questions_ui.html:121-126`); text-only renders nothing (`questions_ui.html:90`).
- **Student answer**: `string` for essay (`questions.ts:63-66`); text-only keeps the default `""` observable (`questions.ts:67-68`).
- **Grading**: always `(1, True, "Correct")` - full points, no check fields (`quizzes.py:226-227`; `quiz_schema.md:143-147`).

### 1.9 `calculated_question` and `file_upload_question` - declared, unsupported

Present only in the enum (`questions.ts:17, 19`). No UI case - they fall into the `$default` branch, "I have no idea what this is!" (`questions_ui.html:141-143`) - and no grading branch, so `check_quiz_question` returns `None` and the server emits `{"message": "Unknown Type: ...", "correct": None, "score": 0, "status": "error"}` (`quizzes.py:81-83, 228`). **Do not implement; preserve pass-through.**

## 2. Pooling and randomization

### 2.1 Pools

`QuestionPool` (`quiz.ts:23-28`): `{ questions: string[] /* question IDs */, amount: number /* how many to show */, name: string, group?: string }`. Pools live in the instructions' top-level `pools` array (`quiz.ts:48`; `quiz_schema.md:44-52`). Each pooled question gets a back-reference for the instructor "Pool: name" badge (`quiz.ts:247-256`; `questions_ui.html:22-24`). The `group` field is **never read** anywhere.

### 2.2 Selection algorithm

`Quiz.hidePools()` (`quiz.ts:271-287`) marks every question visible, then for each pool computes a seed:

- `poolRandomness === "SEED"` → `seed = submission.id` (the seed observable is initialized to the submission ID, `quiz.ts:156`; instructors can override it in a UI field, `quiz_ui.ts:214-224`);
- `"ATTEMPT"` → `seed = submission.id + attemptCount` (`quiz.ts:279-280`);
- `"NONE"` → `seed = 0` (`quiz.ts:281`);
- `"GROUP"` exists in the enum (`quiz.ts:19-21`) but is **unimplemented** - `hidePoolsGroups()` is an empty method (`quiz.ts:289-291`).

`subsetRandomly(questions, amount, seed)` shuffles a copy with a deterministic `sin(seed)`-based PRNG Fisher–Yates and takes the first `amount` (`frontend/utilities/random.ts:1-29`). Non-chosen pool questions get `visible(false)`; instructors viewing not-as-student see all (`questions_ui.html:2`; `quiz_ui.ts:229`).

`hidePools` runs on quiz load (`quizzer.ts:88`) and on each `startQuiz` (`quizzer.ts:189`).

### 2.3 What reproduces after reload

- **Pool membership** is fully reproducible: seed derives from submission ID (constant) and attempt count (persisted in the submission's `attempt.count`), so a reload mid-attempt re-selects the same questions.
- **Choice order is NOT reproducible**: matching-question options (`questions_ui.html:99`) and multiple-dropdowns options (`quiz.ts:324`) are shuffled with plain `Math.random()` on each render. Only `retainOrder: true` gives stable order. Multiple-choice/multiple-answers options are never shuffled.
- The default `poolRandomness` is inconsistent: the empty-instructions template says `SEED` (`quiz.ts:77`) but the backfill for existing instructions without the field says `ATTEMPT` (`quiz.ts:112`); the Quiz object's own initial observable is `SEED` (`quiz.ts:153`) and is overwritten by whatever `loadAssignment` computed (`quiz.ts:233`).

## 3. Attempt lifecycle

### 3.1 States

`QuizMode` (`quiz.ts:8-12`): `READY`, `ATTEMPTING`, `COMPLETED`. Derived, not stored: `attempting() ? ATTEMPTING : attemptCount() > 0 ? COMPLETED : READY` (`quiz.ts:158-161`). All inputs are disabled unless attempting (`isReadOnly`, `quizzer.ts:96-98`; `disable: $component.isReadOnly()` throughout `questions_ui.html`).

### 3.2 Stored attempt record

`QuizSubmissionAttempt` (`quiz.ts:51-56`): `{ attempting?: boolean, count?: number, mulligans?: number }`, defaults `false/0/0` (`quiz.ts:93-95`). `mulligans` = instructor-granted extra attempts, incremented server-side by `Submission.give_quiz_mulligan` (`models/submission.py:757-773`).

### 3.3 Transitions

- **Start** (`startQuiz`, `quizzer.ts:184-193`): `attemptCount += 1`, `attempting = true`, clear all per-question feedback (`quiz.ts:258-262`), re-run `hidePools()`, save the submission JSON. Answers are _not_ cleared (`quizzer.ts:190` is commented out).
- **Autosave while attempting**: every answer change posts the whole submission JSON (`onChange`, `quizzer.ts:143-148`).
- **Submit** (`submit`, `quizzer.ts:207-244`): posts `updateSubmission` with `status: 0, correct: false, score` omitted; the server grades (see §5/§6), returns `feedbacks`, and the client applies them (`quizzer.ts:228`) and sets `attempting(false)` (`quizzer.ts:235`). Server-side, `regrade_if_quiz` independently rewrites `submission.code` with `attempt.attempting = false` plus `feedback` and `summary` blocks (`models/submission.py:741-750`). On `response.correct` the client calls `markCorrect(assignmentId)` to update navigation (`quizzer.ts:236-238`).

### 3.4 Limits

`settings.attemptLimit` (default `-1` = infinite, `quiz.ts:31-32, 108`). Remaining = `attemptLimit + mulligans - attemptCount`; `canAttempt` gates the Start button (`quiz.ts:163-173`; `quiz_ui.ts:50-53, 76-80`). `settings.coolDown` (minutes between attempts, default `-1`) is declared (`quiz.ts:33-34`) but **unimplemented** (`quizzer.ts:13` - "TODO: Attempt cooldowns"). `settings.questionsPerPage` (default `-1` = all on one page) is likewise declared (`quiz.ts:37-38, 111`) but unimplemented (`quizzer.ts:17`).

### 3.5 "Practice" vs "graded"

There is **no explicit practice/graded mode in the quiz schema**. The de-facto knobs are `attemptLimit` (+`feedbackType`) and whether the assignment sits in a graded LTI context (grade push happens in `grade_submission` regardless, `controllers/pylti/post_grade.py:260-283`).

### 3.6 Timer / countdown

Not a quiz-schema feature. Timing is inherited from `AssignmentInterface` for _all_ assignment types: assignment `settings.time_limit` (string, e.g. `"50 min"`) combined with per-student `submission.time_limit` overrides (`"75 min"` or `"1.5x"`) via `parseTimeLimit` (`frontend/components/assignment_interface.ts:20-45`), against `submission.date_started` (`frontend/models/submission.ts:41-43`; set by the `start_assignment` endpoint, `controllers/endpoints/blockpy.py:591-604`). A 5-second interval updates the `.assignment-selector-countdown` span and overlays a "Time is up!" box when expired (`assignment_interface.ts:92-111, 160-256`).

## 4. Feedback flags

### 4.1 `feedbackType`

Enum `IMMEDIATE | NONE | SUMMARY` (`quiz.ts:14-17`); default `IMMEDIATE` (`quiz.ts:75, 110`). Note `quiz_schema.md:32-35` spells them lowercase - the code compares against the uppercase strings (`questions_ui.html:16`; `quizzer_question_status.ts:63`), so uppercase is canonical.

- **IMMEDIATE**: per-question feedback box (message + red/green/dark for error) and per-question score shown after grading (`questions_ui.html:16-21, 146-151`); status squares turn correct/incorrect (`quizzer_question_status.ts:55-78`).
- **NONE / SUMMARY**: students see no per-question feedback or score; instructors (viewing not-as-student) always see it (`questions_ui.html:16, 146`). The bar text differs per mode (`quiz_ui.ts:21-31, 65-75`). SUMMARY has **no real server implementation** - the grader only contains a debug `print("HELLO WORLD")` stub (`quizzes.py:64-66`).

### 4.2 The Feedback record

Frontend `Feedback` (`questions.ts:110-115`): `{ correct: boolean, score: number, message: string, status: string }`. Server producer (`quizzes.py:93`): `{ message: string, correct: bool|null, score: number /* 0..1 fraction for the question */, status: "graded"|"error", tags: string[] }`. Displayed points = `feedback.score * question.points`, rounded to 2 decimals (`questions_ui.html:17`). Feedback records ride along in the submission JSON under `feedback[questionId]` (`quiz.ts:61, 293-312`; server-written copy `models/submission.py:743`).

### 4.3 Hidden answers

Students never receive the checks document: `load_assignment` serves `encode_quiz_json()`, which blanks `on_run`, `on_change`, `on_eval`, `extra_instructor_files`, `extra_starting_files` whenever the viewer can view but not edit (or `force_quiz` is passed) (`controllers/endpoints/blockpy.py:181, 190-195`; `models/assignment.py:153-160`). Caveat: the unauthenticated sync endpoint `load_assignment_give_feedback` returns raw `on_run` for public-course syncing (`blockpy.py:1079-1094`).

### 4.4 Partial credit summary

Per question: multi-part types (matching, multiple answers, multiple dropdowns, fill-in-multiple-blanks) award `parts correct / parts total` (`quizzes.py:119, 142, 166, 225`); single-part types are 0/1; essay/text-only always 1 (`quizzes.py:226-227`). Quiz total: `sum(question_score * question_points) / sum(points)` over questions **that have a student answer** (missing answers are skipped and their points excluded - `quizzes.py:72-79, 98`); `correct` = every checked question fully correct, and `False` if nothing was checked (`quizzes.py:88, 95-96`).

## 5. Persistence endpoints

All calls go through the embedded BlockPy client's `Server` (`window.$MAIN_BLOCKPY_EDITOR.components.server`) which maps names to `/blockpy/<snake_case>` routes.

1. **Load**: `_postBlocking("loadAssignment", {assignment_id, ...createServerData()})` (`quizzer.ts:112-141`) → `/blockpy/load_assignment` (`controllers/endpoints/blockpy.py:172-220`) → `{assignment, submission}` with quiz-sanitized assignment (`models/assignment.py:320-339`).
2. **Autosave answers**: `saveFile("answer.py", quiz.submissionAsJson(), block, cb)` - non-blocking on every change while attempting, blocking on start/submit (`quizzer.ts:143-153`). Payload: `{assignment_id, assignment_group_id, course_id, submission_id, user_id, version, timestamp, timezone, passcode, filename: "answer.py", code: <QuizSubmission JSON>}` (`frontend/components/assignment_interface.ts:287-341`) → `/blockpy/save_file` (`blockpy.py:223-235`) → `save_student_file` writes `submission.code` because `"answer.py" ∈ Submission.STUDENT_FILENAMES` (`blockpy.py:238-271`; `models/submission.py:519-531`). **Only visible questions are serialized** (`quiz.ts:304-311`) - answers to hidden pool questions are dropped from the saved document.
3. **Grade/submit**: `_postBlocking("updateSubmission", {assignment_id, assignment_group_id, course_id, submission_id, user_id, status: 0, correct: false, timestamp, timezone, passcode})` (`quizzer.ts:207-244`) → `/blockpy/update_submission` (`blockpy.py:531-561`) → `grade_submission(...)` (`post_grade.py:178`) → `submission.regrade_if_quiz()` (`post_grade.py:260-269`; `models/submission.py:735-755`) → `process_quiz_str(assignment.instructions, assignment.on_run, submission.code)` (`quizzes.py:44-99`). Response (`GradingReport.for_ajax`, `post_grade.py:144-156`): `{submitted, changed, correct, message, feedbacks: {questionId: Feedback}, submission_status, grading_status}`; score is pushed to the LMS via LTI inside `grade_submission`.
4. **Instructor edits**: `saveAssignment()` saves `!instructions.md` and `!on_run.py` through the same `saveFile` route (instructor branch: `blockpy.py:274-287`; slot mapping `models/assignment.py:341-362`; `"!instructions.md","!on_run.py" ∈ Assignment.INSTRUCTOR_FILENAMES`, `models/assignment.py:103-105`), then `saveAssignmentSettings({settings, points, url, name})` (`quizzer.ts:195-205`) → `_postBlocking("saveAssignment", ...)` (`assignment_interface.ts:343-391`) → `/blockpy/save_assignment` (`blockpy.py:917-921`). Inline per-question body edits go through `editAssignmentBody` (rewrites one question's `body` inside the instructions JSON, `quiz.ts:176-188`) then `saveAssignment()` (`quizzer.ts:174-182`).
5. **Event logging**: `logEvent(...)` → `_postRetry(data, "logEvent", ...)` (`assignment_interface.ts:258-284`).

## 6. The existing "quiz uses the execution engine" pathway

**There is no client-side execution/preprocessing pathway in the legacy quizzer.** The quizzes components import no engine and contain no preprocessing hook (no matches for "preprocess" anywhere under `frontend/`; `quizzer.ts` posts raw answers). What exists today is a _slot reuse_: the quiz's checks document is stored in `assignment.on_run` - the same column that holds the Python grading script for coding problems (`quizzer.ts:198` saves it as `!on_run.py`; `models/assignment.py:345-346`) - and grading is performed **server-side in plain Python** at `update_submission` time: `regrade_if_quiz` → `process_quiz_str` (`models/submission.py:735-755`; `models/data_formats/quizzes.py:44-99`). No Pyodide/Skulpt/worker is involved. There is also a server-side re-grade path used by grading views/reports (`controllers/jinja_filters.py:105-154` re-checks answers when rendering read-only quiz bodies; `models/data_formats/quiz_analysis.py:565` batch-regrades). Consequence for the rewrite: README §6.5 / §11.3.6's "quiz.preprocess" engine phase is a **new capability**, not a port; the frozen schema below reserves no fields for it, and any new fields must be additive and ignorable by `process_quiz`.

## 7. Open questions

1. **`GROUP` pool randomness** (`quiz.ts:20`) and `QuestionPool.group` (`quiz.ts:27`) are dead - freeze as accepted-but-inert, or drop from the frozen types? (Currently kept, optional.)
2. **Choice-shuffle reproducibility**: legacy shuffles matching/dropdown options with unseeded `Math.random` per render (`questions_ui.html:99`, `quiz.ts:324`) - matching options even re-shuffle (and mutate `answers` in place) on every Knockout re-render. Should the rewrite reproduce this bug or seed the shuffle? README §11.3.2's "attempts reproduce identically after reload" is _not_ legacy behavior for option order.
3. **Answers lost on save**: `submissionAsJson` serializes only visible questions (`quiz.ts:304-311`), so under `ATTEMPT` randomness earlier answers to now-hidden questions are destroyed. Preserve or fix?
4. **`feedback` written from the client**: `submissionAsJson` stores the Knockout observable (`quiz.ts:309`), serialized via ko's `toJSON` unwrap - so client saves persist stale/null feedback records that the server later overwrites. Intentional?
5. **Default `poolRandomness` mismatch**: `SEED` in the empty template vs `ATTEMPT` in the backfill (`quiz.ts:77` vs `quiz.ts:112`). Which default does the rewrite freeze?
6. **`fill_in_multiple_blanks` rich `feedback`** iterates `check['feedback']` without `.items()` (`quizzes.py:202`) - the documented per-blank regex feedback likely raises/never worked. Freeze as `wrong_any`-only (per `quiz_schema.md:141`)?
7. **`title` on Question** (`questions.ts:120`) is never rendered or documented. Keep in the frozen type as optional pass-through?
8. **`summary` block** (`models/submission.py:744-747`) is written into the submission but never read by the frontend. Freeze as server-owned, client-preserved.
9. **`coolDown` / `questionsPerPage`**: declared settings with no implementation (`quiz.ts:33-38`; `quizzer.ts:13,17`). Implement in v1 or freeze as inert?
10. **`SUMMARY` feedback type**: UI strings exist but no summary rendering and no server support (`quizzes.py:64-66`). Scope for v1?
11. **numerical tolerance**: none exists; numbers compare as trimmed strings (`quizzes.py:167-182`). Any need before freezing?
12. **`load_assignment_give_feedback` leaks `on_run`** (checks with correct answers) without auth (`blockpy.py:1079-1094`) - flag to server team; affects "hidden answers" guarantees.
13. **Are lowercase `feedbackType` values present in production data** (per `quiz_schema.md:33-35`)? The code only matches uppercase; a fixture sweep should confirm before freezing the enum.

## 8. Draft frozen TypeScript types

```typescript
// ===== Frozen quiz JSON schema (legacy-compatible) =====
// Sources: frontend/components/quizzes/{questions.ts,quiz.ts},
// models/data_formats/quizzes.py, models/submission.py. See A3 body for citations.

export type QuestionId = string; // key of QuizInstructions.questions
export type BlankId = string; // [blank_id] identifiers inside question bodies

// --- Discriminators (questions.ts:7-22) ---
export type QuizQuestionType =
  | 'multiple_choice_question'
  | 'multiple_answers_question'
  | 'true_false_question'
  | 'text_only_question'
  | 'matching_question'
  | 'multiple_dropdowns_question'
  | 'short_answer_question'
  | 'fill_in_multiple_blanks_question'
  | 'essay_question'
  | 'numerical_question'
  // Declared but unsupported (no UI, grades as status:"error"); pass through untouched:
  | 'calculated_question'
  | 'file_upload_question';

// --- Authored quiz (assignment.instructions) ---
export type QuizFeedbackType = 'IMMEDIATE' | 'NONE' | 'SUMMARY'; // quiz.ts:14-17
export type QuizPoolRandomness = 'ATTEMPT' | 'SEED' | 'NONE' | 'GROUP'; // quiz.ts:19-21; GROUP inert

export interface QuizInstructionsSettings {
  // quiz.ts:30-43 (all optional; defaults quiz.ts:98-114)
  attemptLimit?: number; // -1 = infinite (default)
  coolDown?: number; // minutes; -1 = none (default); UNIMPLEMENTED
  feedbackType?: QuizFeedbackType; // default "IMMEDIATE"
  questionsPerPage?: number; // -1 = all (default); UNIMPLEMENTED
  poolRandomness?: QuizPoolRandomness; // default: SEED (empty template) / ATTEMPT (backfill)
  readingId?: number | string | null; // reading preamble: BlockPy id or assignment url slug
}

export interface QuestionPool {
  // quiz.ts:23-28
  name: string;
  amount: number; // how many of `questions` to show per attempt
  questions: QuestionId[];
  group?: string; // never read; preserved
}

export interface QuestionBase {
  // questions.ts:117-127 + quizzes.py:92
  type: QuizQuestionType;
  body: string; // Markdown/HTML; may contain [blank_id] placeholders
  points: number; // weight within the quiz (grader defaults missing to 1)
  title?: string; // declared, unused
  tags?: string[]; // attached to feedback when wrong (server-side only)
  id?: QuestionId; // implied by map key; reinjected at load (quiz.ts:206-207)
}

export interface TrueFalseQuestion extends QuestionBase {
  type: 'true_false_question';
}
export interface MultipleChoiceQuestion extends QuestionBase {
  type: 'multiple_choice_question';
  answers: string[]; // radio options; never shuffled
}
export interface MultipleAnswersQuestion extends QuestionBase {
  type: 'multiple_answers_question';
  answers: string[]; // checkbox options (raw HTML); never shuffled
}
export interface MatchingQuestion extends QuestionBase {
  type: 'matching_question';
  statements: string[]; // left column (Markdown)
  answers: string[]; // shared dropdown options
  retainOrder?: boolean; // false => unseeded shuffle per render
}
export interface MultipleDropdownsQuestion extends QuestionBase {
  type: 'multiple_dropdowns_question';
  answers: { [blank: BlankId]: string[] };
  retainOrder?: boolean;
}
export interface ShortAnswerQuestion extends QuestionBase {
  type: 'short_answer_question';
}
export interface NumericalQuestion extends QuestionBase {
  type: 'numerical_question';
}
export interface FillInMultipleBlanksQuestion extends QuestionBase {
  type: 'fill_in_multiple_blanks_question';
}
export interface EssayQuestion extends QuestionBase {
  type: 'essay_question';
}
export interface TextOnlyQuestion extends QuestionBase {
  type: 'text_only_question';
}
export interface UnsupportedQuestion extends QuestionBase {
  type: 'calculated_question' | 'file_upload_question';
  [key: string]: unknown; // must round-trip unmodified
}

export type QuizQuestion =
  | TrueFalseQuestion
  | MultipleChoiceQuestion
  | MultipleAnswersQuestion
  | MatchingQuestion
  | MultipleDropdownsQuestion
  | ShortAnswerQuestion
  | NumericalQuestion
  | FillInMultipleBlanksQuestion
  | EssayQuestion
  | TextOnlyQuestion
  | UnsupportedQuestion;

export interface QuizInstructions {
  // quiz.ts:45-49
  questions?: Record<QuestionId, QuizQuestion>;
  settings?: QuizInstructionsSettings;
  pools?: QuestionPool[];
}

// --- Checks document (assignment.on_run; instructor-only; blanked for students) ---
export interface TrueFalseCheck {
  correct: boolean;
  wrong?: string;
}
export interface MultipleChoiceCheck {
  correct: string | string[];
  feedback?: { [answer: string]: string };
}
export interface MultipleAnswersCheck {
  correct: string[];
  wrong?: Array<string | null>; // index-aligned with question.answers
  wrong_any?: string;
}
export interface MatchingCheck {
  correct: Array<string | string[]>; // statement order
  feedback?: Array<string | { [answer: string]: string }>; // statement order
}
export interface MultipleDropdownsCheck {
  correct: { [blank: BlankId]: string };
  feedback?: { [blank: BlankId]: string | { [answer: string]: string } };
  wrong_any?: string;
}
export interface ShortAnswerCheck {
  // also numerical_question
  correct?: string | string[]; // alias of correct_exact (trimmed exact match)
  correct_exact?: string | string[];
  correct_regex?: string[]; // any re.match wins
  feedback?: { [answerOrRegex: string]: string };
  wrong_any?: string;
}
export interface FillInMultipleBlanksCheck {
  correct?: { [blank: BlankId]: string | string[] };
  correct_exact?: { [blank: BlankId]: string | string[] };
  correct_regex?: { [blank: BlankId]: string[] };
  wrong_any?: string;
  // documented rich per-blank feedback is broken server-side (quizzes.py:202); do not rely on it
  feedback?: unknown;
}
export type QuestionCheck =
  | TrueFalseCheck
  | MultipleChoiceCheck
  | MultipleAnswersCheck
  | MatchingCheck
  | MultipleDropdownsCheck
  | ShortAnswerCheck
  | FillInMultipleBlanksCheck
  | Record<string, never>; // essay/text-only: no check

export interface QuizChecks {
  questions: Record<QuestionId, QuestionCheck>;
}

// --- Student answers (submission.code -> studentAnswers) (questions.ts:41-108) ---
export type TrueFalseAnswer = '' | 'true' | 'false';
export type MultipleChoiceAnswer = string; // "" = unanswered
export type MultipleAnswersAnswer = string[];
export type MatchingAnswer = Array<string | undefined | null>; // statement order
export type KeyedTextAnswer = { [blank: BlankId]: string }; // dropdowns + fill-in-blanks
export type TextAnswer = string; // short answer / numerical / essay

export type StudentAnswer =
  | TrueFalseAnswer
  | MultipleChoiceAnswer
  | MultipleAnswersAnswer
  | MatchingAnswer
  | KeyedTextAnswer
  | TextAnswer;

// --- Feedback records (questions.ts:110-115; quizzes.py:82-93) ---
export interface QuizQuestionFeedback {
  message: string; // HTML
  correct: boolean | null; // null when status === "error"
  score: number; // fraction 0..1 of this question's points
  status: 'graded' | 'error';
  tags?: string[]; // question.tags, attached when wrong (server-written)
}

// --- Submission document (submission.code) (quiz.ts:51-68; submission.py:743-750) ---
export interface QuizSubmissionAttempt {
  attempting?: boolean; // default false
  count?: number; // default 0; incremented client-side on Start Quiz
  mulligans?: number; // default 0; instructor-granted extra attempts
}

export interface QuizSubmissionSummary {
  // server-written after grading; client must preserve
  points_possible: number;
  score: number; // fraction 0..1 of the whole quiz
}

export interface QuizSubmission {
  studentAnswers?: Record<QuestionId, StudentAnswer>; // only visible questions serialized
  attempt?: QuizSubmissionAttempt;
  feedback?: Record<QuestionId, QuizQuestionFeedback | null>;
  summary?: QuizSubmissionSummary;
}

// --- update_submission response fragment consumed by the quizzer ---
// (post_grade.py:144-156; quizzer.ts:223-239)
export interface UpdateSubmissionQuizResponse {
  success: boolean;
  submitted: boolean;
  changed: boolean;
  correct: boolean;
  message: string | [reason: string, details: string];
  feedbacks: Record<QuestionId, QuizQuestionFeedback>;
  submission_status: string;
  grading_status: string;
}
```
