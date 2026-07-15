# Appendix A2 - Event Logging Vocabulary (`logEvent` / ProgSnap2-inspired stream)

**Status:** Verified against the legacy sources (`blockpy-edu/blockpy` and `blockpy-server`, branch state as of 2026-07-10).
**Authority:** the legacy code. Every claim carries `file:line` citations. Where the code contradicts the README §14.4 draft, that is called out in [§8](#8-deltas-from-readme-144).
**Scope:** everything a client sends through the `logEvent` endpoint, from both legacy codebases, plus (for context) the events the _server_ fabricates into the same log table - the rewrite must **not** re-emit those.

Path shorthands:

- `client/` = `c:/Users/acbar/Projects/blockpy-edu/blockpy/src/`
- `frontend/` = `c:/Users/acbar/Projects/blockpy-server/frontend/`
- `server/` = `c:/Users/acbar/Projects/blockpy-server/` (controllers, models, templates)

---

## 1. Wire format of a `logEvent` request

### 1.1 Endpoint and verb

- URL is injected by the Jinja boot script: `'logEvent': url_for('blockpy.log_event')` (`server/templates/blockpy/editor.html:210`; also `textbook.html:164`). The client stores the whole URL map in `configuration.urls` (`client/blockpy.js:424-425`) and posts to `this.urls[endpoint]` (`client/server.js:282`).
- Server route: `/blockpy/log_event` and `/blockpy/log_event/`, `methods=['GET','POST']` (`server/controllers/endpoints/blockpy.py:320-321`). The clients always POST (`type: "post"` in `_postRetry`, `client/server.js:282`).
- Auth: `@login_required` (`blockpy.py:323`) - session cookie, **or** an `Authorization: Bearer <access_token>` header attached by `authorizeHeader` when `configuration.accessToken` is set (`client/server.js:160-172`; token arrives in the boot config as `"access_token": window.accessToken`, `editor.html:229`, `client/blockpy.js:432`). The access token is **never** a body parameter.
- Body encoding: jQuery `$.ajax({data: data, type: "post"})` - standard `application/x-www-form-urlencoded` form fields, not JSON (`client/server.js:282`).
- Only required parameter server-side: `event_type` (`@require_request_parameters('event_type')`, `blockpy.py:322`).

### 1.2 Body parameters - BlockPy client (`BlockPyServer.logEvent`)

Base payload from `createServerData()` (`client/server.js:178-200`):

| Param                 | Value                     | Semantics                                                                                                       |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `assignment_id`       | `assignment.id()`         | current assignment (server.js:187)                                                                              |
| `assignment_group_id` | `user.groupId()`          | group context (server.js:188)                                                                                   |
| `course_id`           | `user.courseId()`         | course context (server.js:189)                                                                                  |
| `submission_id`       | `submission.id()`         | current submission (server.js:190)                                                                              |
| `user_id`             | `user.id()`               | subject (server.js:191)                                                                                         |
| `version`             | `submission.version()`    | **submission** version (server.js:192)                                                                          |
| `assignment_version`  | `assignment.version()`    | assignment version (server.js:193)                                                                              |
| `timestamp`           | `new Date().getTime()`    | **milliseconds** since epoch (server.js:184-185, 194 - the local variable is misleadingly named `microseconds`) |
| `timezone`            | `now.getTimezoneOffset()` | minutes offset from UTC, JS sign convention (server.js:195)                                                     |
| `passcode`            | `display.passcode()`      | assignment passcode, if any (server.js:196)                                                                     |
| `part_id`             | `configuration.partId()`  | reader-embedded editor region id (server.js:197, 426-431)                                                       |

`logEvent(event_type, category, label, message, file_path, extended=false)` then appends `event_type`, `category`, `label`, `message`, `file_path`, `extended` (`client/server.js:546-558`).

### 1.3 Body parameters - server-frontend components (`AssignmentInterface.logEvent`)

Reader/kettle/explain (and the timer machinery) build their own payload and reuse the embedded BlockPy editor's transport: `BlockPyServer._postRetry(data, "logEvent", 0, callback)` (`frontend/components/assignment_interface.ts:258-285`). Fields (ts:268-283): `assignment_id` (plain number, `models/assignment.ts:8`), `assignment_group_id`, `course_id`, `submission_id`, `user_id`, `version`, `timestamp` (`now.getTime()`), `timezone` (`getTimezoneOffset()`), `passcode` (read off `window["$MAIN_BLOCKPY_EDITOR"].model.display.passcode()`), `event_type`, `category`, `label`, `file_path`, `message`.

**Divergences from the BlockPy-client payload (must be reproduced or consciously fixed):**

- `version` is set to `this.assignment().version()` - the **assignment** version, not the submission version (ts:274). The server stores `version` as `submission_version` (`blockpy.py:330`), so frontend-originated rows have the assignment version in the `submission_version` column.
- No `assignment_version` param at all → server default `0` (`blockpy.py:328`).
- No `extended` and no `part_id` params (ts:268-283).

### 1.4 Server-side handling / timestamp encoding

`log_event()` (`server/controllers/endpoints/blockpy.py:320-350`) reads: `course_id`, `assignment_id` (int), `assignment_version` (maybe-int, default 0), `submission_id` (int), `version` → `submission_version` (maybe-int, default 0), `event_type` (str, required), `file_path` / `category` / `label` / `message` (maybe-str, default `""`), `extended` (maybe-bool, default False). Only the submission owner or graders may log (`blockpy.py:338-340`).

`timestamp` and `timezone` are _not_ read in the endpoint - `make_log_entry` pulls them straight from `request.values` (`server/controllers/helpers.py:368-373`) and stores them verbatim as **strings** in `client_timestamp` / `client_timezone` (`server/models/log_tables/submission_log.py:48-49, 83-95`). Downstream research code parses `client_timestamp` as integer milliseconds (`server/models/data_formats/report.py:92-97`), so the encoding is load-bearing.

Row schema (SubmissionLog, `submission_log.py:30-49`): `submission_id`, `submission_version`, `assignment_id`, `assignment_version`, `course_id`, `subject_id` (= the submission's user), `event_type`, `file_path`, `category`, `label`, `message` (Text; "JSON encoded data, if extended is true" per submission_log.py:45), `extended` (bool), `client_timestamp`, `client_timezone`. Server adds `date_created`/`date_modified`. Note `encode_json` does **not** expose `extended` (submission_log.py:61-81).

### 1.5 Response

`ajax_success({"log_id": new_log.id})` → `{"log_id": ..., "ip": <request.remote_addr>, "success": true}` (`blockpy.py:350`, `helpers.py:362-365`). The client inspects `response.ip` for IP changes and may emit a follow-up `X-IP.Change` event (`client/server.js:62-82, 294-296` - note `_postRetry` calls `this.checkIP(response.ip)` at server.js:295, passing the bare string where `checkIP` expects the response object; `response.success` on a string is undefined, so **the X-IP.Change path is effectively dead for `_postRetry`-based calls**; the working path is `_postLatestRetry`/`_postBlocking`, which pass the whole response - server.js:332, 384).

---

## 2. Delivery: per-event, retry, and queueing

- **Per-event POST, no batching.** Each `logEvent` call fires one `_postRetry(data, "logEvent", 0, …)` (`client/server.js:561`; `frontend/components/assignment_interface.ts:284`). Delay `0` means `setTimeout(postRequest, 0)` (`server.js:304-308`).
- **Retry:** on transport failure (`.fail`), `_postRetry` re-invokes itself with `delay + FAIL_DELAY` where `FAIL_DELAY = 2000` ms (`server.js:44, 299-302`) - linear backoff (0, 2s, 4s, 6s…), **unbounded attempts**. Logical failures (`response.success === false`) are _not_ retried; they only set status `FAILED` (server.js:285-290).
- **Offline queue:** before each POST, the payload is enqueued into a localStorage-backed FaultResistantCache under key `logEvent` (namespace `BLOCKPY`, so the real key is `BLOCKPY_logEvent_value` - `client/server.js:31-37, 251-265`; `client/storage.js:38-41`). Max 200 queued logEvent entries; overflow is trimmed oldest-first (`server.js:38-41, 253-257`). Duplicate payloads (exact JSON match) are not enqueued twice (server.js:258-264). On success, the entry is dequeued - **but** `_dequeueData` calls `splice(index)` with one argument, which removes _every entry from `index` onward_, not just the matched one (server.js:267-274). Legacy quirk; do not "improve" silently.
- **Startup flush:** `checkCaches()` drains the queue one item at a time (1000 ms delay per item, only continuing after each success), using `.pop()` - i.e., **LIFO**, newest-first (`server.js:100-112`).
- **Gating:** events are dropped (status `OFFLINE`) when `display.readOnly()` is true (server.js:547-550) or when no `logEvent` URL is configured (`isEndpointConnected`, server.js:551, 563-565). The frontend `AssignmentInterface.logEvent` performs **neither** check - it posts unconditionally through `_postRetry` (assignment_interface.ts:266-284), inheriting only the transport-level queue/retry.
- **No beacon on unload** - an old TODO only (`server.js:144`).

---

## 3. Event vocabulary - BlockPy client (editor)

`logEvent` signature: `(event_type, category, label, message, file_path, extended)` (`client/server.js:546`). Omitted arguments serialize as empty strings on the wire (jQuery turns `undefined` into `""`). All rows below are **live code** unless flagged ☠ (dead).

| event_type                                                                                                                     | category                                                                                  | label                                                          | message                                                                                                              | file_path                                                   | extended | Trigger                                                                                                                                                            | Citation                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `Compile`                                                                                                                      | `""`                                                                                      | `""`                                                           | `""`                                                                                                                 | `answer.py`                                                 | false    | Student clicks Run; logged before execution (alongside a `saveFile` of answer.py)                                                                                  | client/engine/run.js:13-14                                                                                               |
| `Compile`                                                                                                                      | `""`                                                                                      | `""`                                                           | the eval'd code, prefixed: `_ = <expr>`                                                                              | `evaluations`                                               | false    | Student enters an expression in the console's eval prompt                                                                                                          | client/engine/eval.js:10, 20                                                                                             |
| `Compile.Error`                                                                                                                | `""`                                                                                      | `""`                                                           | `error.toString()`                                                                                                   | `answer.py`                                                 | false    | Run failed and parse/verify report was unsuccessful (syntax error)                                                                                                 | client/engine/run.js:84-86                                                                                               |
| `Compile.Error`                                                                                                                | `""`                                                                                      | `""`                                                           | `error.toString()`                                                                                                   | `evaluations`                                               | false    | Console eval failed                                                                                                                                                | client/engine/eval.js:57                                                                                                 |
| `Run.Program`                                                                                                                  | `""`                                                                                      | `""`                                                           | JSON `{inputs: "\n"-joined, outputs: "\n"-joined}`                                                                   | `answer.py`                                                 | false    | Student program ran to completion                                                                                                                                  | client/engine/run.js:42-48                                                                                               |
| `Run.Program`                                                                                                                  | `ProgramErrorOutput`                                                                      | `""`                                                           | `error.toString()`                                                                                                   | `answer.py`                                                 | false    | Program parsed but raised a runtime error                                                                                                                          | client/engine/run.js:78-83                                                                                               |
| `Intervention`                                                                                                                 | Pedal feedback category (e.g. `Instructor`, `syntax`, `runtime`, `no errors`, `Complete`) | Pedal feedback label (e.g. `Instructor Feedback`, `No errors`) | JSON `{message (rendered markdown HTML), syntaxError: bool, runtimeError: bool, unitTests: {…}}`                     | `answer.py`                                                 | **true** | Every feedback presentation after a run (updateFeedback)                                                                                                           | client/feedback.js:184-186, 203-210, 223-230                                                                             |
| `X-Evaluate.Program`                                                                                                           | `""`                                                                                      | `""`                                                           | `""`                                                                                                                 | `evaluations`                                               | false    | Console eval succeeded                                                                                                                                             | client/engine/eval.js:27                                                                                                 |
| `X-File.Add`                                                                                                                   | `""`                                                                                      | `""`                                                           | the eval'd code                                                                                                      | `evaluations`                                               | false    | Console eval begins (models the eval as adding a file)                                                                                                             | client/engine/eval.js:19                                                                                                 |
| `X-File.Reset`                                                                                                                 | `""`                                                                                      | `""`                                                           | `""`                                                                                                                 | `answer.py`                                                 | false    | Student clicks the editor Reset button (restores starting code + extra starting files)                                                                             | client/blockpy.js:1045-1054                                                                                              |
| `X-View.Change`                                                                                                                | `""`                                                                                      | `""`                                                           | new mode: `block` \| `split` \| `text`                                                                               | current filename (`display.filename()`)                     | false    | Student switches Blocks/Split/Text tab                                                                                                                             | client/blockpy.js:1073-1075; modes client/editor/python.js:15-19                                                         |
| `X-Instructions.Change`                                                                                                        | `""`                                                                                      | `""`                                                           | the new instructions content (or `null` on reset)                                                                    | `instructions.md`                                           | false    | Instructor feedback code calls `set_instructions`, changing `display.changedInstructions`                                                                          | client/blockpy.js:1272-1276; setter client/skulpt_modules/sk_mod_instructor.js:360                                       |
| `X-Rating`                                                                                                                     | current feedback category                                                                 | current feedback label                                         | `thumbs-up` \| `thumbs-down` (a `meh` button exists but is commented out)                                            | _(omitted → `""`)_                                          | false    | Student clicks a feedback rating thumb                                                                                                                             | client/blockpy.js:797-801; buttons client/feedback.js:56-63                                                              |
| `X-Editor.Paste`                                                                                                               | `""`                                                                                      | `""`                                                           | JSON `{characters: n}` - **always `{characters: 0}`**: the inner `const characters` shadows the outer variable (bug) | current editor filename                                     | false    | Paste into the CodeMirror text editor                                                                                                                              | client/editor/python.js:238-248, 272                                                                                     |
| `X-File.Upload`                                                                                                                | `""`                                                                                      | `""`                                                           | full uploaded file contents (ipynb converted to .py)                                                                 | current editor filename                                     | false    | Student uploads a file into the Python editor (then auto-runs)                                                                                                     | client/editor/python.js:454-463                                                                                          |
| `X-File.Download`                                                                                                              | `""`                                                                                      | `""`                                                           | `""`                                                                                                                 | download name (for `answer.py`: sluggified assignment name) | false    | Student downloads the current file                                                                                                                                 | client/editor/python.js:466-473                                                                                          |
| `X-System.Error`                                                                                                               | `internal`                                                                                | `Internal Error`                                               | converted Skulpt error text (also for TimeoutError)                                                                  | filename that was executing                                 | false    | Internal/timeout error during execution                                                                                                                            | client/feedback.js:504-518                                                                                               |
| `X-Feedback`                                                                                                                   | `positive`                                                                                | `hover`                                                        | tooltip text of the positive-feedback icon                                                                           | `""`                                                        | false    | Student hovers a positive-feedback star icon                                                                                                                       | client/feedback.js:286-288                                                                                               |
| `X-Display.Fullscreen.Request`                                                                                                 | `""`                                                                                      | `""`                                                           | `"true"`/`"false"` (`isFullscreen.toString()`)                                                                       | `""`                                                        | false    | Fullscreen toggle requested                                                                                                                                        | client/interface.js:50-52                                                                                                |
| `X-Display.Fullscreen.Success`                                                                                                 | `""`                                                                                      | `""`                                                           | `""`                                                                                                                 | `""`                                                        | false    | `requestFullscreen()` resolved                                                                                                                                     | client/interface.js:60-62                                                                                                |
| `X-Display.Fullscreen.Error`                                                                                                   | `""`                                                                                      | `""`                                                           | `` `Error attempting to enable full-screen mode: ${err.message} (${err.name})` ``                                    | `""`                                                        | false    | `requestFullscreen()` rejected                                                                                                                                     | client/interface.js:55-59                                                                                                |
| `X-Display.Fullscreen.Exit`                                                                                                    | `""`                                                                                      | `""`                                                           | `"false"` (`isFullscreen.toString()` on exit path)                                                                   | `""`                                                        | false    | `exitFullscreen()` resolved                                                                                                                                        | client/interface.js:66-71                                                                                                |
| `X-IP.Change`                                                                                                                  | _(undefined → `""`)_                                                                      | _(undefined → `""`)_                                           | JSON `{old, new}` IP strings                                                                                         | _(omitted)_                                                 | false    | Response `ip` differs from localStorage `IP`; routed through `altLogEntry` (the hosting component's logEvent) when one is registered                               | client/server.js:62-82, 55; frontend/components/assignment_interface.ts:85-86. See §1.5 caveat on the `_postRetry` path. |
| ☠ `Session.End` / `Session.Start`                                                                                              | -                                                                                         | -                                                              | -                                                                                                                    | -                                                           | -        | `createEventLogs` would bind these to window blur/focus, but **it is never called anywhere** (definition only)                                                     | client/server.js:136-145; no call sites in the repo                                                                      |
| ☠ `engine` (category `on_change`)                                                                                              | `on_change`                                                                               | -                                                              | -                                                                                                                    | -                                                           | -        | Inside legacy `BlockPyEngine.on_change()`, which references the pre-rewrite model (`model.programs`, `server.saveCode` - neither exists) and has **no call sites** | client/engine.js:184-211                                                                                                 |
| ☠ `editor` (categories `text`, `reset`, `blocks`, `split`, `import`, `history`, `instructor`, `english`, `upload`, `download`) | as listed                                                                                 | -                                                              | -                                                                                                                    | -                                                           | -        | Old `BlockPyToolbar` module; **not exported and never imported** - entire file is dead                                                                             | client/toolbar.js:10, 30-164 (no `import`/`export` of `BlockPyToolbar` anywhere in src/)                                 |

Reading history back, the client's History viewer only replays `File.Edit`/`File.Create` rows and hides `Compile`, `Intervention`, and (for hidden assignments) `X-Submission.LMS` (`client/history.js:55-65, 118-122`); its display-name map documents the analyst-facing names (`client/history.js:126-134`).

---

## 4. Event vocabulary - blockpy-server frontend (reader / kettle / explain / timers)

All of these go through `AssignmentInterface.logEvent(eventType, category, label, message, file_path, callback)` (`frontend/components/assignment_interface.ts:258-285`) with the §1.3 payload. **The quizzer and textbook components emit no logEvent calls at all** - quiz answers persist via `saveFile("answer.py", quiz-JSON)` (`frontend/components/quizzes/quizzer.ts:146-162`), which produces _server-side_ `File.Edit` rows (§5); `textbook.ts` contains no logging (no matches for `logEvent`/`Resource`).

| event_type        | category  | label            | message                                                                                                                                                                                                                          | file_path                | Trigger                                                                                                                                                    | Citation                                                                  |
| ----------------- | --------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Resource.View`   | `reading` | `visibility`     | `document.visibilityState` (`"visible"` \| `"hidden"`)                                                                                                                                                                           | assignment URL           | `visibilitychange` on the window while any AssignmentInterface (reader/quiz/kettle/explain) is mounted                                                     | frontend/components/assignment_interface.ts:121-139                       |
| ☠ `Resource.View` | `reading` | `focus` / `blur` | `""`                                                                                                                                                                                                                             | assignment URL           | window focus/blur - **commented out** in favor of `visibility`                                                                                             | frontend/components/assignment_interface.ts:122-133                       |
| `Resource.View`   | `reading` | `read`           | JSON `{count, delay, position, height, progress, moved}` - scroll position poll; `delay = count * 30000` ms so polls space out linearly (LOG_TIME_RATE = 30000)                                                                  | assignment URL           | Recurring while a reading is open; each success schedules the next poll; position comes from an `lti.fetchWindowSize` postMessage round-trip when embedded | frontend/components/reader/reader.ts:27, 336-372                          |
| `Resource.View`   | `reading` | `watch`          | HTML5 `<video>`: JSON `{event, time, duration}` where `event` ∈ `pause playing seeked ended loadeddata error ratechange waiting` (`VIDEO_EVENTS`), `time` = `currentTime` (s), `duration` = watch-span seconds on `pause` else 0 | assignment URL           | Native video element events on the reading's video                                                                                                         | frontend/components/reader/reader.ts:28, 259-271, 306-309                 |
| `Resource.View`   | `reading` | `watch`          | YouTube: JSON `{event, time}` where `event` = `YT.PlayerState` integer (−1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued) from `onStateChange`, `time` = `getCurrentTime()`                                       | assignment URL           | YouTube IFrame API state changes                                                                                                                           | frontend/components/reader/reader.ts:272-278, 311-334                     |
| `timer_error`     | `timer`   | `time_error`     | JSON `{error, stack}`                                                                                                                                                                                                            | assignment URL (or `""`) | Exception inside the 5-second exam-timer check                                                                                                             | frontend/components/assignment_interface.ts:92-110                        |
| `timer_cleared`   | `timer`   | `time_clear`     | `""`                                                                                                                                                                                                                             | assignment URL           | A superseded timer instance clears itself                                                                                                                  | frontend/components/assignment_interface.ts:160-176                       |
| `timer_expired`   | `timer`   | `time_up`        | JSON `{elapsed, remaining, time_limit, start_time}`                                                                                                                                                                              | assignment URL           | Exam time limit reached; blocking overlay shown                                                                                                            | frontend/components/assignment_interface.ts:200-245                       |
| `Run.Program`     | `kettle`  | `run`            | JSON (pretty-printed, indent 2) `{code, output: JSON-string of console history, errors: JSON-string, timer}`                                                                                                                     | assignment URL           | Kettle (JS/TS/R) execution finished (`logExecution()`; the `eventType` parameter has no non-default caller)                                                | frontend/components/kettle/kettle.ts:723-731, 857                         |
| `Compile`         | `kettle`  | `compile`        | JSON (indent 2) `{code}`                                                                                                                                                                                                         | assignment URL           | Kettle compilation step                                                                                                                                    | frontend/components/kettle/kettle.ts:733-738, 970                         |
| `Intervention`    | `kettle`  | `""`             | feedback text (plain, not JSON)                                                                                                                                                                                                  | assignment URL           | Kettle feedback presented                                                                                                                                  | frontend/components/kettle/kettle.ts:680, 740-743                         |
| `X-File.Reset`    | `kettle`  | `code_reset`     | JSON `{code: <starting code>}`                                                                                                                                                                                                   | assignment URL           | Student confirms reset-to-starter-code                                                                                                                     | frontend/components/kettle/kettle.ts:1119-1127                            |
| `X-File.Reset`    | `kettle`  | `score_reset`    | JSON `{score: 0}`                                                                                                                                                                                                                | assignment URL           | Student confirms score reset                                                                                                                               | frontend/components/kettle/kettle.ts:1129-1138                            |
| `File.Edit`       | `explain` | `upload_file`    | JSON `{filename, contents}`                                                                                                                                                                                                      | assignment URL           | Student uploads code to the Explain tool (the **only client-emitted** `File.Edit`)                                                                         | frontend/components/explanations/explain.ts:320-342                       |
| `X-IP.Change`     | `""`      | `""`             | JSON `{old, new}`                                                                                                                                                                                                                | _(undefined)_            | Delegated from the embedded BlockPy editor via `altLogEntry`                                                                                               | frontend/components/assignment_interface.ts:85-86; client/server.js:71-75 |

Note the Explain tool's copy/paste/blur/focus/mouseout trackers do **not** emit events - they only bump counters saved inside the submission JSON (`frontend/components/explanations/event_trackers.ts:73-82`; `explain.ts:182-192, 317`).

Templates under `server/templates/blockpy/` contain no inline `logEvent` calls - only the URL-map injection (`editor.html:210`, `textbook.html:164`) and a history _viewer_ (`browse_history.html:26-35`).

---

## 5. Server-fabricated events (context only - the studio client must NOT emit these)

These rows appear in the same `submission_log` table and are consumed by the same research pipelines, but they originate server-side:

| event_type                                                                              | Origin                                                                                                                              | Citation                                                                                                            |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Session.Start` (message = JSON browser info)                                           | Student loads an assignment (`load_assignment`) - this, not the client, is the live source of Session.Start                         | server/controllers/endpoints/blockpy.py:196, 206-213                                                                |
| `X-Submission.Get` (message = student id)                                               | Grader loads another student's submission                                                                                           | blockpy.py:207-210                                                                                                  |
| `File.Edit` (file_path = filename + optional `#part_id`, message = new full code)       | Every `save_file` of a student file - i.e., the client's autosave _implies_ File.Edit without emitting it                           | blockpy.py:238-271; enum value `SubmissionLogEvent.BLOCKPY_FILE_EDIT = "File.Edit"`, server/models/enums/logs.py:56 |
| `File.Create` (file_path `answer.py`, message = starting code)                          | New submission created from assignment                                                                                              | server/models/submission.py:425-455; enums/logs.py:57                                                               |
| `X-View.Submission` (category `single`, file_path `answer.py`, message JSON `{viewer}`) | Grader views a submission page                                                                                                      | blockpy.py:480-503, 505-529                                                                                         |
| `X-Image.Save` (file_path = directory)                                                  | `save_image` endpoint                                                                                                               | blockpy.py:860-878                                                                                                  |
| `Submit` (message `client_status\|valid_status`)                                        | Grade pipeline                                                                                                                      | server/controllers/pylti/post_grade.py:277; LogEventType server/models/generics/definitions.py:87-93                |
| `X-Submission.LMS` (message `total                                                      | sub`scores),`X-Unchanged.LMS`, `X-Submission.LMS.Failure`, `X-Submission.LMS.Retry-Failure`, `X-Quiz.Grade.Failure`, `X-IP.Blocked` | LTI grade passback outcomes                                                                                         | post_grade.py:99-141, 268; definitions.py:88-92; server/tasks/tasks.py:194-198 |
| `X-Grade.Instructor` (message JSON `{grader_id, score, correct, message}`)              | Bulk instructor grading upload                                                                                                      | server/controllers/endpoints/grading.py:255-262                                                                     |
| `start_timer` / `clear_timer` (message = date_started)                                  | Exam timer set/cleared via `start_assignment`                                                                                       | blockpy.py:629-643; enums/logs.py:51-52                                                                             |
| `extend_time`                                                                           | Instructor extends a student's time limit                                                                                           | server/controllers/endpoints/courses.py:1191-1193; enums/logs.py:50                                                 |
| `error` (message = blocked IP / JSON `{ip_address, viewer_id}`)                         | IP-range rejection                                                                                                                  | server/controllers/helpers.py:240-251, 288-294; enums/logs.py:44                                                    |

The server's own enum of "known" submission event types (`SubmissionLogEvent`, `server/models/enums/logs.py:33-58`) is _advisory_ - the `event_type` column is a free string (`submission_log.py:41`), and most client vocabulary (e.g., `Run.Program`, `Intervention`, all `X-Display.*`) is not in the enum.

### 5.1 Studio extension events (spec §14.4: only `X-` additions allowed)

New events the Studio client emits with no legacy analog. Same wire shape
as every other event; researchers can filter them out by name.

| event_type              | category | label | message          | file_path       | Trigger                                                                                                                                | Added        |
| ----------------------- | -------- | ----- | ---------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `X-File.Rename`         | `""`     | `""`  | new legacy name  | old legacy name | File renamed via toolbar/tree UI                                                                                                       | M3.7 / LD-21 |
| `X-File.Move`           | `""`     | `""`  | target namespace | legacy name     | Instructor moves a file between namespaces                                                                                             | M3.7 / LD-21 |
| `X-File.Delete`         | `""`     | `""`  | `""`             | legacy name     | File deleted (tree rail rows; the toolbar Delete of `answer.py`-adjacent files keeps legacy `X-File.Reset` semantics where applicable) | M3.7 / LD-21 |
| `X-Display.Focus.Enter` | `""`     | `""`  | `""`             | active filename | Focused editor mode entered (toolbar button / Ctrl+Alt+F)                                                                              | M4.2         |
| `X-Display.Focus.Exit`  | `""`     | `""`  | `""`             | active filename | Focused editor mode left (button / Esc / assignment switch does NOT log - only user exits)                                             | M4.2         |

---

## 6. Open questions / ambiguities

1. **Frontend `version` mismatch (§1.3).** Frontend components put the _assignment_ version in the `version` param (→ `submission_version` column) and omit `assignment_version` (`assignment_interface.ts:274`). Bug or convention? The rewrite must decide whether to replicate faithfully (bit-compatible logs) or fix (cleaner data, breaks longitudinal comparability). Recommend replicating and flagging.
2. **`X-Editor.Paste` always reports 0 characters** due to the `const` shadowing bug (`client/editor/python.js:239-241`). Replicate the event; decide whether to replicate the bug. Any fix changes the `message` distribution research code may rely on.
3. **`checkIP` via `_postRetry` passes `response.ip` (a string) instead of `response`** (`client/server.js:295`), so `X-IP.Change` in practice only fires from `_postLatestRetry`/`_postBlocking` responses (saveFile/loadAssignment/etc., server.js:332, 384). Intended firing surface unclear.
4. **`_dequeueData` `splice(index)` one-arg bug** flushes the queue tail on any successful dequeue (`client/server.js:267-274`), and the startup flush is LIFO via `.pop()` (server.js:100-112). Net effect: the offline queue rarely preserves more than approximately-recent events, in reverse order. Does any research pipeline depend on queue-replay ordering? Probably not - but the rewrite's "offline queue flushed on reconnect" (README §14.5/17.5) will behave _better_ than legacy; flag as `X-` behavioral difference or reproduce.
5. **Session semantics.** Client-side `Session.Start`/`Session.End` on focus/blur is dead code (`client/server.js:136-145`, no callers); the live `Session.Start` is server-generated on assignment load with browser info (`blockpy.py:212-213`). There is **no** `Session.End` anywhere live. Should the studio emit focus/blur sessions (resurrecting dead intent) or match live behavior (server-only)? Default: match live behavior.
6. **`extended` flag.** Only `Intervention` from the BlockPy client sets `extended=true` (`client/feedback.js:230`); frontend components never send it. Its only observable effect is the DB column (not echoed in `encode_json`, `submission_log.py:61-81`). Confirm whether any export pipeline reads it before dropping it.
7. **Timer event names are lowercase snake_case** (`timer_error`, `timer_cleared`, `timer_expired` - `assignment_interface.ts:98, 169, 234`), breaking the ProgSnap2 `Verb.Noun` convention, and their server-side cousins are `start_timer`/`clear_timer`. Preserve exactly; do not "normalize".
8. **Quizzer emits nothing.** README §14.4 mentions "quiz … interaction events"; none exist (§4). Quiz activity is only visible through server-side `File.Edit` rows of quiz-answer JSON. If the studio quizzer wants richer telemetry, it must be new `X-` events.
9. **`Resource.View`/`read` cadence depends on a postMessage round-trip** (`lti.fetchWindowSize` → LMS parent frame, `reader.ts:336-345`). Outside an LTI iframe the response may never arrive; polls then only continue when the parent replies. Verify desired standalone behavior.
10. **Kettle `logExecution(eventType)` parameter** defaults to `Run.Program` and currently has no other caller (`kettle.ts:723, 857`) - treat the parameter as vestigial but keep `Run.Program` fixed.
11. **`GET` is also accepted** by the endpoint (`blockpy.py:320-321`) but no legacy client uses it; the studio should POST only.
12. **`X-Rating` `meh` value** exists in commented-out markup (`client/feedback.js:59`) - the message union today is `thumbs-up` | `thumbs-down` only.

---

## 7. Frozen `events.ts` sketch (review-gate deliverable)

```typescript
/**
 * Frozen legacy event vocabulary for the BlockPy Studio rewrite.
 * Derived from blockpy/src (client editor) and blockpy-server/frontend
 * (reader/kettle/explain/timer components). See Appendix A2 for file:line
 * provenance of every member. DO NOT add members here - new studio
 * behaviors must use X.* extensions in a separate namespace.
 */

/** Event types emitted by legacy CLIENTS through POST /blockpy/log_event. */
export enum EventType {
  /** Pre-execution marker for a run (blockpy client run.js:14) or console eval (eval.js:20); kettle compile step (kettle.ts:734). */
  Compile = 'Compile',
  /** Syntax/parse failure of a run (run.js:85) or console eval (eval.js:57). */
  CompileError = 'Compile.Error',
  /** Program execution completed (run.js:48) or raised a runtime error (run.js:83, category ProgramErrorOutput); kettle execution (kettle.ts:724). */
  RunProgram = 'Run.Program',
  /** Pedal feedback shown to the student (feedback.js:230, extended=true) or kettle feedback (kettle.ts:741). */
  Intervention = 'Intervention',
  /** Reading/viewing telemetry: visibility, scroll ("read"), and video ("watch") (assignment_interface.ts:135; reader.ts:263,273,361). */
  ResourceView = 'Resource.View',
  /** Explain-tool code upload - the only client-emitted File.Edit (explain.ts:335). Server also fabricates File.Edit on every save_file. */
  FileEdit = 'File.Edit',
  /** Exam timer machinery (assignment_interface.ts:98,169,234). Lowercase names are legacy-exact. */
  TimerError = 'timer_error',
  TimerCleared = 'timer_cleared',
  TimerExpired = 'timer_expired',

  // --- X- extensions (legacy custom events) ---
  /** Console eval treated as adding an "evaluations" file (eval.js:19). */
  XFileAdd = 'X-File.Add',
  /** Console eval succeeded (eval.js:27). */
  XEvaluateProgram = 'X-Evaluate.Program',
  /** Reset to starting code: editor button (blockpy.js:1046) or kettle code/score reset (kettle.ts:1122,1133). */
  XFileReset = 'X-File.Reset',
  /** Block/Split/Text mode switch; message is a DisplayMode (blockpy.js:1074). */
  XViewChange = 'X-View.Change',
  /** Instructor feedback rewrote the instructions (blockpy.js:1274). */
  XInstructionsChange = 'X-Instructions.Change',
  /** Student rated the feedback; message is a RatingValue (blockpy.js:798). */
  XRating = 'X-Rating',
  /** Paste into the text editor; message {characters} (always 0 - legacy bug) (python.js:245). */
  XEditorPaste = 'X-Editor.Paste',
  /** File uploaded into the editor; message = contents (python.js:460). */
  XFileUpload = 'X-File.Upload',
  /** File downloaded from the editor; file_path = download name (python.js:472). */
  XFileDownload = 'X-File.Download',
  /** Internal/timeout Skulpt error (feedback.js:517). */
  XSystemError = 'X-System.Error',
  /** Hover over a positive-feedback icon (feedback.js:287). */
  XFeedback = 'X-Feedback',
  /** Fullscreen lifecycle (interface.js:51-69). */
  XDisplayFullscreenRequest = 'X-Display.Fullscreen.Request',
  XDisplayFullscreenSuccess = 'X-Display.Fullscreen.Success',
  XDisplayFullscreenError = 'X-Display.Fullscreen.Error',
  XDisplayFullscreenExit = 'X-Display.Fullscreen.Exit',
  /** Client detected its public IP changed between responses (server.js:74). */
  XIpChange = 'X-IP.Change',
}

/** Server-fabricated event types that share the log table. The client must NEVER emit these. */
export enum ServerEventType {
  SessionStart = 'Session.Start', // load_assignment, blockpy.py:213
  FileEdit = 'File.Edit', // save_file, blockpy.py:269
  FileCreate = 'File.Create', // new submission, submission.py:447
  Submit = 'Submit', // post_grade.py:277
  XSubmissionGet = 'X-Submission.Get', // blockpy.py:210
  XViewSubmission = 'X-View.Submission', // blockpy.py:494,521
  XImageSave = 'X-Image.Save', // blockpy.py:877
  XSubmissionLms = 'X-Submission.LMS', // post_grade.py:130 / tasks.py:194
  XUnchangedLms = 'X-Unchanged.LMS', // post_grade.py:134
  XSubmissionLmsFailure = 'X-Submission.LMS.Failure', // post_grade.py:141
  XSubmissionLmsRetryFailure = 'X-Submission.LMS.Retry-Failure', // tasks.py:198
  XQuizGradeFailure = 'X-Quiz.Grade.Failure', // post_grade.py:268
  XIpBlocked = 'X-IP.Blocked', // post_grade.py:108
  XGradeInstructor = 'X-Grade.Instructor', // grading.py:257
  StartTimer = 'start_timer', // blockpy.py:635
  ClearTimer = 'clear_timer', // blockpy.py:643
  ExtendTime = 'extend_time', // courses.py:1192
  Error = 'error', // helpers.py:248,292 (IP rejection)
}

/** `category` values observed per event family. Empty string is the default. */
export type EventCategory =
  | '' // most editor events
  | 'ProgramErrorOutput' // Run.Program runtime failure (run.js:83)
  | 'reading' // Resource.View (assignment_interface.ts / reader.ts)
  | 'timer' // timer_* events
  | 'kettle' // all kettle events
  | 'explain' // explain File.Edit
  | 'positive' // X-Feedback
  | 'internal' // X-System.Error
  | string; // Intervention / X-Rating carry the live Pedal
// feedback category (open vocabulary, e.g.
// "Instructor", "syntax", "runtime", "no errors")

/** `label` values observed per event family. Empty string is the default. */
export type EventLabel =
  | ''
  | 'visibility'
  | 'read'
  | 'watch' // Resource.View (focus/blur are dead code)
  | 'time_error'
  | 'time_clear'
  | 'time_up' // timer_*
  | 'run'
  | 'compile'
  | 'code_reset'
  | 'score_reset' // kettle
  | 'upload_file' // explain File.Edit
  | 'hover' // X-Feedback
  | 'Internal Error' // X-System.Error
  | string; // Intervention / X-Rating: live Pedal label

/** X-View.Change message values (editor/python.js:15-19). */
export type DisplayMode = 'block' | 'split' | 'text';

/** X-Rating message values (feedback.js:56-63; "meh" is commented out in legacy). */
export type RatingValue = 'thumbs-up' | 'thumbs-down';

/** HTML5 video events forwarded inside Resource.View/watch messages (reader.ts:28). */
export type VideoWatchEvent =
  'pause' | 'playing' | 'seeked' | 'ended' | 'loadeddata' | 'error' | 'ratechange' | 'waiting';

/** YouTube watch events use YT.PlayerState integers instead (reader.ts:272-278). */
export type YouTubeWatchEvent = -1 | 0 | 1 | 2 | 3 | 5;

/** Wire payload for POST /blockpy/log_event (form-encoded, Bearer token in header). */
export interface LogEventPayload {
  assignment_id: number;
  assignment_group_id: number;
  course_id: number;
  submission_id: number;
  user_id: number;
  /** Submission version (BlockPy client) - but the legacy server-frontend
   *  components send the ASSIGNMENT version here (assignment_interface.ts:274). */
  version: number;
  /** BlockPy client only; server defaults to 0 when absent. */
  assignment_version?: number;
  /** Client clock, integer milliseconds since epoch (Date.getTime()). Stored verbatim as string. */
  timestamp: number;
  /** Date.getTimezoneOffset(), minutes. Stored verbatim as string. */
  timezone: number;
  passcode: string;
  /** BlockPy client only (reader-embedded part regions). */
  part_id?: string;
  event_type: EventType;
  category: EventCategory;
  label: EventLabel;
  /** Plain text or JSON-encoded blob; see per-event table in Appendix A2 §3-4. */
  message: string;
  file_path: string;
  /** Only Intervention sends true (feedback.js:230); frontend components omit it. */
  extended?: boolean;
}
```

---

## 8. Deltas from README §14.4

- **`Session.Start` is not a client event.** The client's focus/blur session logging is dead code (client/server.js:136-145, never invoked); live `Session.Start` rows are created server-side during `load_assignment` (blockpy.py:212-213), and no `Session.End` exists at all. The studio should not emit either.
- **`File.Edit` is (almost entirely) not a client event.** It is fabricated server-side from every `save_file` call (blockpy.py:267-270); the sole client emission is the Explain tool's upload (explain.ts:335). The VFS event-logger note in README §7.2 ("the event logger (`File.Edit` etc.)") should read: _the persistence adapter's `saveFile` traffic produces File.Edit rows server-side_.
- **No quiz interaction events exist** (README implies "quiz/reading interaction events"; only reading events exist - §4).
- **Batching:** confirmed none; strictly per-event POST with a localStorage offline queue (max 200, dedup, LIFO flush with legacy splice bug - §2). The README's proposed default (per-event POST + offline queue flushed on reconnect) matches legacy in spirit but not in its buggy details (§6.4).
- **`X-View.Change`** is specifically the Blocks/Split/Text mode switch with message ∈ {block, split, text} - not a generic view event.
