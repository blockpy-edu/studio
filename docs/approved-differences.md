# Approved-Differences Ledger

Deliberate behavioral differences between BlockPy Studio and the legacy
client, per spec §16.2: the golden-transcript gate and conformance suites
must match legacy behavior **except** for the entries here. Each entry cites
the decision that authorized it ([DECISIONS.md](DECISIONS.md)) and states the
observable difference precisely so tests can encode it.

Replicate decisions (D4, D6) produce no entries — they are legacy parity.

| ID    | Decision | Area          | Status                 |
| ----- | -------- | ------------- | ---------------------- |
| LD-1  | D1-B     | Quizzer       | pending implementation |
| LD-2a | D2-B     | Event logging | pending implementation |
| LD-2b | D2-B     | Event logging | pending implementation |
| LD-2c | D2-B     | Event logging | pending implementation |
| LD-3  | D3-A     | VFS/editors   | pending implementation |
| LD-3x | D3 note  | VFS/engine    | pending implementation |
| LD-5  | D5-B     | Settings save | pending implementation |
| LD-7  | D7-B     | Quizzer       | conditional            |
| LD-10 | dead code | Editor chrome | implemented (M1.4)     |

---

## LD-1 — Seeded quiz option shuffle (D1-B, Milestone 2.4)

- **Legacy:** matching/multiple-dropdown option order shuffled with unseeded
  `Math.random` on every render; reorders on reload.
- **Studio:** option order seeded with the same submission-id(+attempt) seed
  used for pool membership; stable across reloads within an attempt, still
  reshuffled per attempt.
- **Wire impact:** none (render-time only).

## LD-2a — Paste event records real size (D2-B, Milestone 1.2)

- **Legacy:** `X-Editor.Paste` always logs `{characters: 0}` (shadowed
  constant).
- **Studio:** logs the actual pasted character count. Same event name/fields;
  the research docs must note the field is trustworthy only from Studio
  onward. Deprecation metadata recorded in the event-id registry (see D2
  note: registry supports "untrustworthy before version X / superseded by Y"
  annotations).
- **Wire impact:** field value semantics only.

## LD-2b — Offline event queue no longer self-destructs (D2-B, Milestone 1.2)

- **Legacy:** `_dequeueData` uses one-argument `splice(index)`, wiping the
  queue tail; at most one queued offline event survives.
- **Studio:** queue dequeues single entries; all queued events flush on
  reconnect/boot.
- **Wire impact:** more (correct) `log_event` POSTs after offline periods.

## LD-2c — IP-change detection works on the retry path (D2-B, Milestone 1.2)

- **Legacy:** `_postRetry` passes a string into `checkIP`, so `X-IP.Change`
  never fires from retries.
- **Studio:** `X-IP.Change` fires whenever the reported IP changes, including
  on retried posts.
- **Wire impact:** additional `X-IP.Change` events that legacy would have
  missed.

## LD-3 — `&` files uniformly read-only (D3-A, Milestone 1.1/1.4)

- **Legacy:** read-only enforced in Text/JSON/Quiz/Toolbox editors but NOT in
  the Python and Markdown editors (edits never persisted meaningfully).
- **Studio:** the VFS permission matrix makes assignment-owned read-only
  files immutable to students in every editor.
- **Wire impact:** none (legacy edits didn't persist).

## LD-3x — Run artifacts persist to the submission (D3 note; additive §17 extension)

- **Legacy:** files created/modified by student programs are silently
  discarded (the `filewrite` hook is an unimplemented stub — A1/A7).
- **Studio:** run-written files diff into the transient layer, surface in the
  UI as artifacts, and **persist to the backend as part of the student's
  submission** (mechanism: the existing extra-files persistence path;
  finalize endpoint mapping in Milestone 1.1 — candidate: the
  `#extra_student_files.blockpy` bundle autosave).
- **Wire impact:** additional `save_file` traffic legacy never produced.
  Ships flagged, per §17's additive-extension rule.

## LD-5 — Settings save round-trips unknown keys (D5-B, Milestone 1.1/1.4)

- **Legacy:** `saveAssignmentSettings` serializes only registered keys,
  destroying server-only keys (`time_limit`, `protected_ip_ranges`,
  `poolRandomness`, …) on any instructor settings save.
- **Studio:** parse → edit known keys → merge over the original blob; unknown
  keys survive byte-for-byte.
- **Wire impact:** saved settings blobs may contain keys the legacy client
  would have dropped — strictly closer to what the server already stores.

## LD-7 — Hidden pool answers preserved (D7-B, Milestone 2.4) — CONDITIONAL

- **Legacy:** quiz saves serialize only visible questions' answers; answers
  to pool-hidden questions are dropped from the stored answer JSON.
- **Studio:** new answers merge over the previously stored answer map, so
  hidden-question answers survive.
- **Condition:** confirm with the Milestone 2.4 fixtures that the server's
  `process_quiz` tolerates extra answer keys (expected per A3). If not,
  revert to legacy behavior and mark this entry rejected.
- **Wire impact:** same JSON shape with more keys.

## LD-8 — Multi-dim all-index subscripts round-trip losslessly (Milestone 1.4)

- **Legacy:** Skulpt parses `df[1, 2, 3, 4]` as `Index(Tuple)` (CPython ≤3.8
  shape); BlockMirror's tuple block always parenthesizes, so blocks→text
  re-rendered it as `df[(1, 2, 3, 4)]`. BlockMirror's own round-trip corpus
  (simple.html #42) asserts the unparenthesized form — the legacy suite used
  a silent `console.assert` + `break`, which masked the failure.
- **Studio:** the CST→IR converter emits `ExtSlice([Index, …])` for every
  multi-dim subscript, so `df[1, 2, 3, 4]` survives text→blocks→text
  byte-exact. Semantically identical Python is generated.
- **Wire impact:** none (client-side rendering only). §16.1.2 conformance:
  corpus #42 passes as written.

## LD-9 — Bare hidden imports still vanish (legacy parity, Milestone 1.4)

- **Not a difference — recorded to explain a corpus deviation.** `plt` is in
  `hiddenImports`: text→blocks suppresses the `import matplotlib.pyplot as
  plt` block (legacy UX hides plotting boilerplate; the generator re-emits
  the import whenever a `plt.*` call block exists). A bare, *unused* plt
  import therefore does not survive the round trip — in legacy or Studio.
  Corpus #73 asserts otherwise and cannot pass in legacy either (same silent
  console.assert masking); Studio pins the legacy behavior as a documented
  known-delta in the §16.1.2 suite.

## LD-10 — Instructions/feedback code highlighting actually renders (Milestone 1.4)

- **Legacy:** `interface.js:38-47` (instructions, 400 ms debounce) and
  `feedback.js:218-220` (feedback message) call
  `window.hljs.highlightBlock(...)` over `pre code` blocks — but no editor
  page template ever loads highlight.js, so `window.hljs` is undefined and
  the calls throw silently. The intended highlighting never renders on the
  editor page (only on server report pages that load hljs themselves).
- **Studio:** bundles `highlight.js` (common languages) and runs the same
  hooks — instructions highlighted 400 ms after render, feedback on present
  — with the stock hljs default theme scoped under `.blockpy-content`
  (`chrome/highlight.ts`; styles appended to `styles/blockpy.css`).
- **Wire impact:** none (client-side rendering only). Visual delta: code
  fences in instructions/feedback gain the gray background + token colors
  legacy authors intended but never saw.

## LD-11 — `version_change` out-of-date banner made real (Milestone 1.6)

- **Legacy:** the `save_file` endpoint computes and returns
  `version_change: submission.assignment.version != submission.assignment_version`
  (blockpy-server blockpy.py:259-271), but the legacy client never reads the
  flag — no call site anywhere in blockpy/src. Students editing a stale
  assignment version got no notice.
- **Studio:** the spec (§7.4) requires the UI to surface stale-version
  warnings as the "your code is out of date / reload" banner, so the
  submission sync checks `version_change` on every successful `saveFile`
  response and raises a dismissible `.blockpy-version-outdated` alert. The
  banner resets on assignment load.
- **Wire impact:** none (the flag was already on every save response;
  Studio just stops discarding it).

## LD-12 — Exam countdown active for BlockPy assignments too (Milestone 2.2)

- **Legacy:** the countdown/expiry checker lives in the server frontend's
  `AssignmentInterface` (assignment_interface.ts:88-115, 160-256), so it only
  runs while a reader/quiz/kettle/explain component is mounted. A *blockpy*
  assignment whose settings carry `time_limit` never shows a countdown or
  the "Time is up!" overlay — the editor page has no checker of its own
  (editor.html only runs the 10 s time-spent clock).
- **Studio:** README §9.4 assigns countdown ownership to the navigation
  store ("the rewrite owns it via the same store"), and the app feeds the
  loaded pair's `time_limit`/`date_started` into the checker for **every**
  assignment type. Format, tick rate (5 s), per-student overrides, overlay
  text, freeze-after-expiry, instructor exemption, and the
  `timer_expired`/`timer_cleared`/`timer_error` events are ports of the
  legacy checker; the only delta is that time-limited *coding* assignments
  are now covered instead of silently untimed.
- **Wire impact:** timed blockpy assignments now emit the `timer_*` events
  the reader/quiz paths already emitted; no new payload shapes.
