# Appendix A1 — Verified Filename Prefixes and Magic Names

**Status:** Verified against the legacy client source (`blockpy-edu/blockpy`, branch state as of 2026-07-10).
**Authority:** the legacy code. Every claim below carries `file:line` citations into `blockpy/src/`. Where the code contradicts itself, both sites are cited.
**Supersedes:** the draft table in README §7.1, which contains several errors (see [Deltas](#deltas-from-the-spec-draft-readme-71)).

All paths below are relative to `c:/Users/acbar/Projects/blockpy-edu/blockpy/src/`.

---

## 1. The eight namespaces (not five, not six)

The canonical statement is the doc comment in `files.js:178-188` (which itself says "five possible namespaces" and then lists **eight** — the comment's count is stale):

| Prefix | Space name (code comment) | Semantics per the comment | Citation |
| ------ | ------------------------- | ------------------------- | -------- |
| `!` | Instructor | "Invisible to the student under all circumstances" | files.js:180 |
| `^` | Start Space | "Used to reset the student namespace" | files.js:181 |
| *(none)* | Student Space | "Visible to the student when display.hideFiles is not true, able to be edited" | files.js:182 |
| `?` | Hidden Space | "Not directly visible to the student, but accessible programmatically" | files.js:183 |
| `&` | Read-only Space | "An instructor file type visible to the student, but is uneditable by them" | files.js:184 |
| `$` | Secret Space | "Not visible from the menu at all, some other mechanism controls it" | files.js:185 |
| `*` | Generated Space | "Visible to the student, but destroyed after Engine.Clear. Can shadow an actual file." (see §6 — largely vestigial) | files.js:186 |
| `#` | Concatenated Space | "Used when bundling a space for the server" (a **wire format**, actively persisted) | files.js:187 |

The full prefix character set recognized by `chompSpecialFile` is `"!^?&$*#"` (files.js:212-218). The editor-dispatch module recognizes a *smaller* set, `SPECIAL_NAMESPACES = ["!", "^", "?", "$"]` (editors.js:42, editors.js:101-111) — `&`, `*`, `#` are not stripped when parsing a filename for editor selection (harmless in practice because dispatch keys on the `.ext` suffix, but it is a real inconsistency between modules).

The instructor "new file" dialog offers exactly three namespaces for instructor-created files — `!` "Completely inaccessible", `?` "Hidden from student, accessible programatically", `&` "Visible to student, but not editable" (files.js:169-172), plus `^` when creating a "starting" file and empty prefix for "student" files (files.js:648-660).

### Model-storage mapping (which observable backs each namespace)

From `BlockPyFileSystem.observeFile_` (files.js:375-413):

- `answer.py` → `submission.code` (files.js:376-377)
- `!on_run.py` / `!on_change.py` / `!on_eval.py` → `assignment.onRun/.onChange/.onEval` (files.js:378-383)
- `!instructions.md` → `assignment.instructions` (files.js:384-385)
- `^starting_code.py` → `assignment.startingCode` (files.js:386-387)
- `?mock_urls.blockpy`, `?toolbox.blockpy`, `!answer_prefix.py`, `!answer_suffix.py` → entries in `assignment.extraInstructorFiles` (files.js:388-395)
- `!tags.blockpy` → `assignment.tags` (files.js:396-397)
- `!assignment_settings.blockpy` → `assignment.settings` (files.js:398-399)
- `!sample_submissions.blockpy` → `assignment.sampleSubmissions` (files.js:400-401)
- `$settings.blockpy` → `model.display` itself (files.js:402-403)
- any other `^…` → `assignment.extraStartingFiles` (files.js:404-405)
- any other `!…`, `?…`, `&…` → `assignment.extraInstructorFiles` (files.js:406-409)
- **everything else** (unprefixed, and `*…` generated) → `submission.extraFiles` (files.js:410-412; `*` lookup in `submission.extraFiles` confirmed at files.js:585)

**Key ownership fact:** `&` files are **assignment-owned instructor files**, not student files (files.js:406-409). Student-created extra files carry **no prefix** and live in `submission.extraFiles` (files.js:410-412; creation path blockpy.js:977-979 → files.js:648-660 with empty prefix).

---

## 2. Verified prefix table

Roles: the UI keys almost everything on the `display.instructor` flag (blockpy.js:199-203), not on `user.role` (`owner`/`grader`/`student`, blockpy.js:122-129; `ui.role.isGrader` blockpy.js:547-550 is defined but essentially unused by the file UI). "Read-only mode" (`display.readOnly`, blockpy.js:284) blocks *all* persistence (`saveFile` server.js:642-645, `logEvent` server.js:546-549, `saveImage` server.js:569-571, `updateSubmission` server.js:663-666, `updateSubmissionStatus` server.js:585-588) but does not freeze the local editors.

| Prefix | Owner (layer) | Student visibility | Student mutability | Instructor mutability | Persistence | Editor | Citations |
| ------ | ------------- | ------------------ | ------------------ | --------------------- | ----------- | ------ | --------- |
| *(none)* e.g. `data.txt` | submission | Tab shown whenever files panel visible (files.js:70-79); panel itself requires `instructor \|\| !hideFiles \|\| preloadAllFiles` (blockpy.js:912-915) and **`hideFiles` defaults to `true`** (assignment_settings.js:29) | Editable; students can create via "Add New → Student File" (files.js:120-121, 124-129) | Editable | Autosaved inside the `#extra_student_files.blockpy` bundle via `saveFile` (server.js:131, blockpy.js:1006) | By extension (editors.js:129-133) | |
| `!` | assignment | Invisible (tab carries `blockpy-file-instructor`, `visible: display.instructor()` — files.js:9-14, 46-48) | None (cannot see) | Full (create files.js:118-119; only `!on_change.py`/`!on_eval.py` deletable — files.js:229, 495-499) | The five magic `!` files: see §3. Generic `!name`: autosaved in `#extra_instructor_files.blockpy` bundle (server.js:133, blockpy.js:1007) | By extension | files.js:180 |
| `^` | assignment | Invisible (`extraStartingFiles` tabs are instructor-only — files.js:58-67); contents reach students only through Reset | N/A (Reset copies `^name` → unprefixed student file, prefix stripped — blockpy.js:1045-1054) | Full (create via "Starting File" — files.js:116-117, 652-654) | `^starting_code.py` autosaved individually (server.js:130); other `^` files in `#extra_starting_files.blockpy` bundle (server.js:132, blockpy.js:1008) | By extension | files.js:181 |
| `?` | assignment | **Hidden from UI entirely** for students (tab rendering shows `extraInstructorFiles` entries to students only when they start with `&` — files.js:46-48); readable by student *code* (search order, files.js:589-590) | None (no UI access; runtime FS is read-only for students — §6) | Full | Autosaved in `#extra_instructor_files.blockpy` bundle (server.js:133) | `?toolbox.blockpy` → Toolbox editor; others fall through to Text (editors.js:113-133) | files.js:183 |
| `&` | assignment | **Visible** to students (files.js:46-48), tab styled `uneditable` (files.js:52), display name shown prefix-stripped (blockpy.js:1025-1027) | Read-only — enforced per-editor via `readOnly` when `filename.startsWith("&") && !instructor` (text.js:53, json.js:54, quiz.js:51, toolbox.js:61). **Not enforced in the Python editor** (python.js:442-447 checks only historyMode/onlyUploads) nor Markdown editor (markdown.js has no check) — a `&x.py`/`&x.md` file is *editable by students* in the current client (only the tab CSS says otherwise). | Full | Autosaved in `#extra_instructor_files.blockpy` bundle (server.js:133) | By extension | files.js:184 |
| `$` | display/local ("some other mechanism") | Never listed in any menu (files.js:185; no tab in FILES_HTML files.js:26-134) | None | None via file UI | **Never persisted** — `$settings.blockpy`'s handle is the `display` model (files.js:402-403); no save subscription (server.js:123-134) | None (would fall to Text, but never opened) | files.js:185, 198, 232 |
| `*` | submission (`submission.extraFiles`, files.js:585) | Per comment: visible, destroyed after Engine.Clear (files.js:186) | — | — | Would be bundled into `#extra_student_files.blockpy` like any `submission.extraFiles` entry (server.js:131) | By extension | **Vestigial**: nothing in the codebase ever *creates* a `*` file — see §6 |
| `#` | wire format (not a real user file) | Never shown; exists only as three fixed bundle names | N/A | N/A | **These ARE persisted** — each bundle is a JSON object `{filename: contents}` autosaved through `saveFile` whenever any member file changes (server.js:131-133; JSON shape files.js:283-299) | N/A | files.js:187 |

Uploaded/remote files (the `list_files`/`upload_file`/`rename_file`/`download_file` endpoints) are **not a prefix namespace at all**: they are unprefixed names kept in `BlockPyFileSystem.remoteFiles_`/`filesToUrls` (files.js:313-314, 669-737), fetched via `listUploadedFiles`/`downloadFile` (server.js:468-478, 507-524), uploaded with a `placement ∈ {submission, assignment, course, user}` + `directory` pair (images.js:76-82, 208-221, 223-237; server.js:480-505), and consulted **last** in every file-search order (files.js:588-599). Preloading is controlled by `preload_files` / `preload_all_files` settings (files.js:677-696; assignment_settings.js:21, 42).

---

## 3. Verified magic-name table

"Persistence endpoint" abbreviations: **sF** = `saveFile` (payload `{filename, code}` + standard fields, server.js:637-655, debounced `TIMER_DELAY = 1000` ms server.js:43, gated by `display.autoSave()` server.js:114-118 and `display.readOnly()` server.js:642-645, with localStorage latest-retry caching server.js:322-370); **sA** = `saveAssignment` (assignment metadata + `settings` JSON, server.js:432-454, manual only).

| Name | Owner | Backing model | Visible to student? | Persistence | Editor (registration) | Citations |
| ---- | ----- | ------------- | ------------------- | ----------- | --------------------- | --------- |
| `answer.py` | submission | `submission.code` | Yes — the primary tab, visible to everyone (`notInstructor` tab, files.js:35, 5-24); default open file (blockpy.js:1298-1300) | **Autosave** sF (server.js:125); also saved *immediately* (delay `null`) on every Run (engine/run.js:13). Undeletable/unrenamable (files.js:231-239) | Python (`.py`, python.js:478-483); if assignment type ≠ blockpy, rerouted to the `."+type` editor, e.g. Quiz for `.quiz`, Python for `.reading` (editors.js:113-127) | |
| `!instructions.md` | assignment | `assignment.instructions` (files.js:384-385) | Rendered in instructions pane; file tab instructor-only (files.js:36) | **Autosave** sF (server.js:129) | Markdown (`.md`, markdown.js:71-75) | |
| `!assignment_settings.blockpy` | assignment | `assignment.settings` (files.js:398-399) | No (files.js:37) | **Manual only** — Save button → `saveAssignment`, settings serialized as sparse JSON of non-default values (assignment_settings.js:96-107, 309-320; blockpy.js:1121-1123). **Not** in the sF subscription list (server.js:123-134) | Assignment Settings form (exact-name registration, assignment_settings.js:407-412) | |
| `!on_run.py` | assignment | `assignment.onRun` (files.js:378-379) | No (files.js:39) | **Autosave** sF (server.js:126) | Python | Executed as `_instructor.on_run` wrapped in Pedal boilerplate (engine/on_run.js:112-138) |
| `!on_change.py` | assignment | `assignment.onChange` (files.js:380-381) | No; tab hidden-if-empty (files.js:40) | **Autosave** sF (server.js:128). One of only two files in `DELETABLE_SIMPLE_FILES` (files.js:229, 495-499) | Python | Created via Add New (files.js:102-104; blockpy.js:965-968) |
| `!on_eval.py` | assignment | `assignment.onEval` (files.js:382-383) | No (files.js:41) | **Autosave** sF (server.js:127); deletable (files.js:229) | Python | files.js:105-107; blockpy.js:970-973 |
| `^starting_code.py` | assignment | `assignment.startingCode` (files.js:386-387) | No (tab instructor-only, files.js:38); reaches student via Reset (blockpy.js:1045-1054) | **Autosave** sF (server.js:130) | Python | |
| `!sample_submissions.blockpy` | assignment | `assignment.sampleSubmissions` (files.js:400-401) | No — "not provided at all to students without the Grader role" (sample_submissions.js:1-4) | **No client persistence path**: not in sF subscriptions (server.js:123-134) nor in the sA payload (server.js:432-454); loader is a no-op stub (blockpy.js:454-456) | Sample Submissions (exact name, sample_submissions.js:164-169) — editor is largely unfinished (sample_submissions.js:103-152) | |
| `!tags.blockpy` | assignment | `assignment.tags` (files.js:396-397) | No (files.js:43) | **No client persistence path** (same reasoning; loader stub blockpy.js:450-452) | Tags (exact name, tags.js:27-32) — a placeholder template, no real editor (tags.js:3-25). Its "Add New" menu item has **no click binding** (files.js:96-97), so it cannot even be created | |
| `!answer_prefix.py` / `!answer_suffix.py` | assignment | entries in `extraInstructorFiles` (files.js:392-395) | No | Bundle autosave (`#extra_instructor_files.blockpy`, server.js:133) | Python | Concatenated around the student's code for every run: `getStudentCode()` = prefix + `submission.code` + suffix (blockpy.js:994-1005; used by run.js:8 and instructor.js:69). Add-menu: files.js:109-114 |
| `?toolbox.blockpy` | assignment | entry in `extraInstructorFiles` (files.js:390-391) | No | Bundle autosave; the Toolbox editor writes to the handle only on its explicit Save button (toolbox.js:54, 75-85), after which the bundle autosaves | Toolbox (exact name, toolbox.js:97-102). Consumed by the block editor when `settings.toolbox === "custom"` (python.js:405-428, read at python.js:407); default contents seeded from the "normal" toolbox (blockpy.js:956-960) | |
| `?mock_urls.blockpy` | assignment | entry in `extraInstructorFiles` (files.js:388-389) | No (UI); consumed at runtime | Bundle autosave | **Text editor by fallback** — `.blockpy` is not a registered extension and only exact paths match (editors.js:113-133; `registered_[0]` is Text, editors.js:44-47) | JSON of `{filename: [url, ...]}` consulted by `Sk.requestsGet` to serve mocked URL fetches from the local FS (engine/configurations.js:30, 135-155); instructor runs additionally special-case the OpenAI proxy (engine/instructor.js:117-125) |
| `images.blockpy` | assignment (**no prefix!**) | entry in `extraInstructorFiles` (blockpy.js:931-932) | Tab visible per generic unstarred rules; the Add-New "Images" item is instructor-only (files.js:90-91) | The file itself is a stub (`"{}"` — blockpy.js:953-954, files.js:728); real image data flows through `uploadFile`/`downloadFile`/`renameFile` placement endpoints (images.js:223-276, server.js:480-544) | Image manager (exact name, images.js:288-293) | |
| `$settings.blockpy` | local/display | `model.display` (files.js:402-403) | Never shown (files.js:185) | **Never persisted** | None | In `STARTING_FILES` (files.js:198) and UNDELETABLE (files.js:232), so it survives `dismountExtraFiles` (files.js:438-448) |
| `#extra_student_files.blockpy` | wire | `observeConcatenatedFile(submission.extraFiles)` (blockpy.js:1006) | N/A | **Autosave** sF (server.js:131) | N/A | JSON `{filename: contents}` (files.js:283-299) |
| `#extra_starting_files.blockpy` | wire | `observeConcatenatedFile(assignment.extraStartingFiles)` (blockpy.js:1008) | N/A | **Autosave** sF (server.js:132) | N/A | |
| `#extra_instructor_files.blockpy` | wire | `observeConcatenatedFile(assignment.extraInstructorFiles)` (blockpy.js:1007) | N/A | **Autosave** sF (server.js:133) | N/A | Carries all `!`/`?`/`&` extras **including hidden instructor files in one blob** |
| `turtle_output` (directory name, not a file) | submission artifact | canvas PNG data-URL | n/a | `saveImage` endpoint, fired after runs when `save_turtle_output` is set (console.js:467-481; server.js:568-583; setting assignment_settings.js:14) | n/a | Block-workspace PNG also rides on `updateSubmission` as `image` (server.js:675-677) |

**Boot/mount sets:** `STARTING_FILES = [answer.py, !instructions.md, !assignment_settings.blockpy, ^starting_code.py, !on_run.py, $settings.blockpy]` (files.js:190-199; mountFiles files.js:430-436 mounts the first five). `BASIC_NEW_FILES = [!on_change.py, !on_eval.py, ?mock_urls.blockpy, ?toolbox.blockpy, !tags.blockpy, !sample_submissions.blockpy, !answer_prefix.py, !answer_suffix.py]` (files.js:201-210).

**Engine-side virtual names** (never in the FS model, resolved specially): `./answer.py` import → `submission.code` (student.js:42-43; instructor.js:128-129); `./_instructor/on_run.py`, `./_instructor/on_eval.py`, `./_instructor/__init__.js` (instructor.js:130-135, 38); `_instructor/answer.py`, `_instructor/on_run.py`, `_instructor/on_change.py`, `_instructor/on_eval.md` [sic], `_instructor/instructions.md`, `_instructor/starting_code.py` mock files from `searchForSpecialFiles_` (files.js:612-634). Students are forbidden from `src/lib/utility/`, `src/lib/pedal/`, `./_instructor/` (student.js:62-66).

---

## 4. Explicit answers to the verification questions

### (a) Can a student `&` file shadow an assignment `?` file of the same basename?

**No — and the question's premise is wrong.** `&` files are not student files: any `&name` is stored in `assignment.extraInstructorFiles` (files.js:406-409) and only instructors can create one (namespace dropdown in the instructor-only dialog, files.js:169-172; the student "Add New" menu offers only unprefixed Student Files, files.js:124-129). Since both `&name` and `?name` live in the same assignment-owned list, only the instructor could create the collision, and in the **student** search order the `?` version wins anyway: `firstDefinedValue(hiddenVersion(?), defaultVersion(&), studentVersion, generatedVersion(*), remoteVersion)` (files.js:589-590, lookups files.js:584-588). A student's *unprefixed* file also cannot shadow `?` or `&`: it comes third in that same order. In the instructor's default (`EVERYWHERE`) order the priority flips to `& → plain → * → ! → ? → ^ → remote` (files.js:597-599), and with an explicit `_instructor/` path prefix it is `! → ? → ^ → & → plain → * → remote` (files.js:563-566, 594-596). So shadowing behavior differs by role — document both in conformance tests.

### (b) Are `?` files read-only to students?

Stronger: they are **invisible** to students in the UI. The only tab rendering for `extraInstructorFiles` shows an entry to non-instructors when `filename().startsWith("&")` (files.js:46-48), so `?` files get no tab, no editor, no delete button — nothing. They are, however, **readable by student code** at runtime: student `open()`/`import` resolve through `searchForFile(..., studentSearch=true)`, whose result list includes `hiddenVersion = "?"+name` first (files.js:589-590; student hooks student.js:25-56; comment files.js:183). There is no write path from student code (§4e), so "read-only to students, invisible in UI" is the verified semantics. (The per-editor `readOnly` enforcement exists only for `&`, not `?` — text.js:53, json.js:54, quiz.js:51, toolbox.js:61.)

### (c) Complete list of magic names beyond the bare prefixes

From §3, the full set the client special-cases by exact name:

1. `answer.py` (files.js:376, 35; run.js:13)
2. `!instructions.md` (files.js:384)
3. `!assignment_settings.blockpy` (files.js:398)
4. `!on_run.py`, `!on_change.py`, `!on_eval.py` (files.js:378-383)
5. `^starting_code.py` (files.js:386)
6. `!sample_submissions.blockpy` (files.js:400)
7. `!tags.blockpy` (files.js:396)
8. `!answer_prefix.py`, `!answer_suffix.py` (files.js:392-395; blockpy.js:994-1005)
9. `?toolbox.blockpy` (files.js:390; python.js:407)
10. `?mock_urls.blockpy` (files.js:388; configurations.js:137)
11. `images.blockpy` — unprefixed magic name (blockpy.js:931-932, 953-954; images.js:290)
12. `$settings.blockpy` (files.js:198, 402)
13. `#extra_student_files.blockpy`, `#extra_starting_files.blockpy`, `#extra_instructor_files.blockpy` — wire bundles (server.js:131-133)
14. Engine-virtual: `./answer.py`, `./_instructor/on_run.py`, `./_instructor/on_eval.py`, `./_instructor/__init__.js`, and the `_instructor/*` mock names incl. the `on_eval.md` typo (student.js:42; instructor.js:127-148; files.js:612-634)
15. `turtle_output` — the `saveImage` directory constant (console.js:472, 476; server.js:579)

### (d) Which files are never persisted; which autosave

**Autosaved** (each via `saveFile`, debounce 1000 ms, only while `display.autoSave()` is true — server.js:114-118, 43 — and never in read-only mode — server.js:642-645):

- `answer.py` (server.js:125; plus immediate save on Run, run.js:13)
- `!on_run.py` (126), `!on_eval.py` (127), `!on_change.py` (128)
- `!instructions.md` (129), `^starting_code.py` (130)
- `#extra_student_files.blockpy` (131), `#extra_starting_files.blockpy` (132), `#extra_instructor_files.blockpy` (133) — which transitively autosave *every* extra file in every namespace (`?`, `&`, other `!`, other `^`, plain student, and hypothetically `*`)

When `autoSave` is false, a manual Save button appears instead (`ui.editors.canSave`, blockpy.js:1055-1056; python.js:110-115 — note the button has **no click binding**, python.js:112-114, i.e. manual save of files is not actually wired up).

**Manual-only:** `!assignment_settings.blockpy` and assignment metadata (name/url/points/hidden/reviewed/public/ip_ranges) persist solely through the Settings form's Save button → `saveAssignment` (assignment_settings.js:101-107, 309-320; blockpy.js:1121-1123; server.js:432-454).

**Never persisted by the client:** `$settings.blockpy` (display model, files.js:402-403; no subscription); `!tags.blockpy` and `!sample_submissions.blockpy` (no `saveFile` subscription server.js:123-134, absent from the `saveAssignment` payload server.js:432-454, load stubs blockpy.js:450-456 — they round-trip only if the server sends/stores them by other means); `images.blockpy` contents (a `"{}"` placeholder — real assets go through the upload endpoints, images.js:223-276); anything in read-only mode.

**Uploads layer:** persisted through `uploadFile`/`renameFile`/`downloadFile`/`listUploadedFiles` with `placement` + `directory` (server.js:468-544; images.js:208-276); BlockMirror image paste also uploads to `placement="submission"` (python.js:197-208).

### (e) Files written by student programs at runtime

**There is no working write path.** Skulpt's `filewrite` option is bound to `Configuration.writeFile` (configurations.js:99), which is an unimplemented stub — `writeFile() { console.warn("Unimplemented method!"); }` (configurations.js:162-165) — and no subclass overrides it (student.js, instructor.js, run.js, on_run.js, eval.js, on_eval.js, on_change.js contain no `writeFile`). `BlockPyFileSystem.writeFile` exists (files.js:477-480) but is never called from the engine. Consequently the `*` Generated Space (files.js:186) is **vestigial**: it is consulted on lookup (files.js:585) and would be bundled/persisted like any `submission.extraFiles` entry (server.js:131) and included in Pedal's file set (instructor.js:73 skips only `!^$#`), but nothing ever creates `*` files, and no "Engine.Clear" destruction routine exists (`dismountExtraFiles`, files.js:438-448, runs on assignment *load*, not per run, and is not `*`-specific). Runtime *graphical* output is the only persisted run artifact: turtle/pygame canvases via `saveImage` when `save_turtle_output` is set (console.js:467-481; assignment_settings.js:14), and the blocks PNG on `updateSubmission` (server.js:675-677). Reads at runtime go through `searchForFile` plus the remote-file URL map (`Sk.fileToURL`, configurations.js:28, 114-120).

For the rewrite: §7.5's "files created or modified by the run diff back into a transient layer" is a **new behavior**, not a legacy-parity requirement. The legacy-faithful contract is: student writes are dropped (with at most a console warning); the `*` prefix must be *tolerated* on the wire and in search, but nothing need generate it.

---

## 5. Editor dispatch summary (editors.js)

Dispatch = exact-path match for `.blockpy` names, else extension, else first-registered fallback (Text) (editors.js:101-135; registration list editors.js:44-47):

- `.py`, `.reading` → Python (python.js:480); `.md` → Markdown (markdown.js:73); `.txt` → Text (text.js:86); `.json` → JSON (json.js:88); `.quiz` → Quiz (quiz.js:84)
- Exact names: `!assignment_settings.blockpy` → Settings form; `!tags.blockpy` → Tags stub; `!sample_submissions.blockpy` → Sample Submissions; `?toolbox.blockpy` → Toolbox; `images.blockpy` → Image manager (§3)
- `?mock_urls.blockpy`, `$settings.blockpy`, `#…` and any unknown extension → Text fallback (editors.js:115-117 fails the exact match, editors.js:129-133 falls through)
- Non-blockpy assignment types reroute `answer.py` to the `."+assignmentType` editor (quiz/reading/maze) (editors.js:118-127; types assignment_settings.js:46-51)

Delete/rename guards: `DELETABLE_SIMPLE_FILES = ["!on_change.py", "!on_eval.py"]` (files.js:229); `UNDELETABLE_FILES` and `UNRENAMABLE_FILES` (files.js:231-239) — both lists contain the **wrong name** `!assignment_settings.py` instead of `!assignment_settings.blockpy` (compare files.js:37, 195). `renameFile` is dead code that references an undefined variable `filename` (files.js:518-528) and would throw if reached; the UI exposes rename only for images (blockpy.js:1116, images.js:257-276).

---

## 6. Deltas from the spec draft (README §7.1)

1. **`&<name>` row is wrong.** Draft: "submission … extra student-created files stored with the submission." Verified: `&` is the assignment-owned **Read-only Space** — instructor-created, visible to students, uneditable by them (files.js:184, 406-409, 46-52, 169-172). Student-created extras are **unprefixed** and live in `submission.extraFiles` (files.js:410-412).
2. **`*<name>` row is wrong.** Draft: "user/course uploaded files managed through `list_files`/`upload_file`/…". Verified: `*` is the **Generated Space** for run artifacts (files.js:186), currently vestigial (§4e). Uploaded files are a separate, unprefixed remote mechanism keyed by `placement`+`directory` (files.js:669-737; server.js:468-544).
3. **`#<name>` row is wrong.** Draft: "transient, local-only scratch files, never persisted." Verified: `#` is the **Concatenated Space** — the three `#extra_*_files.blockpy` bundles are the *primary persistence wire format* for all extra files and autosave through `saveFile` (files.js:187; server.js:131-133). Nothing in the client implements a "scratch, never persisted" prefix (the closest is `$`).
4. **`$` prefix missing from the draft.** `$settings.blockpy` — Secret Space, never menu-visible, never persisted, undeletable (files.js:185, 198, 232, 402-403).
5. **Draft's §7.2 layer diagram inherits errors 1-3:** Layer 4 "transient `#`-files" and Layer 2 "uploads = `*`" must be re-derived; `&` belongs to the assignment layer, not the submission layer.
6. **`!assignment_settings.blockpy` does not persist via `saveFile`:** manual `saveAssignment` only (§4d) — relevant to §7.4's persistence-adapter mapping.
7. **Missing magic names:** `!answer_prefix.py` / `!answer_suffix.py` (student-code wrapping, blockpy.js:994-1005), unprefixed `images.blockpy`, `$settings.blockpy`, the three `#` bundles, `turtle_output`, and the `_instructor/*` engine-virtual names. The draft's "verify" list (`!sample_submissions.blockpy`, `!tags.blockpy`, `?toolbox.blockpy`, `?mock_urls.blockpy`) is confirmed, with the caveat that tags/sample-submissions have **no working persistence** in the client.
8. **`?` row understated:** `?` files are not merely "readable by student code"; they are fully hidden from the student UI and take *precedence over the student's own files* in the student search order (files.js:589-590) — i.e., not shadowable. §7.2's default assumption ("assignment `?` files are read-only to students and not shadowable") is confirmed, but shadowing priority is role-dependent (§4a).
9. **§7.5 "student files written by programs … verify against legacy":** verified — legacy has no such behavior; `filewrite` is a stub (§4e). The rewrite's diff-back-to-transient design is an extension, not parity.
10. **§7.4 autosave claim** ("`answer.py` autosaves on a debounce and on run") is confirmed (server.js:125; run.js:13) but incomplete: five `!`/`^` assignment files and all three `#` bundles autosave identically, gated by the same `autoSave` flag (server.js:123-134) — instructor-file autosave is not `saveAssignment`-mediated as §7.4 implies.
11. **Roles:** the draft's per-role visibility matrix (student/instructor/grader/read-only) is finer-grained than the code, which keys file visibility solely on `display.instructor` (files.js:10-14) and blocks persistence on `display.readOnly` (server.js:642-645); `grader` affects only sample-submission access per the comment at sample_submissions.js:2-3 (not enforced in this repo's file UI).

## 7. Open questions / internal contradictions in the legacy code

1. **`*` shadowing:** the comment says `*` "can shadow an actual file" (files.js:186), but every search order places `generatedVersion` *after* `studentVersion` (files.js:589-599). Comment and code disagree; since `*` files are never created, either reading is currently unobservable. Decide the rewrite's stance explicitly.
2. **`&` read-only gap:** enforced in Text/JSON/Quiz/Toolbox editors (text.js:53, json.js:54, quiz.js:51, toolbox.js:61) but **not** in Python (python.js:442-447) or Markdown editors — so `&x.py` / `&x.md` are student-editable today (edits would even autosave via the `#` bundle, server.js:133). Bug or feature?
3. **Add-menu prefix typos:** `ui.files.add` switches on `?tags.blockpy` and `?settings.blockpy` (blockpy.js:949-950) while the real names are `!tags.blockpy` / `$settings.blockpy` — dead cases. The Tags "Add New" item also lacks a click binding (files.js:96-97). Tags are effectively uncreatable/unpersistable; confirm whether the rewrite should resurrect or drop them.
4. **`!assignment_settings.py` vs `.blockpy`** in UNDELETABLE/UNRENAMABLE (files.js:231-239): the settings file is unprotected by the lists (the Delete button appears for it, blockpy.js:1057-1059), saved only by the accident that its `owner === null` path returns `false` (files.js:500-501). The fixture table should protect the `.blockpy` name.
5. **Manual save button is unwired** (python.js:110-115) although `canSave` exposes it when autosave is off (blockpy.js:1055-1056). What should non-autosave mode do in the rewrite?
6. **`renameFile` is broken** (undefined `filename`, files.js:518-528). Renaming semantics for prefixed files are therefore unspecified by the code.
7. **Hidden-file leakage on the wire:** `#extra_instructor_files.blockpy` bundles `!` and `?` contents into a single submission-visible save payload (server.js:133) — whether students can fetch that blob is a *server*-side authorization question the client code cannot answer. Must be verified against blockpy-server before freezing the VFS permission model.
8. **`editors.js` vs `files.js` prefix sets** (`["!", "^", "?", "$"]` editors.js:42 vs `"!^?&$*#"` files.js:213): harmonize in the rewrite's `LegacyName.parse`.
9. **Instructor access to the raw student namespace:** "how would an instructor access `./_instructor/answer.py`?" is an open TODO in the code itself (files.js:578); `on_eval` maps to a `.md` mock name (files.js:627), likely a typo to preserve or fix consciously.
10. **`images.blockpy` placement of record:** it is stored in `extraInstructorFiles` yet the tab is not marked instructor-only in `hasContents`/add flow (files.js:90-91 restricts creation to instructors; visibility for students of an existing `images.blockpy` tab follows the generic unprefixed-in-instructor-list rendering at files.js:46-48 — it starts with `i`, not `&`, so it is instructor-only in practice). Confirm intended student access to the image manager when `preload_all_files` is on (blockpy.js:912-915 shows the *panel*, not the tab).

---

## 8. Machine-readable fixture seed

`layer`: `submission` | `assignment` | `uploads` | `local` | `wire` | `transient`. `visibility`: who can see it in the UI (`all`, `instructor`, `none`) — runtime code readability is noted in §4. `endpoint`: legacy URL-map key, `null` if never persisted. `student_mutable` reflects *intended/enforced* UI semantics (see open question 2 for the `&` enforcement gap).

```json
[
  {"name_or_prefix": "", "kind": "prefix", "layer": "submission", "visibility": "all", "student_mutable": true, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (as #extra_student_files.blockpy bundle)", "source_refs": ["src/files.js:182", "src/files.js:410-412", "src/files.js:70-79", "src/server.js:131", "src/blockpy.js:1006"]},
  {"name_or_prefix": "!", "kind": "prefix", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (magic names individually; others via #extra_instructor_files.blockpy bundle)", "source_refs": ["src/files.js:180", "src/files.js:406-409", "src/files.js:9-14", "src/server.js:126-129", "src/server.js:133"]},
  {"name_or_prefix": "^", "kind": "prefix", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (^starting_code.py individually; others via #extra_starting_files.blockpy bundle)", "source_refs": ["src/files.js:181", "src/files.js:404-405", "src/files.js:58-67", "src/server.js:130", "src/server.js:132", "src/blockpy.js:1045-1054"]},
  {"name_or_prefix": "?", "kind": "prefix", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (via #extra_instructor_files.blockpy bundle)", "source_refs": ["src/files.js:183", "src/files.js:406-409", "src/files.js:46-48", "src/files.js:589-590", "src/server.js:133"]},
  {"name_or_prefix": "&", "kind": "prefix", "layer": "assignment", "visibility": "all", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (via #extra_instructor_files.blockpy bundle)", "source_refs": ["src/files.js:184", "src/files.js:406-409", "src/files.js:46-52", "src/editor/text.js:53", "src/editor/python.js:442-447", "src/server.js:133", "src/blockpy.js:1025-1027"]},
  {"name_or_prefix": "$", "kind": "prefix", "layer": "local", "visibility": "none", "student_mutable": false, "instructor_mutable": false, "persisted": false, "endpoint": null, "source_refs": ["src/files.js:185", "src/files.js:198", "src/files.js:402-403", "src/server.js:123-134"]},
  {"name_or_prefix": "*", "kind": "prefix", "layer": "submission", "visibility": "all", "student_mutable": false, "instructor_mutable": false, "persisted": true, "endpoint": "saveFile (via #extra_student_files.blockpy bundle; vestigial — never created by any code path)", "source_refs": ["src/files.js:186", "src/files.js:585", "src/engine/configurations.js:162-165", "src/server.js:131"]},
  {"name_or_prefix": "#", "kind": "prefix", "layer": "wire", "visibility": "none", "student_mutable": false, "instructor_mutable": false, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/files.js:187", "src/server.js:131-133", "src/files.js:283-299"]},
  {"name_or_prefix": "answer.py", "kind": "magic", "layer": "submission", "visibility": "all", "student_mutable": true, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/files.js:376-377", "src/files.js:35", "src/server.js:125", "src/engine/run.js:13", "src/files.js:231"]},
  {"name_or_prefix": "!instructions.md", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/files.js:384-385", "src/files.js:36", "src/server.js:129"]},
  {"name_or_prefix": "!assignment_settings.blockpy", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveAssignment (settings field; manual save only)", "source_refs": ["src/files.js:398-399", "src/editor/assignment_settings.js:309-320", "src/server.js:432-454", "src/blockpy.js:1121-1123", "src/files.js:231-239"]},
  {"name_or_prefix": "!on_run.py", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/files.js:378-379", "src/server.js:126", "src/engine/on_run.js:112-138"]},
  {"name_or_prefix": "!on_change.py", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/files.js:380-381", "src/server.js:128", "src/files.js:229"]},
  {"name_or_prefix": "!on_eval.py", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/files.js:382-383", "src/server.js:127", "src/files.js:229"]},
  {"name_or_prefix": "^starting_code.py", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/files.js:386-387", "src/files.js:38", "src/server.js:130"]},
  {"name_or_prefix": "!sample_submissions.blockpy", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": false, "endpoint": null, "source_refs": ["src/files.js:400-401", "src/editor/sample_submissions.js:1-4", "src/server.js:123-134", "src/blockpy.js:454-456"]},
  {"name_or_prefix": "!tags.blockpy", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": false, "endpoint": null, "source_refs": ["src/files.js:396-397", "src/server.js:123-134", "src/blockpy.js:450-452", "src/files.js:96-97"]},
  {"name_or_prefix": "!answer_prefix.py", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (via #extra_instructor_files.blockpy bundle)", "source_refs": ["src/files.js:392-393", "src/blockpy.js:994-1005", "src/server.js:133", "src/files.js:109-111"]},
  {"name_or_prefix": "!answer_suffix.py", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (via #extra_instructor_files.blockpy bundle)", "source_refs": ["src/files.js:394-395", "src/blockpy.js:994-1005", "src/server.js:133", "src/files.js:112-114"]},
  {"name_or_prefix": "?toolbox.blockpy", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (via #extra_instructor_files.blockpy bundle)", "source_refs": ["src/files.js:390-391", "src/editor/toolbox.js:97-102", "src/editor/python.js:405-428", "src/blockpy.js:956-960", "src/server.js:133"]},
  {"name_or_prefix": "?mock_urls.blockpy", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": true, "endpoint": "saveFile (via #extra_instructor_files.blockpy bundle)", "source_refs": ["src/files.js:388-389", "src/engine/configurations.js:135-155", "src/files.js:87-88", "src/server.js:133", "src/editors.js:113-133"]},
  {"name_or_prefix": "images.blockpy", "kind": "magic", "layer": "assignment", "visibility": "instructor", "student_mutable": false, "instructor_mutable": true, "persisted": false, "endpoint": "uploadFile/downloadFile/renameFile/listUploadedFiles (for the actual assets; the .blockpy file itself is a local '{}' stub)", "source_refs": ["src/blockpy.js:931-932", "src/blockpy.js:953-954", "src/editor/images.js:288-293", "src/editor/images.js:208-276", "src/server.js:468-544"]},
  {"name_or_prefix": "$settings.blockpy", "kind": "magic", "layer": "local", "visibility": "none", "student_mutable": false, "instructor_mutable": false, "persisted": false, "endpoint": null, "source_refs": ["src/files.js:198", "src/files.js:402-403", "src/files.js:185", "src/files.js:232"]},
  {"name_or_prefix": "#extra_student_files.blockpy", "kind": "magic", "layer": "wire", "visibility": "none", "student_mutable": false, "instructor_mutable": false, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/server.js:131", "src/blockpy.js:1006", "src/files.js:283-299"]},
  {"name_or_prefix": "#extra_starting_files.blockpy", "kind": "magic", "layer": "wire", "visibility": "none", "student_mutable": false, "instructor_mutable": false, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/server.js:132", "src/blockpy.js:1008"]},
  {"name_or_prefix": "#extra_instructor_files.blockpy", "kind": "magic", "layer": "wire", "visibility": "none", "student_mutable": false, "instructor_mutable": false, "persisted": true, "endpoint": "saveFile", "source_refs": ["src/server.js:133", "src/blockpy.js:1007"]},
  {"name_or_prefix": "uploaded/remote files (unprefixed, placement+directory)", "kind": "magic", "layer": "uploads", "visibility": "all", "student_mutable": true, "instructor_mutable": true, "persisted": true, "endpoint": "uploadFile/downloadFile/renameFile/listUploadedFiles", "source_refs": ["src/files.js:669-737", "src/server.js:468-544", "src/editor/images.js:76-82", "src/editor/images.js:208-221"]},
  {"name_or_prefix": "turtle_output", "kind": "magic", "layer": "submission", "visibility": "none", "student_mutable": false, "instructor_mutable": false, "persisted": true, "endpoint": "saveImage", "source_refs": ["src/console.js:467-481", "src/server.js:568-583", "src/editor/assignment_settings.js:14"]}
]
```
