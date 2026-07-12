# Appendix A4 — Settings Inventory (verified against legacy sources)

**Legacy sources audited (read-only):**

- Client: `c:/Users/acbar/Projects/blockpy-edu/blockpy/src/` (BlockPy 5.1.2, `src/blockpy.js:46`)
- Server template: `c:/Users/acbar/Projects/blockpy-server/templates/blockpy/editor.html`
- Server models/controllers: `c:/Users/acbar/Projects/blockpy-server/` (cited where a setting is consumed server-side)

All line numbers below refer to the working copies as of 2026-07-10.

**How the assignment-settings pipeline works.** The single source of truth for the
`!assignment_settings.blockpy` blob is the `ASSIGNMENT_SETTINGS` registry, an array of
`[clientName, serverName, default, type, doc]` rows at
`blockpy/src/editor/assignment_settings.js:4-44`. The blob's JSON keys are the
**serverName** column (snake_case). Three functions define behavior:

- `makeAssignmentSettingsModel(configuration)` (`assignment_settings.js:340-358`) — builds one
  Knockout observable per row; seeds each from the constructor option-bag key
  `"assignment.settings.<serverName>"` if present (`assignment_settings.js:346-353`), coercing
  bools with `configValue.toString().toLowerCase() === "true"` (`assignment_settings.js:350-352`).
- `loadAssignmentSettings(model, settings)` (`assignment_settings.js:322-338`) — called on every
  assignment load (`blockpy.js:527`). `JSON.parse`s the blob; every registered key present in the
  blob is applied; every registered key **absent** from the blob is reset to its default
  (`assignment_settings.js:327-331`); unregistered blob keys are ignored. Side effect: a truthy
  `start_view` also overwrites `display.pythonMode` (`assignment_settings.js:334-336`).
- `saveAssignmentSettings(model)` (`assignment_settings.js:309-320`) — rebuilds the blob **from the
  registry only**, writing only non-default values. **Unregistered keys are silently dropped on
  save** (see Deltas — this contradicts the "unknown keys pass through" behavior §11.1 requires;
  the spec's requirement is an intentional fix, not parity).

The blob is exposed in the file system as `!assignment_settings.blockpy`
(`files.js:398-399`, mounted at `files.js:435`; editor registration
`assignment_settings.js:407-412`) and is sent to the server in `saveAssignment` as
`data["settings"]` (`server.js:443`).

---

## Table 1 — Assignment settings keys (`!assignment_settings.blockpy` blob)

Registry row citations are `assignment_settings.js:<line>`; "consumed" cites the code that gives
the key its runtime effect. Defaults are reapplied on every load when the key is absent
(`assignment_settings.js:327-331`).

| Blob key (serverName) | Client observable | Type | Default | Effect | Registry | Consumed at |
|---|---|---|---|---|---|---|
| `toolbox` | `toolbox` | enum: `normal`, `ct`, `ct2`, `minimal`, `full`, `custom` (UI options `assignment_settings.js:263-268`) | `"normal"` | Selects the Blockly toolbox preset handed to BlockMirror; changing it reloads the toolbox; `custom` re-reads `?toolbox.blockpy` | `assignment_settings.js:5` | `editor/python.js:192`, `editor/python.js:377`, `editor/toolbox.js:80` |
| `type` | `type` | string | `"blockpy"` | Registry entry only. The operative problem type is the separate `assignment.type` observable (`blockpy.js:149`); the settings-editor "Problem Type" select binds `assignment.type`, not `settings.type` (`assignment_settings.js:280`). `settings.type` has **no runtime consumer** | `assignment_settings.js:6` | — (see quirk in Open questions) |
| `passcode` | `passcode` | string | `""` | Server-side gate. Server: `has_passcode()`/`passcode_fails()` do a constant-time compare against `get_setting("passcode", "")` (`blockpy-server/models/assignment.py:479-493`); services reject requests on failure (`blockpy-server/controllers/services/__init__.py:118,159,172,181`). Template sets `passcode_protected` (`blockpy-server/controllers/helpers.py:252-256,274`) which triggers `editor.requestPasscode()` (`editor.html:299-301`); the client prompt (`blockpy.js:1308-1311`) stores `display.passcode` (`blockpy.js:274`) which rides along on **every** API payload as `"passcode"` (`server.js:196`). No client-side comparison | `assignment_settings.js:7` | server-side (citations at left) |
| `start_view` | `startView` | enum `DisplayModes`: `block`/`split`/`text` | `"text"` (`DisplayModes.TEXT`) | Initial Python editor mode; on every assignment load a truthy value overwrites `display.pythonMode` (`assignment_settings.js:334-336`), which drives BlockMirror mode (`editor/python.js:366-369`) | `assignment_settings.js:9` | `assignment_settings.js:334-336`, `editor/python.js:366` |
| `datasets` | `datasets` | string, comma-separated dataset names | `""` | Each named CORGIS dataset is imported on load and added to the toolbox | `assignment_settings.js:10` | `corgis.js:46` |
| `disable_timeout` | `disableTimeout` | bool | `false` | Student exec limit 5000 ms → `Infinity` (`engine/student.js:9`); instructor limit 7000 ms → `Infinity` (`engine/instructor.js:15`); suppresses the "want to wait?" timeout prompt (`engine/configurations.js:34,60,63,73`) | `assignment_settings.js:11` | `engine/student.js:9`, `engine/instructor.js:15`, `engine/configurations.js:34-73` |
| `part_id` | `partId` | string | `""` | Registry entry only. The operative value is `configuration.partId`, seeded from the **option-bag key `"partId"`** (`blockpy.js:431`), used to extract the part's region from submission code (`blockpy.js:172,472`; `utilities.js:240-`) and sent as `"part_id"` in every payload (`server.js:197`). The settings-editor field binds `configuration.partId` directly (`assignment_settings.js:296`); a blob `part_id` value never reaches `configuration.partId` | `assignment_settings.js:12` | `blockpy.js:172,431,472`, `server.js:197` |
| `is_parsons` | `isParsons` | bool | `false` | `answer.py` block editor becomes a Parsons (jumbled) puzzle | `assignment_settings.js:13` | `editor/python.js:278` |
| `save_turtle_output` | `saveTurtleOutput` | bool | `false` | After a run, the last turtle/pygame canvas is uploaded as a PNG via `saveImage("turtle_output", …)` | `assignment_settings.js:14` | `console.js:468` |
| `disable_feedback` | `disableFeedback` | bool | `false` | Skips instructor scripts (`on_run` after run, `on_eval` after evaluate); raw errors shown instead | `assignment_settings.js:15` | `engine.js:115`, `engine.js:146` |
| `disable_instructor_run` | `disableInstructorRun` | bool | `false` | Pedal environment skips re-running student code inside `on_run` (student code still runs once beforehand) | `assignment_settings.js:16` | `engine/on_run.js:41` (`skip_run = get_model_info('assignment.settings.disableInstructorRun')`), `engine/on_run.js:226` |
| `disable_student_run` | `disableStudentRun` | bool | `false` | Run button executes empty student code (`this.code = ""`); instructor `on_run` still runs | `assignment_settings.js:17` | `engine/run.js:9-11` |
| `disable_tifa` | `disableTifa` | bool | `false` | Tifa static analysis skipped in `on_run` and `on_eval` | `assignment_settings.js:18` | `engine/on_run.js:119`, `engine/on_eval.js:84` |
| `disable_trace` | `disableTrace` | bool | `false` | **Declared but never consumed** (no reference outside the registry in client or server) | `assignment_settings.js:19` | — |
| `disable_edit` | `disableEdit` | bool | `false` | **Declared but never consumed**; editability is actually governed by `onlyUploads` + `display.instructor` + history mode (`editor/python.js:442-447`) | `assignment_settings.js:20` | — |
| `preload_all_files` | `preloadAllFiles` | bool | `false` | Files toolbar forced visible (`blockpy.js:914`); on load, all remotely uploaded files are listed/downloaded (`files.js:677,692-694`) | `assignment_settings.js:21` | `blockpy.js:914`, `files.js:677` |
| `can_image` | `enableImages` | bool | `false` | Copy/paste images into the text editor (BlockMirror `setImageMode`) | `assignment_settings.js:22` | `editor/python.js:378-380` |
| `can_blocks` | `enableBlocks` | bool | **`true`** | If false: Blocks/Split/Text tabs hidden (`editor/python.js:44`) and mode forced to TEXT (`editor/python.js:370-376`) | `assignment_settings.js:23` | `editor/python.js:44,370` |
| `can_close` | `canClose` | bool | `false` | Enables the Submit/close lifecycle button and "submitted" state handling | `assignment_settings.js:24` | `blockpy.js:591` (`canMarkSubmitted`), `blockpy.js:620` (`isSubmitted`) |
| `only_interactive` | `onlyInteractive` | bool | `false` | Menu hidden for students (`blockpy.js:570`), editors hidden (`blockpy.js:1042`); console enters Eval mode after auto-run | `assignment_settings.js:25` | `blockpy.js:570,1042` |
| `only_uploads` | `onlyUploads` | bool | `false` | Student editor read-only (must upload submissions); instructors exempt | `assignment_settings.js:26` | `editor/python.js:434,445` |
| `hide_submission` | `hideSubmission` | bool | `false` | **Server-side only**: submission code/history hidden in the group report (`any_hidden`) | `assignment_settings.js:28` | `blockpy-server/controllers/endpoints/blockpy.py:460` |
| `hide_files` | `hideFiles` | bool | **`true`** | Hides the View Files toolbar for students (`blockpy.js:914,917`); gates file delete/rename (`blockpy.js:1058,1061`). Note the non-false default | `assignment_settings.js:29` | `blockpy.js:914,917,1058,1061` |
| `hide_queued_inputs` | `hideQueuedInputs` | bool | `false` | Hides the queued-inputs box | `assignment_settings.js:30` | `blockpy.js:627` |
| `hide_editors` | `hideEditors` | bool | `false` | All editors hidden for students | `assignment_settings.js:31` | `blockpy.js:1041` |
| `hide_middle_panel` | `hideMiddlePanel` | bool | `false` | Console + feedback second row hidden | `assignment_settings.js:32` | `blockpy.js:671` |
| `hide_all` | `hideAll` | bool | `false` | Marked INCOMPLETE in the registry; **never consumed** | `assignment_settings.js:33` | — |
| `hide_evaluate` | `hideEvaluate` | bool | `false` | Evaluate button hidden (`blockpy.js:719`); eval-mode after run suppressed (`engine/run.js:57`) | `assignment_settings.js:34` | `blockpy.js:719`, `engine/run.js:57` |
| `hide_import_datasets_button` | `hideImportDatasetsButton` | bool | `false` | "Import datasets" button hidden | `assignment_settings.js:35` | `editor/python.js:58` |
| `hide_import_statements` | `hideImportStatements` | bool | `false` | Marked INCOMPLETE; **never consumed** | `assignment_settings.js:37` | — |
| `hide_coverage_button` | `hideCoverageButton` | bool | `false` | Marked INCOMPLETE; **never consumed** | `assignment_settings.js:38` | — |
| `hide_trace_button` | `hideTraceButton` | bool | `false` | Trace button hidden for students (instructors exempt) | `assignment_settings.js:39` | `blockpy.js:668` |
| `small_layout` | `smallLayout` | bool | `false` | Compact ("quick task") layout for students: narrower second row/console/files/editors columns and hidden footer | `assignment_settings.js:40` | `blockpy.js:546,664,713,920,1036,1214` |
| `has_clock` | `hasClock` | bool | `false` | Shows a wall clock in the menu bar. **Naming is inverted in code**: `ui.menu.showClock = !hasClock` (`blockpy.js:630`), the DOM binds `hidden: ui.menu.showClock` (`interface.js:182`), and the update interval starts when `showClock()` is false-after-subscription (`blockpy.js:1280-1295`). Net effect: `has_clock: true` displays the ticking clock. Preserve behavior, not names | `assignment_settings.js:41` | `blockpy.js:630,1280-1295`, `interface.js:182` |
| `preload_files` | `preloadFiles` | string (JSON) | `""` | JSON structure of remote files auto-downloaded on load as if local (`files.js:677-687`). Known bug: `JSON.parse(preloadFiles)` parses the expression `preloadFiles() \|\| preloadAllFiles()`, so if only `preload_all_files` is set the parse target is boolean `true` (`files.js:677,681-683`) — harmless today because that branch requires `preloadFiles()` truthy, but the variable shadowing is fragile | `assignment_settings.js:42` | `files.js:677-687` |
| `instructions_pool` | `instructionsPool` | bool | `false` | Instructions and `on_run` interpreted as pools; one variant chosen by seed (`pools.js:29-34`, `engine/on_run.js:105`); seed input UI shown (`interface.js:183-192`); seed = `display.poolSeed` else submission id (`blockpy.js:658-660`) | `assignment_settings.js:43` | `blockpy.js:559`, `interface.js:183`, `engine/on_run.js:105` |

**Count: 36 registered keys** (30 bool, 5 string/enum registered, 1 enum `startView`), of which
**6 are declared but have no runtime consumer anywhere** (`type` [as a settings key],
`disable_trace`, `disable_edit`, `hide_all`, `hide_import_statements`, `hide_coverage_button`) and
2 (`passcode`, `hide_submission`) are consumed only server-side.

### Server-only keys living in the *same* blob (not in the client registry)

The server reads additional keys out of the identical `settings` JSON column via
`Assignment.get_setting` (`blockpy-server/models/assignment.py:439-445`):

| Key | Consumed at | Effect |
|---|---|---|
| `protected_ip_ranges` | `models/assignment.py:467`, `controllers/endpoints/assignment_groups.py:232` | extra IP allow/deny ranges |
| `time_limit` | `models/assignment.py:591` | submission time limit |
| `poolRandomness` | `controllers/jinja_filters.py:166` | pool selection strategy (note: camelCase, unlike the rest) |

Because the client's `saveAssignmentSettings` rebuilds the blob from its registry only
(`assignment_settings.js:309-320`), **saving assignment settings from the legacy client destroys
these server-only keys.** The rewrite must round-trip unknown keys (README §11.1 already requires
this — it is a fix, not parity; see Deltas).

### Studio extension keys (same blob; no legacy analog)

| Key | Added | Effect |
|---|---|---|
| `docs_url` | M4.3 / LD-25 | URL of a markdown reference document rendered in the collapsible Docs panel beside the editor. Raw string; empty/absent hides the affordance. Server-ignored; a LEGACY client instructor save drops it (the registry-rebuild bug above) — Studio saves round-trip it. |

---

## Table 2 — BlockPy constructor option bag as passed by `editor.html`

Constructed at `editor.html:263-292` (`editor = new blockpy.BlockPy({...})`). The constructor's
first positional argument is stored as `this.initialConfiguration_` (`blockpy.js:117`) and read
either directly (`configuration["…"]`) or through `getSetting(key, default)`
(`blockpy.js:92-100`), whose precedence is: **option bag → localStorage (`localSettings_`) →
default**.

| Key (exact string) | Source (template side) | Template file:line | Client consumption file:line | Effect |
|---|---|---|---|---|
| `'blockly.path'` | `window.$blocklyMediaPath` = `url_for('static', filename='blockly/media/')` (`editor.html:200`) | `editor.html:265` | `blockpy.js:419` → `editor/python.js:191` | Blockly media assets path handed to BlockMirror |
| `'attachment.point'` | literal `'#blockpy-div'` | `editor.html:266` | `blockpy.js:421`, `blockpy.js:440-444` | CSS selector where the interface is injected |
| `'urls'` | `window.$blockPyUrls` (Jinja-built map, `editor.html:201-221`; save/log endpoints only emitted `{% if submissions %}`, `editor.html:207-220`) | `editor.html:267` | `blockpy.js:425` | Endpoint map; `ui.server.isEndpointConnected` treats missing keys as disconnected (`blockpy.js:1168-1171`) |
| `'user.id'` | `window.$blockPyUserData["user.id"]` = `user_id` (`editor.html:223`), spread at `editor.html:269` | `editor.html:223,269` | `blockpy.js:122` | Current user id (payloads, ownership checks) |
| `'user.name'` | `$blockPyUserData` = `user.name()`; only emitted `{% if user %}` (`editor.html:224-226`) | `editor.html:225,269` | `blockpy.js:123` | Display name |
| `'user.role'` | `$blockPyUserData` = `role` (`editor.html:227`) | `editor.html:227,269` | `blockpy.js:129` (via `getSetting`, default `"owner"`) → `ui.role.isGrader` `blockpy.js:548-550` | Role string; `owner`/`grader` unlock grader UI affordances |
| `'user.course_id'` | `$blockPyUserData` = `course_id` (`editor.html:228`) | `editor.html:228,269` | `blockpy.js:133` | Course context for payloads |
| `'access_token'` | `$blockPyUserData` = `window.accessToken` (`editor.html:229`) **and again explicitly** at `editor.html:285` | `editor.html:229,269,285` | `blockpy.js:432` → `Authorization: Bearer` header `server.js:161-172` | Cookieless-auth bearer token |
| `'user.group_id'` | `assignment_group_id`; **only when `assignment_group_id != None`** | `editor.html:272-273` | `blockpy.js:137` | Assignment group id (payloads, share URLs `blockpy.js:636`) |
| `'callback.success'` | global `markCorrect`; **only when `assignment_group_id != None`** | `editor.html:274` | `blockpy.js:411` (`configuration.callbacks.success`) | Fired on completion to update group navigation |
| `'display.instructor'` | literal `true`; **only when `role in ("owner", "grader")`** | `editor.html:277-279` | `blockpy.js:203` (`""+getSetting(...)==="true"`) | Master switch for the instructor UI (files, settings editor, grading controls) |
| `'display.read_only'` | literal `true`; **only when `read_only`** (view arg, e.g. `controllers/endpoints/blockpy.py:65,80,99`) | `editor.html:281-283` | `blockpy.js:284` (`.toString()==="true"`) | Suppresses `logEvent`, `saveImage`, `updateSubmissionStatus`, `saveFile`, `updateSubmission` (`server.js:547,569,586,642,664`) |
| *(spread)* `settings-*` params | every query param starting `settings-`, prefix stripped | `editor.html:287-291` | any key below or above | See §3 |

**Count: 12 distinct named keys** (+ the `settings-*` spread; `access_token` is emitted twice, and
`user.name`, `user.group_id`, `callback.success`, `display.instructor`, `display.read_only`, and
the save-family URLs are conditionally present).

### Table 2b — Additional option-bag keys the constructor accepts (not emitted by `editor.html`, but reachable via `settings-*` or embedders)

These must survive in the §15.1 facade because any of them can arrive through the URL loop:

| Key | Client file:line | Effect |
|---|---|---|
| `assignment.instructions` | `blockpy.js:142` | initial instructions (scratch-mode default otherwise) |
| `assignment.starting_code` | `blockpy.js:151` | initial starting code |
| `assignment.on_run` / `assignment.on_change` / `assignment.on_eval` | `blockpy.js:152-154` | initial instructor scripts |
| `assignment.extra_instructor_files` | `blockpy.js:155` | concatenated instructor files |
| `assignment.reviewed` / `assignment.public` / `assignment.hidden` / `assignment.ip_ranges` | `blockpy.js:164-167` | assignment flags |
| `assignment.settings.<serverName>` (any Table 1 key, e.g. `assignment.settings.disable_timeout`) | `assignment_settings.js:346-353` | seeds the corresponding settings observable; bools string-coerced |
| `submission.code` | `blockpy.js:172,294` | initial submission code (part-extracted) |
| `partId` | `blockpy.js:172,431` | part extraction + `part_id` payload field (`server.js:197`) |
| `display.python.mode` | `blockpy.js:212` (via `getSetting`) | initial Blocks/Split/Text mode |
| `display.showRating` | `blockpy.js:298` | feedback-rating widget visibility (also persisted to localStorage, `blockpy.js:795`) |
| `display.poolSeed` | `blockpy.js:306` | pool seed override |
| `server.connected` | `blockpy.js:417` | if falsy, all endpoints treated as offline (`blockpy.js:1168-1171`) — but see string caveat in §3 |
| `callback.success` | `blockpy.js:411` | (also settable standalone by embedders) |

---

## 3. The `settings-*` query-param mechanism (exact)

The Jinja loop, verbatim (`editor.html:287-291`, inside the `new blockpy.BlockPy({...})` literal):

```jinja
{% for name, value in request.args.items() %}
    {% if name.startswith('settings-') %}
        "{{ name[9:] }}": {{ value|tojson }},
    {% endif %}
{% endfor %}
```

Verified behavior:

1. **Prefix stripping.** `name[9:]` removes exactly the 9 characters `settings-`; the remainder is
   used **verbatim** as the option-bag key, dots and all. `?settings-display.instructor=true` →
   `"display.instructor": "true"`.
2. **Values are JSON-*encoded* strings, never JSON-parsed.** `request.args` values are strings;
   `value|tojson` emits a JS **string literal** of the raw query value (`editor.html:289`).
   `?settings-assignment.settings.disable_timeout=true` produces `"true"` (string), and
   `?settings-urls={"a":1}` produces the *string* `'{"a":1}'`, not an object. All type coercion is
   per-key on the client: `""+v === "true"` (`blockpy.js:203`), `.toString() === "true"`
   (`blockpy.js:284,298`), `.toString().toLowerCase() === "true"` for assignment-settings bools
   (`assignment_settings.js:350-352`). Keys with no coercion get the raw string — notably
   `server.connected` (`blockpy.js:417`), where the string `"false"` is truthy, so
   `?settings-server.connected=false` does **not** disconnect the server.
3. **Precedence.** The loop is emitted **last** inside the object literal, after
   `'blockly.path'`/`'urls'`, the `$blockPyUserData` spread, `'user.group_id'`,
   `'callback.success'`, `'display.instructor'`, `'display.read_only'`, and `'access_token'`
   (`editor.html:263-292`). JavaScript object-literal semantics: last duplicate key wins, so a
   `settings-*` param overrides every server-emitted key. Within the client,
   `getSetting` gives the merged option bag priority over localStorage over defaults
   (`blockpy.js:92-100`); assignment-settings keys seeded this way are then **overwritten on every
   assignment load** by `loadAssignmentSettings` from the assignment's blob
   (`assignment_settings.js:322-338`) — so `settings-assignment.settings.*` params only affect the
   pre-load/scratch state unless the loaded blob omits nothing… i.e., they do *not* survive a
   server assignment load. `display.*`/`user.*`/`configuration` keys are read once at construction
   and *do* stick.
4. **Duplicates.** Werkzeug's `request.args.items()` yields one entry per key (first value), so
   repeating a `settings-` param uses its first occurrence; distinct keys each emit one line.

---

## 4. Student-overridable vs instructor-only

**The code does not distinguish.** The Jinja loop (`editor.html:287-291`) has no role guard —
`settings-*` params are applied for every viewer, including students. The only role-derived keys
are the *defaults* the template emits earlier (`display.instructor` at `editor.html:277-279`,
`display.read_only` at `editor.html:281-283`), and because the loop is emitted after them, a
student URL `?settings-display.instructor=true` yields the instructor UI client-side
(`blockpy.js:203` performs no role cross-check, and `ui.role.isGrader` at `blockpy.js:548-550`
is a separate check on `user.role` — which is itself overridable via `settings-user.role`, since
it is read through `getSetting` at `blockpy.js:129`).

The actual security boundary is server-side and must remain so: endpoint scopes and role checks in
`blockpy-server/controllers` (e.g. `load_submission` scoping at
`controllers/endpoints/blockpy.py:66-72`), passcode verification via constant-time compare
(`models/assignment.py:479-489` — the client never validates; answers the §11.1 "verify: local
hash vs server check" note), and instructor file filtering in the assignment serializers
(`models/assignment.py:320` `for_read_only_editor`). Conclusion for the rewrite: treat every
`settings-*` key as student-reachable presentation state; nothing confidential (instructor files,
answers, on_run source) may be gated client-side on `display.instructor` alone.

---

## 5. Deltas from the spec draft (studio/README.md)

1. **§15.2 "value JSON-parsed" is wrong.** The template JSON-*encodes* the raw query string
   (`{{ value|tojson }}`, `editor.html:289`); values always arrive as **strings** and are coerced
   per-key (see §3.2). §5.2's `BootConfig.settings: Record<string, unknown>; // parsed
   'settings-*' query params` (README ~line 156) inherits the same error — it should be
   `Record<string, string>` with legacy string-coercion rules, or the shim must replicate the
   coercions exactly. A true-JSON-parsing rewrite would change behavior (e.g. `"false"` becoming
   boolean `false` would *newly activate* keys like `server.connected` that the legacy string
   semantics leave truthy).
2. **§15.1 key list is incomplete as a type surface.** Beyond the 12 keys `editor.html` emits,
   the constructor consumes `assignment.instructions`, `assignment.starting_code`,
   `assignment.on_run/on_change/on_eval`, `assignment.extra_instructor_files`,
   `assignment.reviewed/public/hidden/ip_ranges`, `assignment.settings.<serverName>` (all 36),
   `submission.code`, `partId`, `display.python.mode`, `display.showRating`, `display.poolSeed`,
   and `server.connected` (Table 2b citations). "Plus arbitrary `settings-*`-derived keys" covers
   them informally, but the facade should enumerate them since each has defined semantics.
3. **§15.2 "Applied last, over BootConfig" is correct** — confirmed by emission order
   (`editor.html:263-292`) — but add: option bag beats localStorage beats default
   (`blockpy.js:92-100`), and `settings-assignment.settings.*` values are subsequently clobbered
   by any server assignment load (`assignment_settings.js:322-338`).
4. **§11.1 "Unknown keys pass through untouched" is a fix, not parity.** The legacy client *drops*
   unknown blob keys on save (`assignment_settings.js:309-320`), and the server actively uses keys
   outside the client registry (`protected_ip_ranges`, `time_limit`, `poolRandomness` —
   `models/assignment.py:467,591`, `controllers/jinja_filters.py:166`). Keep the spec requirement,
   but conformance tests must not diff against legacy save output for blobs containing unknown
   keys.
5. **Non-obvious defaults to freeze:** `hide_files` defaults to **true** and `can_blocks` to
   **true** (`assignment_settings.js:29,23`); all other bools default false. Absent keys are
   reset to defaults on every load (`assignment_settings.js:327-331`) — the blob is authoritative
   per-assignment, not sticky.
6. **`has_clock` is inverted in implementation** (`ui.menu.showClock = !hasClock`,
   `blockpy.js:630`; DOM binds `hidden: showClock`, `interface.js:182`; interval logic
   `blockpy.js:1280-1295`). Net behavior (true ⇒ clock visible+ticking) matches the doc string;
   any port copying the *names* will invert the feature.
7. **`start_view` has a load-time side effect** — overwrites the user's current editor mode on
   every assignment load (`assignment_settings.js:334-336`), interacting with the
   `display.python.mode` option-bag key (`blockpy.js:212`). §11.1's "start view" bullet should
   note the override-on-load.
8. **Six registered settings are no-ops** (`type` [settings copy], `disable_trace`,
   `disable_edit`, `hide_all`, `hide_import_statements`, `hide_coverage_button`) — three
   explicitly marked INCOMPLETE in their doc strings (`assignment_settings.js:33,37,38`). §11.1's
   "identical names and effects" therefore means: accept and round-trip them, and keep them
   inert.
9. **§5.2 BootConfig `display.readOnly` semantics:** read-only suppresses five server calls
   (`server.js:547,569,586,642,664`), not merely editor editability — the BootConfig doc should
   say so, since the rewrite's network layer must implement the same suppression.
10. **`access_token` is emitted twice** (`editor.html:229` via spread, `editor.html:285`
    explicitly) — harmless duplication; `mountLegacy()` should tolerate either.

## Open questions

1. **Freeze or fix the string-truthiness gotchas?** `?settings-server.connected=false` is a no-op
   today (`blockpy.js:417`, no coercion). Does any content in the wild rely on
   `settings-server.connected` with a *truthy-string* value to force-offline? Recommend: keep
   string semantics, document `=` (empty value) as the only way to falsify.
2. **`settings-user.role`** lets a student flip `ui.role.isGrader` client-side (`blockpy.js:129`,
   `548-550`). Parity says keep it; should the rewrite at least log/telemetry such overrides?
3. **`part_id` divergence:** blob key `part_id` never reaches `configuration.partId`
   (`blockpy.js:431` reads option-bag `partId` only). Is the blob key vestigial, or do any stored
   assignments carry `part_id` expecting an effect? Affects whether the rewrite should honor it.
4. **`preload_files` parse bug** (`files.js:677-683`, shadowed variable) — replicate or fix? A fix
   changes behavior only for malformed states, but "identical effects" argues for bug-compatible.
5. **Duplicate `settings-` params:** werkzeug takes the first occurrence; freeze first-wins in the
   §15.2 contract?
6. **`poolRandomness` naming:** the one camelCase key in a snake_case blob
   (`controllers/jinja_filters.py:166`) — confirm stored assignments use exactly this spelling
   before freezing the round-trip fixture.
7. **`settings.type` vs `assignment.type`:** the settings blob can contain `type` (registry
   `assignment_settings.js:6`) while the real type is the DB column bound in the settings UI
   (`assignment_settings.js:280`). Should the rewrite ignore blob `type` (current behavior) even
   when they disagree?
8. **Where should the `display.showRating` localStorage persistence live** in the rewrite? Legacy
   writes it on toggle (`blockpy.js:795`) and reads it through `getSetting` precedence
   (`blockpy.js:92-100,298`); BootConfig has no slot for localSettings today.
