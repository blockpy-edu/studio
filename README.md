# BlockPy Studio — Platform Rewrite Specification

**Target:** A TypeScript + React reimplementation of the BlockPy learning environment, unifying the current BlockPy client (`blockpy-edu/blockpy`) and the assignment-orchestration frontend of the BlockPy server (`blockpy-edu/blockpy-server/frontend`) into a single application, built on modern CodeMirror (6), modern Blockly, and Pyodide.

**Status:** Draft for review
**Audience:** BlockPy maintainers and contributors implementing the rewrite

---

## 1. Purpose and Goals

BlockPy is a web-based Python learning environment offering dual block/text editing, entirely client-side execution of student code, rich autograding feedback (Pedal), and LTI-based LMS integration through the BlockPy server. Today the system is split across two codebases with two UI frameworks:

1. **The BlockPy client** — a Knockout.js MVVM application bundling BlockMirror (Blockly ⇄ CodeMirror round-tripping), Skulpt (in-browser Python), the virtual file system, the trace/feedback subsystems, and the server-communication layer.
2. **The server frontend** — a TypeScript + Knockout component library (compiled to `frontend.js`) that provides the _other_ assignment types (readings, quizzes, textbooks, Kettle/TypeScript problems, "explain" tasks), the `Server` communication model, watch/grading interfaces, and — together with Jinja templates (`editor.html`, `assignment_groups.html`) — the assignment-group navigation shell that dispatches between assignment types.

This rewrite collapses both into one React application ("**the client**") with the following goals:

- **G1 — Single frontend.** One TypeScript/React codebase owns the editor, readings, quizzes, and navigation. The server's Jinja templates shrink to a thin bootstrap page that mounts the React app with a JSON configuration blob.
- **G2 — Modern engine stack.** Skulpt → **Pyodide** (real CPython in WASM); CodeMirror 5 → **CodeMirror 6**; legacy Blockly fork → **current Blockly** (plugin-based, with a maintained Python-block set replacing BlockMirror's fork).
- **G3 — Legacy API compatibility.** The client must speak the _existing_ blockpy-server HTTP API, event-logging vocabulary, LTI embedding protocol, and configuration surface byte-for-byte where the server observes it. Server changes are out of scope for v1 (see §14 for the compatibility contract and §17 for permitted additive changes).
- **G4 — Legacy filesystem semantics, modern implementation.** The idiosyncratic BlockPy "filesystem" (special filename prefixes such as `!`, `^`, `?`, `&`, `*`; magic names like `answer.py`) is preserved as the _wire and authoring format_, but internally mapped onto a clean layered virtual file system (§7).
- **G5 — Composability and nesting.** Every major surface is a React component that can be embedded inside another: full editor, minified editor inside reading code blocks, quiz rendered beneath a reading, reading rendered as a preamble to a coding problem, etc. (§12).
- **G6 — Library integrations.** First-class support for Pedal (autograding), matplotlib (plot capture), Drafter (student web apps), CORGIS datasets, and designer/turtle-style graphics, all running against the Pyodide engine (§10).

### Non-goals (v1)

- Rewriting blockpy-server's backend, database schema, or LTI plumbing.
- Restoring Java assignment support (explicitly dropped; render a tombstone message, as today).
- Feature-parity for instructor _course-management_ dashboards (watcher, grader, exam proctoring views). These remain on the old frontend until v2; the spec reserves extension points for them (§17).
- Offline/PWA operation beyond engine asset caching.

---

## 2. Source Systems Inventory (what is being replaced)

| Concern                                            | Current owner                                                      | Current tech                                                                         | Destination in rewrite                                                |
| -------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Dual block/text editor                             | blockpy + BlockMirror                                              | Blockly fork + CodeMirror 5, Skulpt parser for text→blocks                           | `@blockpy/editor` package, CM6 + Blockly 10+, Python AST service (§8) |
| Python execution, tracing                          | blockpy + skulpt fork                                              | Skulpt                                                                               | `@blockpy/engine` package, Pyodide in a Web Worker (§6)               |
| Feedback/autograding                               | pedal (runs inside Skulpt)                                         | Python (Skulpt-compatible subset)                                                    | Pedal running natively in Pyodide (§10.1)                             |
| Virtual filesystem                                 | blockpy `files.js` + editor tabs                                   | In-memory model keyed by prefixed filenames                                          | `@blockpy/vfs` layered FS with legacy-name adapter (§7)               |
| Server communication                               | blockpy (Skulpt-side) _and_ server frontend `Server` model         | jQuery AJAX, ad-hoc                                                                  | `@blockpy/api` typed client for the legacy REST endpoints (§14)       |
| Readings (`<reader>`)                              | server frontend                                                    | Knockout component                                                                   | `@blockpy/reader` (§11.2)                                             |
| Quizzes (`<quizzer>`)                              | server frontend                                                    | Knockout component                                                                   | `@blockpy/quizzer` (§11.3)                                            |
| Textbooks (`<textbook>`)                           | server frontend                                                    | Knockout component                                                                   | `@blockpy/textbook` (§11.4)                                           |
| Kettle / TypeScript problems (`<kettle>`)          | server frontend                                                    | Knockout component                                                                   | out of v1 scope; type registered, lazy-loaded legacy shim (§17)       |
| Explain tasks (`<explain>`)                        | server frontend                                                    | Knockout component                                                                   | same treatment as Kettle (§17)                                        |
| Assignment-group navigation                        | `assignment_groups.html` macro + inline jQuery                     | Jinja + jQuery + globals (`URL_MAP`, `markCorrect`, `altAssignmentChangingFunction`) | `@blockpy/navigation` (§9)                                            |
| Assignment-type dispatch                           | `editor.html` inline script (`loadAssignmentWrapper`, `mainModel`) | Knockout observables + globals (`QUIZZES`, `READINGS`, …)                            | `AssignmentHost` component + router (§5.3)                            |
| LTI embed glue (resize, cookie fallback, passcode) | `editor.html` inline script                                        | postMessage + jQuery                                                                 | `@blockpy/lti-embed` (§13)                                            |

---

## 3. Definitions

- **Assignment** — the atomic unit students work on. `type ∈ {blockpy (python coding), reading, quiz, textbook, typescript (kettle), explain, java (dead)}`. Fundamentally, v1 treats _python coding problem_, _reading_, and _quiz_ as the three first-class types.
- **Assignment group** — an ordered list of assignments delivered as one LTI launch; the navigation header/footer lets students move within it.
- **Subordinate assignment** — an assignment hidden from the group selector because it renders _inside_ another assignment (e.g., a quiz rendered beneath its reading). Preserved from `assignment_groups.html` (`rejectattr('0.subordinate')`).
- **Submission** — per-(user, assignment, course) record holding code/answers, correctness, grading status.
- **Secretive group** — a group containing any `hidden` assignment; correctness indicators and the completion count must be masked (`??`) for the whole group.
- **Engine** — the Pyodide-backed Python execution service.
- **Legacy names** — the prefixed filename scheme of the current BlockPy filesystem.

---

## 4. Technology Stack

| Layer         | Choice                                                                                                                                                                         | Notes                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Language      | TypeScript ≥ 5.x, `strict`                                                                                                                                                     | All packages                                                                                  |
| UI            | React 18+ (function components + hooks)                                                                                                                                        | No class components                                                                           |
| State         | Zustand stores per domain (editor, engine, submission, navigation) + React context for dependency injection                                                                    | Mirrors current Knockout observables with subscribable stores; avoids Redux ceremony          |
| Build         | Vite; library mode for embeddable bundles                                                                                                                                      | Outputs: full app bundle, embeddable `blockpy.iife.js` for third-party pages, per-package ESM |
| Text editor   | CodeMirror 6 (`@codemirror/lang-python`, lint, autocomplete, merge for history diffs)                                                                                          |                                                                                               |
| Blocks        | Blockly (current npm releases), custom Python block set + generators                                                                                                           | Replaces the BlockMirror Blockly fork                                                         |
| Python engine | Pyodide (pin latest stable; loaded in a dedicated Web Worker)                                                                                                                  | `SharedArrayBuffer` interrupts where COOP/COEP available; fallback path required (§6.6)       |
| Markdown      | unified/remark with the current instructions extensions (see §11.1). **No sanitization** — legacy parity per decision D4 (docs/DECISIONS.md); instructor HTML renders verbatim |                                                                                               |
| Styling       | CSS modules + design tokens; must be themable to match host LMS neutrality; Bootstrap-compatible class hooks kept on navigation elements for legacy CSS/tests (§9.6)           |                                                                                               |
| Testing       | Vitest + React Testing Library; Playwright for end-to-end; golden-transcript tests against a recorded legacy server (§16)                                                      |                                                                                               |
| Packaging     | pnpm monorepo: `packages/{engine,vfs,editor,blocks,reader,quizzer,textbook,navigation,api,lti-embed,legacy-shim,app}`                                                          |                                                                                               |

---

## 5. Application Architecture

### 5.1 Package graph

```
app ─────────────► navigation ──► api
 │                    │
 ├──► editor ──► blocks(blockly) ─┐
 │        │                       │
 │        ├──► vfs ◄──────────────┤
 │        └──► engine (pyodide worker)
 ├──► reader ──► editor (minified) ──► quizzer (subordinate)
 ├──► quizzer ──► engine (preprocessing)
 ├──► textbook ──► reader
 ├──► lti-embed
 └──► legacy-shim (window.blockpy / window.frontend facade)
```

`engine` and `vfs` are UI-free and runnable in Node for tests. Exactly one engine worker exists per page; all editors/quizzes on the page (including nested minified editors in readings) share it through a queued session API (§6.3).

### 5.2 Bootstrapping contract

The server today renders `editor.html`, which (a) injects JSON constants, (b) instantiates `frontend.Server` and a Knockout `mainModel`, (c) instantiates `blockpy.BlockPy({...})`, and (d) wires `loadAssignmentWrapper`. The rewrite replaces all of this with:

```html
<div id="blockpy-root"></div>
<script type="application/json" id="blockpy-config">
  { ...BootConfig... }
</script>
<script src=".../blockpy-studio.iife.js"></script>
<script>
  BlockPyStudio.mount('#blockpy-root', '#blockpy-config');
</script>
```

`BootConfig` is the typed union of everything `editor.html` currently injects:

```ts
interface BootConfig {
  urls: LegacyUrlMap; // §14.2 — exactly the keys of window.$blockPyUrls
  user: {
    id: number | null;
    name?: string;
    role: string;
    courseId: number | null;
  };
  accessToken?: string; // window.accessToken passthrough
  assignment: {
    currentAssignmentId: number | null;
    assignmentGroupId: number | null;
    assignmentData?: LegacyAssignmentPayload; // for editor.loadAssignmentData_ path
    typeIndex: {
      // replaces QUIZZES/READINGS/TEXTBOOKS/JAVAS/KETTLES/EXPLAINS/BLOCKPYS
      quiz: number[];
      reading: number[];
      textbook: number[];
      java: number[];
      typescript: number[];
      explain: number[];
      blockpy: number[];
    };
  };
  group?: GroupBootData; // §9.2 — replaces the Jinja-rendered header
  display: { instructor: boolean; readOnly: boolean; embed: boolean };
  passcodeProtected: boolean;
  sessionStartTime: number | null; // epoch ms; drives the "time spent" clock
  paths: {
    blocklyMedia: string;
    emojiProxy: string;
    pyodideIndexURL: string;
  };
  settings: Record<string, unknown>; // parsed `settings-*` query params, prefix stripped (§15.2)
  corgisUrl: string; // urls.importDatasets
}
```

**Compatibility rule:** during migration the server may keep emitting the old globals (`window.$blockPyUrls`, `window.$blockPyUserData`, `QUIZZES`, `READINGS`, …, `window.$blocklyMediaPath`, `window.accessToken`). `BlockPyStudio.mountLegacy()` must be able to assemble a `BootConfig` purely from those globals so the rewrite can ship without a synchronized server release.

### 5.3 Assignment host and type dispatch

`<AssignmentHost>` replaces `editor.html`'s `mainModel` + `loadAssignmentWrapper`. Behavior to preserve exactly:

1. Given an assignment id, classify it via `assignment.typeIndex` membership (the current code checks `QUIZZES.includes(id)` etc., in the priority order quiz → reading → textbook → java → kettle → explain → blockpy).
2. If the id is a non-blockpy type, hide the coding editor (legacy `editor.hide()`), mount the matching component, and set only that type's "current id" (all others null) — the per-type-id reset in `loadAssignmentWrapper` is observable behavior (components unmount/remount rather than reload in place) and must be kept.
3. If the id is a blockpy assignment (or unknown), show the editor and delegate to its async load; on completion, mark the active type. Unknown ids fall through to the editor exactly as today (the editor is the fallback renderer and surfaces its own load errors).
4. `java` renders the static message "Java assignments are no longer supported in BlockPy."
5. The host exposes `loadAssignment(id: number): Promise<void>` — this is the modern `altAssignmentChangingFunction`, and the legacy global of that name must alias it (§15.3).

Routing: when not embedded, the host mirrors the current URL contract — assignment switches update `assignment_id` (preserving `assignment_group_id`, `assignment_group_url`, `embed`) via `history.replaceState`, and honor deep links on load. When the SPA path is unavailable (host page without the app shell), navigation falls back to full-page loads using the server-provided per-assignment URL map (§9.2), matching today's `URL_MAP`/`document.location.href` behavior.

---

## 6. Execution Engine (`@blockpy/engine`)

### 6.1 Requirements

- **E1** Run untrusted student Python entirely client-side under CPython (Pyodide) with: captured stdout/stderr, interactive `input()`, wall-clock and instruction limits, interruption ("Stop" button), and per-run isolation.
- **E2** Provide the _instructor execution phases_ BlockPy has today: `on_run` (main grading), `on_change` (lightweight feedback as students type), `on_eval` (REPL/eval feedback), plus plain student runs and an interactive console.
- **E3** Expose line-level tracing sufficient to rebuild the **Trace/State Explorer** (step through execution, inspect variables per step) — implemented with `sys.settrace` + frame snapshotting in the worker, streamed as compact trace events. Trace capture is opt-in per run (perf).
- **E4** Deterministic instructor-controlled environment: mocked modules, mocked `open()`/URLs (`?mock_urls.blockpy` behavior), seeded `random` when configured, event-driven re-runs.
- **E5** Serve as a shared service: the main editor, N minified reading editors, and quiz preprocessing all submit jobs to one worker with FIFO queueing and priorities (user-initiated runs preempt `on_change` jobs; `on_change` jobs are debounced and coalesced).

### 6.2 Worker architecture

```
Main thread                          Engine worker
───────────                          ─────────────
EngineClient  ── postMessage ──►  JobRunner ─► Pyodide runtime
  runStudent(job)                    │  stdout/stderr chunks
  runInstructor(phase, job)          │  input requests
  evaluate(expr)                     │  trace events
  interrupt(jobId)                   │  filesystem sync events
  ◄── structured events ────────────┘  result {success, error, feedback}
```

- One Pyodide instance per worker; per-job isolation via a fresh `__main__` module dict, `sys.modules` snapshot/restore, and FS staging (§7.5). Full interpreter restart is available as a "nuclear" reset (exposed to users as _Restart kernel_, and triggered automatically after unrecoverable interpreter corruption).
- **Interrupts:** where cross-origin isolation is available, use `pyodide.setInterruptBuffer` over `SharedArrayBuffer` (also enables synchronous `input()` via `Atomics.wait`). Fallback (§6.6) otherwise.
- **stdin:** `input()` surfaces as an `input-request` event; the editor renders the existing inline console prompt. SAB path blocks synchronously; fallback path uses `pyodide.runPythonAsync` with an async input shim.
- **Time limits:** dual guard — JS-side watchdog that fires the interrupt after the assignment's configured timeout, and a trace-based instruction counter when tracing is on. Skulpt's `execLimit` setting maps to this.

### 6.3 Job model

```ts
type Phase =
  | 'student.run'
  | 'student.eval'
  | 'instructor.on_run'
  | 'instructor.on_change'
  | 'instructor.on_eval'
  | 'quiz.preprocess';

interface EngineJob {
  id: string;
  phase: Phase;
  fsSnapshot: VfsSnapshotRef; // which VFS overlay to mount (§7.5)
  entry: string; // e.g. 'answer.py' or synthesized runner
  env: {
    mockedModules: string[];
    mockUrls: MockUrl[];
    seed?: number;
    args?: string[];
  };
  limits: { wallMs: number; traceSteps?: number };
  trace: boolean;
  inputsPrefill?: string[]; // scripted inputs (sample-input replay, Pedal)
}
```

Results carry: exit status, exception (type, message, formatted traceback with _student-relative_ line numbers — instructor scaffolding lines must be subtracted exactly as the current Skulpt integration does), captured streams, produced images (§10.2), Pedal final feedback (§10.1), and the trace buffer.

### 6.4 Console / REPL

Retain the BlockPy console: a persistent-per-session REPL bound to the last student run's namespace, powering "Evaluate" and the `on_eval` phase. Implemented as `pyodide.runPython` against the retained post-run globals; cleared on new runs.

### 6.5 Engine as a service to quizzes

Quizzes may declare Python **preprocessing** of student answers before submission (e.g., normalize/parse/execute a typed-code answer and attach results). The quizzer calls `EngineClient.run({phase:'quiz.preprocess', ...})` with the question's preprocessing script mounted plus the raw answer injected as a variable/file; the returned value (JSON-serializable) replaces or augments the answer payload sent to the backend (§11.3.6). Preprocessing failures must fail-soft: the raw answer is still submitted, with an `preprocessing_error` annotation.

### 6.6 Cross-origin isolation fallback

The LTI reality: BlockPy runs inside LMS iframes where COOP/COEP often cannot be guaranteed. The engine must therefore support both modes and pick at boot:

- **Isolated mode** (SAB available): sync input, instant interrupt.
- **Compat mode:** async-only execution (`runPythonAsync` with periodic `setTimeout` yields injected via Pyodide's `checkInterrupt`-style callbacks), async input shim, interrupt latency up to one yield interval, and — worst case — worker termination + engine reload as the hard-stop. Feature-detect and log the active mode via the event API (`X-Engine.Mode` event) for research telemetry.

### 6.7 Skulpt-compat notes (behavioral deltas to document for instructors)

Maintain a written compatibility appendix as part of the deliverable: differences in float repr, error messages, module availability, `time` behavior, and performance. Where the legacy curriculum depends on Skulpt quirks (notably Pedal's `sandbox` expectations and TIFA), the Pedal integration layer (§10.1) is the shim point, not the engine core.

---

## 7. Virtual File System (`@blockpy/vfs`)

### 7.1 The legacy model (must remain the wire/authoring format)

The current BlockPy filesystem is a flat namespace of specially-named files split across ownership groups, signaled by filename prefixes. The canonical behavior lives in the client's `files.js` and the editor's file toolbar; the rewrite must reproduce it observably. The legacy roles:

| Legacy name / prefix                          | Owner                              | Meaning                                                                                             |
| --------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `answer.py`                                   | submission                         | The student's main program (blocks and text views both edit this)                                   |
| `!instructions.md`                            | assignment                         | Instructions markdown shown in the instructions pane                                                |
| `!assignment_settings.blockpy`                | assignment                         | JSON settings blob (toolbox level, execution limits, display toggles, etc.)                         |
| `!on_run.py`                                  | assignment                         | Pedal/instructor grading script, executed after student runs                                        |
| `!on_change.py`                               | assignment                         | Instructor script run (debounced) as the student edits                                              |
| `!on_eval.py`                                 | assignment                         | Instructor script run on console evaluations                                                        |
| `^starting_code.py` (and `^<name>` generally) | assignment                         | Starting version of the correspondingly named student file; used for reset-to-start and diffing     |
| `?<name>`                                     | assignment (student-visible extra) | Extra files distributed with the assignment and readable by student code                            |
| `!<name>` (other)                             | assignment (instructor-only)       | Hidden instructor support files, importable by grading scripts but invisible to students            |
| `&<name>`                                     | submission                         | Extra student-created files stored with the submission                                              |
| `*<name>` / uploaded files                    | user/course                        | "Uploaded files" managed through `list_files`/`upload_file`/`rename_file`/`download_file` endpoints |
| `#<name>`                                     | transient                          | Local-only scratch files, never persisted                                                           |

> **Action item:** before implementation freezes, the prefix table must be verified line-by-line against `src/files.js` and `src/editor/` in the legacy client (the table above reflects intended semantics; the code is the authority, including any additional magic names such as `!sample_submissions.blockpy`, `!tags.blockpy`, `?toolbox.blockpy`, `?mock_urls.blockpy`, and image/summary files). The verified table becomes a fixture for conformance tests.

### 7.2 Modern architecture: layered overlay FS

Internally, replace the flat prefixed namespace with a layered filesystem; the prefixes become a **naming adapter** at the edges:

```
Layer 4 (top)  transient/      #-files, run artifacts        (memory only)
Layer 3        submission/     answer.py, &-files             (persisted via save_file per file)
Layer 2        uploads/        user-uploaded data files       (persisted via upload endpoints)
Layer 1        assignment/     !,^,? files                    (persisted only for instructors via save_assignment/save_file)
Layer 0 (base) system/         engine-provided stdlib mounts  (read only)
```

- `Vfs.resolve(name)` performs top-down lookup, so a student's `&data.txt` can shadow an assignment's `?data.txt` only if the legacy client allows it (verify; default: assignment `?` files are read-only to students and not shadowable).
- Each layer records dirty state per file; the persistence adapter maps _layer × file_ to the correct legacy endpoint and legacy filename (re-attaching the prefix). Wire format never changes.
- **Permissions:** roles (`student`, `instructor`, `grader`, read-only) gate visibility and mutability per layer. Students never see Layer-1 `!` files; instructors see everything with the current tabbed editor affordances (add/delete/rename instructor files).
- **Events:** the VFS emits change events consumed by (a) autosave/debounced persistence, (b) the engine (FS staging invalidation), (c) the editor tabs UI, and (d) the event logger (`File.Edit` etc., §14.4).

### 7.3 Filename adapter

```ts
LegacyName.parse('!on_run.py')  => { layer:'assignment', visibility:'instructor', path:'on_run.py' }
LegacyName.format(entry)        => '!on_run.py'
```

All server I/O and all instructor-facing UI labels use legacy names; all internal code uses `(layer, path)`. This module is the single place the oddities live.

### 7.4 Persistence semantics (unchanged from legacy)

- `answer.py` autosaves on a debounce (and on run) via the `saveFile` endpoint with the legacy payload shape; version/timestamp conflict handling must match the current client (server returns stale-version warnings that the UI surfaces as the "your code is out of date / reload" banner).
- Instructor edits to assignment-layer files save through `saveAssignment`/`saveFile` as today, gated by `display.instructor`.
- History: `loadHistory` returns the submission's edit/run history; the History viewer renders it with CM6 merge-view diffs (replacing the current CodeMirror diff UI).
- Read-only mode (`display.read_only`) freezes Layers 1–3 in the UI but still stages them into the engine for execution if running is allowed.

### 7.5 Engine mounting

Before each job, the engine worker materializes a snapshot of the resolved namespace into Pyodide's Emscripten FS under `/mnt/blockpy/`, applying visibility rules for the phase: student runs see student-visible files only; instructor phases additionally see `!` files; `^` starting files are never mounted (they are editor metadata). `open()` inside student code resolves against this mount. Mock URLs (§10.4) intercept network-ish access. After the job, files _created or modified by the run_ diff back into Layer 4, surface in the UI as run artifacts, and **persist to the backend as artifacts of the student's submission** (decision D3, docs/DECISIONS.md; ledger LD-3x). Verified 2026-07-10: legacy _discarded_ all program-written files (the `filewrite` hook was an unimplemented stub — appendix A1/A7), so this is an additive §17 extension shipped behind a flag, with the existing extra-files persistence path as the candidate mechanism.

---

## 8. Dual Block/Text Editing (`@blockpy/editor` + `@blockpy/blocks`)

### 8.1 Requirements

- **B1** Three view modes: _Blocks_, _Split_, _Text_ — with the same toggle UI position and semantics as today. Split keeps both views live.
- **B2** Text is the source of truth. Blocks are a projection: text → AST → blocks; block edits → generated Python → text. Round-trip stability: converting text→blocks→text must be idempotent for supported constructs (whitespace/comment policy documented; comments preserved at statement granularity as BlockMirror does today).
- **B3** Unparseable text disables the Blocks/Split modes with the current "your code has an error, blocks unavailable" affordance, showing the syntax error location in the text editor.
- **B4** The block palette ("toolbox") is instructor-configurable per assignment via the existing assignment settings (named toolbox levels and custom toolbox definitions must keep loading from their legacy settings keys).
- **B5** Images-in-code, corgis dataset import blocks, and the block styling/l10n of the current BlockMirror set carry over incrementally; v1 must cover the full core-language block set BlockMirror supports (statements, expressions, literals, functions/defs, classes minimal, imports, comprehensions per current support level).
- **B6 — Visual parity (added 2026-07-10).** The interface must be basically the same as the original BlockPy interface, especially in **layout** (region arrangement: instructions pane, view toggles, run controls, console, feedback pane, file tabs) and **color** (the legacy palette). Icons and fonts may change only where the replacement is relatively similar, makes sense, and improves usability/accessibility — such changes are proposed individually with rationale, not wholesale. The legacy layout/palette extraction in the A8 appendix is the conformance fixture.

### 8.2 Parsing strategy

BlockMirror currently uses Skulpt's parser to build the AST that drives block generation. The rewrite must not depend on Skulpt.

**Decision (2026-07-10):** block generation is driven by the **CodeMirror CST** — the Lezer Python parse tree already powering CM6 highlighting (`@codemirror/lang-python` / `@lezer/python`). One parser serves highlighting, diagnostics, and the text→blocks direction; conversion is synchronous, works before/without Pyodide loading, and never queues behind student runs.

- The CST→workspace builder in `@blockpy/blocks` consumes Lezer trees directly (concrete tree: comments and token positions are preserved, aiding B2's comment policy).
- Lezer's error tolerance is used for B3: any error node in the tree marks the source unparseable for block purposes (blocks/split disabled with the legacy affordance), rather than generating blocks from a recovered tree.
- Divergence risk (Lezer grammar vs CPython) is managed by the round-trip conformance suite (§16.1.2) cross-checking Lezer parse success against CPython `ast` verdicts from the engine in tests.
- The engine's CPython `ast` remains available for Pedal's analysis needs (§10.1) but is not in the editing loop.

### 8.3 Blocks package

- Custom Blockly block definitions + a Python **generator** (Blockly's official python generator, extended) and an **AST→workspace builder** (the BlockMirror text-to-blocks direction).
- Block ↔ source mapping retained per block (line ranges) to support (a) selection sync between views in Split mode and (b) trace highlighting of the active line in both views.
- Blockly media path comes from `paths.blocklyMedia` (legacy `window.$blocklyMediaPath`).

### 8.4 Minified editor variant

A compact configuration of the same component used inside readings (§11.2): text-only by default (blocks optional via settings), short height, Run + output console inline, no file tabs, no instructions pane. It shares the page's engine worker and creates an ephemeral VFS (its code block content = `answer.py` in a detached namespace). Edits/executions log events attached to the _reading_ assignment id.

---

## 9. Assignment Group Navigation (`@blockpy/navigation`)

Replaces the `assignment_group_header` Jinja macro and its jQuery. Rendered **twice** (top and bottom of the page) from one shared store, exactly like the current template includes it twice.

### 9.1 UI contract (preserve layout and behavior)

Left to right, matching the legacy header:

1. **First** button (step-backward icon) — disabled when current == first.
2. **Back** button (chevron-left) — disabled when current == first.
3. **Assignment `<select>`** listing non-subordinate assignments in group order; option label = `✔ ` prefix + name when correct (suppressed in secretive groups); option classes `correct-submission` / `incorrect-submission` / `secret-submission` preserved as CSS hooks.
4. **Completion box** — `(<n>/<total> completed)`, `??` numerator when secretive. Clicking it toggles the selector between dropdown and expanded list-box (legacy: `size = min(5, options/2)` vs `size=1`), persisted under the exact localStorage key `blockpy_assignmentSelectorExpanded` (string `"true"`/`"false"`), guarded for storage-denied contexts.
5. **Next** button (chevron-right), **Last** button (step-forward) — disabled at end. Next gains success styling (legacy `btn-success`) after the current assignment is marked correct.
6. Right-aligned: **countdown** span (time remaining when a time limit is set) and **clock** span (§9.4).

### 9.2 Boot data

```ts
interface GroupBootData {
  assignments: Array<{
    id: number;
    name: string;
    url: string; // url = legacy URL_MAP[id] for full-page fallback
    subordinate: boolean;
    hidden: boolean;
    correct: boolean; // from the paired submission
  }>;
  anySecretive: boolean; // OR of hidden — masks all statuses
  currentAssignmentId: number;
}
```

### 9.3 Behavior

- Selecting/Next/Back/First/Last resolve the target id using the _non-subordinate ordered list_ (INDICES semantics: next of last = last, back of first = first) and call `AssignmentHost.loadAssignment(id)`. If no SPA host is present (`altAssignmentChangingFunction` undefined in legacy terms), do a full navigation to `assignments[i].url` and show the legacy "~~~ The next problem is loading! Please wait" notice.
- `markCorrect(assignmentId)` — invoked by any assignment component on success (this is the `callback.success` config the editor receives): idempotently set correct, add ✔, restyle Next, increment the completion numerator. In secretive groups: perform none of the visible updates and set the numerator to `??` (legacy behavior). The store also re-broadcasts so both header instances update.
- Keyboard: buttons focusable; select operable; add `aria-live="polite"` announcements for assignment changes (new, but non-breaking).

### 9.4 Time-spent clock and countdown

Preserve the `editor.html` clock exactly:

- Starts from `sessionStartTime` (server-provided) or `Date.now()`; ticks every 10 s.
- Display tiers: `(Just started)` under 1 min; `~N minute(s) spent` under 1 h; `~H:MM hours spent`; cap `99+ hours spent`.
- Click toggles modes: `session` → `loading` (`(Getting Total)`) → `activity`, fetching total via the legacy `estimate_group_duration` endpoint (`window.ACTIVITY_GET_DURATION` equivalent; the global must still be exported for legacy pages, §15.3); errors fall back to session mode. Clicking again returns to session mode.
- Countdown span: renders remaining time when the assignment/group carries a time limit; hook point for the exam/passcode subsystem. (Legacy leaves population of `.assignment-selector-countdown` to other scripts — the rewrite owns it via the same store.)

### 9.5 Completion-of-group

When the last incomplete assignment flips correct in a non-secretive group, show the legacy end-of-group affordance (verify exact current behavior — at minimum, Next/Last disabled at end plus fully green state; if the legacy `frontend` shows a congratulations message, replicate).

### 9.6 CSS compatibility

Keep the class names `assignment-selector-div`, `assignment-selector`, `assignment-selector-first/back/next/last`, `completion-box`, `completion-rate`, `assignment-selector-clock`, `assignment-selector-countdown`, and the row's warning-yellow styling, since course custom CSS and existing tests target them.

---

## 10. Library Integrations

### 10.1 Pedal (autograding)

- Pedal runs **inside Pyodide** as a normal package (its natural habitat is CPython; the Skulpt port's constraints disappear). Bundle `pedal`, `curriculum-ctvt`, `curriculum-sneks` as wheels in the deployment, importable by `!on_run.py` unchanged.
- Provide the Pedal _sandbox_ execution of student code within the same job: instructor script drives `pedal.sandbox` against the mounted student files, with stdout/input scripting, mocked modules, and TIFA analysis. The integration layer implements Pedal's environment contract (equivalent to today's "blockpy environment" in Pedal) targeting the engine: capturing student ASTs (via `ast` on the real source), runtime results, and output.
- The **final feedback object** (category, label, title, message HTML, score, correctness) flows back and renders in the feedback pane with the current category taxonomy and styling hooks. `success` triggers `markCorrect` + `update_submission` exactly as now.
- Feedback messages may embed rich content (images, formatted tracebacks). Do not sanitize.

### 10.2 matplotlib

- Use the Agg backend in-worker; hook `plt.show()`/figure finalization to serialize PNGs, emit them as `image` events rendered in the console output area (current behavior), and offer the legacy "save image" flow via the `saveImage` endpoint (used for submission snapshots/grading views).
- Multiple figures per run render in order; figures count toward Pedal's plot-inspection APIs (Pedal's matplotlib mock is replaced by inspecting real figure objects — provide the shim so existing `!on_run.py` scripts using Pedal's plotting assertions keep working).

### 10.3 Drafter (student web apps)

- Drafter (route-decorated web-app framework for novices) runs its "server" inside the engine; the client provides a **DOM bridge**: a sandboxed iframe pane in the console area renders the current page; form submissions/link clicks post back into the worker to invoke routes, enabling the full request/response loop without a network.
- State snapshots of the Drafter app integrate with the trace/state explorer where feasible (stretch goal, flag-gated).

### 10.4 CORGIS datasets and mock URLs

- The dataset-import block/UI fetches from `corgisUrl` (`urls.importDatasets`) as today; imported datasets install into the VFS uploads layer and as importable modules in the engine mount.
- `?mock_urls.blockpy` (URL → local file mapping) intercepts `urllib`/`requests`-style access in student code via installed shims, preserving instructor-authored offline behavior.

### 10.5 OpenAI proxy

The editor's AI-help affordances continue to call the server's `openaiProxy` endpoint (never a vendor directly); requests carry the legacy payload and `access_token`. Feature remains gated by server/course configuration.

---

## 11. Assignment Types

### 11.1 Python coding problems (`blockpy` type) — `@blockpy/editor`

Feature-parity checklist against the current client (each item is a conformance test target):

- Instructions pane rendering `!instructions.md` (markdown + HTML, LaTeX, dynamic content placeholders — verify legacy extensions list from the client's instructions renderer and freeze it in an appendix).
- View toggles (Blocks/Split/Text), Run, Stop, Evaluate/console, Trace (state explorer with step slider, variable table, active-line highlight in both views), History (diff timeline), Reset-to-starting-code (from `^` files), file tabs per role, upload/download of data files, "quick task" compact mode if enabled in settings.
- Feedback pane with Pedal categories, "full guidance vs. gentle hints" modes as configured, and instructor-only internals (raw feedback object, grading controls: force-mark-correct, regrade) behind `display.instructor`.
- Settings surface: everything read from `!assignment_settings.blockpy` today keeps its key names and effects (toolbox level, `disable_timeout`/exec limits, hide files, start view, etc.). Unknown keys pass through untouched so old assignments never break.
- Submission lifecycle: run → autograde → `update_submission` (score/correct) → `update_submission_status` transitions → `markCorrect` — identical calls and ordering (§14.3).
- Passcode lock: when `passcodeProtected`, block the UI with the passcode prompt before any assignment content loads (legacy `editor.requestPasscode()`), validating however the legacy client does (verify: local hash vs server check) — same UX.

### 11.2 Readings — `@blockpy/reader`

Port of the server-frontend `<reader>` component:

- Content: instructor-authored markdown/HTML (assignment `instructions`/content field), rendered with the same pipeline as instructions; supports embedded YouTube videos (log play/pause/seek events as the current reader does — verify exact event names in the frontend source and freeze them) and images.
- **Executable code blocks:** fenced code blocks marked runnable ("blockpy" blocks in the source) hydrate into the minified editor (§8.4) in place: editable, runnable, resettable, sharing the page engine. Non-runnable blocks render read-only with CM6 highlighting.
- **Reading-completion tracking:** the reader reports engagement (scroll-to-bottom / dwell time / video watched, per the legacy component's rules) and marks the reading correct via the same submission calls; navigation reflects it. Verify the exact completion rule in `frontend/components/reader.ts` and preserve it.
- **Subordinate quiz:** if the reading has an attached subordinate quiz assignment, render the full quizzer directly beneath the reading content (the legacy composition), with its own submission lifecycle; the reading and quiz report correctness independently. `asPreamble` mode (a reading rendered above another assignment, per the `<reader params="asPreamble: ...">` usage) is retained as a prop.

### 11.3 Quizzes — `@blockpy/quizzer`

Port of `<quizzer>`. The concrete question schema, attempt rules, and grading flags live in the server frontend source and server models; the rewrite freezes them as TypeScript types generated from real payload samples (conformance fixtures), rather than inventing a new schema.

1. **Question types** (per the legacy quizzer; verify complete list against `frontend/components/quizzes/`): multiple choice (single), multiple answers, true/false, short answer / fill-in-blank, multiple fill-in-blanks / multiple dropdowns, matching, numerical, essay/text, and code-typing questions.
2. **Pooling/randomization:** honor the legacy per-attempt question pools, shuffled choices, and seeds so attempts reproduce identically after reload.
3. **Attempt lifecycle:** states as in the legacy component (e.g., not-started → attempting → submitted/feedback-available, with attempt counts, attempt limits, and "practice" vs "graded" modes). Timer/countdown integrates with the navigation countdown span for timed quizzes.
4. **Feedback:** per-question correctness/partial credit and overall score display rules follow the legacy flags (immediate vs on-close feedback, hidden answers in secretive contexts).
5. **Persistence:** answers autosave through the same submission endpoints/payload structure the legacy quizzer uses (`save_assignment`/`update_submission` family with quiz JSON bodies — capture exact usage from the frontend `Server` model as fixtures).
6. **Pyodide preprocessing (§6.5):** questions may attach a preprocessing script; the quizzer runs it against the student's answer before submission and sends the processed payload; instructor grading scripts server-side thus receive normalized data. This formalizes and generalizes the existing "quizzes can use the execution engine" pathway.
7. **Instructor mode:** inline preview of correct answers and (out of v1 UI scope but schema-compatible) the separate quiz editor remains usable — the quizzer must not alter stored quiz JSON it doesn't understand.

### 11.4 Textbooks — `@blockpy/textbook`

Legacy `<textbook>` composes multiple readings/assignments into a chaptered page. v1 ports it as a thin composition over `reader` + `AssignmentHost` per the legacy component's layout (chapter nav sidebar). If timeline pressure hits, textbook may ship as a legacy-shim type like Kettle/Explain (§17) — decide at implementation kickoff; the type registry supports either.

---

## 12. Composition and Nesting Model

A single mechanism underlies all the nesting cases:

- `AssignmentSurface` = React context providing `{assignmentId, submissionApi, engine, logger, depth, variant}`.
- Any assignment component can host another with `variant: 'full' | 'embedded' | 'minified'`.
- Concrete required compositions (all exist today and must work): reading → minified editors (many); reading → quiz (subordinate, full-width); assignment → preamble reading (`asPreamble`); group page → any assignment type; standalone embed (LTI `embed=true`) → single assignment without navigation.
- Event logging and submission calls always attach to the _owning_ assignment id of the surface (nested editors in a reading log against the reading; the subordinate quiz logs against the quiz's own id) — matching current behavior.
- Depth guard: refuse nesting beyond depth 3 with a console warning (protects against authored content cycles).

---

## 13. LTI Embedding & Page Environment (`@blockpy/lti-embed`)

Preserve every observable behavior of the `editor.html` glue:

- **Frame resize:** when `display.embed`, post `{subject:"lti.frameResize", height: bodyHeight + 50}` (JSON-stringified) to `window.parent` with origin `*` (as today; tightening origin is a §17 opt-in), on load and via a `ResizeObserver` on `document.body` debounced 500 ms.
- **Cookie-blocked fallback:** on boot, detect cookie availability (legacy `frontend.checkCookies()`), set `window.ltiLoadedCorrectly`, log the console error verbatim in spirit, and perform the LTI platform-storage handshake (`lti.put_data` postMessages for state and nonce with generated UUIDs, listening for `lti.put_data.response` with message-id/origin validation) as currently written — including the current `'*'` platform-origin caveat, kept behind a constant so it can be corrected when platforms comply.
- **Loading screen:** show the loading notice (including the Safari warning and a retry link to the legacy `load_assignment` URL) until the app mounts; remove `.delete-on-load` content.
- **Emoji proxy:** configure the engine so emoji rendering resolves through `paths.emojiProxy` (legacy `Sk.emojiProxy` — reimplemented as an engine-level hook for output rendering).
- No use of cookies/localStorage beyond the legacy keys already documented; all auth rides on `access_token` and server session as today.

---

## 14. Legacy Server API Compatibility (`@blockpy/api`)

### 14.1 Contract

The client MUST interoperate with an **unmodified** blockpy-server. All endpoints, verbs, parameter names, payload shapes, and response handling are defined by current server routes and current client usage — the rewrite treats recorded request/response transcripts from the live legacy client as the normative fixtures ("golden transcripts", §16.2). `@blockpy/api` is a typed wrapper generated over those fixtures.

### 14.2 Endpoint inventory (from `window.$blockPyUrls` + `editor.html`)

| Key                                                                | Purpose (client-side usage to preserve)                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `loadAssignment`                                                   | Fetch assignment + submission payload (also the full-page retry link target) |
| `saveAssignment`                                                   | Persist instructor assignment edits / quiz answer bundles                    |
| `loadHistory`                                                      | Submission history for the History viewer                                    |
| `logEvent`                                                         | Event stream (§14.4)                                                         |
| `saveFile`                                                         | Persist a single (legacy-named) file for the submission or assignment        |
| `saveImage`                                                        | Persist rendered artifacts (plots, block screenshots)                        |
| `listUploadedFiles` / `uploadFile` / `renameFile` / `downloadFile` | Uploads layer management                                                     |
| `updateSubmission`                                                 | Score/correctness updates from autograding                                   |
| `updateSubmissionStatus`                                           | Lifecycle status transitions (started/submitted/etc.)                        |
| `forkAssignment`                                                   | Instructor fork action                                                       |
| `importDatasets`                                                   | CORGIS base URL                                                              |
| `instructionsAssignmentSetup`                                      | Help link for making problems                                                |
| `openaiProxy`                                                      | AI-help proxy                                                                |
| `shareUrl`                                                         | Share-link generation                                                        |
| `estimate_group_duration` (from editor.html, not the url map)      | Total-time clock (§9.4)                                                      |
| `load_assignment` page route                                       | Full-page navigation fallback and retry links                                |

Auth: every request carries the session cookie when available and the `access_token` field exactly where the legacy client puts it (form field / header — per transcript). Group context (`assignment_group_id`, `course_id`) accompanies calls as today.

### 14.3 Submission lifecycle calls

Preserve the current sequence and payloads for a successful grading pass: run completes → Pedal feedback → `updateSubmission` (score, correct, optional image) → on success `updateSubmissionStatus` → local `markCorrect` → navigation update → LTI grade passback happens server-side (no client change). Also preserve failure-path reporting (incorrect runs still update score where legacy does).

### 14.4 Event logging vocabulary

The legacy client logs a ProgSnap2-inspired event stream through `logEvent` (event types like `Session.Start`, `File.Edit`, `Run.Program`, `Compile.Error`, `Intervention`, `X-View.Change`, quiz/reading interaction events from the server frontend, etc.). Requirements:

- Extract the complete event-type × field vocabulary from both legacy codebases into a frozen `events.ts` enum with doc comments; this is a review gate deliverable (research pipelines depend on it).
- The rewrite emits the same events with the same field semantics for the same user actions. New behaviors (e.g., engine mode) use `X-`-prefixed extensions only.
- Batching/retry: match legacy timing where research relies on it (verify whether events batch today; default to per-event POST with an offline queue flushed on reconnect, flagged as `X-` behavior if it differs).

### 14.5 Payload compatibility for assignments

`loadAssignment` responses (and the inline `assignment_data` boot path via legacy `editor.loadAssignmentData_`) parse into the internal model through a versioned decoder. The decoder must accept every payload the current server emits for every assignment type — including fields the rewrite doesn't use — and must round-trip unknown fields on save (no data loss for forward compatibility with the legacy editor operating on the same records).

---

## 15. Legacy Global/Embedding API (`@blockpy/legacy-shim`)

Pages, course content, and research tooling touch BlockPy through globals. The shim preserves them:

### 15.1 `window.blockpy.BlockPy` constructor

A facade class accepting the current option bag — at minimum every key `editor.html` passes: `'blockly.path'`, `'attachment.point'`, `'urls'`, `'user.id'`, `'user.name'`, `'user.role'`, `'user.course_id'`, `'user.group_id'`, `'access_token'`, `'display.instructor'`, `'display.read_only'`, `'callback.success'`, plus arbitrary `settings-*`-derived keys — and mounting the React app accordingly. Public methods used in the wild and required: `loadAssignment(id)` (returns a thenable with `.done()` support — jQuery-Deferred-compatible wrapper), `loadAssignmentData_(payload)`, `hide()`, `show()`, `requestPasscode()`. `$MAIN_BLOCKPY_EDITOR` continues to point at the facade instance.

### 15.2 `settings-*` query parameters

Any query param `settings-<key>=<json>` overrides the corresponding config key, exactly as the Jinja loop does today (prefix stripped, value JSON-parsed). Applied last, over BootConfig.

### 15.3 Other globals

- `altAssignmentChangingFunction` — set by the app to `AssignmentHost.loadAssignment`; if a _page_ defines it first, navigation defers to it (legacy contract).
- `markCorrect(id)` — global alias to the navigation store action (older content calls it directly).
- `window.ACTIVITY_GET_DURATION` — promise-returning total-duration fetcher (clock, §9.4).
- `window.frontend` minimal surface: `checkCookies()`, `generateUUID()`, `Server` (constructor-compatible stub delegating to `@blockpy/api`) — enough that unmodified server templates keep working during migration.
- `URL_MAP`, `INDICES`, `FIRST_ID`, `LAST_ID`, `FULL_SELECTOR_DIV`, `loadNavigation()` — emitted by the shim when running against unmodified templates so any course-level scripts that poke them don't crash; documented as deprecated.

---

## 16. Quality, Testing, and Acceptance

### 16.1 Conformance suites

1. **VFS/legacy-name suite** — fixture table from §7.1 verification; parse/format round-trips; visibility matrices per role.
2. **Round-trip editing suite** — corpus of real student programs (existing BlockMirror test corpus) asserting text→blocks→text idempotence and error-mode handling.
3. **Engine suite** — curriculum regression corpus: representative `!on_run.py` graders from curriculum-ctvt/sneks executed against known student submissions must produce the same correctness verdicts as production (allowing documented message-text deltas).
4. **Navigation suite** — Playwright: button enable/disable at boundaries, subordinate filtering, secretive masking, expansion persistence, dual header sync, markCorrect visuals, clock tiers and mode toggling.
5. **Quiz suite** — fixture quizzes covering every question type, pooling reproducibility, attempt limits, preprocessing success/failure paths.

### 16.2 Golden transcripts

Record full HTTP traffic of the legacy client performing a scripted session (load group → navigate → edit → run → pass → quiz → reading) against a dev server; the rewrite replays the same script and its traffic must match modulo an approved-differences ledger. This is the primary G3 gate.

### 16.3 Non-functional acceptance

- **Performance:** first interactive editor ≤ legacy on a mid-tier laptop despite Pyodide (mitigations: engine lazy-loads after UI paint; wasm + packages cached via HTTP caching/service worker; readings/quizzes must be interactive before the engine finishes loading).
- **Memory:** one engine per page regardless of nested editor count; page with 10 minified editors stays under an agreed budget.
- **Accessibility:** WCAG 2.1 AA for navigation, quiz answering, and text editing; blocks canvas gets the Blockly keyboard-nav plugin (best-effort, documented gaps).
- **Browsers:** evergreen Chrome/Edge/Firefox/Safari; Safari must at minimum load and show a functional compat-mode engine (improving on the current "stop using Safari" notice where feasible; keep the notice for genuinely broken versions).
- **i18n:** all UI strings externalized; Blockly locale wiring preserved.

---

## 17. Migration Plan and Permitted Extensions

1. **Phase 0** — Freeze appendices: verified prefix table, event vocabulary, quiz schema fixtures, settings-key inventory, golden transcripts.
2. **Phase 1** — Ship `engine`, `vfs`, `editor` behind a per-course feature flag; server templates unchanged (`mountLegacy` path). Skulpt client remains default.
3. **Phase 2** — Ship `navigation` + `AssignmentHost` + `reader` + `quizzer`; the React app owns the whole `editor.html` body for flagged courses.
4. **Phase 3** — Default-on; legacy client kept installable for one semester; remove Jinja inline scripts in favor of the BootConfig JSON block.
5. **Permitted additive changes** (each behind a flag, never breaking G3): tightened postMessage origins; batched event logging; new `X-` events; new engine endpoints (e.g., wheel hosting) added to the server as pure additions.

---

## Appendix A — Traceability to source artifacts

- `editor.html` → §5.2 (boot), §5.3 (dispatch, per-type observables, `loadAssignmentWrapper` order), §9.4 (clock code), §13 (resize/cookie/LTI handshake, Safari notice, emoji proxy), §14.2 (URL map), §15 (globals, `settings-*` loop, passcode).
- `assignment_groups.html` → §9 in full (buttons, select classes, ✔ prefix, completion box expansion + localStorage key, secretive `??`, subordinate filtering, `URL_MAP` fallback navigation and loading message, `markCorrect` visuals).
- `blockpy` client README/src → §2, §6 (phases, trace), §7 (files), §8 (BlockMirror replacement), §10 (Pedal/CORGIS), §16.1.
- `blockpy-server/frontend` → §11.2–11.4 (reader/quizzer/textbook), §14.4 (frontend-originated events), §15.3 (`frontend.Server`, `checkCookies`, `generateUUID`).
