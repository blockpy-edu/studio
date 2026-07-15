# Phase 0.2 Appendices - Legacy Verification Deliverables

Frozen extracts of legacy behavior (DEVELOPMENT_PLAN.md §0.2). Every claim in
these files carries a `file:line` citation into the authoritative legacy
sources:

- BlockPy client: `../blockpy` (relative to the blockpy-edu checkout)
- BlockMirror: `../BlockMirror`
- Server frontend + templates: `../../blockpy-server`

| Appendix                                              | Status      | Contents                                                                    |
| ----------------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| [A1 - Filename prefixes](A1-filename-prefixes.md)     | ✅ Verified | Prefix/magic-name table, visibility/persistence rules, fixture seed JSON    |
| [A2 - Event vocabulary](A2-event-vocabulary.md)       | ✅ Verified | 22 live event types, wire format, retry/queue semantics, draft `events.ts`  |
| [A3 - Quiz schema](A3-quiz-schema.md)                 | ✅ Verified | 12 question discriminators, attempt/pooling rules, draft frozen TS types    |
| [A4 - Settings inventory](A4-settings-inventory.md)   | ✅ Verified | 36 assignment-settings keys, constructor option bag, `settings-*` mechanism |
| [A5 - Golden transcripts](A5-golden-transcripts.md)   | ⏳ Pending  | Needs a live legacy dev server to record                                    |
| [A6 - Markdown extensions](A6-markdown-extensions.md) | ✅ Verified | The two (different!) rendering pipelines, runnable-fence rules              |
| [A7 - Behavioral notes](A7-behavioral-notes.md)       | ✅ Verified | Passcode, end-of-group, run artifacts, reading completion, clock, LTI glue  |

## Headline corrections to the spec draft (README.md)

The spec explicitly deferred to the code as authority; verification found these
draft assumptions wrong:

1. **§7.1 prefix table** - `&` = instructor "Read-only Space" (not student
   files; student extras are unprefixed in `submission.extraFiles`); `*` =
   vestigial Generated Space (not uploads); `#` bundles are the autosave wire
   format (not transient); `$` secret prefix missing; `!answer_prefix.py` /
   `!answer_suffix.py` wrap student code every run (affects line mapping).
2. **§7.5 run artifacts** - legacy discards all program-written files (the
   `filewrite` hook is a stub). Surfacing run artifacts is an _extension_, not
   parity.
3. **§11.3 quizzes** - no code-typing question type, no practice/graded modes,
   and **no existing engine-preprocessing pathway** (`quiz.preprocess` is a new
   §17-style additive capability). `mulligans`, the server-written `summary`,
   and pass-through-only `calculated_question`/`file_upload_question` were
   missed. Matching/dropdown shuffle is unseeded per render (legacy bug).
4. **§14.4 events** - `Session.Start` and (almost all) `File.Edit` are
   server-fabricated, not client-emitted; the quizzer logs nothing. The rewrite
   must not re-emit server-fabricated types.
5. **§15.2 settings** - `settings-*` values arrive as raw strings with per-key
   coercion, not JSON-parsed; no role gating (security is server-side only).
6. **§11.1/§11.2 rendering** - instructions (marked via EasyMDE) and readings
   (markdown-it) use _different_ pipelines; neither sanitizes; no LaTeX.
7. **§11.2 reading completion** - readings mark correct immediately on load;
   scroll/video telemetry is logging only.
8. **§9.4/§9.5 navigation** - the frontend _does_ own the countdown span
   (5 s tick, "Time is up!" overlay); there is no end-of-group congratulations
   message; passcode is a server-side `compare_digest` (client is a bare
   `prompt()`).

Each appendix ends with an **Open questions** section; the replicate-or-fix
decisions collected from them live in DEVELOPMENT_PLAN.md §0.4.
