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

## LD-7 — Hidden pool answers preserved (D7-B, Milestone 2.4) — RESOLVED

- **Legacy:** quiz saves serialize only visible questions' answers; answers
  to pool-hidden questions are dropped from the stored answer JSON
  (quiz.ts:304-311).
- **Condition check (2026-07-11):** the original plan (merge extra keys into
  `studentAnswers`) FAILS — `process_quiz` grades every answered question
  and counts its points toward the total (quizzes.py:72-79), so extra keys
  would change scores.
- **Studio (revised):** hidden answers persist under a NEW additive
  top-level key `hiddenAnswers` in the submission document. `process_quiz`
  reads only `studentAnswers` (quizzes.py:60) and `regrade_if_quiz`
  round-trips unknown top-level keys (submission.py:743-750), so grading is
  untouched. When a pooled question becomes visible again, its stashed
  answer moves back into `studentAnswers`.
- **Wire impact:** one additive, server-ignored key in `submission.code`;
  grading payloads and scores identical to legacy.

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

## LD-13 — Reading content rendered with `marked`, not markdown-it (Milestone 2.3)

- **Legacy:** two markdown pipelines (A6): the client instructions pane uses
  EasyMDE's bundled `marked` (breaks forced ON, `target="_blank"` injection),
  while reader/quiz/explain content uses `markdown-it` (`html: true`, breaks
  off, in-render hljs `highlight` callback, the `replace-link` download_file
  rewrite, the runnable-fence part-id scheme).
- **Studio:** one library (`marked`) for both, with the reader pipeline
  (`reader/markdown.ts`) configured to replicate markdown-it's observable
  behaviors: `breaks: false`, no `target="_blank"` injection, no
  sanitization (D4-A), the exact fence scheme (python+part-id → runnable
  structure, ts/r → kettle structure, known langs → hljs pre, unknown →
  escaped `pre.hljs`), and the verbatim `startsWith("http")` link/image
  rewrite predicate.
- **Known deltas** (A6 open question 3): marked's GFM autolinking turns bare
  URLs into links where markdown-it (`linkify: false`) leaves them as text;
  header-id generation and rare typographic details may differ between the
  libraries. No course content is known to depend on either.
- **Wire impact:** none (client-side rendering only).

## LD-14 — LTI put_data handshake posts the GENERATED UUIDs (Milestone 2.5)

- **Legacy:** the cookie-blocked fallback (editor.html:27-99) generates
  `messageId` and `stateId` UUIDs but then posts the LITERAL placeholder
  strings — `key: "blockpy_<state_id>", value: "<state_id>"` and
  `key: "nonce_<nonce_value>", value: "<nonce_value>"` (editor.html:85-98).
  The interpolation was never written; the platform stores the placeholder
  text. Additionally, with `platformOrigin = '*'` the response listener's
  origin check (`event.origin !== platformOrigin`) can never pass, so the
  `lti.put_data.response` confirmation is unreachable.
- **Studio:** `@blockpy/lti-embed`'s `installCookieFallback` substitutes the
  generated UUIDs (`blockpy_${stateId}`/`stateId`, `nonce_${nonce}`/`nonce`)
  per spec §13's "with generated UUIDs". The `'*'` origin caveat is kept
  verbatim behind the `PLATFORM_ORIGIN` constant — including the
  consequently-unreachable success path — so it can be corrected when
  platforms comply, exactly as §13 directs.
- **Wire impact:** the two postMessages now carry usable values; message
  count, shape, and origin are unchanged.

## LD-15 — Textbook assignment type rendered per textbook.html, not the ko stub (Milestone 2.5)

- **Legacy:** TWO textbook surfaces exist. The standalone route
  (`/assignments/textbook/<url>`, templates/blockpy/textbook.html) WORKS:
  server-rendered chapter sidebar (the recursive `textbook_item` macro) +
  a `<reader asPreamble: true>` bound to the open page, `?page=` history
  contract, no-op markCorrect. The `<textbook>` knockout COMPONENT used by
  editor.html's assignment-type dispatch is UNFINISHED: its content
  renderer is commented out (textbook.ts:251-266 renders a JSON dump), the
  template begins with the literal word "Testing", editor.html passes it no
  `textbook` param, and `foreach: textbook.content` on the resulting
  undefined crashes the binding. A textbook inside an assignment group is
  effectively broken in legacy.
- **Studio:** per README §11.4 (decided at M2.5 kickoff), `@blockpy/textbook`
  is a thin composition over `reader` replicating the WORKING standalone
  page's observables — sidebar macro classes/indentation, first-reading
  default page, `?page=` pushState/popstate/title contract, no-op
  markCorrect (readings still post their own markRead), the legacy
  "Missing Reading" fallback — and serves BOTH the group-embedded type slot
  and (later) standalone pages. The legacy RAW instructor editor
  (instructions + settings textareas) is ported; the FORM mode
  (jsoneditor/filepond) is deferred.
- **Wire impact:** none new — loads ride `load_assignment`, page opens are
  full `Reader` loads, edits ride `save_file`/`save_assignment`.

## LD-16 — Textbook references rehydrate client-side only via an OPTIONAL resolver (Milestone 2.5; server-team flag)

- **Legacy:** the v1 textbook document stores `reading`/`group` as URL
  strings; only the SERVER's dedicated textbook route rehydrates them to
  `{id, name, url, missing}` (models/data_formats/textbook.py:83-130)
  before rendering. `load_assignment` returns the raw url-string document
  and there is NO by-url JSON endpoint a client could use.
- **Studio:** `parseTextbookDocument` accepts both shapes (raw strings and
  rehydrated objects, round-tripping unknown fields per §14.5); the
  `Textbook` component takes an optional `resolveAssignment(url)` and
  renders unresolvable references in the legacy MISSING_READING style. On
  an unmodified server the group-embedded textbook therefore shows its
  structure but cannot open pages — matching the (broken) legacy baseline.
  **Server-team flag:** either rehydrate textbook instructions in
  `load_assignment` for `type == 'textbook'` or expose an
  assignment-by-url JSON endpoint; the client is already shaped for both.
- **Wire impact:** none until the endpoint exists.
