# BlockPy Studio — Development Plan

**Derived from:** [README.md](README.md) (spec draft)
**Last updated:** 2026-07-10
**Status:** Proposed

This plan turns the specification into an ordered set of engineering phases, milestones, and deliverables. Section references (§) point into the spec.

---

## 0. Guiding principles

1. **Legacy behavior is the requirement.** Where the spec says "verify against legacy," verification is a _blocking_ task that happens before the dependent implementation freezes (§7.1, §9.5, §11.2, §14.4). Phase 0 exists to burn down that list.
2. **Build bottom-up along the package graph** (§5.1): `engine` and `vfs` have no UI dependencies and unblock everything else; `api` fixtures unblock all persistence work; UI packages come last.
3. **Conformance suites are written alongside, not after.** Every milestone's exit criteria include its slice of §16.
4. **Ship behind flags, never big-bang** (§17). Each phase ends in a deployable state against an unmodified blockpy-server.

---

## 1. Phase 0 — Foundations & Legacy Freeze (no product code)

Goal: eliminate specification ambiguity and stand up the monorepo. Everything here is a prerequisite for freezing interfaces.

### 0.1 Repository & tooling

- [x] pnpm monorepo scaffold: `packages/{engine,vfs,editor,blocks,reader,quizzer,textbook,navigation,api,lti-embed,legacy-shim,app}` (§4).
- [x] Shared TypeScript ≥5 `strict` config, ESLint/Prettier, Vitest, Playwright, CI pipeline (lint → unit → e2e smoke).
- [x] Vite build targets: full app bundle, `blockpy-studio.iife.js` embeddable, per-package ESM (§4).
- [x] Dev harness: static page that mounts the app from a hand-written `BootConfig` (no server needed).

### 0.2 Legacy verification appendices (the §17 Phase-0 "freeze" deliverables)

Each produces a checked-in fixture/appendix that becomes a conformance-test input:

- [x] **A1 — Verified filename-prefix table** from legacy `src/files.js` + editor source, including magic names (`!sample_submissions.blockpy`, `!tags.blockpy`, `?toolbox.blockpy`, `?mock_urls.blockpy`, image/summary files) and the `&` vs `?` shadowing rule (§7.1, §7.2). → [docs/appendices/A1-filename-prefixes.md](docs/appendices/A1-filename-prefixes.md)
- [x] **A2 — Event vocabulary** (`events.ts`): complete event-type × field enum extracted from both legacy codebases, incl. reader video events and quiz interaction events; confirm whether events batch today (§14.4). _Review-gate deliverable — research pipelines depend on it._ → [docs/appendices/A2-event-vocabulary.md](docs/appendices/A2-event-vocabulary.md)
- [x] **A3 — Quiz schema fixtures**: real payload samples for every question type from `frontend/components/quizzes/`; generate frozen TS types from them (§11.3). → [docs/appendices/A3-quiz-schema.md](docs/appendices/A3-quiz-schema.md)
- [x] **A4 — Settings-key inventory**: every key read from `!assignment_settings.blockpy` and every `settings-*` query param (§11.1, §15.2). → [docs/appendices/A4-settings-inventory.md](docs/appendices/A4-settings-inventory.md)
- [x] **A5 — Golden transcripts**: record full HTTP traffic of a scripted legacy session (load group → navigate → edit → run → pass → quiz → reading) against a dev server (§16.2). _First transcript recorded via `tools/record-golden-transcript.mjs` (Playwright HAR, scrubbed): [docs/appendices/A5-golden-transcripts.md](docs/appendices/A5-golden-transcripts.md). Extend (passing grader run, authenticated + instructor sessions, history/uploads) before the Milestone 1.2 freeze._
- [x] **A6 — Instructions/markdown extension list** used by the legacy instructions renderer and reader (§11.1, §11.2). → [docs/appendices/A6-markdown-extensions.md](docs/appendices/A6-markdown-extensions.md)
- [x] **A7 — Behavioral notes**: passcode validation mechanism (local hash vs server, §11.1), end-of-group affordance (§9.5), run-artifact persistence rules (§7.5). → [docs/appendices/A7-behavioral-notes.md](docs/appendices/A7-behavioral-notes.md)

### 0.3 Technical spikes (de-risk before Phase 1)

- [x] **Spike S1 — Pyodide in LMS iframes**: _resolved by maintainer testing (2026-07-10)._ SharedArrayBuffer is confirmed unavailable in Canvas iframes, and iframe embedding is a hard requirement — so **compat mode (no SAB) is the engine's primary mode**, with SAB isolated mode as opportunistic enhancement. Load time is an accepted cost of Pyodide (managed via caching/lazy-load), not a go/no-go criterion. Residual work (tuning compat-mode interrupt latency, async input shim) folds into Milestone 1.3 step 4.
- [x] **Spike S2 — Lezer CST → Blockly workspace** (maintainer decision 2026-07-10: blocks are generated from CodeMirror's CST, not from CPython `ast` in the worker — overrides spec §8.2's preference order): **GO.** 78/79 of the BlockMirror round-trip corpus parses in agreement with CPython 3.11 (`ast.parse`); the sole gap is valueless `yield` (upstream-fixable). Comments are CST nodes; error nodes are precisely detectable for B3; ~35 ms for a 1,000-line file. Report: [docs/spikes/S2-lezer-cst-blocks.md](docs/spikes/S2-lezer-cst-blocks.md).
- [x] **Spike S3 — Pedal wheel running in Pyodide** with a real `!on_run.py` from curriculum-sneks (§10.1): **GO.** `pedal 3.0.1` + `curriculum-sneks` install and run unmodified on Pyodide 314 (Python 3.14); the real "Convert Pixels" grader from `courses/bakery_course.json` produces correct feedback for both incorrect and correct submissions in 10–20 ms. Key finding: the environment must call `start_trace()` before running student code (coverage tracer). Report: [docs/spikes/S3-pedal-pyodide.md](docs/spikes/S3-pedal-pyodide.md).

### 0.4 Verification findings & decision log (from the 2026-07-10 appendix pass)

The line-by-line verification invalidated several spec-draft assumptions. Summary in
[docs/appendices/README.md](docs/appendices/README.md); consequences for this plan:

**Plan adjustments (applied to the milestones below):**

- **`quiz.preprocess` is a new capability, not a port** — no legacy engine-preprocessing pathway exists (A3). Moved to a flagged §17-style additive extension.
- **Run artifacts are an extension, not parity** — legacy discards all program-written files; the `filewrite` hook is a stub (A1, A7). Per D3's decision note: run-written files surface in the UI **and persist to the backend as submission artifacts** (ledger LD-3x; ships flagged as a §17 additive extension).
- **Reading completion is trivial** — legacy marks the reading correct immediately on load; scroll/video telemetry is logging-only (A7).
- **Two markdown pipelines, no sanitization, no LaTeX in legacy** (A6) — per D4-A, the rewrite **replicates legacy: no sanitization** (spec §4/§11.1 "sanitized" language is superseded). Pipeline unification still needs checking against real course content (marked vs markdown-it differences, `breaks:true`).
- **Do not re-emit server-fabricated events** — `Session.Start` and (nearly all) `File.Edit` rows are fabricated server-side from `load_assignment`/`save_file`; the quizzer logs nothing (A2).
- **`BootConfig.settings` is `Record<string, string>`** — `settings-*` values are raw strings with per-key coercion, never JSON-parsed (A4). Applied to `packages/app/src/boot-config.ts`.

**Replicate-or-fix decisions — ALL DECIDED (maintainer, 2026-07-10)** in **[docs/DECISIONS.md](docs/DECISIONS.md)**: D1-B (seed shuffle), D2-B (fix logging bugs + central event-id registry with deprecation metadata), D3-A (enforce read-only; plus persist run artifacts to the submission), D4-A (replicate: no sanitization), D5-B (round-trip unknown keys), D6-A (replicate), D7-B (preserve, conditional). Fix outcomes seeded into **[docs/approved-differences.md](docs/approved-differences.md)** (LD-1 … LD-7). Original context table:

| # | Legacy behavior (cited in appendix) | Options |
| --- | --- | --- |
| D1 | Matching/dropdown option order shuffled with unseeded `Math.random` per render (A3) | Replicate, or seed it (fix) behind the ledger |
| D2 | `X-Editor.Paste` always logs `{characters: 0}`; event-queue `splice` bug wipes queue tail on retry (A2) | Replicate bug-for-bug vs fix as `X-` delta |
| D3 | Python/Markdown editors let students edit `&` read-only files; rename/manual-save paths dead (A1) | Enforce read-only uniformly (fix) vs replicate |
| D4 | No sanitization of instructions/reading HTML (A6) | Sanitize (spec G-goal, may break courses) — needs a course-content audit first |
| D5 | Legacy `saveAssignmentSettings` drops unregistered settings keys incl. server-only `time_limit`/`protected_ip_ranges` (A4) | Round-trip unknown keys (fix per §14.5 spirit) — recommended |
| D6 | `settings-*` params unrestricted for students (can flip instructor UI client-side) (A4) | Replicate (server-side security holds) vs gate cosmetically |
| D7 | Hidden pool questions' answers dropped on quiz save (A3) | Replicate vs preserve |

**Exit criteria — MET (2026-07-10):** appendices A1–A7 delivered (A5 first transcript recorded; extensions listed); all three spikes resolved (S1 by maintainer testing, S2 GO, S3 GO); D1–D7 decided and ledgered; CI green. **Phase 0 is complete — Phase 1 may begin.**

---

## 2. Phase 1 — Core Runtime: `engine`, `vfs`, `api`, `editor`, `blocks`

Goal: the spec's §17 Phase 1 — a working coding-problem editor behind a per-course flag, mounted via `mountLegacy()` on unchanged server templates.

### Milestone 1.1 — `@blockpy/vfs` (§7)

- [x] Layered FS storing by (space, basename) with the **role-dependent legacy search orders** from A1 §4a (student `? → & → plain → *`; instructor EVERYWHERE and `_instructor/` orders) — `packages/vfs/src/vfs.ts`.
- [x] `parse/format` adapter — the _only_ place prefixes live (§7.3); full eight-space set (`!^?&$*#` + unprefixed) harmonized per A1 §7.8, plus the verified magic-name registry — `packages/vfs/src/legacy-names.ts`.
- [x] Dirty tracking (by legacy name), change events, role-based visibility/mutability matrix (D3-A: `&` uniformly read-only for students, ledger LD-3) — `packages/vfs/src/permissions.ts`.
- [x] Persistence **mapping** (§7.4): per-file plan → `saveFile` individual / `#`-bundle / manual `saveAssignment` / uploads / never (A1 §4d), incl. bundle wire encode/decode and reset-to-start semantics.
- [ ] Persistence **transport**: debounced autosave through `@blockpy/api`, `autoSave`/`readOnly` gating, stale-version banner, uploads-layer endpoints, LD-3x artifact persistence — lands with Milestone 1.2 (needs the API client).
- [x] **Tests:** VFS/legacy-name conformance suite (§16.1.1) — 28 Node-runnable tests over search orders, visibility, deletion guards, bundles, persistence plans.

### Milestone 1.2 — `@blockpy/api` (§14)

- [x] Typed client for the core endpoint set (`loadAssignment`, `saveFile`, `saveAssignment`, `loadHistory`, `updateSubmission`, `updateSubmissionStatus`, `saveImage`, `logEvent`), validated against the golden transcript — `packages/api/src/client.ts`. Uploads endpoints (`listUploadedFiles`/`uploadFile`/`renameFile`/`downloadFile`), `forkAssignment`, `openaiProxy`, `shareUrl` pending the A5 transcript extensions.
- [x] Auth plumbing per A2 §1.1: `Authorization: Bearer` header only (access token never in the body); the eleven-field base context on every call; `version` = submission version (the frontend's assignment-version corruption is NOT reproduced) — `packages/api/src/context.ts`, `transport.ts`.
- [x] Versioned assignment/submission decoder round-tripping unknown fields (§14.5) + `mergeSettings` implementing D5-B/LD-5 — `packages/api/src/decoder.ts`.
- [x] **Central event-id registry with deprecation metadata** (D2): 25 live + 3 dead + 16 server-fabricated identifiers; `clientMayEmit` blocks server-fabricated/dead types and admits `X-` extensions; `X-Editor.Paste`/`X-IP.Change` carry "untrustworthy before Studio" annotations — `packages/api/src/events.ts`. Logger: per-event POST, legacy retry ladder (+2000 ms linear), 200-entry deduped offline queue with LIFO boot flush; LD-2b (single-entry dequeue) and LD-2c (working IP-change detection) fixed.
- [x] **Tests:** transcript replay harness (first cut of the §16.2 G3 gate) asserting field-set + value parity per endpoint against the recorded HAR, plus transport/queue/decoder suites — 18 tests.
- [x] VFS persistence transport: `Autosaver` binds `Vfs` change events → debounced `saveFile` (legacy 1000 ms `TIMER_DELAY`, bundle coalescing, `autoSave`/`readOnly` gating, immediate `answer.py` save on Run, `version_change` → stale-version banner callback) — `packages/vfs/src/autosaver.ts`, structurally typed so `vfs` keeps no dependency on `api`.

### Milestone 1.3 — `@blockpy/engine` (§6)

Build in this order:

1. [x] Protocol frozen (`EngineJob`/`EngineResult`/`TraceStep`/worker messages); `JobRunner` + `WorkerHost` (Node-testable message handling) + `worker.entry.ts` (browser Web Worker shell) + `EngineClient` with live stdout/stderr streaming per job — `packages/engine/src/{protocol,runner,runtime.py,worker-host,worker.entry,client,loopback}.ts`.
2. [x] Job model + queue with priorities and `on_change` debounce/coalesce (§6.3, E5): user jobs FIFO and preempt background; only the newest on_change survives — `packages/engine/src/queue.ts`.
3. [x] Per-job isolation (fresh `__main__` module, `sys.modules` snapshot/restore, FS staging under `/mnt/blockpy` with LD-3x artifact diff-back §7.5) — verified against real Pyodide in the Node suite. "Restart kernel" = `EngineClient.restartKernel()` (worker respawn + fresh interpreter, verified end-to-end).
4. [x] Compat mode PRIMARY (S1: SAB dead in Canvas): `interrupt()` on a running job = worker-termination hard stop with automatic respawn; `detectEngineMode` at boot; mode reported per (re)spawn via `onMode` (the `X-Engine.Mode` log source). _Deferred as isolated-mode enhancements: SAB interrupt buffer, synchronous interactive `input()`. Compat interactive input strategy: UI collects input and replays via `inputsPrefill` (M1.4 console)._
5. [x] Student-relative traceback mapping (`answer_prefix` lines subtracted, §6.3) and persistent REPL namespace (§6.4). Instructor phases execute; the Pedal environment contract (`set_source → start_trace → run → tifa → exec → resolve`, per Spike S3) is Milestone 1.5.
6. [x] Opt-in `sys.settrace` tracing (E3): compact per-line events with truncated-repr variable snapshots and student-relative lines, 10k-step storage cap — powers the Trace/State Explorer.
7. [x] Time limits (§6.2): client-side wall-clock watchdog (compat hard stop → `TimeoutError` result) + tracer step counter (`limits.traceSteps` → `TraceLimitError`); legacy `execLimit` maps to these.

- **Tests:** engine conformance suite headless in Node (§16.1.3 seed: a handful of curriculum graders from Spike S3).

### Milestone 1.4 — `@blockpy/blocks` + `@blockpy/editor` (§8)

- **Visual parity requirement (maintainer, 2026-07-10; spec B6):** the interface must be basically the same as the original BlockPy interface, **especially layout and color** — region arrangement (instructions pane, view toggles, run controls, console, feedback pane, file tabs) and the palette are conformance targets like any legacy behavior. Icons and fonts MAY change only if relatively similar, sensible, and the change improves usability/accessibility; propose such changes individually with rationale. Reference fixture: [docs/appendices/A8-ui-parity.md](docs/appendices/A8-ui-parity.md) (legacy layout + palette extraction).
- [x] CM6 setup: Python language, syntax lint (from the shared Lezer parse — same B1–B3 gate as block generation), autocomplete, Tab/Shift-Tab indent, Ctrl-Enter run, line-highlight API (`editor-error-line`/`editor-uncovered-line`/`editor-traced-line` classes per A8) — `packages/editor/src/dual/text-editor.ts`. _Merge view for history lands with the History chrome._
- [x] Parsing: the Lezer CST from `@codemirror/lang-python` drives both diagnostics and block generation (maintainer decision, see §0.3 S2) — `packages/blocks/src/cst/{parse,to-ast}.ts`. B3 "blockable" gate tolerates exactly the zero-width valueless-`yield` error node, closing the S2 known-gap (all 79 corpus programs parse). Engine-side CPython `ast` remains available to Pedal (§10.1) only.
- [x] Blockly block set + Python generator + CST→workspace builder — full port of BlockMirror's 44 `ast_*.js` modules (block defs + `forBlock` generators + IR→XML converters, quirk-for-quirk), the `text_to_blocks.js` orchestrator (comment/peer layout, chop-and-retry raw-block fallback), generator shims (4-space indent, `___` blank, case-SENSITIVE variable names re-implemented against Blockly 11 `Names` internals), and the legacy signature tables (builtins/methods/turtle/plt). Blockly pinned to 11.2.1 (legacy version). Blocks carry `line_number` attributes for §8.3 block↔line mapping; split-view sync wiring lands with the editor.
- [x] Three view modes with legacy semantics — `DualEditor` (`packages/editor/src/dual/dual-editor.ts`) is the full BlockMirror port: mode tables (block 100%/split 60-40/text 100%), 675px responsive stacking, quiet-set sync loop, `outOfDate_` deferral, read-only overlay, change-listener contract. **B3 note (verified against legacy):** legacy has NO mode lockout — unparseable text degrades to `ast_Raw` blocks via the chop-and-retry loop, which the orchestrator ports exactly; "no blocks from a recovered tree" is enforced inside the converter. React wrapper `DualEditorView`; live in the dev harness (Playwright-verified: blocks render, text→blocks sync, mode toggle). _Chrome toolbar (fa-th-large/fa-columns/fa-align-left toggle buttons per A8) lands with the editor chrome._
- [ ] Instructor-configurable toolbox from legacy settings keys (B4, fixture A4) — presets fully ported (`packages/editor/src/dual/toolboxes.ts`: normal/ct/ct2/minimal/full/empty + `getFunctionBlock`); pending: the `toolbox` settings-key subscription and `custom` = `?toolbox.blockpy` wiring.
- [~] Editor chrome — **first slice landed** (`packages/editor/src/chrome/` + `styles/`): A8 §1 row structure with legacy class hooks (`.blockpy-content` parchment frame, header + instructions, console, feedback, python toolbar, blockmirror mount), instructions pane on `marked` with `breaks:true` + `target=_blank` post-process (A6 §1; D4-A **no sanitization** — test-pinned), Run/Stop button with the A8 §4.1 state classes (incl. wiring the legacy-dead `blockpy-run-error`, A8 §5.2), Reset, view-toggle radios (fa-th-large/fa-columns/fa-align-left), feedback pane with the full Pedal category→`label-*` badge mapping (A8 §4.5), console streaming via the engine-agnostic `RunController` interface, zustand chrome store. CSS: `styles/tokens.css` (A8 §2.2 normative values), `styles/blockpy.css` (blockpy.css + bootstrap_retheme + BlockMirror rules, CM5 selectors twinned for CM6), `styles/bootstrap-subset.css` (pinned BS 4.6 defaults — resolves A8 §5.1). Live in the dev harness; 4 Playwright + 9 chrome component tests. _Engine adapter landed_ (`packages/app/src/engine-adapter.ts`): Run executes `student.run` jobs through `EngineClient` (module-worker via Vite; lazy first-Run boot per R7/§16.3; Stop = compat-mode hard interrupt; errors map to syntax/runtime feedback categories with student-relative lines §6.3). Verified in-browser: gated `PYODIDE_E2E=1` Playwright test does a real Pyodide run (CDN v314.0.2) — prints output, "No errors" feedback, run-state round trip. Icons modernized to Lucide with per-glyph rationale (`chrome/icons.tsx`, B6). _Pedal `on_run` through the worker landed:_ additive protocol extension (`EngineJob.pedal` request → `EngineResult.feedback`), lazy wheel install inside `JobRunner` (fail-soft per §10.1), adapter chains a grading job after each clean student run and maps resolved feedback onto the pane categories. Verified: `PEDAL_IT=1` Node integration (correct→complete, incorrect→gentle, same-interpreter student runs) and `PYODIDE_E2E=1` browser round trip (run → output → **Complete** badge → wrong answer → instructor hint). This is the client half of the §14.3 final-feedback ordering; the `updateSubmission`/`markCorrect` calls attach in M1.6 when the API client joins the app. _File tabs + toolbox wiring landed:_ `chrome/FileTabs.tsx` renders the A8 Row-3 strip from the VFS (legacy instructor tab order with empty starred tabs hidden; `&` files carry `uneditable` and open read-only in forced text mode — D3-A/LD-3, browser-verified); `CodingEditor` takes `vfs`/`role`, edits write back through the VFS (feeding the M1.1 Autosaver when the API client attaches), Run always executes `answer.py`, Reset restores from `^starting_code.py` (§7.4), and `resolveToolboxSetting` maps the A4 `toolbox` key incl. `custom` = `?toolbox.blockpy` JSON with the legacy fall-back-to-`empty`, live-reloading via `remakeToolbox`. _Evaluate/REPL + Trace explorer landed:_ console Evaluate follows the full legacy lifecycle (run success → `beginEval` button pinned inside the printer → inline "Evaluate:" input line → frozen disabled-input echo, re-armed per evaluation; `hide_evaluate` gates it) running `student.eval` jobs against the persistent §6.4 namespace; runs collect the E3 trace (`trace: true`), the feedback pane's View-Trace eye swaps in `chrome/TraceExplorer.tsx` (A8 TRACE_HTML markup: step controls, `n / m`, line indicator, Name/Type/Value table — Type derived from reprs since the compact trace stores reprs only), and stepping drives the `editor-traced-line` highlight. Browser-verified under `PYODIDE_E2E=1` (trace stepping + `a + 41` REPL round trip). _Quick-menu internals + footer + passcode + hljs landed:_ `chrome/QuickMenu.tsx` ports the interface.js:117-193 region (mark-submitted text/click ladder incl. `dirtySubmission` tracking, view-as-instructor checkbox, browser fullscreen with legacy alert-on-error, EDIT_INPUTS dialog → store `queuedInputs`/`clearInputs` → `RunOptions.inputs` → engine `inputsPrefill` (the M1.3.4 compat stdin strategy, browser-verified end-to-end), Toggle Images store flag, share button gated like `canShare`, the dead pink bug icon kept dead, `has_clock` wall clock with the A4 §6 inversion note and the legacy `hours%12` → "0:30pm" quirk); `chrome/Footer.tsx` is FOOTER_HTML (8 `server-status-*` badges driven by new store `serverStatus`, message line, identity line, instructor force-load input); `chrome/Dialog.tsx` ports DIALOG_HTML (modal subset pinned into bootstrap-subset.css); `requestPasscode()` replicates the blocking prompt + store passcode awaiting the M1.6 API context; instructions (400 ms debounce) + feedback code blocks highlight via bundled highlight.js — dead code in legacy (no template loads hljs), made real as **ledger LD-10**. 30 chrome component tests + smoke coverage. _Dev console + system-message routing landed (NEW REQUIREMENT, maintainer 2026-07-10 — a Studio extension with no legacy analog):_ engine/system messages ("Loading Python engine…", grader lifecycle) and instructor-code output (Pedal `on_run` stdout/stderr) never touch the student console — they surface in the footer status area (`onExecution` badge + message line, via the new `RunHandlers.system` channel) and in `chrome/DevConsole.tsx`, a secondary dark terminal-style console available only in instructor view (`display.instructor`, driven by the quick-menu "View as instructor" toggle; wired in the dev harness for debugging). The dev console shares the console slot: a header toggle swaps between the two, each side badging the count of entries the hidden console received (`consoleUnseen`/`devUnseen`). This subsumes the legacy quick-menu "instructor stdout" dialog. _Deferred within quick-menu: owner/readonly spying controls, pool seed input (M2); mark-submitted/share/force-load wiring attaches with the M1.6 API client._ _Pending: History diffs + merge view, "Add New" file menu + uploads, minified variant._
- [ ] Minified editor variant (§8.4) — build now, consumed by `reader` in Phase 2.
- [x] **Tests:** round-trip suite over the BlockMirror corpus (§16.1.2) — **79/79 exact-text fixed points (double trip)**, headless (jsdom + Blockly headless workspace). Corpus fixture extracted by `tools/extract-blockmirror-corpus.mjs`. Two corpus entries conflict with actual legacy behavior (legacy's own runner masked failures via silent `console.assert`+`break`): #42 multi-dim subscripts now round-trip losslessly (ledger LD-8), #73 bare hidden `plt` import keeps legacy suppression (ledger LD-9, pinned as known-delta in the suite). Plus 34 CST→IR unit tests and a pipeline smoke suite; 214 tests green workspace-wide.

### Milestone 1.5 — Integrations needed for parity (§10)

- [x] **Pedal environment implemented** (`packages/engine/src/pedal{,-env.py}.ts`): the S3 pipeline (`clear → stage → set_source → queue_input → start_trace → run → tifa → exec(on_run) → resolve`) with the legacy `_instructor` package contract (instructor `!`/`?`/`&` .py files importable, files staged prefix-stripped — A1 §3) and fail-soft `system_error` feedback on grader/Pedal crashes. **Corpus regression: 213/213 bakery graders execute (194 clean, 19 categorized fail-softs — see appendix)** via `tools/run-grader-corpus.mjs`; integration tests gated behind `PEDAL_IT=1` (network). §6.7 appendix started: [docs/appendices/skulpt-compat.md](docs/appendices/skulpt-compat.md).
- [ ] Wheels bundled with the deployment (currently PyPI via micropip): `pedal`, `curriculum-sneks`, `bakery` resolve; **`curriculum-ctvt` is not on PyPI** — needs a bundled wheel, as do `bakery_canvas` and the legacy `utility` module (compat appendix table).
- [ ] Final-feedback → `updateSubmission`/`markCorrect` ordering (§14.3) — editor wiring, lands with M1.4/M1.6; verify legacy score derivation first (S3 open item).
- matplotlib Agg capture → `image` events → console rendering + `saveImage`; Pedal plot-inspection shim (§10.2).
- CORGIS dataset import into uploads layer + engine mount; `?mock_urls.blockpy` shims (§10.4).
- OpenAI proxy pass-through (§10.5).
- Skulpt-compat appendix started (§6.7) — living document updated as deltas surface.

### Milestone 1.6 — Boot & shim (enough to deploy)

- `BlockPyStudio.mount()` + `mountLegacy()` assembling `BootConfig` from old globals (§5.2).
- `legacy-shim` minimum: `window.blockpy.BlockPy` facade with jQuery-Deferred-compatible `loadAssignment`, `$MAIN_BLOCKPY_EDITOR`, `settings-*` param loop (§15.1–15.2).
- Deploy behind per-course flag; Skulpt client stays default.

**Exit criteria:** flagged course completes edit → run → Pedal feedback → grade passback on an unmodified server; engine suite passes curriculum regression corpus; golden-transcript replay matches for the coding-problem slice; Drafter deferred to 1.x follow-up (§10.3) if timeline requires — it is not on the Phase-1 gate.

---

## 3. Phase 2 — Full Page Ownership: `navigation`, `AssignmentHost`, `reader`, `quizzer`

Goal: the React app owns the whole `editor.html` body for flagged courses (§17 Phase 2).

### Milestone 2.1 — `AssignmentHost` + routing (§5.3)

- Type dispatch in legacy priority order (quiz → reading → textbook → java → kettle → explain → blockpy); unknown ids fall through to the editor; per-type unmount/remount semantics preserved.
- Java tombstone message.
- `loadAssignment(id)` exposed and aliased to `altAssignmentChangingFunction` (§15.3).
- URL contract: `history.replaceState` param updates, deep links, full-page fallback via URL map (§5.3, §9.3).

### Milestone 2.2 — `@blockpy/navigation` (§9)

- Dual-rendered header/footer from one store; exact legacy layout, button semantics, `✔` prefixes, CSS class hooks (§9.1, §9.6).
- Completion box + selector expansion with exact localStorage key; secretive `??` masking (§9.1, §9.3).
- `markCorrect` store action + global alias; Next success styling (A7: turns green on _any_ markCorrect, not just current); end-of-group = green-but-disabled Next + full count, no congratulations message (A7).
- Time-spent clock (tiers, 10s tick, mode toggle via `estimate_group_duration`) and countdown span — A7: the frontend owns the countdown (5 s tick, `"X elapsed; Y left"`, per-student limit overrides, "Time is up!" overlay) (§9.4).
- **Tests:** Playwright navigation suite (§16.1.4).

### Milestone 2.3 — `@blockpy/reader` (§11.2)

- Markdown/HTML pipeline: legacy uses markdown-it here vs marked for instructions (A6) — unify carefully; D4-A: **no sanitization** (legacy parity); keep the `download_file` link/image rewrite; YouTube + scroll telemetry per A2 (logging only).
- Runnable code blocks hydrating minified editors sharing the page engine (A7: runnable = python fence with non-empty info-string part id; save/submit endpoints stripped); events attach to the reading id (§12).
- Completion rule per A7: mark correct immediately on load when a submission exists; subordinate quiz composition; `asPreamble` prop.

### Milestone 2.4 — `@blockpy/quizzer` (§11.3)

- All question types from A3 fixtures (10 rendered + `calculated_question`/`file_upload_question` as pass-through); pool membership seeded by submission id; option shuffle seeded with the same seed (D1-B, ledger LD-1); attempt lifecycle incl. `mulligans`; timed-quiz countdown via the generic `time_limit` mechanism (A3/A7).
- Feedback display flags (`feedbackType`, secretive hiding) and the server-written `summary` block; autosave via `save_file` of the answer JSON, grading via server-side `process_quiz` (A3).
- Pyodide preprocessing with fail-soft `preprocessing_error` — **new additive capability, ships flagged** (§6.5, §17; A3 finding).
- Unknown quiz JSON passes through untouched (instructor-editor compatibility); hidden-pool answers preserved via merge (D7-B, ledger LD-7 — conditional on the server tolerating extra answer keys, verify in these fixtures).
- **Tests:** quiz suite (§16.1.5).

### Milestone 2.5 — Composition, LTI, legacy islands

- `AssignmentSurface` context, variants, owning-assignment event attribution, depth-3 guard (§12).
- `@blockpy/lti-embed`: frame resize, cookie fallback + platform-storage handshake, loading screen with Safari notice, emoji proxy hook (§13).
- `legacy-shim` completes: `window.frontend` stub (`checkCookies`, `generateUUID`, `Server`), `URL_MAP`/`INDICES`/etc. exports (§15.3); Kettle/Explain load the old frontend bundle in a sandboxed Knockout island (§17).
- **Textbook decision point:** port as thin `reader` composition (§11.4) _or_ ship as legacy-shim island — decide at 2.5 kickoff based on remaining runway.

**Exit criteria:** golden-transcript replay passes for the full scripted session (the primary G3 gate); navigation + quiz Playwright suites green; a flagged course runs a mixed group (coding + reading + quiz) end-to-end in an LMS iframe.

---

## 4. Phase 3 — Hardening & Default-On

- **Non-functional acceptance (§16.3):** engine lazy-load after UI paint, wasm/package caching, 10-minified-editor memory budget, WCAG 2.1 AA on navigation/quiz/text editing, Blockly keyboard-nav plugin, Safari compat-mode verification, i18n externalization + Blockly locale wiring.
- Finish the Skulpt-compat instructor appendix (§6.7).
- Default-on rollout; legacy client installable for one semester; server templates shrink to BootConfig JSON block (§17 Phase 3).
- Permitted flagged extensions as capacity allows (§17.5): tightened postMessage origins, batched logging, `X-` events, wheel hosting.

---

## 5. Cross-cutting workstreams (run through all phases)

| Workstream                          | Cadence                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| Golden-transcript replay in CI      | From Milestone 1.2 onward, on every PR touching `api`/lifecycle code |
| Approved-differences ledger (§16.2) | Reviewed at each milestone exit                                      |
| Skulpt-compat appendix (§6.7)       | Updated whenever an engine delta is found                            |
| Performance budget tracking (§16.3) | Dashboard from Milestone 1.3; regression alerts                      |
| Accessibility review                | Component-level checks at each UI milestone; full audit in Phase 3   |

---

## 6. Risk register

| #   | Risk                                                                        | Impact                                         | Mitigation                                                                                                  |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| R1  | ~~Pyodide unusable in LMS iframes without COOP/COEP~~ RESOLVED: SAB confirmed dead in Canvas; compat mode is primary | Interrupt latency / async-input UX in compat mode | Compat-path-first engine design (M1.3); worker-termination hard stop as floor; SAB as enhancement |
| R2  | Pedal/TIFA behavior differs on CPython vs Skulpt, breaking existing graders | Curriculum regressions at scale                | Engine regression corpus (§16.1.3) early; shim in the Pedal integration layer, never the engine core (§6.7) |
| R3  | Prefix/visibility semantics mis-transcribed from `files.js`                 | Silent data corruption on the wire             | A1 is a blocking Phase-0 gate; adapter is a single module with a conformance fixture suite                  |
| R4  | Lezer CST diverges from CPython grammar (error tolerance, edge constructs), so blocks disagree with what actually runs | Blocks mode unusable or misleading for courses | Spike S2 corpus validation; round-trip suite (§16.1.2); tests cross-check Lezer parse success against CPython `ast` verdicts |
| R5  | Event vocabulary drift breaks research pipelines                            | Loss of research data continuity               | A2 review gate; only `X-` extensions allowed (§14.4)                                                        |
| R6  | Quiz schema richer than sampled fixtures                                    | Data loss on quiz save                         | Round-trip-unknown-fields rule (§11.3.7, §14.5); widen A3 sampling across production courses                |
| R7  | Pyodide first-load latency hurts readings/quizzes                           | Bad first impression on non-coding assignments | Readings/quizzes interactive before engine loads (§16.3); lazy engine boot                                  |
| R8  | Textbook port slips                                                         | Phase 2 delay                                  | Pre-approved fallback: legacy-shim island (§11.4)                                                           |

---

## 7. Suggested build order (dependency-driven)

```
Phase 0:  scaffold ──► A1..A7 appendices ──► spikes S1..S3
Phase 1:  vfs ──► api ──┐
          engine ───────┼──► editor+blocks ──► integrations ──► mountLegacy (flagged ship)
Phase 2:  AssignmentHost ──► navigation ──► reader ──► quizzer ──► lti-embed/shim/islands (flagged ship)
Phase 3:  hardening ──► default-on
```

`vfs`, `api`, and `engine` milestones can proceed in parallel once Phase 0 lands; `editor` needs all three. Within Phase 2, `reader` depends on the minified editor (built in 1.4) and `quizzer` depends on the engine's `quiz.preprocess` phase (built in 1.3).

---

## 8. Definition of done (project-level)

1. All five conformance suites (§16.1) green in CI.
2. Golden-transcript replay matches modulo the approved-differences ledger (§16.2 / G3).
3. Non-functional acceptance criteria met (§16.3).
4. Frozen appendices published: prefix table, event vocabulary, quiz schema, settings inventory, Skulpt-compat deltas.
5. At least one full semester course runs default-on with the legacy client available as fallback.
