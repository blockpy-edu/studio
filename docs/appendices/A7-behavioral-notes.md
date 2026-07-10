# Appendix A7 — Legacy Behavioral Notes (Pinned Semantics)

Status: verified against legacy sources on 2026-07-10.
Repos: `blockpy` client (`c:/Users/acbar/Projects/blockpy-edu/blockpy`), server (`c:/Users/acbar/Projects/blockpy-server`). Paths below are relative to those roots.

---

## 1. Passcode protection

**Verdict: server-side plaintext comparison on every request. No local hash, no dedicated validation endpoint, no re-prompt loop.**

- **Trigger.** The Jinja context computes `passcode_protected = True` if **any** assignment in the group has a passcode setting (`blockpy-server/controllers/helpers.py:252-256`, via `Assignment.has_passcode()` at `models/assignment.py:491-493`). The template then runs `editor.requestPasscode();` immediately after constructing the editor (`templates/blockpy/editor.html:298-301`) — *before* `loadAssignmentWrapper` is invoked (`editor.html:341-348`).
- **UX.** `requestPasscode()` is literally a synchronous browser `prompt("Please enter the passcode.")`, whose value is stored in `model.display.passcode` (`blockpy/src/blockpy.js:1308-1311`; the observable is declared at `blockpy.js:272-274` with the comment "User-supplied passcode to compare on the server against the current passcode"). Because `prompt()` blocks the JS thread, no assignment content is requested until the user answers. One prompt covers the whole group.
- **Transport.** The passcode is attached to **every** server payload as `"passcode": display.passcode()` in `createServerData()` (`blockpy/src/server.js:196`). The server-frontend components do the same for `updateSubmission`/`logEvent`/`saveFile` (`frontend/components/reader/reader.ts:397`, `frontend/components/assignment_interface.ts:277`, `305`, `355`).
- **Validation.** Server-side only: `Assignment.passcode_fails()` does a constant-time `compare_digest(given, stored)` against the plaintext `passcode` value in assignment settings (`models/assignment.py:479-489`). Enforcement happens in the permission checks — a failing passcode aborts with message `"Passcode '...' rejected."` and, notably, **HTTP status 200** with `success: false` (`controllers/services/__init__.py:117-119`, `158-162`, `170-174`, `179-183`).
- **Failure UX.** There is no retry prompt: a rejected passcode simply surfaces as a failed load (client logs and error status; e.g. the reader shows `errorMessage` from the response, `reader.ts:405-408`). The user must reload the page to be prompted again.
- The passcode setting is authored as a plain string in the assignment settings editor (`blockpy/src/editor/assignment_settings.js:7`, `226-231`).

## 2. End-of-group behavior

**Verdict: there is NO congratulations message in legacy. A code comment promises one, but it was never implemented.**

- The group header's `markCorrect(assignmentId)` (`templates/helpers/assignment_groups.html:129-142`) is preceded by the comment block:
  ```
  /*
   * Increment completed counter by 1
   * Disable next/first/etc. butttons when at end
   * Display message when completed all
   */
  ```
  (`assignment_groups.html:124-128`) — the "Display message when completed all" line has **no corresponding code**. `markCorrect` does exactly and only this, guarded by `if (!opt.hasClass("correct-submission"))` for idempotence (`:131`):
  - non-secretive groups: prepend `&#10004; ` to the option label, swap class `incorrect-submission` → `correct-submission`, restyle **all** `.assignment-selector-next` buttons from `btn-outline-secondary` to `btn-success`, and increment `.completion-rate` numerator by parsing its current text (`assignment_groups.html:132-137`). Because these are class selectors, both header instances (top and bottom, included twice at `templates/blockpy/editor.html:102-103` and `:188-190`) update together.
  - secretive groups (`ns.any_secretive`, OR of `assignment.hidden` over the group, `assignment_groups.html:5-8`): the **only** action is setting the numerator to `??` (`:138-140`); no checkmark, no class change, no Next restyle.
- So when the last incomplete assignment flips correct: the count reaches `n/n`, the option gets its ✔, and Next turns green — but if the user is already on the last assignment, Next/Last are simultaneously `disabled` (set by `updateUI`: First/Back disabled at `FIRST_ID`, Next/Last disabled at `LAST_ID`, `assignment_groups.html:54-60`). Net visual: a green-but-disabled Next button and a full completion count. Nothing else.
- Nuance: `markCorrect` restyles Next whenever **any** assignment is marked correct, not only the currently-displayed one (there is no `assignmentId === currentId` check, `:129-137`).
- When the page has no group (or a single assignment), `markCorrect` is defined as a no-op (`templates/blockpy/editor.html:109-114`).
- Navigation fallback: without a SPA host (`altAssignmentChangingFunction` undefined) it sets `document.location.href = URL_MAP[id]` and appends `"~~~ The next problem is loading! Please wait"` to `.row` (`assignment_groups.html:62-71`).
- Selector expansion: `.completion-box` click toggles list-box mode with `size = Math.min(5, options/2)` vs `size=1`, persisted under localStorage key `blockpy_assignmentSelectorExpanded` with try/catch storage guard (`assignment_groups.html:94-120`).

## 3. Run-artifact persistence (files written by student programs)

**Verdict: writes are silently discarded. Nothing is shown, persisted, or diffed back.**

- The Skulpt engine is configured with `filewrite: this.writeFile.bind(this)` (`blockpy/src/engine/configurations.js:99`), but the base `Configuration.writeFile()` is an unimplemented stub:
  ```js
  writeFile() {
      console.warn("Unimplemented method!");
      // TODO
  }
  ```
  (`configurations.js:162-165`), and **no subclass overrides it** — `StudentConfiguration` overrides only `openFile`/`importFile`/`input`/`isForbidden`/`step` (`blockpy/src/engine/student.js:25-66`), `InstructorConfiguration` only read-side methods (`blockpy/src/engine/instructor.js:108-148`). A `filewrite` grep across the whole client source finds only the config line (`configurations.js:99`).
- The file-namespace documentation names a "Generated Space (`*`): Visible to the student, but destroyed after Engine.Clear. Can shadow an actual file" (`blockpy/src/files.js:186`), and `searchForFile` does look up `"*"+name` in the student file list (`files.js:585`, included in every search-mode resolution order, `files.js:589-599`) — but **nothing in the codebase ever creates a `*`-prefixed file** (only occurrences: `files.js:186`, `:545`, `:548`, `:585`).
- Reads, by contrast, are fully wired: `Sk.inBrowser`/`read` resolve through `searchForFile` with namespace precedence (`student.js:25-56`; `files.js:536-601`), and mock URLs intercept `requestsGet` (`configurations.js:135-155`).
- **Spec impact:** README §7.5's claim that files created/modified by a run "surface in the UI as run artifacts" *matching current behavior* is wrong for the legacy client — the legacy behavior to match is: **student writes vanish** (with only a console warning). The §7.5 design (diff into transient Layer 4 + UI surfacing) is an *extension*, not parity, and should be labeled as such.

## 4. Reading-completion rule

**Verdict: a reading marks itself correct immediately on load — there is no scroll, dwell-time, or video-watched gate. Scroll/video engagement is only *logged*.**

- In `loadReading`'s success handler, as soon as the assignment+submission arrive: `if (response.submission) { this.markRead(); }` (`frontend/components/reader/reader.ts:154-156`). A stale TODO right above the class ("Mark as success on load", `reader.ts:25`) describes exactly what ships.
- `markRead()` (`reader.ts:384-419`) posts `updateSubmission` with `status: 1, correct: true` (plus ids, timestamp/timezone, passcode; `reader.ts:387-398`), then on response sets `submissionStatus`/`correct` from the server echo and, `if (response.correct && this.markCorrect)`, calls the navigation's `markCorrect(assignment.id)` (`reader.ts:409-413`). Server rejection surfaces via `errorMessage` (`reader.ts:405-408`).
- **Engagement logging (no effect on correctness):**
  - Scroll/read pings: `logReadingStart` posts `{subject: "lti.fetchWindowSize"}` to `window.top` (`reader.ts:343-345`); the `message` listener accepts `lti.fetchWindowSize` / `lti.fetchWindowSize.response` (`reader.ts:336-341`) and `logReading` logs `Resource.View`/`reading`/`read` with `{count, delay, position, height, progress, moved}` (`reader.ts:347-372`). Ping interval escalates: `delay = logCount * LOG_TIME_RATE` with `LOG_TIME_RATE = 30000` ms (`reader.ts:27`, `:348-349`), i.e. 30 s, 60 s, 90 s, ... The first ping is scheduled 1 s after load (`reader.ts:151`).
  - Video watch events: see A6 §2.6 — `Resource.View`/`reading`/`watch` for HTML5 events `pause playing seeked ended loadeddata error ratechange waiting` (`reader.ts:28`, `259-280`, `306-309`) and YouTube `onStateChange` (`reader.ts:311-334`).
  - Tab visibility: every assignment interface logs `Resource.View`/`reading`/`visibility` with `document.visibilityState` on `visibilitychange` (`frontend/components/assignment_interface.ts:134-138`).
- Exam wrinkle: if `settings.start_timer_button` is set and the (non-instructor) student hasn't started, the reader hides `.assignment-selector-div` until "I am ready to start the exam!" posts `blockpy/start_assignment/` (`reader.ts:102-135`, `251-256`; button markup `reader/reader.html:63-76`).
- **Spec impact:** README §11.2's "scroll-to-bottom / dwell time / video watched, per the legacy component's rules" over-promises — the legacy rule is simply *load ⇒ correct*.

## 5. Time-spent clock, countdown, and `estimate_group_duration`

All in `templates/blockpy/editor.html:393-451` plus `templates/helpers/assignment_groups.html:193-196`.

- **Start value:** `const pageStartTime = {{ (session_start_time or 0)|tojson }} || Date.now();` (`editor.html:400`); `session_start_time` comes from the first submission's `get_session_start_time()` (`controllers/helpers.py:260`).
- **Tick:** initial `refreshClock()` then `setInterval(refreshClock, 10000)` — 10 s (`editor.html:426-428`).
- **Tiers** (`refreshClock`, `editor.html:403-425`), computed from `duration = floor((Date.now()-pageStartTime)/1000 + activityDuration)`:
  - `hours >= 99` → `99+ hours spent`;
  - `hours < 1`: `oMinutes < 1` → `(Just started)`; `oMinutes === 1` → `~1 minute spent` (singular); else → `~N minutes spent`;
  - else → `~H:MM hours spent` with zero-padded minutes (`editor.html:407-408`).
  README §9.4's tier list is confirmed, with two precisions: the 99-hour cap triggers at `hours >= 99`, and the 1-minute label is singular.
- **Mode toggle** (click handler, `editor.html:429-449`): `session` → (if `window.ACTIVITY_GET_DURATION` defined) `loading`, which renders `(Getting Total)` (`editor.html:422-424`); on success `activityDuration = result; clockMode = 'activity'`; on error → back to `session` with `activityDuration = 0`; `.always(refreshClock)`. A click in **any non-session mode** (including `loading`) resets to session and zeroes `activityDuration` (`editor.html:444-447`). Note that in activity mode the display is *fetched total + current session elapsed*, still ticking.
- **Endpoint:** `window.ACTIVITY_GET_DURATION` wraps `$.get` on `url_for('blockpy.estimate_group_duration', assignment_group_id=..., course_id=...)` — both ids are baked into the URL at template render — and maps the JSON to `result.duration` (`editor.html:395-399`). The global is defined even for pages without groups; §15.3's requirement to keep exporting it is confirmed.
- **Initial text:** the clock span is server-rendered with placeholder `0:00` and tooltip "Estimate time spent (click to get total time spent across all sessions)" (`assignment_groups.html:195-196`).
- **Countdown span** (`assignment-selector-countdown`, `assignment_groups.html:193-194`): README §9.4 says legacy "leaves population to other scripts" — more precisely, it **is** populated by the server frontend's `AssignmentInterface`: a 5 s `setInterval` (`frontend/components/assignment_interface.ts:92-112`, singleton-guarded via `window["$TIME_CHECKER_ID"]`, `:88-91`, `160-178`) runs `handleTimeCheck` which, when the assignment settings carry `time_limit` and the submission has `dateStarted`, renders `"{X} elapsed; {Y} left"` via `formatAmount(..., coarse=true)` and **hides the time-spent clock** (`assignment_interface.ts:186-254`, clock hidden at `:253`; coarse tiers in `frontend/utilities/dates.ts:104-133`). Time-limit parsing supports `"Nmin"` and per-student `"Nmin"`/`"Nx"` multiplier overrides from `submission.timeLimit()` (`assignment_interface.ts:20-45`). On expiry (non-instructors only) it overlays a full-screen white `end-assignment-timer-box` — "Time is up! Your assignment will be automatically submitted now..." — and logs `timer_expired` (`assignment_interface.ts:201-246`); timer errors render "Error with timer" in the countdown span (`:108`).

## 6. LTI glue details

All in `templates/blockpy/editor.html` unless noted.

- **frameResize payload** (`editor.html:350-380`, emitted only `{% if embed %}`):
  ```js
  window.parent.postMessage(JSON.stringify({
      subject: "lti.frameResize",
      "height": $("body").height()+50
  }), '*')
  ```
  (`:352-357`) — JSON-**stringified** (not a structured object), height = body height + 50, origin `'*'`. Sent once on ready (`:359`) and from a `ResizeObserver` on `document.body` debounced 500 ms via `clearTimeout`/`setTimeout` (`:360-375`), all wrapped in try/catch (`:358`, `:377-379`). Confirms README §13.
- **Cookie check + handshake** (`editor.html:25-100`):
  - `window.ltiLoadedCorrectly = frontend.checkCookies();` and the branch re-calls `checkCookies()` (`:27-28`). `checkCookies` = `navigator.cookieEnabled`, falling back to writing a `testcookie` and re-reading it (`frontend/site/core.ts:20-27`).
  - On failure it logs verbatim: `"Cookies appear to be disabled. We will attempt to load without cookies. You might need to disable an ad-blocker, adjust your security settings, or use a different browser (we recommend Chrome)."` (`:30-31`).
  - Handshake state: `targetFrame = window.parent`, `platformOrigin = '*'`, `messageId = frontend.generateUUID()`, `stateId = frontend.generateUUID()` (`:40-43`; `generateUUID` at `frontend/utilities/random.ts:31`). A dated comment block explains the real platform-origin derivation is parked "right now (Jan 4, 2024), it's still expecting '*' to be the origin" (`:33-39`).
  - **Pinned quirks the rewrite must decide on rather than blindly copy:**
    1. The two `lti.put_data` postMessages send **literal placeholder strings** — `key: "blockpy_<state_id>", value: "<state_id>"` and `key: "nonce_<nonce_value>", value: "<nonce_value>"` (`:85-98`). `stateId` is generated (`:43`) but never interpolated; both messages reuse the same `messageId`.
    2. The `lti.put_data.response` listener validates `typeof event.data === "object"`, subject, `message_id`, then `event.origin !== platformOrigin` (`:48-81`) — since `platformOrigin` is the literal string `'*'` and `event.origin` is always a real origin, the origin check **always fails**, so the success path (`:80`) is dead code. The handshake is effectively fire-and-forget.
- **Safari notice / loading screen** (`editor.html:20-23`): a static `.delete-on-load` span rendered unconditionally into the body — "Loading! Please wait. If this doesn't load, and you are using Safari, then please stop using Safari!" plus a retry link (`target="_blank"`) to `blockpy.load_assignment` with `assignment_id`, `course_id`, `assignment_group_id`, `embed`, `read_only`. There is **no browser detection**: the trigger condition is simply "the app hasn't finished booting yet" — the span is removed at the end of the ready handler by `$('.delete-on-load').remove()` (`editor.html:382-383`). (README §13's "Safari warning" is therefore always part of the loading text, not conditional.)
- **Emoji proxy:** the page overrides the client's default (`https://twemoji.maxcdn.com/v/13.1.0/svg/...`, `blockpy/src/engine/configurations.js:108`) with `Sk.emojiProxy = (part) => "{{ static images/emoji/ }}" + part.toLowerCase() + ".svg"` (`editor.html:294`).
- Also in the boot glue, for completeness: `window.$blockPyUrls` (`editor.html:201-221`, submission-dependent endpoints only rendered `{% if submissions %}`), `window.$blockPyUserData` (`:222-230`), `settings-*` query-arg passthrough into the constructor (`:287-291`), `altAssignmentChangingFunction = loadAssignmentWrapper` (`:347`), and `$MAIN_BLOCKPY_EDITOR = editor` (`:296`).

---

## Open questions

1. **Run artifacts (item 3):** README §7.5 must be re-worded — is the Layer-4 run-artifact surfacing a v1 extension (recommended framing) or should v1 replicate the legacy silent-discard exactly? Also: was `filewrite` ever functional in an older client (git history), i.e., do any Pedal grading scripts *expect* writes to fail silently rather than raise?
2. **Reading completion (item 4):** load ⇒ correct means merely opening a reading completes it. Does the rewrite keep that (parity) or adopt the engagement gate README §11.2 imagines? If parity: note `markRead` is skipped when `response.submission` is null (anonymous/no-course), so anonymous readers never mark correct (`reader.ts:154-156`).
3. **End-of-group (item 2):** should the rewrite implement the never-shipped "Display message when completed all", or freeze the legacy no-op? README §9.5's "if the legacy frontend shows a congratulations message, replicate" resolves to: it does not.
4. **Next-button styling scope:** legacy turns Next green on *any* `markCorrect`, even for a non-current assignment (e.g. a subordinate quiz reporting late). Preserve or fix?
5. **Passcode (item 1):** the passcode travels in plaintext in every request body and rejection returns HTTP 200 — keep the 200-with-`success:false` contract for API compatibility? And should the rewrite add a retry prompt (legacy requires a page reload after a wrong passcode)?
6. **LTI handshake (item 6):** are the literal `<state_id>`/`<nonce_value>` placeholder payloads relied on by any platform (Canvas ignores unknown keys), or can the rewrite send real values behind the planned origin constant? The dead origin-check should be reproduced only if we deliberately keep the handshake fire-and-forget.
7. **Countdown ownership:** legacy has *two* timers touching the header (10 s clock in the template, 5 s countdown in the frontend singleton with `$TIME_CHECKER_ID` cross-component hand-off). The rewrite's single-store design (README §9.4) must replicate the observable effects: countdown format `"{elapsed} elapsed; {left} left"` (coarse tiers of `dates.ts:118-133`), clock hidden while a time limit is active, expiry overlay text, and `timer_expired`/`timer_cleared`/`timer_error` log events.
8. **`session_start_time` fallback:** when the server provides `0`/None the clock silently falls back to `Date.now()` (`editor.html:400`) — confirm the rewrite treats `0` (not just undefined) as "no server time".
