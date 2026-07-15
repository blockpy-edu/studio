# Replicate-or-Fix Decisions (D1–D7)

Legacy behaviors uncovered during Phase 0.2 verification (see
[appendices](appendices/README.md)) where the rewrite must either **replicate**
the legacy behavior bug-for-bug or **fix** it as an approved difference. Every
"fix" outcome gets an entry in the approved-differences ledger (spec §16.2) so
the golden-transcript gate and conformance suites know about it.

**Status: all seven decided (maintainer, 2026-07-10).** Fix outcomes are
recorded in the [approved-differences ledger](approved-differences.md).

| #   | Topic                                          | Recommendation        | Decision                                          |
| --- | ---------------------------------------------- | --------------------- | ------------------------------------------------- |
| D1  | Unseeded quiz option shuffle                   | B (fix: seed it)      | **B - seed it**                                   |
| D2  | Event-logging bugs (paste size, retry queue)   | B (fix, keep names)   | **B - fix** + central id registry w/ deprecation  |
| D3  | Read-only `&` files editable in some editors   | A (enforce read-only) | **A - enforce** + persist run artifacts (backend) |
| D4  | No HTML sanitization of instructions/readings  | C (audit first)       | **A - replicate (no sanitization)**               |
| D5  | Settings save destroys unregistered keys       | B (round-trip keys)   | **B - round-trip unknown keys**                   |
| D6  | `settings-*` URL params unrestricted           | A (replicate)         | **A - replicate**                                 |
| D7  | Hidden pool questions' answers dropped on save | B (preserve)          | **B - preserve** (pending server-tolerance check) |

---

## D1 - Quiz matching/dropdown option order is unseeded

**Legacy behavior** (A3 - [quiz schema](appendices/A3-quiz-schema.md)): question
_pool membership_ is seeded by submission id (± attempt count), so which
questions appear reproduces identically after reload. But the option order of
matching and multiple-dropdown questions is shuffled with **unseeded
`Math.random` on every render** - reload the page and the choices reorder.
The spec draft (§11.3.2) wrongly assumed full reproducibility.

**Why it matters:** students who note "my answer was the third option" lose
that anchor on reload; researchers can't reconstruct what a student saw;
support/debugging is harder. Replicating requires deliberately writing
nondeterministic code.

**Options:**

- **A - Replicate:** keep unseeded shuffle per render. Byte-faithful, no ledger
  entry, preserves the (accidental) anti-memorization property across
  attempts _and_ reloads.
- **B - Fix:** seed the option shuffle with the same submission-id seed used
  for pooling, so one attempt always renders the same order (reloads stable;
  new attempts still reshuffle). Ledger entry; invisible to the server.

**Recommendation: B.** Stable within an attempt is what students and
researchers would expect; the wire format is untouched.

**Decision:** B
**By / date:**
**Notes:**

---

## D2 - Event-logging client bugs

**Legacy behavior** (A2 - [event vocabulary](appendices/A2-event-vocabulary.md)):

1. `X-Editor.Paste` always logs `{characters: 0}` - a shadowed constant means
   the pasted-size is never recorded (legacy `python.js:239-241`).
2. The offline retry queue's `_dequeueData` calls one-argument
   `splice(index)`, which deletes the entry **and the whole queue tail**
   (`server.js:271`) - queued offline events beyond the first are silently
   destroyed.
3. `_postRetry` passes a string into `checkIP`, effectively disabling
   `X-IP.Change` detection on the retry path (`server.js:295`).

**Why it matters:** research pipelines consume this stream. Replicating means
knowingly logging wrong data; fixing means post-rewrite data has properties
(paste sizes, complete offline queues) the legacy data lacks - a discontinuity
researchers must know about.

**Options:**

- **A - Replicate bug-for-bug:** identical data quality before/after rewrite;
  simplest comparability story.
- **B - Fix, same event names/fields:** correct paste sizes, a working retry
  queue, working IP-change detection. Ledger entries + a note in the research
  documentation ("fields trustworthy from version X"). Spec §14.4 allows
  behavior deltas flagged as `X-` where they alter timing/semantics.
- **C - Fix and rename** (`X-`-prefixed variants for changed semantics, e.g.
  the paste event): maximally explicit for researchers, slightly noisier
  vocabulary.

**Recommendation: B.** These are data-loss bugs, not semantics anyone relies
on; document the version boundary. (If you expect anyone to compare paste-size
distributions across the boundary, C for the paste event only.)

**Decision:** B
**By / date:**
**Notes:** Centralize all of the identifiers into one place along with a system for deprecating old ones (e.g. "X-Editor.Paste is untrustworthy after version X, use X-Editor.PasteV2 instead") so the research team can track them clearly in the docs and codebase.

---

## D3 - `&` (read-only space) files editable in some editors

**Legacy behavior** (A1 - [filename prefixes](appendices/A1-filename-prefixes.md)):
`&`-prefixed files are instructor-authored, student-visible, and documented
read-only (`files.js:184, 406-409`) - but the read-only flag is enforced only
by the Text/JSON/Quiz/Toolbox editors. The **Python and Markdown editors let
students edit `&` files**, and the rename/manual-save paths for them are dead
or broken code, so edits generally don't persist anywhere meaningful.

**Why it matters:** students can locally mutate files instructors intended as
fixed reference material, then be confused when edits vanish (or worse,
locally affect a run). Consistency between editors is a correctness property
of the new VFS permission matrix.

**Options:**

- **A - Enforce read-only uniformly** across all editors, matching the
  documented intent and the majority of editors. Ledger entry (a student who
  used to type into an `&` python file no longer can).
- **B - Replicate the inconsistency:** faithful, but requires deliberately
  building per-editor permission exceptions into the clean VFS design.

**Recommendation: A.** The legacy behavior is an enforcement gap, not a
feature; edits don't persist anyway, so nothing observable on the wire changes.

**Decision:** A
**By / date:**
**Notes:** Read-only files should be read-only. That said, generated and modified files should become persisted artifacts of the students' submission and stored in the backend.

---

## D4 - No sanitization of instructions/reading HTML

**Legacy behavior** (A6 - [markdown extensions](appendices/A6-markdown-extensions.md)):
neither renderer sanitizes. Instructions use EasyMDE's bundled `marked`
(forces `breaks: true`, adds `target="_blank"`); readings use `markdown-it`
with `html: true` plus a link/image rewrite to `download_file`. Instructor
HTML - including `<script>`, `<iframe>`, inline handlers - renders verbatim.
The spec draft (§11.1) assumed "sanitized HTML" was already legacy behavior;
it is not. Real course content may depend on raw HTML/JS (custom widgets,
YouTube embeds, styling).

**Why it matters:** unsanitized instructor HTML is an XSS surface (instructors
are semi-trusted, but content is shared/forked across courses); yet
sanitizing may break years of authored content. This is the highest-blast-
radius decision of the seven.

**Options:**

- **A - Replicate (no sanitization):** nothing breaks; keeps the XSS surface;
  simplest parity.
- **B - Sanitize now** (rehype-sanitize with an allowlist per spec §4):
  safest, but _will_ break content until the allowlist is tuned; needs a
  breakage-report channel.
- **C - Audit first, then decide:** run a scan over production course content
  (instructions + reading bodies) counting tags/attributes that a default
  allowlist would strip; tune the allowlist against real usage; ship
  sanitization behind a per-course flag with a "render legacy (unsanitized)"
  fallback during migration.
- **D - Sanitize readings only / instructions only** (split decision by
  surface).

**Recommendation: C.** The audit is cheap (course dumps like
`courses/bakery_course.json` are already the right shape) and converts an
unknown risk into a known allowlist. Also note `breaks: true` (marked) vs
markdown-it defaults changes line-break rendering - the audit should flag
content relying on it.

**Decision:** A
**By / date:**
**Notes:**

---

## D5 - Settings save destroys unregistered keys

**Legacy behavior** (A4 - [settings inventory](appendices/A4-settings-inventory.md)):
`saveAssignmentSettings` (`assignment_settings.js:309-320`) serializes only
the keys in the client's `ASSIGNMENT_SETTINGS` registry. Any other key in the
`!assignment_settings.blockpy` blob - including the **server-consumed**
`protected_ip_ranges`, `time_limit`, and `poolRandomness` - is silently
deleted the next time an instructor saves settings through the legacy editor.

**Why it matters:** this is active data loss. Spec §14.5 already mandates
round-tripping unknown fields for assignment payloads; the settings blob is
the same class of problem. Replicating would mean the new editor also
destroys exam time limits when an instructor touches any setting.

**Options:**

- **A - Replicate:** faithful, knowingly destructive.
- **B - Fix: round-trip unknown keys** (parse → edit known keys → merge back
  over the original blob). Ledger entry; strictly less destructive; the wire
  format is unchanged when no edit occurs.

**Recommendation: B**, and treat it as required by the spirit of §14.5/G3
(the spec's "unknown keys pass through untouched" §11.1 line was aspirational

- make it real).

**Decision:** B
**By / date:**
**Notes:**

---

## D6 - `settings-*` URL parameters are unrestricted

**Legacy behavior** (A4): the Jinja loop (`editor.html:287-291`) applies any
`settings-<key>=<value>` query parameter for **any role**, last-wins. A
student can pass `?settings-display.instructor=true` and get the instructor
UI client-side. Actual security holds server-side (instructor-only endpoints
reject; passcode is a server-side `compare_digest`), so this is cosmetic
exposure: students can see instructor chrome and raw feedback internals, but
cannot fetch instructor-only data (e.g. `!on_run.py` is blanked for students
by the server).

**Why it matters:** it looks alarming, and instructor chrome may leak _hints_
(e.g. grading-control labels), but there is no known data exposure. Gating it
adds a role check that legacy content/tests using `settings-*` deep links
(e.g. shared debug links) might trip over.

**Options:**

- **A - Replicate:** keep the unrestricted loop; document loudly that
  security is server-side and instructor UI must never embed secrets in the
  client bundle (this constrains the rewrite's design: no instructor-only
  data in BootConfig for students).
- **B - Gate cosmetically:** ignore `display.instructor`/role-flipping keys
  for non-instructors while allowing benign ones. Ledger entry; breaks any
  legitimate use of those links by graders/TAs whose role detection differs.

**Recommendation: A**, with the design constraint made explicit in the
`BootConfig`/API docs: the client may never receive data the user's role
shouldn't see, so UI flags can stay harmless.

**Decision:** A
**By / date:**
**Notes:**

---

## D7 - Hidden pool questions' answers are dropped on quiz save

**Legacy behavior** (A3): when a quiz uses pools, saving serializes only the
**visible** questions' answers. If pooling later shows a different subset
(new attempt, instructor edits the pool), the student's earlier answers to
now-hidden questions are gone from the stored answer JSON.

**Why it matters:** mostly invisible today (pool membership is stable within
a submission), but it interacts with D1's seed decision and with instructors
editing pools mid-semester; it also means the stored answer JSON is not a
complete record of what the student ever answered (research/regrade impact).

**Options:**

- **A - Replicate:** store visible answers only; byte-identical save payloads
  (easiest for the golden-transcript gate).
- **B - Preserve:** merge new answers over the previously stored answer map so
  hidden-question answers survive. Wire format stays the same shape (same
  JSON structure, more keys); server-side `process_quiz` grades submitted
  answers regardless. Ledger entry; verify the server tolerates extra keys
  (A3 indicates it iterates the checks, not the answers - confirm in the
  Milestone 2.4 fixtures).
- **C - Defer to Milestone 2.4:** decide when the quizzer fixtures exist;
  default to A until then.

**Recommendation: B**, pending the server-tolerance check in 2.4 fixtures
(fall back to A if the server chokes on extra keys - unlikely per A3).

**Decision:** B
**By / date:**
**Notes:**

---

## After deciding

1. Record each outcome here (and any conditions, e.g. "B if the server
   tolerates extra keys").
2. Copy every **fix** decision into the approved-differences ledger when it
   exists (created alongside the first golden-transcript comparison,
   Milestone 1.2).
3. Update the affected milestone bullets in
   [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) (D1/D7 → M2.4, D2 → M1.2,
   D3 → M1.1, D4 → M1.4/M2.3, D5 → M1.1/M1.4, D6 → M1.6).
