# A5 — Golden Transcripts

**Status:** First transcript recorded (2026-07-10). Extend before Milestone 1.2 freeze.

Per spec §16.2 and DEVELOPMENT_PLAN.md §0.2, this appendix holds recorded HTTP
traffic of the legacy client performing scripted sessions against a local dev
blockpy-server. The recordings are the normative fixtures for `@blockpy/api`
(Milestone 1.2) and the primary G3 compatibility gate.

## Recorded transcripts

### `transcripts/group189-anonymous.har`

- **Server:** local dev blockpy-server, `course_id=3`, `assignment_group_id=189`
  (reading 1021, quiz 1022, kettle 1023, blockpy 1024, reading 1025,
  subordinate blockpy 1026), anonymous session.
- **Script:** load group → reading dwell/scroll → quiz (start attempt → answer
  → submit) → kettle load → blockpy (edit code in CodeMirror → autosave → Run
  → grading traffic) → second reading dwell.
- **Captured (25 entries, same-host only, static assets stripped):**
  `GET assignments/load`, `GET assignments/by_url`,
  `GET blockpy/serve_kettle_iframe` ×2, `POST blockpy/load_assignment` ×6,
  `POST blockpy/log_event` ×6, `POST blockpy/save_file` ×4,
  `POST blockpy/update_submission` ×5 — with full request/response bodies.
- **Scrubbing:** `Cookie`/`Set-Cookie`/`Authorization` headers and
  `access_token` form fields redacted; third-party traffic (YouTube embeds in
  readings) dropped. The anonymous dev `user_id`/`submission_id` values are
  synthetic and retained.
- **Live confirmations of appendix findings:** readings mark correct on load
  via `update_submission status=1&correct=true` (A7); `Resource.View`
  `category=reading label=read` events with escalating-interval `count/delay`
  messages (A2); form-encoded per-event logging with `timestamp` ms +
  `timezone` minutes (A2); quiz answers persist via `save_file` of the answer
  JSON (A3).

## Tooling

`tools/record-golden-transcript.mjs` — Playwright-driven recorder + scrubber.

```
node tools/record-golden-transcript.mjs [groupUrl]
```

## To extend before the Milestone 1.2 freeze

- A session where the coding problem's grader actually **passes** (submit code
  that satisfies `!on_run.py`), capturing the full success sequence
  (`update_submission` with score/correct → `update_submission_status`).
- An authenticated (non-anonymous) student session, and an instructor session
  (assignment save paths: `save_assignment`, file upload endpoints).
- History viewer traffic (`load_history`) and uploaded-files endpoints.
- Replay harness in `packages/api` that asserts request-shape equality against
  these fixtures (the G3 gate).
