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

- [ ] **A1 — Verified filename-prefix table** from legacy `src/files.js` + editor source, including magic names (`!sample_submissions.blockpy`, `!tags.blockpy`, `?toolbox.blockpy`, `?mock_urls.blockpy`, image/summary files) and the `&` vs `?` shadowing rule (§7.1, §7.2).
- [ ] **A2 — Event vocabulary** (`events.ts`): complete event-type × field enum extracted from both legacy codebases, incl. reader video events and quiz interaction events; confirm whether events batch today (§14.4). _Review-gate deliverable — research pipelines depend on it._
- [ ] **A3 — Quiz schema fixtures**: real payload samples for every question type from `frontend/components/quizzes/`; generate frozen TS types from them (§11.3).
- [ ] **A4 — Settings-key inventory**: every key read from `!assignment_settings.blockpy` and every `settings-*` query param (§11.1, §15.2).
- [ ] **A5 — Golden transcripts**: record full HTTP traffic of a scripted legacy session (load group → navigate → edit → run → pass → quiz → reading) against a dev server (§16.2). Tooling: proxy recorder + replay harness.
- [ ] **A6 — Instructions/markdown extension list** used by the legacy instructions renderer and reader (§11.1, §11.2).
- [ ] **A7 — Behavioral notes**: passcode validation mechanism (local hash vs server, §11.1), end-of-group affordance (§9.5), run-artifact persistence rules (§7.5).

### 0.3 Technical spikes (de-risk before Phase 1)

- [ ] **Spike S1 — Pyodide in LMS iframes**: measure load time, verify compat-mode (no SAB) interrupt/input strategies actually work inside Canvas/Moodle iframes (§6.6). _Highest-risk item in the project; do first._
- [ ] **Spike S2 — CPython `ast` → JSON → Blockly workspace** round-trip on 10 representative student programs (§8.2–8.3).
- [ ] **Spike S3 — Pedal wheel running in Pyodide** with a real `!on_run.py` from curriculum-sneks (§10.1).

**Exit criteria:** appendices A1–A7 merged and reviewed; spikes written up with go/no-go notes; CI green on the empty monorepo.

---

## 2. Phase 1 — Core Runtime: `engine`, `vfs`, `api`, `editor`, `blocks`

Goal: the spec's §17 Phase 1 — a working coding-problem editor behind a per-course flag, mounted via `mountLegacy()` on unchanged server templates.

### Milestone 1.1 — `@blockpy/vfs` (§7)

- Layered overlay FS (transient / submission / uploads / assignment / system), top-down `resolve`.
- `LegacyName.parse/format` adapter — the _only_ place prefixes live (§7.3); driven by fixture A1.
- Per-layer dirty tracking, change events, role-based visibility matrix.
- Persistence adapter mapping layer × file → legacy endpoint + legacy filename (§7.4), incl. `answer.py` debounce-autosave and stale-version banner semantics.
- **Tests:** VFS/legacy-name conformance suite (§16.1.1) — runnable in Node.

### Milestone 1.2 — `@blockpy/api` (§14)

- Typed client for the full §14.2 endpoint inventory, generated/validated against golden transcripts (A5).
- Auth plumbing: session cookie + `access_token` placement per transcript; group context on every call.
- Versioned assignment decoder that round-trips unknown fields losslessly (§14.5).
- Event logger implementing A2 vocabulary; per-event POST + offline queue (flag any timing delta as `X-`, §14.4).
- **Tests:** transcript replay harness (first cut of the §16.2 G3 gate).

### Milestone 1.3 — `@blockpy/engine` (§6)

Build in this order:

1. Worker + one Pyodide instance; `EngineClient` postMessage protocol; stdout/stderr streaming.
2. Job model + FIFO queue with priorities and `on_change` debounce/coalesce (§6.3, E5).
3. Per-job isolation (`__main__` reset, `sys.modules` snapshot, FS staging from VFS snapshots §7.5) + "restart kernel" nuclear reset.
4. Dual interrupt/input paths: SAB isolated mode and compat mode with worker-termination hard stop; boot-time detection + `X-Engine.Mode` event (§6.2, §6.6 — informed by Spike S1).
5. Instructor phases (`on_run`/`on_change`/`on_eval`), student-relative traceback line mapping (§6.3), persistent REPL namespace (§6.4).
6. Opt-in `sys.settrace` tracing streamed as compact events (E3).
7. Time limits: JS watchdog + trace instruction counter; `execLimit` mapping (§6.2).

- **Tests:** engine conformance suite headless in Node (§16.1.3 seed: a handful of curriculum graders from Spike S3).

### Milestone 1.4 — `@blockpy/blocks` + `@blockpy/editor` (§8)

- CM6 setup: Python language, lint (Lezer squiggles only), autocomplete, merge view for history.
- Parse service: in-worker CPython `ast` → JSON AST with LRU + parser-availability during long runs (§8.2).
- Blockly block set + Python generator + AST→workspace builder; block↔line mapping for split-view sync and trace highlight (§8.3).
- Three view modes with legacy toggle semantics; unparseable-text lockout of Blocks/Split (B1–B3).
- Instructor-configurable toolbox from legacy settings keys (B4, fixture A4).
- Editor chrome: instructions pane (A6 pipeline), Run/Stop/Evaluate/console, Trace explorer, History diffs, reset-to-`^`, file tabs per role, feedback pane with Pedal categories, passcode lock (§11.1 checklist — each item is a test target).
- Minified editor variant (§8.4) — build now, consumed by `reader` in Phase 2.
- **Tests:** round-trip suite over the BlockMirror corpus (§16.1.2).

### Milestone 1.5 — Integrations needed for parity (§10)

- Pedal wheels (`pedal`, `curriculum-ctvt`, `curriculum-sneks`) bundled; blockpy-environment contract implemented; final-feedback object → feedback pane → `updateSubmission`/`markCorrect` ordering (§10.1, §14.3).
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
- `markCorrect` store action + global alias; Next success styling; end-of-group affordance per A7.
- Time-spent clock (tiers, 10s tick, mode toggle via `estimate_group_duration`) and countdown span (§9.4).
- **Tests:** Playwright navigation suite (§16.1.4).

### Milestone 2.3 — `@blockpy/reader` (§11.2)

- Markdown/HTML pipeline shared with instructions; YouTube event logging per A2.
- Runnable code blocks hydrating minified editors sharing the page engine; events attach to the reading id (§12).
- Completion rule per legacy component (verified in A7 follow-up); subordinate quiz composition; `asPreamble` prop.

### Milestone 2.4 — `@blockpy/quizzer` (§11.3)

- All question types from A3 fixtures; pooling/shuffle/seed reproducibility; attempt lifecycle + timed-quiz countdown integration.
- Feedback display flags (immediate vs on-close, secretive hiding); autosave via legacy payload shapes.
- Pyodide preprocessing with fail-soft `preprocessing_error` (§6.5, §11.3.6).
- Unknown quiz JSON passes through untouched (instructor-editor compatibility).
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
| R1  | Pyodide unusable/slow in LMS iframes without COOP/COEP                      | Core value prop fails                          | Spike S1 first; compat mode is a hard requirement (§6.6); worker-termination hard stop as floor             |
| R2  | Pedal/TIFA behavior differs on CPython vs Skulpt, breaking existing graders | Curriculum regressions at scale                | Engine regression corpus (§16.1.3) early; shim in the Pedal integration layer, never the engine core (§6.7) |
| R3  | Prefix/visibility semantics mis-transcribed from `files.js`                 | Silent data corruption on the wire             | A1 is a blocking Phase-0 gate; adapter is a single module with a conformance fixture suite                  |
| R4  | Text→blocks round-trip diverges from BlockMirror on real student code       | Blocks mode unusable for courses               | Spike S2 + BlockMirror corpus suite (§16.1.2) before editor freeze                                          |
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
