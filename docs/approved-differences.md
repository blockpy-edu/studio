# Approved-Differences Ledger

Deliberate behavioral differences between BlockPy Studio and the legacy
client, per spec §16.2: the golden-transcript gate and conformance suites
must match legacy behavior **except** for the entries here. Each entry cites
the decision that authorized it ([DECISIONS.md](DECISIONS.md)) and states the
observable difference precisely so tests can encode it.

Replicate decisions (D4, D6) produce no entries - they are legacy parity.

| ID    | Decision  | Area          | Status                 |
| ----- | --------- | ------------- | ---------------------- |
| LD-1  | D1-B      | Quizzer       | pending implementation |
| LD-2a | D2-B      | Event logging | pending implementation |
| LD-2b | D2-B      | Event logging | pending implementation |
| LD-2c | D2-B      | Event logging | pending implementation |
| LD-3  | D3-A      | VFS/editors   | pending implementation |
| LD-3x | D3 note   | VFS/engine    | pending implementation |
| LD-5  | D5-B      | Settings save | pending implementation |
| LD-7  | D7-B      | Quizzer       | conditional            |
| LD-10 | dead code | Editor chrome | implemented (M1.4)     |

---

## LD-1 - Seeded quiz option shuffle (D1-B, Milestone 2.4)

- **Legacy:** matching/multiple-dropdown option order shuffled with unseeded
  `Math.random` on every render; reorders on reload.
- **Studio:** option order seeded with the same submission-id(+attempt) seed
  used for pool membership; stable across reloads within an attempt, still
  reshuffled per attempt.
- **Wire impact:** none (render-time only).

## LD-2a - Paste event records real size (D2-B, Milestone 1.2)

- **Legacy:** `X-Editor.Paste` always logs `{characters: 0}` (shadowed
  constant).
- **Studio:** logs the actual pasted character count. Same event name/fields;
  the research docs must note the field is trustworthy only from Studio
  onward. Deprecation metadata recorded in the event-id registry (see D2
  note: registry supports "untrustworthy before version X / superseded by Y"
  annotations).
- **Wire impact:** field value semantics only.

## LD-2b - Offline event queue no longer self-destructs (D2-B, Milestone 1.2)

- **Legacy:** `_dequeueData` uses one-argument `splice(index)`, wiping the
  queue tail; at most one queued offline event survives.
- **Studio:** queue dequeues single entries; all queued events flush on
  reconnect/boot.
- **Wire impact:** more (correct) `log_event` POSTs after offline periods.

## LD-2c - IP-change detection works on the retry path (D2-B, Milestone 1.2)

- **Legacy:** `_postRetry` passes a string into `checkIP`, so `X-IP.Change`
  never fires from retries.
- **Studio:** `X-IP.Change` fires whenever the reported IP changes, including
  on retried posts.
- **Wire impact:** additional `X-IP.Change` events that legacy would have
  missed.

## LD-3 - `&` files uniformly read-only (D3-A, Milestone 1.1/1.4)

- **Legacy:** read-only enforced in Text/JSON/Quiz/Toolbox editors but NOT in
  the Python and Markdown editors (edits never persisted meaningfully).
- **Studio:** the VFS permission matrix makes assignment-owned read-only
  files immutable to students in every editor.
- **Wire impact:** none (legacy edits didn't persist).

## LD-3x - Run artifacts persist to the submission (D3 note; additive §17 extension)

- **Legacy:** files created/modified by student programs are silently
  discarded (the `filewrite` hook is an unimplemented stub - A1/A7).
- **Studio:** run-written files diff into the transient layer, surface in the
  UI as artifacts, and **persist to the backend as part of the student's
  submission** (mechanism: the existing extra-files persistence path;
  finalize endpoint mapping in Milestone 1.1 - candidate: the
  `#extra_student_files.blockpy` bundle autosave).
- **Wire impact:** additional `save_file` traffic legacy never produced.
  Ships flagged, per §17's additive-extension rule.

## LD-5 - Settings save round-trips unknown keys (D5-B, Milestone 1.1/1.4)

- **Legacy:** `saveAssignmentSettings` serializes only registered keys,
  destroying server-only keys (`time_limit`, `protected_ip_ranges`,
  `poolRandomness`, …) on any instructor settings save.
- **Studio:** parse → edit known keys → merge over the original blob; unknown
  keys survive byte-for-byte.
- **Wire impact:** saved settings blobs may contain keys the legacy client
  would have dropped - strictly closer to what the server already stores.

## LD-7 - Hidden pool answers preserved (D7-B, Milestone 2.4) - RESOLVED

- **Legacy:** quiz saves serialize only visible questions' answers; answers
  to pool-hidden questions are dropped from the stored answer JSON
  (quiz.ts:304-311).
- **Condition check (2026-07-11):** the original plan (merge extra keys into
  `studentAnswers`) FAILS - `process_quiz` grades every answered question
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

## LD-8 - Multi-dim all-index subscripts round-trip losslessly (Milestone 1.4)

- **Legacy:** Skulpt parses `df[1, 2, 3, 4]` as `Index(Tuple)` (CPython ≤3.8
  shape); BlockMirror's tuple block always parenthesizes, so blocks→text
  re-rendered it as `df[(1, 2, 3, 4)]`. BlockMirror's own round-trip corpus
  (simple.html #42) asserts the unparenthesized form - the legacy suite used
  a silent `console.assert` + `break`, which masked the failure.
- **Studio:** the CST→IR converter emits `ExtSlice([Index, …])` for every
  multi-dim subscript, so `df[1, 2, 3, 4]` survives text→blocks→text
  byte-exact. Semantically identical Python is generated.
- **Wire impact:** none (client-side rendering only). §16.1.2 conformance:
  corpus #42 passes as written.

## LD-9 - Bare hidden imports still vanish (legacy parity, Milestone 1.4)

- **Not a difference - recorded to explain a corpus deviation.** `plt` is in
  `hiddenImports`: text→blocks suppresses the `import matplotlib.pyplot as
plt` block (legacy UX hides plotting boilerplate; the generator re-emits
  the import whenever a `plt.*` call block exists). A bare, _unused_ plt
  import therefore does not survive the round trip - in legacy or Studio.
  Corpus #73 asserts otherwise and cannot pass in legacy either (same silent
  console.assert masking); Studio pins the legacy behavior as a documented
  known-delta in the §16.1.2 suite.

## LD-10 - Instructions/feedback code highlighting actually renders (Milestone 1.4)

- **Legacy:** `interface.js:38-47` (instructions, 400 ms debounce) and
  `feedback.js:218-220` (feedback message) call
  `window.hljs.highlightBlock(...)` over `pre code` blocks - but no editor
  page template ever loads highlight.js, so `window.hljs` is undefined and
  the calls throw silently. The intended highlighting never renders on the
  editor page (only on server report pages that load hljs themselves).
- **Studio:** bundles `highlight.js` (common languages) and runs the same
  hooks - instructions highlighted 400 ms after render, feedback on present
  - with the stock hljs default theme scoped under `.blockpy-content`
    (`chrome/highlight.ts`; styles appended to `styles/blockpy.css`).
- **Wire impact:** none (client-side rendering only). Visual delta: code
  fences in instructions/feedback gain the gray background + token colors
  legacy authors intended but never saw.

## LD-11 - `version_change` out-of-date banner made real (Milestone 1.6)

- **Legacy:** the `save_file` endpoint computes and returns
  `version_change: submission.assignment.version != submission.assignment_version`
  (blockpy-server blockpy.py:259-271), but the legacy client never reads the
  flag - no call site anywhere in blockpy/src. Students editing a stale
  assignment version got no notice.
- **Studio:** the spec (§7.4) requires the UI to surface stale-version
  warnings as the "your code is out of date / reload" banner, so the
  submission sync checks `version_change` on every successful `saveFile`
  response and raises a dismissible `.blockpy-version-outdated` alert. The
  banner resets on assignment load.
- **Wire impact:** none (the flag was already on every save response;
  Studio just stops discarding it).

## LD-12 - Exam countdown active for BlockPy assignments too (Milestone 2.2)

- **Legacy:** the countdown/expiry checker lives in the server frontend's
  `AssignmentInterface` (assignment_interface.ts:88-115, 160-256), so it only
  runs while a reader/quiz/kettle/explain component is mounted. A _blockpy_
  assignment whose settings carry `time_limit` never shows a countdown or
  the "Time is up!" overlay - the editor page has no checker of its own
  (editor.html only runs the 10 s time-spent clock).
- **Studio:** README §9.4 assigns countdown ownership to the navigation
  store ("the rewrite owns it via the same store"), and the app feeds the
  loaded pair's `time_limit`/`date_started` into the checker for **every**
  assignment type. Format, tick rate (5 s), per-student overrides, overlay
  text, freeze-after-expiry, instructor exemption, and the
  `timer_expired`/`timer_cleared`/`timer_error` events are ports of the
  legacy checker; the only delta is that time-limited _coding_ assignments
  are now covered instead of silently untimed.
- **Wire impact:** timed blockpy assignments now emit the `timer_*` events
  the reader/quiz paths already emitted; no new payload shapes.

## LD-13 - Reading content rendered with `marked`, not markdown-it (Milestone 2.3)

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

## LD-14 - LTI put_data handshake posts the GENERATED UUIDs (Milestone 2.5)

- **Legacy:** the cookie-blocked fallback (editor.html:27-99) generates
  `messageId` and `stateId` UUIDs but then posts the LITERAL placeholder
  strings - `key: "blockpy_<state_id>", value: "<state_id>"` and
  `key: "nonce_<nonce_value>", value: "<nonce_value>"` (editor.html:85-98).
  The interpolation was never written; the platform stores the placeholder
  text. Additionally, with `platformOrigin = '*'` the response listener's
  origin check (`event.origin !== platformOrigin`) can never pass, so the
  `lti.put_data.response` confirmation is unreachable.
- **Studio:** `@blockpy/lti-embed`'s `installCookieFallback` substitutes the
  generated UUIDs (`blockpy_${stateId}`/`stateId`, `nonce_${nonce}`/`nonce`)
  per spec §13's "with generated UUIDs". The `'*'` origin caveat is kept
  verbatim behind the `PLATFORM_ORIGIN` constant - including the
  consequently-unreachable success path - so it can be corrected when
  platforms comply, exactly as §13 directs.
- **Wire impact:** the two postMessages now carry usable values; message
  count, shape, and origin are unchanged.

## LD-15 - Textbook assignment type rendered per textbook.html, not the ko stub (Milestone 2.5)

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
  page's observables - sidebar macro classes/indentation, first-reading
  default page, `?page=` pushState/popstate/title contract, no-op
  markCorrect (readings still post their own markRead), the legacy
  "Missing Reading" fallback - and serves BOTH the group-embedded type slot
  and (later) standalone pages. The legacy RAW instructor editor
  (instructions + settings textareas) is ported; the FORM mode
  (jsoneditor/filepond) is deferred.
- **Wire impact:** none new - loads ride `load_assignment`, page opens are
  full `Reader` loads, edits ride `save_file`/`save_assignment`.

## LD-16 - Textbook references rehydrate client-side only via an OPTIONAL resolver (Milestone 2.5; server-team flag)

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
  structure but cannot open pages - matching the (broken) legacy baseline.
  **Server-team flag:** either rehydrate textbook instructions in
  `load_assignment` for `type == 'textbook'` or expose an
  assignment-by-url JSON endpoint; the client is already shaped for both.
- **Wire impact:** none until the endpoint exists.
- **CLOSED (M4.7, 2026-07-12):** the by-url JSON endpoint DOES exist -
  `/assignments/by_url` (assignments.py:341-355, GET-only,
  login_required); the original survey missed it. `ApiClient.
loadAssignmentByUrl` (Transport.getJson - our one GET call) now feeds
  the Textbook's `resolveAssignment`. Remaining server-team ask shrinks
  to: publish the `loadAssignmentByUrl` URL key on the editor template
  ($blockPyUrls). Unresolved refs still render Missing Reading. The
  standalone route also landed: BootConfig `assignment.textbookPath`
  (the `load_textbook` `<path>`) resolves by-url-then-numeric-id at boot
  and dispatches; the initial `?page=` was already honored in-component.

## LD-17 - Fullscreen failures no longer double-log Success (Milestone 3.3)

- **Legacy:** the fullscreen click handler chained `.catch().then()`
  (interface.js:55-63), so a rejected `requestFullscreen()` logged
  `X-Display.Fullscreen.Error` AND THEN `X-Display.Fullscreen.Success` -
  every failure also appeared as a success in the event stream.
- **Studio:** two-arm `.then(onSuccess, onFailure)` - fulfilled logs
  Success, rejected logs Error (+ the legacy alert) and nothing else
  (QuickMenu.tsx `toggleFullscreen`).
- **Wire impact:** `X-Display.Fullscreen.Success` rows drop to their true
  rate; research code counting fullscreen successes before Studio must
  subtract paired Error events.

## LD-18 - Prompted share dialog only on NEGATIVE feedback ratings (Milestone 3.3)

- **Legacy:** ANY rating (thumbs-up or thumbs-down) opened the "It looks
  like you are having some trouble…" prompted share dialog after the 1 s
  thank-you (blockpy.js:801-813; the `suggestShare` parameter was dead).
- **Studio:** only `thumbs-down` triggers the prompted share; thumbs-up
  ends at the thank-you (Feedback.tsx `rate`). Rationale: a
  having-trouble prompt after a positive rating was noise.
- **Wire impact:** fewer prompted-share dialog opens; `X-Rating` logging is
  unchanged.

## LD-19 - Feedback badges for categories legacy left blank (Milestone 3.2)

- **Legacy:** the category→badge switch (blockpy.js:724-783) had no case
  for `mistakes`, `style`, `system`, or Pedal 3's `algorithmic` /
  `specification` / `positive` / `student` / `uncategorized` - all fell to
  `label-none` (transparent, no text), so e.g. TIFA feedback showed no
  colored badge at all.
- **Studio:** `categories.ts` maps the full Pedal 3 literal set
  (pedal/core/feedback_category.py), reusing the existing legacy color
  hooks - notably `algorithmic` → `label-semantic-error` "Algorithm Error"
  (the reported missing-badge bug).
- **Wire impact:** none (presentation only; Intervention events already
  carried the raw category).

## LD-20 - Console images stretch to the console width (Milestone 3.2)

- **Legacy:** `.blockpy-console-image-output img { max-height: 100px }`
  (blockpy.css) - every plot rendered as a ~100px-tall thumbnail.
- **Studio:** `width: 100%; height: auto; max-height: 480px;
object-fit: contain` - plots fill the console column with a sane cap
  (maintainer request, 2026-07-11). Applies to the minified editor too.
- **Wire impact:** none (presentation only; the `image` submission payload
  is unchanged).

## LD-21 - Working file Rename / Delete / namespace-move UI (Milestone 3.7)

- **Legacy:** Delete existed as a toolbar button (python.js:117-123,
  `DELETABLE_SIMPLE_FILES`); Rename was DEAD - the button was commented out
  (python.js:142-147) and `FileSystem.renameFile` references an undefined
  variable (files.js:518-528); the namespace was only choosable at file
  creation (NEW_INSTRUCTOR_FILE_DIALOG).
- **Studio:** working Rename and Delete for the active file in the Python
  toolbar and per-row in the new file-tree rail, plus a net-new
  instructor-only namespace-move. All three enforce the legacy
  UNRENAMABLE/magic-name guards (files.js:229/234) via
  `Vfs.canRenameName`/`canDeleteName`; renames/moves refuse to clobber.
  New `X-File.Rename` / `X-File.Move` / `X-File.Delete` extension events.
  The file-tree rail itself is a Studio extension (off by default,
  persisted `BLOCKPY_display.fileTree`); in text-only mode it replaces the
  horizontal tab strip.
- **Wire impact:** rename/move are CLIENT-side today - the renamed file
  persists under its new name through the normal save channels on the next
  edit; no server-side rename call exists (server-team flag if stale
  old-name artifacts on the submission become a problem).

## LD-22 - Pool-question seeding actually works (Pedal env fidelity pass)

- **Legacy:** on_run.js:43-45 called `set_seed(str(submission.id))` BEFORE
  `setup_environment(...)` - but `set_seed` stores into
  `report['questions']['seed']` (pedal/questions/setup.py:53) and
  `Environment.__init__` begins with `report.clear()`, which wipes
  `_tool_data`. The submission-id seed was therefore ERASED before any pool
  selection ran: legacy pool questions were never actually seeded per
  student (everyone got the default-seed selection).
- **Studio:** `_studio_pedal_grade` seeds AFTER `setup_environment`, so the
  seed sticks. The seed value is the legacy intent: submission id (the
  `poolSeed` instructor override joins when that M2-deferred control
  lands).
- **Wire impact:** none directly, but graders using `pedal.questions` pools
  now vary questions per submission id where legacy showed everyone the
  same pool pick. Course authors relying (unknowingly) on the frozen
  selection will see per-student variation - the documented intent.

## LD-23 - Color themes: dark & Windows-2000 opt-ins (Milestone 4.1)

- **Legacy:** no theming of any kind - one hard-coded parchment look.
- **Studio:** a `data-theme` scope system over the tokens.css variables
  (`[data-theme='dark']` / `[data-theme='win2000']`, styles/themes.css)
  plus a CM6 dark HighlightStyle + dark-base flag, a Blockly
  `componentStyles` dark workspace theme, and a win2000 cosmetic skin
  (box-shadow bevels - never border-width changes - square corners,
  Tahoma-era font stack; layout/metrics identical). A quick-menu palette
  button cycles light → dark → win2000; the choice persists at
  `BLOCKPY_display.theme` (showRating pattern).
- **Parity stance:** LIGHT REMAINS THE DEFAULT AND NORMATIVE LOOK (B6).
  Themes bind only on explicit user opt-in; `prefers-color-scheme` is
  deliberately ignored so an OS-dark student still boots into the parity
  default. Dark palette values are NOT legacy-derived - chosen for WCAG AA
  contrast on the dark surfaces (§16.3); the neutral token ramp inverts
  wholesale, so any future rule built on tokens themes for free.
- **Wire impact:** none - display-only; nothing new is logged or saved
  server-side (localStorage only, like showRating).

## LD-24 - Focused editor mode (Milestone 4.2)

- **Legacy:** no equivalent - the closest affordance was browser fullscreen
  (interface.js:50-71), which kept the whole chrome.
- **Studio:** an exam-friendly display mode that maximizes the editor:
  instructions pane, quick menu, file strip/tree, and the app's group-nav
  headers all hide; the Run/Stop/Reset toolbar stays; console + feedback
  move into a slim collapsible bottom drawer whose feedback badge (legacy
  label-* colors) stays visible while collapsed. Instructions remain
  reachable through a dialog overlay toggle. Enter via toolbar button or
  Ctrl+Alt+F; exit via the button or Esc. Composes with browser fullscreen
  (independent states). NOT persisted - every page load starts in the
  normal parity chrome, so B6 holds by default.
- **Telemetry:** new extension events `X-Display.Focus.Enter` /
  `X-Display.Focus.Exit` (A2 §5.1) fire on user enter/exit only; an
  assignment switch silently restores the chrome without logging an exit.
- **Wire impact:** the two new event rows only; display state is
  client-side.

## LD-25 - Docs browser panel + `docs_url` setting (Milestone 4.3)

- **Legacy:** no reference-document affordance of any kind.
- **Studio:** a new `docs_url` assignment-settings key (raw string, A4
  Studio-extensions table) drives a collapsible right-hand Docs panel
  beside the editor: markdown fetched once per session per URL, rendered
  through the A6 instructions pipeline (marked breaks + unsanitized HTML
  per D4-A + target=_blank + 400 ms hljs pass), heading-derived TOC with a
  filter box and scroll anchors, and an explicit raw-file download link.
  Toolbar "Docs" toggle appears only when the setting is present; the
  expand state persists (`BLOCKPY_display.docsPanel`). Width rides the
  M3.7 grid (3 columns from the editor; composes with the file tree:
  3+6+3). Hidden entirely in focused mode (LD-24).
- **Wire impact:** one additive settings-blob key. The server ignores it;
  a legacy-client instructor SAVE drops it (LD-5's registry-rebuild bug),
  Studio saves round-trip it. Fetching the document is a plain browser GET
  to the instructor-chosen URL (CORS applies; failure fails soft with a
  direct link).

## LD-26 - CSV grid & JSON editors (Milestone 4.4)

- **Legacy:** every non-Python file opened in the same CodeMirror text
  editor (JSON files had a JSON_EDITOR_HTML variant for a few magic names,
  but plain `.json`/`.csv` working files were raw text).
- **Studio:** extension-based dispatch in the CodingEditor tab body (third
  special case beside `images.blockpy` and the settings form): `.csv` tabs
  get a grid editor (RFC-4180-ish parse, header-row toggle, add/remove
  rows/columns, cell editing; ragged rows pad to a rectangle visibly);
  `.json` tabs get a CM6 editor with the JSON language, a synchronous
  validity badge + message, the jsonParseLinter gutter, and a collapsible
  tree view. Both serialize through the normal code-change path (VFS
  write → autosave → dirty tracking) and offer a "Raw Text" escape with a
  "Back to Grid/JSON Editor" return; unparseable CSV degrades straight to
  the text editor. `&`-space stays read-only in every mode (D3-A).
- **Wire impact:** none - same files, same save channels; only the editing
  surface changed. CSV serialization normalizes CRLF to LF and pads
  ragged rows (visible in the very first save after a grid edit).

## LD-27 - Image preview & sprite pixel editor (Milestone 4.5)

- **Legacy:** graphic files had no editor at all - uploads were listed in
  the images manager; a `.png` working file opened as garbage text.
- **Storage decision (plan M4.5 task, decided 2026-07-12):** the editable
  representation is the file's VFS TEXT CONTENTS AS A DATA-URL. Edits ride
  the normal code-change path (VFS write → autosave → dirty tracking) like
  every working file, so nothing new touches the wire. Server-side uploads
  (placement files) remain ImagesManager-only (M1.6 path): preview/replace
  by upload, no pixel editing - their bytes never enter the VFS.
- **Studio:** `.png/.jpg/.jpeg/.gif/.bmp` tabs render the ImageEditor:
  checkerboard-backed preview with zoom (0.5–8×) and a natural-dimensions
  readout; an "Edit Pixels" mode for sprite-scale images (≤ 64×64):
  palette + custom color + eraser, click/drag painting, width/height
  resize preserving the top-left, Apply re-encodes to a PNG data-URL.
  Non-data-URL contents (fresh files) offer a blank-canvas creator. The
  raw-text escape/return matches the M4.4 editors; `&`-space files are
  preview-only (D3-A).
- **Wire impact:** none structurally - image working files save as text
  data-URLs through existing channels. Consequence for runs: a student
  `open('sprite.png')` reads the data-URL STRING (text staging), which is
  also what legacy would have done with text contents.

## LD-28 - Assignment-group organizer, slice 1 (Milestone 4.6)

- **Legacy:** group management lived only on the server-rendered course
  pages (`courses/edit_settings.html`, a bulk form) - nothing was
  reachable from the editor, and the editor template never published the
  `/assignment_group/*` endpoint URLs.
- **Studio:** an instructor-only "Organize Group" dialog in the app shell
  over endpoints that already exist server-side: group rename/url
  (`POST /assignment_group/edit` - `assignment_group_id`/`new_name`/
  `new_url`), per-assignment name/url/points/public/hidden/reviewed
  (`POST save_assignment` - ONLY touched fields go on the wire; boot data
  doesn't carry points/public/reviewed, so untouched means unknown, never
  false), and move-out/move-in (`POST /assignment_group/move_membership`;
  `new_group_id = -1` removes). The group-nav header refreshes in place
  (new `GroupNavStore.renameEntry`/`removeEntry`).
- **Capability detection:** `editAssignmentGroup` and `moveMembership` are
  NEW `$blockPyUrls` keys - server templates must publish them to light up
  the group-edit/move controls (server-team flag, R10); per-assignment
  saves work on every editor page today. Slice 2 (true reordering, type
  changes, subordinate JSON toggle) stays open pending server endpoints.
- **Wire impact:** POSTs to two legacy-but-previously-unlinked routes,
  carrying the standard eleven base fields plus the routes' documented
  parameters. No new server code required for slice 1.

## LD-29 - WCAG AA fixes: ARIA roles, accessible names, contrast (Milestone 6.1)

- **Legacy:** never audited; the §16.3 acceptance criteria (WCAG 2.1 AA on
  navigation/quiz/text editing) are a Studio requirement.
- **Studio (axe-core audit, e2e/a11y.spec.ts - now a CI-runnable gate over
  the editor, quiz, reading, and textbook surfaces):**
  - **ARIA:** quick menu `role` menubar → toolbar (children are buttons,
    not menuitems); the file strip dropped its INCOMPLETE tab ARIA
    (tablist/tab/aria-selected with no tabpanel and non-tab children) for
    a plain navigation list with `aria-current` on the active file;
    CM6 editors carry `aria-label`s (Python/JSON); icon-only toolbar
    buttons, the assignment selector, and every quiz input
    (matching/dropdown selects, short-answer/numerical/essay/blank
    fields) gained accessible names.
  - **Contrast (all visual deltas, deliberately breaking exact color
    parity where legacy fails AA):** `.text-muted` and
    `.btn-outline-secondary` text `#6c757d` → `#62696f` (4.39:1 on
    parchment → 5.2:1); `.btn-success` `#28a745` → `#1e7e34` (3.13 →
    5.1); textbook active item `#007bff` → `#0a58ca` (3.97 → 6.4);
    footer server badges - ready `#5cb85c` → `#358535` (2.48 → 4.6),
    active `#5bc0de` → `#1a7a96`, failed `#d9534f` → `#b52b27`,
    retrying keeps amber with dark text (1.9 → 7.9).
- **Residual (Phase 6 full audit):** the feedback `label-*` badge colors
  are A8 §4.5-normative and still fail AA with white text when shown
  (e.g. no-errors `#5bc0de`); keyboard-only/manual passes (completion-box
  span, Blockly keyboard-nav plugin) are separate §16.3 lines.
- **Wire impact:** none - roles/labels/colors are client-side only.

## LD-30 - Blockly keyboard navigation plugin (Milestone 6.2; §16.3)

- **Legacy:** no keyboard access to the block canvas at all.
- **Studio:** @blockly/keyboard-navigation 0.6.14 (the Blockly-11 line),
  wired as a page-global NavigationController that workspaces join on a
  persisted, default-off toolbar toggle (`BLOCKPY_display.
blockKeyboardNav`). §16.3 frames this as best-effort: the plugin's
  0.6.x cursor/shortcut set ships as-is, and gaps (mutator dialogs,
  field editing depth) are the plugin's documented limits, not ours to
  paper over. Disposed editors leave the controller (and we manually
  dispose the trashcan flyout's workspace around an upstream Blockly
  11.2 registry leak - one retained workspace per editor mount
  otherwise; see block-editor.ts dispose).
- **Wire impact:** none - localStorage toggle only.

## LD-31 - Subordinate-reading preamble visible in instructor views (user request, 2026-07-13)

- **Legacy:** a quiz with `settings.readingId` renders the subordinate
  reading in full above the questions ONLY when "View As Student" is on
  (quiz_ui.ts:194-208); otherwise instructors get the static line
  "Reading is hidden; Click 'View as Student' to preview the Reading."
- **Studio:** the student rendering is unchanged (full reading above the
  quiz; url-slug readingIds now resolve through the GET-only
  `/assignments/by_url` route, quizzer.ts:108-110 → assignment.ts:119-127).
  Instructor views - the Quiz Editor (their default) and Actual Quiz with
  "View As Student" off - replace the static line with a
  "Show/Hide Subordinate Reading" toggle, expanded by default, so the
  pairing is visible without leaving instructor mode. The legacy line
  remains only as the fallback when no reading renderer is composed.
- **Wire impact:** none new - the preamble uses the same loadAssignment /
  by_url endpoints the reader and textbook already call.

## LD-32 - Assignment-switch loading overlay with status text (user request, 2026-07-13)

- **Legacy:** `.blockpy-overlay` is a bare full-screen darkening layer with
  no message or spinner, shown only around blocking POSTs and darkening
  per retry (server.js:216-249, blockpy.css:20-32). Assignment switches on
  the group page swap surfaces with at most an inline "Loading!" text.
- **Studio:** every top-level assignment load (editor path, quiz, reading,
  textbook) runs under a semi-opaque overlay carrying a spinner and
  "Loading <name>…" (the group-nav assignment name when known, else the
  surface kind + id). Counter-guarded so overlapping loads keep the
  overlay up until the last settles; preamble readings and textbook pages
  are excluded (they load inside an already-overlaid surface). The legacy
  `.blockpy-overlay` retry layer is untouched. `role="status"` announces
  the label; reduced-motion slows the spinner.
- **Wire impact:** none - presentation only.

## LD-33 - downloadFile url builder honors existing query strings (user request, 2026-07-13)

- **Legacy:** `plugins.ts:272` appends `?placement=…` blindly, producing
  `…?a=b?placement=…` when the configured downloadFile url already has a
  query string.
- **Studio:** the builder joins with `&` when the base url contains `?`
  (matching the transport's getJson separator rule). Filename stays
  unencoded, as legacy.
- **Wire impact:** requests against query-string'd downloadFile urls are
  now well-formed; identical bytes otherwise.

## LD-34 - Instructor tools moved into the group-nav bar as icon buttons (user request, 2026-07-13)

- **Legacy:** no in-page instructor-mode toggle or group organizer at all -
  both are Studio inventions (the organizer is LD-28; the persistent
  toggle was previously a Studio-only STICKY bar above the page).
- **Studio:** the sticky bar is gone. The tools are icon-only buttons at
  the FAR right of the TOP `assignment_group_header` bar (right of the
  clock/countdown floats), via a host `extras` slot on GroupNav:
  - Organize Group - ordered-list icon (Lucide `ListOrdered`), shown only
    while instructor mode is on (plus API + group context, as before);
  - Instructor mode - graduation-cap icon (Lucide `GraduationCap`),
    `aria-pressed` + `btn-success`/`btn-outline-secondary` swap for a
    clear on/off state (the same pair the Next button already uses).
    Both are gated on `display.instructor` (or the dev shell's
    `display.devHarness`), so STUDENTS never see them and the student-facing
    bar keeps exact legacy layout. The bottom bar instance stays pure
    legacy. Group-less pages fall back to a plain, non-sticky right-aligned
    strip so instructor mode stays reachable.

## LD-35 - Unanswered quiz questions grade as incorrect (Milestone 7.0; server-team flag)

- **Legacy/server:** `process_quiz` SKIPS questions whose answer is absent -
  the server's own `# Hack` (quizzes.py:72-76) - excluding their points
  from the total and never forcing `total_correct = False`. A blank
  question could therefore ride an otherwise-correct submission to
  `correct: true` (the maintainer-reported T/F false-correct). Only a
  fully-empty submission tripped the `questions_checked` guard.
- **Studio (local grading engine, quizzer/grading.ts):** every question
  PRESENTED in the attempt grades - an absent answer grades as the type's
  EMPTY answer (`defaultAnswer(question, undefined)`) and is therefore
  incorrect with its points counted. Questions pooled OUT of the attempt
  stay excluded: `processQuiz` takes `visible`/`seed` options
  (`selectVisibleQuestions` recomputes the shown set), and without attempt
  context, pooled questions with absent answers keep the legacy exclusion
  (a `hiddenAnswers` stash is positive evidence of hiddenness). The
  `checkQuizQuestion` T/F branch is also hardened: `String()` coercion can
  no longer alias an undefined answer against an unauthored `correct`
  ('undefined' === 'undefined' was a silent false PASS where the server
  would crash on `None.lower()`); unauthored checks never grade correct;
  `wrong` feedback falls back to "Incorrect" instead of stringified
  undefined.
- **Scope/interim divergence (risk R13):** the client engine governs the
  quiz editor's Try It local grading and the static demo. REAL submissions
  are graded server-side and still hit the skip hack until the server
  mirrors this fix in quizzes.py:72-76 - server-team flag filed with this
  entry. Visible-but-blank questions were already `''`-prefilled by Studio
  (documents.ts) and graded incorrect on both sides; only absent keys
  change.

## LD-36 - Pink bug icon made real: internal-grading-error dialog (Milestone 7.1)

- **Legacy:** the quick-menu `.blockpy-student-error` bug icon existed in
  the markup (interface.js:181) but was DEAD - no click or visible
  binding; the only reference ever `.hide()` it (feedback.js:269).
  Grader crash tracebacks were reachable only via instructor dialogs.
- **Studio:** internal grading errors (Pedal `system_error` from the
  fail-soft, pedal-env.py, plus PedalEnvironmentError/grading-job
  failures) set a store slot that renders the icon - faint pink
  (opacity 0.55, full on hover/focus) in the legacy top-right quick-menu
  spot - and clicking opens a Dialog with the full traceback in the
  standard `<pre.blockpy-printer-traceback>`. Visible to ALL roles: the
  generic "Internal Grading Error" badge already shows to students, and
  the dialog lets them attach details when reporting a broken grader.
  Cleared at run start (parity with the legacy per-grade hide). The
  dev-console/footer routing of the same text is kept as a supplement.
- **Wire impact:** none (presentation; existing logging paths unchanged).

## LD-37 - Engine one-time-setup indicator (Milestone 7.3)

- **Legacy:** no analog - Skulpt loaded with the page. In Studio, the
  first Run's Pyodide download (10-30 s) and the first grading's Pedal
  wheel install previously surfaced only as an orange Stop button plus a
  small footer message: it read as a hang.
- **Studio:** the adapter's boot-state hook (now carrying a user-facing
  label) drives a store slot: the Run button shows a spinner +
  "Loading…" (title = the full message) and the student console shows a
  status row ("Starting Python - one-time setup…", reused LD-32 spinner)
  until the wait ends; the Pedal wheel install drives the same indicator
  with its own message; a fatal boot failure clears it. Ruling: this is
  chrome, not routed system output - the dev-console rule (system
  messages never in the student console) is untouched, and the
  footer/dev-console text flows exactly as before.
- **Wire impact:** none.

## LD-38 - Feedback rating pinned bottom-right in both states (Milestone 7.6)

- **Legacy (replicated by Studio until now):** the EXPANDED "Rate this
  Feedback" row was in-flow at the end of the feedback column
  (`text-align: right` only), so it floated up under short messages and
  scrolled away under long ones, while the COLLAPSED "Rate" chip was
  absolutely pinned bottom-right (feedback.js template) - two different
  positions for the same affordance.
- **Studio:** the pane body (label + message + positives) scrolls inside
  an inner wrapper (`.blockpy-feedback-body`, flex:1) and the rating
  renders as a pinned footer row (`.blockpy-feedback-response`) aligned
  bottom-right in BOTH states - always visible, never overlapping
  content. Usability rationale per B6: a control that changes position
  with its own state is harder to find; bottom-right (the collapsed
  position) wins.
- **Wire impact:** none (X-Rating logging unchanged).

## LD-39 - Toolbar upload/download work locally; upload does NOT auto-run (Milestone 7.4)

- **Legacy:** Upload read the chosen file into the current editor
  (`.ipynb` via convertIpynbToPython, python.js:161-181), logged
  X-File.Upload, then IMMEDIATELY ran the program (python.js:462).
  Download saved the current file (answer.py under the sluggified
  assignment name, text/x-python) after logging X-File.Download.
- **Studio:** both buttons are real again (they shipped as disabled
  stubs). Upload targets the ACTIVE tab through the normal change path
  (VFS write + autosave + dirty), converts `.ipynb` (unparseable
  notebooks fall back to raw text), refuses read-only files (D3-A), and
  - the delta - does NOT auto-run: the maintainer spec is "just work
    locally", and running on upload surprised more than it helped.
    Download replicates the legacy naming/mimetype rules
    (chrome/file-transfer.ts); the obsolete msSaveOrOpenBlob arm is
    dropped. Both log the legacy X-File.Upload/X-File.Download events.
- **Wire impact:** the events fire as in legacy; no new endpoints.

## LD-40 - Quiz font-size stepper (Milestone 7.6; Studio extension)

- **Legacy:** no analog - quiz text was fixed at the Bootstrap default.
- **Studio:** an A−/A+ stepper on the quiz surface steps the question
  cards through 1 / 1.15 / 1.3 / 1.5 rem via a `--quizzer-font-size`
  CSS var (inline blanks/dropdowns inherit, so they scale too).
  Persisted per-user globally under `BLOCKPY_display.quizFontSize`
  (the established key family), storage-denied-guarded.
- **Wire impact:** none.

## LD-41 - Textbook chapter headers expand/collapse (Milestone 7.8; Studio extension)

- **Legacy:** sidebar header rows were inert BY DESIGN - the click
  binding attached only `if item.reading` (textbook.html:63-66); pure
  chapter titles rendered disabled-secondary and did nothing.
- **Studio:** rows with children get a chevron and toggle their subtree;
  clicking a header-only row toggles it too (header+reading rows keep
  opening their reading - legacy semantics - with the chevron as the
  separate collapse affordance). Default expanded = the legacy flat
  look; per-session state; `aria-expanded` reported. Companion
  diagnosability fix: instructor views annotate Missing Reading rows
  with WHY ("could not resolve <url> - is the by_url endpoint published
  (LD-16)?") instead of a silent disabled row.
- **Wire impact:** none.

## LD-42 - Working fork flow for non-owned assignments (Milestone 7.9)

- **Legacy:** `save_assignment` failures with `response.forkable` opened
  OFFER_FORK (server.js:657-661) - but the dialog's three buttons had NO
  click handlers (dialog.js:161-190 renders HTML only): the flow
  dead-ended at the prompt. The editor template's `forkAssignment` URL
  points at `blockpy.fork_assignment` (editor.html:205), a half-finished
  route that never returns the fork's id (blockpy.py:1139-1178).
- **Studio:** the full loop works. `save_assignment` responses carrying
  `forkable: true` (helpers.py:55-60 - the user is an instructor in
  their own course but not the assignment's) open the OFFER_FORK port
  with WORKING handlers: fork this assignment (optional new URL;
  collision surfaces the server message) → `ApiClient.forkAssignment`
  (wire contract of the WORKING `/assignments/fork`,
  assignments.py:133-178, which forks into the caller's course) → on a
  response with the fork's id, the app navigates to the fork through
  the host dispatch. Proactively, instructor views of a non-owned
  assignment (decoded `course_id` vs the context course - the decoder
  now surfaces owner/course/forked ids) show a notice with the fork
  affordance BEFORE the first rejected save. Capability-detected.
- **Server-team flags:** (1) repoint the published `forkAssignment` URL
  at `url_for('assignments.fork')` - against the current half-finished
  route the client fail-softs ("fork request failed") because no id
  comes back; (2) "Fork entire assignment group" needs a route a
  NON-owner may call (`assignment_group/fork` requires instructorship
  in the OWNING course and forks into it, assignment_groups.py:47-68) -
  the button ships only when that exists; (3) instructor-file
  `save_file` failures carry no `forkable` flag (blockpy.py:275-288) -
  the proactive notice covers that path client-side.
- **Wire impact:** none - client-side chrome only.

## LD-43 - Engine crash recovery: stack-overflow fatals self-heal (2026-07-15)

- **Legacy:** Skulpt executed as ordinary JS - runaway recursion raised a
  catchable JS/Skulpt error and the engine survived by construction; there
  was no "dead interpreter" state to recover from.
- **Studio:** a wasm stack-overflow fatal (unbounded recursion through C
  layers - e.g. a recursive `__getattr__`, hit in the wild via Pedal
  3.0.1's `cait_node.__getattr__` under `prevent_operation`; see
  pyodide#5959/#5987) kills the Pyodide interpreter but not the worker,
  and can even poison the interpreter WITHOUT failing the job when a
  fail-soft catch (grading) swallows it - the fatal then lands on the
  NEXT run's first `runPython`. Recovery contract (§6.6): (1) every
  interpreter reload reuses the init `indexURL` (reloading without it
  resolved `pyodide-lock.json` against the wrong base - the
  "`<!doctype` is not valid JSON" dead-engine failure); (2) after every
  job the worker runs a stack canary (`_studio_runtime.stack_canary`,
  depth scaled to the boot recursion limit) and replaces a dead/poisoned
  interpreter before the next job; (3) recovered fatals surface as
  `EngineCrash` with a student-readable message ("usually unbounded
  recursion… the engine has been restarted"), raw cause kept in the
  traceback for the dev console; (4) the worker posts `runner-reloaded`
  (and the client fires it on hard-stop respawns too) so the adapter
  re-arms the Pedal wheel install (long wall clock + LD-37 indicator).
  WorkerHost serializes init/run/restart handling so a job posted during
  a reload never executes against the corpse (input-response bypasses
  the chain - a queued run awaits it).
- **Wire impact:** none - engine protocol gains the worker→client
  `runner-reloaded` message; no server contract touched.
