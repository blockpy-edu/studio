# Appendix A8 — UI Parity Fixture (Legacy Layout & Palette)

Status: extracted from legacy sources on 2026-07-10. Conformance fixture for spec §8.1 **B6** (visual parity: layout and color must match the original BlockPy interface; icons/fonts may modernize with per-change rationale).

Legacy source root: `c:/Users/acbar/Projects/blockpy-edu/blockpy`. All paths below are relative to that root unless prefixed. The two authoritative stylesheets are `src/css/blockpy.css` and `src/css/bootstrap_retheme.css` (the latter is loaded on top of Bootstrap 4 and re-skins buttons, page background, and font sizing — it is part of the legacy look and is in scope).

---

## 1. Layout tree

The whole interface is one Knockout-templated string (`makeInterface`, `src/interface.js:78-251`). The intended row structure is documented in the file header (`src/interface.js:5-10`):

> Row 1: Header and Quick Menu · Row 2: Console and Feedback · Row 3: File Navigation · Row 4: View Row · Row 5: Footer Row

Global framing rules:

- Every `.blockpy-content .row` gets a `1px solid #faebcc` bottom border — this is the horizontal "seam" between rows (`src/css/blockpy.css:2-4`).
- `.blockpy-content` itself has background `#fcf8e3`, border `1px solid #faebcc`, zero left/right padding (`src/css/bootstrap_retheme.css:21-26`).
- `.blockpy-panel` = `padding-left/right: 10px; padding-bottom: 5px` (`src/css/blockpy.css:6-10`).
- Bootstrap 4 grid (`container-fluid`, `row`, `col-md-*`), with `.row` margins zeroed (`src/css/bootstrap_retheme.css:58-61`).

```
.blockpy-content.container-fluid                      interface.js:80  (bg #fcf8e3, border #faebcc — retheme.css:21-26)
│
├─ DIALOG_HTML  .blockpy-dialog.modal                 interface.js:83; dialog.js:3-26
│    └─ .modal-dialog.modal-lg > .modal-content       Bootstrap modal; footer has btn-white "Close",
│                                                     btn-success "Okay" (dialog.js:20-21)
├─ canvas#capture-canvas.d-none                       interface.js:86  (hidden screenshot canvas)
│
├─ ROW 1  .row  (hidden when ui.smallLayout)          interface.js:89
│  ├─ .col-md-9.blockpy-panel.blockpy-header          interface.js:92-115  (role=heading; height:25% — blockpy.css:16-18)
│  │   ├─ span.blockpy-name  "<strong>BlockPy: </strong>" + assignment name   interface.js:96-100
│  │   ├─ .blockpy-instructions-reset > a.float-right "Reset instructions"    interface.js:103-109
│  │   │     (visible only when instructions changed; font-size:smaller — blockpy.css:80-82)
│  │   └─ .blockpy-instructions  (markdown-rendered !instructions.md, html-bound)  interface.js:112-114
│  │
│  └─ .col-md-3.blockpy-panel.blockpy-quick-menu      interface.js:117-193  (role=menubar;
│      │                                              border-left: 1px solid #faebcc — blockpy.css:87-90)
│      ├─ "submission ready" text + Mark-Submitted button (btn-outline-secondary btn-sm)  interface.js:122-127
│      ├─ [GRADER] .form-check "View as instructor" checkbox #blockpy-as-instructor      interface.js:129-136
│      ├─ [SPY]    Owner id + "Readonly?" checkbox (when submission owner ≠ user)        interface.js:138-147
│      ├─ Fullscreen button (fas, dynamic fa-expand-arrows-alt/fa-compress-arrows-alt)   interface.js:151-155; blockpy.js:572-573
│      ├─ Edit Queued Inputs button (fa-list-alt)                                        interface.js:157-160
│      ├─ Toggle Images button (fa-images)                                               interface.js:162-166
│      ├─ Get Shareable Link button (fa-link)                                            interface.js:168-172
│      ├─ [INSTRUCTOR] Show-instructor-stdout button (fa fa-terminal), inline style
│      │     "text-align: right; cursor: pointer"                                        interface.js:173-179
│      ├─ span.blockpy-student-error.fas.fa-bug  (pink bug, hidden until error)          interface.js:181; blockpy.css:567-572
│      ├─ span.blockpy-menu-clock  (text set on interval)                                interface.js:182; blockpy.js:1279-1282
│      └─ [instructionsPool] Seed label+input #blockpy-set-seed, inline "display:flex"   interface.js:183-192
│
├─ SMALL-LAYOUT VARIANT (ko if: ui.smallLayout)       interface.js:197-210
│  ├─ "View as instructor" .form-check (duplicate of above)                              interface.js:199-206
│  └─ FILES_HTML (file tab strip moved above the second row)                             interface.js:207-209
│
├─ OUTER WRAPPER .row  (rows 2–4 live inside one bordered row)                           interface.js:212-239
│  │
│  ├─ ROW 2 — Console/Feedback/Trace  (ko if: ui.secondRow.isAllVisible)                 interface.js:214-229
│  │  └─ div[class: ui.secondRow.width] > .row        interface.js:215-216
│  │      │   width = "col-md-12" normally, "col-md-5" in student small layout (blockpy.js:663-666)
│  │      │
│  │      ├─ CONSOLE_HTML .blockpy-panel.blockpy-console[class: ui.console.size]         console.js:22-39
│  │      │   │   size = "col-md-12" when second panel is NONE or small layout, else "col-md-6" (blockpy.js:711-717)
│  │      │   │   padding-top:10px (blockpy.css:94-96)
│  │      │   ├─ show-feedback eye button  btn btn-sm btn-outline-secondary float-right
│  │      │   │     .blockpy-show-feedback (fa-eye)                                      console.js:28-32
│  │      │   ├─ <strong>Console:</strong>                                               console.js:34
│  │      │   └─ .blockpy-printer.blockpy-printer-default                                console.js:36-37
│  │      │         height 200px, overflow auto, resize:vertical (blockpy.css:103-108);
│  │      │         white bg + 1px lightgray border (blockpy.css:110-113);
│  │      │         each output line .blockpy-printer-output: dashed lightgray bottom border (blockpy.css:121-125);
│  │      │         Evaluate button .blockpy-btn-eval pinned bottom-left (console.js:7-10; blockpy.css:143-147)
│  │      │
│  │      ├─ FEEDBACK_HTML  (ko if: ui.secondRow.isFeedbackVisible)                      interface.js:220-222; feedback.js:3-75
│  │      │   ├─ span.blockpy-floating-feedback  "New feedback ↑"  (sticky-top, shown on
│  │      │   │     out-of-view update; color red — blockpy.css:270-275)                 feedback.js:5-8
│  │      │   └─ .blockpy-feedback.blockpy-panel[class: ui.console.size]                 feedback.js:10-13
│  │      │       │   (aria-live=polite; padding 10px, flex column, overflow-y auto — blockpy.css:196-202)
│  │      │       ├─ eye button btn-sm btn-outline-secondary float-right (fa-eye) +
│  │      │       │     switchLabel "View Trace" (hidden by hideTraceButton)             feedback.js:17-24; blockpy.js:667-669,682-685
│  │      │       ├─ <strong.feedback-header>Feedback: </strong>                         feedback.js:28
│  │      │       │     [INSTRUCTOR] clicking header opens Full Feedback dialog          feedback.js:408-414
│  │      │       ├─ span.badge.blockpy-feedback-category.feedback-badge  (css: ui.feedback.badge,
│  │      │       │     text: ui.feedback.category — see §5.3)                           feedback.js:29-31
│  │      │       ├─ [INSTRUCTOR] score % + "(reset)" small text-muted links             feedback.js:32-37
│  │      │       ├─ strong.blockpy-feedback-label + div.blockpy-feedback-message (html) feedback.js:39-44
│  │      │       ├─ span.blockpy-feedback-thank-you  (fade/slide on rating — blockpy.css:209-220)  feedback.js:46-49
│  │      │       ├─ rating strip: far fa-minus-square, fa-thumbs-up, fa-thumbs-down
│  │      │       │     (inline "cursor:pointer; font-size:20px")                        feedback.js:50-64
│  │      │       ├─ .blockpy-feedback-positive (inline "text-align:right"; star icons
│  │      │       │     injected with color "green")                                     feedback.js:66-67,263,272-289
│  │      │       └─ collapsed rating toggle far fa-plus-square (inline absolute right/bottom)  feedback.js:68-73
│  │      │
│  │      └─ TRACE_HTML  (ko if: ui.secondRow.isTraceVisible)                            interface.js:224-226; trace.js:1-71
│  │          └─ .blockpy-trace.col-md-6.blockpy-panel  (hard-coded col-md-6)            trace.js:3
│  │              ├─ .clearfix > <strong>Trace: </strong> + Hide-Trace eye button
│  │              │     btn-sm btn-outline-secondary float-right .blockpy-hide-trace     trace.js:6-15
│  │              ├─ .input-group.mb-3.blockpy-trace-controls                            trace.js:17-46
│  │              │     prepend: fa-step-backward | fa-backward | "Step:" | "n / m"      trace.js:18-32
│  │              │     append:  fa-forward | fa-step-forward | line number              trace.js:33-45
│  │              │     (all btn btn-outline-secondary; margins zeroed — blockpy.css:287-290)
│  │              ├─ p (AST description) + p "Variables after this step:"                trace.js:47-48
│  │              └─ table.table.table-sm.table-striped.table-bordered.table-hover
│  │                    Name/Type/Value header                                           trace.js:49-68
│  │
│  ├─ ROW 3 — File tab strip  (ko if: ui.files.visible() && !ui.smallLayout())           interface.js:232-234
│  │  └─ FILES_HTML .blockpy-panel.blockpy-files[class: ui.files.width]                  files.js:27-28
│  │      │   width = "col-md-12" normally, "col-md-6" in student small layout (blockpy.js:919-922)
│  │      └─ ul.nav.nav-tabs[role=tablist]                                               files.js:29
│  │          ├─ li.nav-item > <strong>View: </strong>  (label pseudo-tab)               files.js:31-33
│  │          ├─ tab "answer.py"  (student-visible; makeTab notInstructor=true)          files.js:35, 5-24
│  │          ├─ [INSTRUCTOR] li.nav-item.blockpy-file-instructor tabs, in order:
│  │          │     Instructions, Settings, Starting Code, On Run, On Change*,
│  │          │     On Eval*, Sample Submissions*, Tags*   (*hidden when empty)          files.js:36-43
│  │          ├─ dynamic tabs: extraInstructorFiles (class `uneditable` when "&"-prefixed),
│  │          │     extraStartingFiles [INSTRUCTOR], submission extraFiles               files.js:45-79
│  │          └─ li.nav-item.dropdown "Add New" > .dropdown-menu.dropdown-menu-right
│  │                (instructor menu files.js:84-123; student menu files.js:124-129)
│  │
│  └─ ROW 4 — View row (editors)  EDITORS_HTML                                           interface.js:237; editors.js:49-62
│     └─ one per registered editor: .blockpy-panel.blockpy-editor[class: ui.editors.width,
│         │  visible: current editor name]                                               editors.js:50-55
│         │  width = "col-md-12" normally, "col-md-7" in student small layout (blockpy.js:1035-1038)
│         └─ PYTHON editor template (the answer.py view)                                 editor/python.js:30-157
│             ├─ .blockpy-python-toolbar.col-md-12.btn-toolbar  (padding-left:0 —
│             │     blockpy.css:376-381)  — button groups IN ORDER, each .btn-group.mr-2:
│             │   1. RUN    button.btn.blockpy-run.notransition — fa-play + "Run"/"Stop"
│             │        (css: blockpy-run-running when executing)                         editor/python.js:35-41; blockpy.js:1132-1137
│             │   2. VIEW TOGGLE .btn-group.btn-group-toggle (data-toggle=buttons), only if
│             │        settings.enableBlocks: three label.btn.btn-outline-secondary
│             │        .blockpy-mode-set-blocks radios —
│             │        "Blocks" fa-th-large / "Split" fa-columns / "Text" fa-align-left
│             │        (active class bound to display.pythonMode)                        editor/python.js:21-28,43-49
│             │   3. RESET  btn-outline-secondary — fa-sync "Reset"                      editor/python.js:51-56
│             │   4. IMPORT DATASETS btn-outline-secondary — fa-cloud-download-alt
│             │        (hidden by hideImportDatasetsButton or smallLayout)               editor/python.js:58-65
│             │   5. UPLOAD split group — label.btn.btn-outline-secondary fa-file-upload
│             │        "Upload" + hidden file input + caret dropdown with
│             │        "Download" fa-download (hidden in smallLayout)                    editor/python.js:67-87
│             │   6. HISTORY btn-outline-secondary — fa-history "History"
│             │        (active class bound to display.historyMode; hidden in smallLayout) editor/python.js:89-98
│             │   7. SAVE   btn-outline-secondary — fa-save "Save" (visible: !autoSave)  editor/python.js:110-115; blockpy.js:1055-1056
│             │   8. DELETE btn-outline-secondary — fa-trash "Delete" (visible: canDelete) editor/python.js:117-123
│             │   9. EXTRA  dropdown — fa-ellipsis-v; menu item "Run without feedback"
│             │        fa-comment-slash (gets blockpy-run-running class too)             editor/python.js:125-140
│             │   (commented-out in source: Fullscreen fa-expand-arrows-alt group
│             │    editor/python.js:100-108; Rename fa-file-signature editor/python.js:142-147)
│             ├─ HISTORY_TOOLBAR .blockpy-history-toolbar.col-md-12 (visible: historyMode)
│             │     Start fa-step-backward / Previous fa-backward / select.custom-select /
│             │     Use fa-file-import / Next fa-forward / Most Recent fa-step-forward   history.js:3-31
│             └─ .blockpy-python-blockmirror  (BlockMirror mounts Blockly + CodeMirror
│                   here; hidden when submission isSubmitted)                            editor/python.js:154-156
│                   Split-mode halves: div.blockpy-text.blockpy-editor-menu.col-md-6 and
│                   div.blockpy-blocks.blockpy-editor-menu.col-md-6 (padding zeroed —
│                   blockpy.css:445-451); text view bordered 1px lightgray (blockpy.css:415-417)
│             (Non-python files get default_header toolbar: Upload/Download/Delete only —
│              editor/default_header.js:3-36)
│
└─ ROW 5 — Footer  (ko if: ui.footer.visible)  .row > FOOTER_HTML                        interface.js:243-247
   └─ .col-md-12.blockpy-panel.blockpy-status                                            footer.js:3
       ├─ server badges line: "Load Assignment" (label wrapping a hidden [INSTRUCTOR]
       │     force-load file input), "Save Assignment", "Load File", "Save File",
       │     "Load Dataset", "Log Event", "Update Submission" (clickable), "Execution" —
       │     each span/label.badge with class ui.server.status(endpoint) =
       │     "server-status-<state>"                                                     footer.js:4-21; blockpy.js:1164-1167
       ├─ server messages line                                                           footer.js:22-24
       └─ identity line: User (name, role), Course, Group, Assignment, Assignment
             Version, Submission (+Owner ID), Submission Version, Editor Version         footer.js:25-39
```

Instructor-only regions summary (all gated on `display.instructor()` unless noted): instructor file tabs and Add-New menu items (`src/files.js:16-21,47-48,84-123`), "View as instructor" checkbox (gated on `ui.role.isGrader`, `src/interface.js:129-136`), instructor-stdout terminal button (`src/interface.js:173-179`), feedback score %/reset and full-feedback-dialog header click (`src/feedback.js:32-37,408-414`), footer force-load-assignment input (`src/footer.js:6-11`), seed pool input (gated on `assignment.settings.instructionsPool`, `src/interface.js:183-192`).

---

## 2. Color palette

### 2.1 Complete color-literal inventory

**46 distinct color values** across the two stylesheets and template/JS inline styles (`black`≡`#000`≡`#000000`, `white`≡`#ffffff`, `lightgray`≡`lightgrey` deduplicated). `bp.css` = `src/css/blockpy.css`, `rt.css` = `src/css/bootstrap_retheme.css`.

#### Chrome / page frame

| Value | Selector(s) | Role | Citation |
|---|---|---|---|
| `#fcf8e3` | `.blockpy-content` background | Warm parchment page background (the signature BlockPy tint) | rt.css:21-26 |
| `#fcf8e3` | `.blockpy-content .editor-preview` background | Markdown editor preview matches page bg | bp.css:463-467 |
| `#faebcc` | `.blockpy-content .row` border-bottom | Row separator seam between all layout rows | bp.css:2-4 |
| `#faebcc` | `.blockpy-content` border | Outer frame border | rt.css:21-26 |
| `#faebcc` | `.blockpy-quick-menu` border-left | Divider between instructions and quick menu | bp.css:87-90 |
| `#faebcd` | `.editor-preview` border | Markdown preview border — **one-off, almost certainly a typo of `#faebcc`** | bp.css:463-467 |

#### Buttons

| Value | Selector(s) | Role | Citation |
|---|---|---|---|
| `rgb(40, 130, 40)` | `button.blockpy-run` background | **Run button green** (white text) | bp.css:383-386 |
| `rgb(20, 100, 20)` | `button.blockpy-run:focus` background | Run button focus (darker green) | bp.css:388-390 |
| `#f0ad4e` | `button.blockpy-run.blockpy-run-running` background | Run button while executing (Bootstrap-3 warning orange) | bp.css:392-394 |
| `#d9534f` | `button.blockpy-run.blockpy-run-error` background | Run button error state (Bootstrap-3 danger red) | bp.css:396-398 |
| `white` / `black` / `rgb(130, 40, 40)` | `button.blockpy-delete` bg / color / border | Delete button: white with maroon border | bp.css:400-404 |
| `rgb(100, 20, 20)` | `.blockpy-delete:focus` border; `:active` background (white text) | Delete focus/active (darker maroon) | bp.css:406-413 |
| `white` / `#333` | `.blockpy-content .btn-outline-secondary` | All secondary toolbar buttons: white bg, dark-gray text | rt.css:33-36 |
| `#e6e6e6` / `#8c8c8c` | `.btn-outline-secondary:focus` bg / border | Secondary button focus | rt.css:38-42 |
| `#e6e6e6` / `#adadad` | `.btn-outline-secondary:hover` bg / border | Secondary button hover | rt.css:44-48 |

#### File tabs (nav)

| Value | Selector(s) | Role | Citation |
|---|---|---|---|
| `#cccccc` / `black` | `.blockpy-content .nav-link` bg / color | Inactive file tab | bp.css:301-309 |
| `#ddd` | `.nav-link` border-left/right (2px) | Tab side borders | bp.css:306-307 |
| `white` / `black` / `#ddd` | `.nav-link.active` bg / color / border | Active tab: white, bold | bp.css:311-320 |
| `#ddd` | `.nav-link:hover` background | Tab hover | bp.css:322-324 |
| `white` | `.nav-link.active:hover` background | Active tab hover stays white | bp.css:326-328 |
| `darkblue` | `.nav-link.uneditable` color (italic) | Read-only ("&"-namespace) file tab | bp.css:334-337 |

#### Console / printer

| Value | Selector(s) | Role | Citation |
|---|---|---|---|
| `white` / `lightgray` | `.blockpy-printer-default` bg / border | Console output area | bp.css:110-113 |
| `black` / `darkgray` / `white` | `.blockpy-printer-inverse` bg / border / color | Inverse console theme | bp.css:115-119 |
| `lightgray` | `.blockpy-printer-output` border-bottom (dashed) | Per-line separator in console | bp.css:121-125 |

#### Feedback pane / Pedal category badges

| Value | Selector(s) | Role | Citation |
|---|---|---|---|
| `white` | `.feedback-badge` color (font-size 75%) | Badge text | bp.css:151-154 |
| `black` | `.label-internal-error` background | Internal error badge | bp.css:156-158 |
| `darkred` | `.label-syntax-error` background | Syntax/editor error badge | bp.css:160-162 |
| `#d9534f` | `.label-runtime-error` background | Runtime error badge | bp.css:164-166 |
| `orangered` | `.label-semantic-error` background | Semantic/analyzer ("Algorithm Error") badge | bp.css:168-170 |
| `#f0ad4e` | `.label-feedback-error` background | Instructor-feedback ("Incorrect Answer") badge | bp.css:172-174 |
| `#5cb85c` | `.label-problem-complete` background | **Correct/Complete badge green** | bp.css:176-178 |
| `rgba(0, 0, 0, 0)` | `.label-none` background | No-category badge (transparent) | bp.css:180-182 |
| `#5bc0de` | `.label-no-errors`, `.label-instructions` backgrounds | "No errors" / Instructions info blue | bp.css:184-190 |
| `#358535` | `.label-success` background | Success label (darker green variant) | bp.css:192-194 |
| `white` | `.blockpy-feedback-traces table`, `table.pedal-table` backgrounds | Feedback tables | bp.css:204-207, 222-226 |
| `lightgray` | `tr.pedal-row` border-top | Pedal table row separator | bp.css:228-230 |
| `#f0f0f0` / `lightgrey` | `.blockpy-feedback pre` bg / border | Code blocks inside feedback (12px) | bp.css:236-243 |
| `green` | `.blockpy-feedback pre span.filename` color | Traceback filename | bp.css:249-253 |
| `orangered` | `.blockpy-feedback pre span.lineno` color | Traceback line number | bp.css:255-259 |
| `black` / `transparent` | `.blockpy-feedback-unit code` color / bg | Inline code in feedback | bp.css:261-264 |
| `red` | `.blockpy-floating-feedback` color | "New feedback ↑" alert (overrides `.text-muted-less`) | bp.css:270-275 |
| `green` | positive-feedback star icon, set inline via JS `positive.css("color", color)` with `"green"` | Positive feedback star | src/feedback.js:263, 272-275 |
| `green` / `black` | `.green-check-mark` color / text-shadow outline | Green check for completed work | bp.css:34-38 |
| `green` | `.pedal-positive-mark` color (16px) | Pedal positive mark | bp.css:578-582 |
| `pink` | `.blockpy-quick-menu .blockpy-student-error` color (16px) | Pink bug icon for silenced student errors | bp.css:567-572 |
| `lightgray` | `.blockpy-dialog-student-error-message` border | Student-error dialog box | bp.css:562-565 |
| `lightgray` | `.feedback-expand-on-click` border | Expandable full-feedback entries | bp.css:635-638 |

#### Editor (CodeMirror/BlockMirror)

| Value | Selector(s) | Role | Citation |
|---|---|---|---|
| `#C4FBC4` / `#8a1f11` | `.editor-active-line` bg / color (!important) | Trace active line: pale green bg, dark red text | bp.css:423-426 |
| `#ddd` / `#bbb` | `.CodeMirror-gutters` bg / border-left | Editor gutter | bp.css:428-431 |
| `#FBC4C4` | `.editor-error-line` background (!important) | Error line: pale red | bp.css:433-435 |
| `#FBFBC4` | `.editor-uncovered-line` background (!important) | Uncovered line: pale yellow | bp.css:437-439 |
| `#C4FBC4` | `.editor-traced-line` background (!important) | Traced line: pale green | bp.css:441-443 |
| `rgba(1, 1, 1, .1)` | `.CodeMirror-code div pre` border-bottom (dashed) | Faint per-line rule in text editor | bp.css:454-456 |
| `#E5E5E5` | `.blockpy-read-only .CodeMirror-scroll` background | Read-only editor gray-out | bp.css:458-460 |
| `lightgray` | `.blockpy-text`, `.blockpy-upload` borders | Text editor / upload area frames | bp.css:415-421 |
| `#eee` / `lightgrey` | `.editor-toolbar` bg / border; `.cm-s-easymde` borders | Markdown (EasyMDE) editor chrome | bp.css:469-478 |

#### Footer / status badges

| Value | Selector(s) | Role | Citation |
|---|---|---|---|
| `white` | `.blockpy-content .badge` color (75%) | Status badge text | bp.css:495-498 |
| `#5cb85c` | `.badge.server-status-ready` | Server ready | bp.css:500-502 |
| `#5bc0de` | `.badge.server-status-active` | Server active | bp.css:504-506 |
| `#f0ad4e` | `.badge.server-status-retrying` | Server retrying | bp.css:508-510 |
| `#d9534f` | `.badge.server-status-failed` | Server failed | bp.css:512-514 |
| `#333` | `.badge.server-status-offline` | Server offline | bp.css:516-518 |

#### Misc / secondary surfaces

| Value | Selector(s) | Role | Citation |
|---|---|---|---|
| `#000` (50% opacity) | `.blockpy-overlay` background | Full-screen blocking overlay | bp.css:20-32 |
| `#988` → `#655` → `#333` → `black` | `.blockpy-overlay` inline bg per retry attempt | Overlay darkens with repeated connection failures | src/server.js:225-238 |
| `#444` | `.text-muted-less` color | Slightly muted text | rt.css:50-52 |
| `#666` | `.label-default` background | Default label | rt.css:54-56 |
| `black` | `.blockpy-content .alert` color | Alert text forced black | rt.css:63-65 |
| `white` | `.blockpy-content table` background | Tables on parchment bg get white | rt.css:67-69 |
| `white` | `.btn-file input[type=file]` background | Hidden file-input hack | bp.css:358-372 |
| `#F0F0F0` / `darkgray` | `.pygame-title-bar` bg / border | Pygame window title bar | bp.css:590-603 |
| `rgb(220, 53, 69)` / `rgb(200, 33, 49)` / `white` | `.pygame-title-exit` bg / border / color | Pygame close button (≈Bootstrap-4 danger) | bp.css:605-618 |
| `rgb(240, 73, 89)` | `.pygame-title-exit:hover` background | Pygame close hover | bp.css:620-622 |
| `rgb(255, 150, 150)` | `.pygame-title-exit:active` background | Pygame close active | bp.css:624-626 |
| `#000000` / `#ffffff` | QR-code `colorDark`/`colorLight` options in share dialog | Share-link QR code | src/dialog.js:254-255 |

### 2.2 Proposed design tokens

Grouped so the rewrite's token sheet reproduces the palette exactly. Names are proposals; values are normative.

```css
/* Frame */
--blockpy-bg-parchment:        #fcf8e3;   /* page + markdown preview bg */
--blockpy-border-warm:         #faebcc;   /* frame, row seams, quick-menu divider (also fold #faebcd typo into this) */

/* Run button */
--blockpy-run-green:           rgb(40, 130, 40);
--blockpy-run-green-focus:     rgb(20, 100, 20);
--blockpy-run-running:         var(--blockpy-status-warning);   /* #f0ad4e */
--blockpy-run-error:           var(--blockpy-status-danger);    /* #d9534f */

/* Delete button */
--blockpy-delete-maroon:       rgb(130, 40, 40);
--blockpy-delete-maroon-dark:  rgb(100, 20, 20);

/* Status semantics (Bootstrap-3-era brand colors, reused by feedback badges AND server badges) */
--blockpy-status-success:      #5cb85c;   /* complete badge, server ready */
--blockpy-status-success-dark: #358535;   /* label-success */
--blockpy-status-info:         #5bc0de;   /* no-errors + instructions badges, server active */
--blockpy-status-warning:      #f0ad4e;   /* feedback-error badge, run-running, server retrying */
--blockpy-status-danger:       #d9534f;   /* runtime-error badge, run-error, server failed */
--blockpy-status-syntax:       darkred;   /* #8b0000 — syntax/editor error badge */
--blockpy-status-semantic:     orangered; /* #ff4500 — semantic/analyzer badge, traceback lineno */
--blockpy-status-internal:     black;     /* internal-error badge */
--blockpy-status-offline:      #333;      /* server offline */

/* Feedback accents */
--blockpy-positive-green:      green;     /* check marks, stars, traceback filename */
--blockpy-alert-red:           red;       /* "New feedback" floating alert */
--blockpy-student-error-pink:  pink;      /* quick-menu bug icon */

/* File tabs */
--blockpy-tab-bg:              #cccccc;
--blockpy-tab-border:          #ddd;      /* shared with tab hover bg and CM gutter bg */
--blockpy-tab-active-bg:       white;
--blockpy-tab-uneditable:      darkblue;  /* #00008b */

/* Editor line highlights */
--blockpy-line-active-bg:      #C4FBC4;   /* also traced-line */
--blockpy-line-active-text:    #8a1f11;
--blockpy-line-error-bg:       #FBC4C4;
--blockpy-line-uncovered-bg:   #FBFBC4;
--blockpy-editor-readonly-bg:  #E5E5E5;
--blockpy-gutter-border:       #bbb;
--blockpy-line-rule:           rgba(1, 1, 1, .1);

/* Neutral ramp (buttons, chrome, code blocks) */
--blockpy-neutral-900:         black;     /* #000, overlay, inverse console */
--blockpy-neutral-800:         #333;      /* secondary-button text */
--blockpy-neutral-700:         #444;      /* text-muted-less */
--blockpy-neutral-600:         #666;      /* label-default */
--blockpy-neutral-500:         #8c8c8c;   /* secondary-button focus border */
--blockpy-neutral-450:         #adadad;   /* secondary-button hover border */
--blockpy-neutral-400:         darkgray;  /* #a9a9a9, inverse-console + pygame borders */
--blockpy-neutral-350:         #bbb;
--blockpy-neutral-300:         #cccccc;
--blockpy-neutral-250:         lightgray; /* #d3d3d3, most 1px borders */
--blockpy-neutral-200:         #ddd;
--blockpy-neutral-150:         #E5E5E5;
--blockpy-neutral-125:         #e6e6e6;   /* secondary-button hover/focus bg */
--blockpy-neutral-100:         #eee;      /* markdown toolbar bg */
--blockpy-neutral-75:          #f0f0f0;   /* feedback pre bg, pygame title bar */
--blockpy-neutral-0:           white;

/* Overlay retry ramp (JS-driven) */
--blockpy-overlay-1: #988;  --blockpy-overlay-2: #655;
--blockpy-overlay-3: #333;  --blockpy-overlay-4: black;

/* Pygame window close button (Bootstrap-4 danger family; low priority) */
--blockpy-pygame-exit:         rgb(220, 53, 69);
--blockpy-pygame-exit-border:  rgb(200, 33, 49);
--blockpy-pygame-exit-hover:   rgb(240, 73, 89);
--blockpy-pygame-exit-active:  rgb(255, 150, 150);
```

---

## 3. Typography and icons (the parts allowed to change, per B6)

### 3.1 Fonts and sizes

| Declaration | Where | Citation |
|---|---|---|
| `font-family: "Helvetica Neue", Helvetica, Arial, sans-serif` on `body` | Global UI font | rt.css:5-7 |
| `.blockpy-content * { font-size: 14px }` | Base size for everything inside the widget (blunt universal selector) | rt.css:9-11 |
| `.btn-sm`, `.btn-sm span` → 12px | Small buttons (quick menu, eye toggles) | rt.css:13-15 |
| `.blockpy-content .fas { font-size: 12px }` | All solid FA icons downsized to 12px | bp.css:40-42 |
| `.blockpy-instructions pre, code` → `monospace` | Code in instructions (a broader font-family override at bp.css:64-66 is commented out) | bp.css:68-70 |
| `.blockpy-instructions-reset a` → `smaller` | Reset-instructions link | bp.css:80-82 |
| `.feedback-badge` → 75%, white | Feedback category badge | bp.css:151-154 |
| `.blockpy-feedback pre`, `pre strong`, `span.filename`, `span.lineno` → 12px | Feedback code blocks/tracebacks | bp.css:236-259 |
| `.blockpy-status span/label` → 12px | Footer status text | bp.css:491-493 |
| `.blockpy-content .badge` → 75% | Footer badges | bp.css:495-498 |
| `.blockpy-content sup` → 12px | Superscripts | bp.css:574-576 |
| `.blockpy-feedback-positive-icon`, `.blockpy-student-error` → 16px | Positive-star and bug icons | bp.css:557-560, 567-572 |
| `.pedal-positive-mark` → 16px, system-UI font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`) | Pedal positive mark — the only system-font usage | bp.css:578-582 |
| Rating thumbs → inline `font-size: 20px` | Feedback rating icons | src/feedback.js:55, 61 |
| `.blockpy-content a { text-decoration: underline }` | Links always underlined (a11y retheme) | rt.css:17-19 |
| `.btn` margins 5px top/bottom | Vertical rhythm of toolbar buttons | rt.css:28-31 |

Rewrite guidance: the Helvetica stack and the 14px/12px scale may modernize (e.g., a system-UI stack — the legacy `.pedal-positive-mark` already uses one), but relative hierarchy (12px chrome text vs. 14px body) should be preserved so region proportions match.

### 3.2 Icon inventory (Font Awesome 5, `fas`/`far` prefixes)

| Icon | Where used | Citation |
|---|---|---|
| `fa-play` | Run button | editor/python.js:39 |
| `fa-th-large` / `fa-columns` / `fa-align-left` | View toggles Blocks / Split / Text | editor/python.js:45-47 (via makeTab, :21-27) |
| `fa-sync` | Reset button | editor/python.js:54 |
| `fa-cloud-download-alt` | Import datasets | editor/python.js:62 |
| `fa-file-upload` | Upload (python toolbar; default header) | editor/python.js:69; editor/default_header.js:8 |
| `fa-download` | Download menu item | editor/python.js:84; editor/default_header.js:23 |
| `fa-history` | History toggle | editor/python.js:96 |
| `fa-save` | Save button; toolbox editor save | editor/python.js:113; editor/toolbox.js:9 |
| `fa-trash` | Delete button | editor/python.js:121; editor/default_header.js:32 |
| `fa-ellipsis-v` | Extra-features dropdown | editor/python.js:128 |
| `fa-comment-slash` | Run without feedback | editor/python.js:137 |
| `fa-expand-arrows-alt` / `fa-compress-arrows-alt` | Fullscreen toggle (quick menu; dynamic class) | interface.js:154; blockpy.js:572-573 |
| `fa-list-alt` | Edit queued inputs | interface.js:159 |
| `fa-images` | Toggle image rendering | interface.js:165 |
| `fa-link` | Get shareable link | interface.js:171 |
| `fa fa-terminal` | Instructor stdout dialog (note FA4-style `fa` prefix) | interface.js:178 |
| `fa-bug` | Pink student-error indicator | interface.js:181 |
| `fa-eye` | Console show-feedback; feedback advance-state; trace hide | console.js:31; feedback.js:21; trace.js:13 |
| `far fa-minus-square` / `far fa-plus-square` | Collapse/expand rating strip | feedback.js:52, 71 |
| `fa-thumbs-up` / `fa-thumbs-down` (`fa-meh` commented out) | Feedback rating | feedback.js:55, 61 (58) |
| `fa-star` (dynamic, `"fas fa-"+icon`) | Positive feedback marks | feedback.js:263, 274 |
| `fa-step-backward` / `fa-backward` / `fa-forward` / `fa-step-forward` | Trace first/back/forward/last; history Start/Previous/Next/Most Recent | trace.js:21, 25, 36, 40; history.js:9, 13, 23, 27 |
| `fa-file-import` | History "Use" | history.js:19 |
| `glyphicon glyphicon-new-window` | Trace table list-expansion (dead Bootstrap-3 leftover inside a broken binding) | trace.js:62 |
| `fa-file-signature` (commented out) | Rename button (never shipped) | editor/python.js:145 |
| `.caret` + `.sr-only` "Toggle Dropdown" | Upload split-dropdown arrow (Bootstrap caret, not FA) | editor/python.js:77-78 |

Replacement rule (B6): any modern icon set is acceptable if each glyph is proposed individually with a rationale and is "relatively similar" (e.g., a modern play triangle for `fa-play` is fine; replacing the eye-toggle with a chevron is a semantic change needing justification). The 12px icon sizing (bp.css:40-42) is layout-relevant and must be preserved.

---

## 4. Component states

### 4.1 Run button (`button.blockpy-run`)

| State | Styling | Trigger | Citation |
|---|---|---|---|
| Default | bg `rgb(40, 130, 40)`, color `white`; label "Run" + `fa-play` | — | bp.css:383-386; editor/python.js:36-40 |
| `:focus` | bg `rgb(20, 100, 20)` | keyboard/click focus | bp.css:388-390 |
| `.blockpy-run-running` | bg `#f0ad4e`; label swaps to "Stop" | KO css binding on `ui.execute.isRunning` (execution ACTIVE) | bp.css:392-394; editor/python.js:37-38; blockpy.js:1132-1137 |
| `.blockpy-run-error` | bg `#d9534f` | defined in CSS; **no code in `src/` ever applies this class** (see Open Questions) | bp.css:396-398 |
| `.notransition` | all transitions disabled so state colors snap instantly | always present on the Run button | bp.css:524-529; editor/python.js:36 |

There is no explicit `:hover` or `:disabled` rule for `.blockpy-run` — hover inherits the default green; disabled falls through to Bootstrap's default `.btn:disabled` opacity.

The "Run without feedback" dropdown item also receives `blockpy-run-running` while executing (editor/python.js:133-137), but as an `<a.dropdown-item>` the class only picks up the `button.blockpy-run`-scoped CSS if selectors are loosened — legacy CSS targets `button.blockpy-run` specifically, so the menu item shows no color change.

### 4.2 Secondary buttons (`.btn-outline-secondary` — view toggles, Reset, eye buttons, trace controls, quick menu)

- Default: white bg, `#333` text (rt.css:33-36).
- `:focus`: `#e6e6e6` bg, `#8c8c8c` border (rt.css:38-42).
- `:hover`: `#e6e6e6` bg, `#adadad` border (rt.css:44-48).
- View-toggle labels get Bootstrap's `.active` (via KO binding on `display.pythonMode()`, editor/python.js:22-24); active styling is Bootstrap 4 default `.btn-outline-secondary.active` (gray-filled) — **not** overridden in legacy CSS (see Open Questions).
- History button uses the same `.active` binding on `display.historyMode` (editor/python.js:94).

### 4.3 Delete button (`button.blockpy-delete`)

Default white bg / black text / `rgb(130, 40, 40)` border; `:focus` border `rgb(100, 20, 20)`; `:active` bg `rgb(100, 20, 20)` with white text (bp.css:400-413). (Note: the Python toolbar's Delete button in the template only carries `btn-outline-secondary`, not `blockpy-delete` — editor/python.js:119 — so this styling applies where the class is used, e.g. dialogs.)

### 4.4 File tabs (`.blockpy-content .nav-link`)

| State | Styling | Citation |
|---|---|---|
| Inactive | bg `#cccccc`, black text, no top/bottom border, 2px `#ddd` left/right borders, `border-radius: 0`, padding `.2rem .5rem` | bp.css:301-309 |
| Hover | bg `#ddd` | bp.css:322-324 |
| Active | bg `white`, black, **bold**, 1px `#ddd` border (2px left/right), `padding-bottom: .1rem` | bp.css:311-320 |
| Active hover | stays `white` | bp.css:326-328 |
| Uneditable ("&" files) | `darkblue`, italic | bp.css:334-337 |
| Instructor file | `li.blockpy-file-instructor`, shown only when `display.instructor()` | files.js:16-21 |
| Strip chrome | `.nav-tabs { border-bottom: none }`; first item padding-top 7px, others 5px; links not underlined | bp.css:297-299, 330-332, 344-350 |

### 4.5 Feedback pane category colorings (Pedal categories)

Category → badge class mapping lives at `src/blockpy.js:724-753`; display names at `blockpy.js:754-783`; colors at bp.css:156-194. Badge element: `span.badge.blockpy-feedback-category.feedback-badge` (feedback.js:29-31; white 75% text, bp.css:151-154).

| Pedal category (lowercased) | Badge class | Display text | Color |
|---|---|---|---|
| *(null)* / `none` / default | `label-none` | "" | transparent `rgba(0,0,0,0)` |
| `runtime` | `label-runtime-error` | Runtime Error | `#d9534f` |
| `syntax`, `editor` | `label-syntax-error` | Syntax Error / Editor Error | `darkred` |
| `internal` | `label-internal-error` | Internal Error | `black` |
| `semantic`, `analyzer` | `label-semantic-error` | Algorithm Error | `orangered` |
| `feedback`, `instructor` | `label-feedback-error` | Instructions / Incorrect Answer | `#f0ad4e` |
| `complete` | `label-problem-complete` | Complete | `#5cb85c` |
| `instructions` | `label-instructions` | Instructions | `#5bc0de` |
| `no errors` | `label-no-errors` | No errors | `#5bc0de` |
| *(unused by this mapping)* | `label-success` | — | `#358535` (bp.css:192-194) |

### 4.6 Correct / incorrect submission styling

- **Correct** = Complete category: `#5cb85c` badge (above), plus positive-feedback green stars (`fas fa-star`, color `green`, 16px, feedback.js:263,272-289; bp.css:557-560) and `.green-check-mark` (bold green with 1px black text-shadow outline, bp.css:34-38 — applied by host/server templates, not by `src/`).
- **Incorrect** = Instructor category → orange `#f0ad4e` "Incorrect Answer" badge (blockpy.js:744-745,776-777).
- Instructor view additionally shows `(100*score)%` and a "(reset)" link as muted small text (feedback.js:32-37); reset zeroes score/correct (blockpy.js:784-788).
- Quick menu shows "Your submission is ready to be reviewed!" when submitted (interface.js:122-123); the BlockMirror editor area is hidden entirely while submitted (editor/python.js:154-156).
- Actual-error-while-complete indicator: pink `fa-bug` in the quick menu, hidden by default, shown by feedback code (bp.css:567-572; interface.js:181; feedback.js:269).

### 4.7 Other stateful pieces

- **Feedback rating**: thank-you span animates opacity 0→1 and `translateY(-16px)` on `.show` (bp.css:209-220); rating icons fade out/in on click (blockpy.js:802-809).
- **Full-feedback entries** (instructor dialog): `.feedback-shrunk` clamps to 4em with ellipsis and shows a floating "+" / "−" via `::before` (bp.css:628-648); muted entries strike through their titles (feedback.js:327-332).
- **Server status badges**: `server-status-ready` `#5cb85c` / `-active` `#5bc0de` / `-retrying` `#f0ad4e` / `-failed` `#d9534f` / `-offline` `#333` (bp.css:500-518), class computed per endpoint (blockpy.js:1164-1167).
- **Editor line highlights**: error `#FBC4C4`, uncovered `#FBFBC4`, traced/active `#C4FBC4` (+`#8a1f11` text), applied via BlockMirror `setHighlightedLines` (bp.css:423-443; editor/python.js:280-290).
- **Read-only editor**: `.blockpy-read-only .CodeMirror-scroll` bg `#E5E5E5` (bp.css:458-460).
- **Console themes**: `.blockpy-printer-default` (white/lightgray) vs `.blockpy-printer-inverse` (black/darkgray/white) (bp.css:110-119).
- **Blocking overlay**: black at 50% opacity (bp.css:20-32), inline-darkened `#988`→`#655`→`#333`→`black` per failed reconnect attempt (server.js:225-238).

---

## 5. Open questions

1. **Bootstrap-default colors are part of the perceived palette but not in legacy CSS.** The modal dialog, dropdown menus, `input-group-text` (trace "Step:" chips), `.form-control`, `.custom-select`, table striping (`table-striped`), `.badge-info.badge-pill` (instructor full-feedback score), `.btn-success` ("Okay" in dialogs, dialog.js:21), and the *active* state of `.btn-outline-secondary` view toggles all come from stock Bootstrap 4. Decision needed: pin the Bootstrap 4.x default values into the token sheet, or accept "whatever the compat layer ships" for these secondary surfaces. (Related: `.btn-white` on the dialog Close button, dialog.js:20, is not a Bootstrap class and has no rule in either legacy stylesheet — it renders as an unstyled `.btn`.)
2. **`blockpy-run-error` is styled but apparently never applied.** bp.css:396-398 defines it, but no JS in `src/` adds the class (only `blockpy-run-running` is bound, editor/python.js:38). Recommend the rewrite implement the state anyway (Run turns `#d9534f` on execution error) since the spec cites it — flag as an intentional behavioral *improvement* if we wire it up, or drop the token if strict parity is wanted.
3. **`.green-check-mark` and `.label-success` have no in-repo consumers.** Both are defined (bp.css:34-38, 192-194) but not referenced from `src/` templates; they are presumably used by blockpy-server host templates (assignment-group headers). Verify against the server repo before dropping.
4. **`#faebcd` (bp.css:466) is a near-duplicate of `#faebcc`** — one character off, on the markdown preview border only. Treat as a typo and normalize to `--blockpy-border-warm` unless someone objects.
5. **Conflicting rules on the floating-feedback alert**: element carries `.text-muted-less` (`#444`, rt.css:50-52) but `.blockpy-content .blockpy-floating-feedback` forces `red` (bp.css:270-275). Red wins on specificity; token sheet should record red as normative.
6. **Third-party chrome colors not in these files**: Blockly toolbox/flyout colors, CodeMirror syntax-highlight theme, highlight.js theme for instructions, and EasyMDE internals all ship their own palettes. B6 conformance for those needs a separate extraction from the vendored builds (BlockMirror fork) — out of scope for this appendix's two stylesheets.
7. **Bootstrap-3 vestiges**: the `label-*` badge classes are Bootstrap-3 naming (used with BS4 `.badge`), trace.js:62 references a `glyphicon`, and interface.js:178 uses the FA4 `fa` prefix. The rewrite should keep the *class names* where §9.6 requires legacy hooks, but these inconsistencies need no visual reproduction.
8. **Row-height rules that likely don't bind**: `.blockpy-header`/`.blockpy-bottom` are given `height: 25%` (bp.css:12-18) but the container has no fixed height, so percentage heights generally collapse; actual heights come from content and the 200px printer. Verify with a rendered legacy instance before encoding 25% into the rewrite.
9. **`ui.footer.visible`**: the footer row is conditional (interface.js:243), and `.blockpy-status` text is developer/diagnostic-facing. Confirm whether the rewrite must show it to students or only in instructor/debug mode (legacy shows it whenever the model flag is true; flag definition not in the files audited here).
