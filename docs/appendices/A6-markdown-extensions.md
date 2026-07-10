# Appendix A6 — Markdown/HTML Rendering Pipelines (Legacy Inventory)

Status: verified against legacy sources on 2026-07-10.
Sources: `blockpy` client repo (`c:/Users/acbar/Projects/blockpy-edu/blockpy`), server repo (`c:/Users/acbar/Projects/blockpy-server`). All paths below are relative to those repo roots.

There are **two distinct pipelines**, not one. The client's instructions pane uses EasyMDE's bundled `marked`; the server frontend (readings, quiz question text, explanations, kettle) uses `markdown-it`. Any rewrite claim that readings render "with the same pipeline as instructions" (README §11.2) is incorrect for the legacy system and must be reconciled (see Open questions).

---

## 1. Client instructions pane (`!instructions.md`, blockpy type)

### 1.1 Renderer: EasyMDE's `marked`, invoked statically

- The single markdown utility is defined at `blockpy/src/blockpy.js:1236-1241`:
  ```js
  this.utilities = {
      markdown: (text) => text ? EasyMDE.prototype.markdown(text) : "<p></p>"
  };
  ```
  Note it is called on **`EasyMDE.prototype`** with no instance, so `this.options` is `undefined` inside EasyMDE's `markdown()`. Consequences (from the bundled EasyMDE source, `blockpy-server/static/libs/easymde/easymde.min.js`, `prototype.markdown=function(e){...}`):
  - `markedOptions = {}` (no `renderingConfig.markedOptions`).
  - `breaks: true` is forced (GFM single-line-break mode) because `singleLineBreaks === false` is never set.
  - `codeSyntaxHighlighting` is **not** enabled through marked (that branch requires an options object).
  - After `marked(text)`, EasyMDE post-processes all `<a ...>` tags lacking `target=` to add `target="_blank"`.
- EasyMDE (and its embedded `marked`) is a page global, loaded by the server's `libs_js` asset bundle: `blockpy-server/controllers/assets.py:31` (`libs/easymde/easymde.min.js`). It is declared as a webpack external/global on the client side (the client never imports it; see the bare `EasyMDE` global at `blockpy/src/blockpy.js:1239` and `blockpy/src/editor/markdown.js:13`).

### 1.2 Pipeline order

Computed observable `ui.instructions.current` at `blockpy/src/blockpy.js:551-563`:

1. Pick raw text: instructor-changed instructions (`display.changedInstructions`) if present, else `assignment.instructions` (`blockpy.js:555-558`).
2. If `settings.instructionsPool` is set, run **pool extraction** `formatPoolInstructions(raw, model)` (`blockpy.js:559-561`), defined at `blockpy/src/pools.js:27-39`:
   - Pool sections are split on the HTML-comment separator regex `/<!-{4,}# .+ #-{4,}>/` (`pools.js:5`), one section chosen by `1 + (seed % (pools.length-2))` (`pools.js:8-10`), keeping the header (index 0) and footer (last) sections (`pools.js:12-20`).
   - Instructors get an appended italic notice about the randomized pool (`pools.js:35-37`).
3. `self.utilities.markdown(raw)` → HTML string (`blockpy.js:562`).
4. Injected into the DOM with a raw Knockout `html:` binding — `<div class='blockpy-instructions' data-bind="html: ui.instructions.current">` (`blockpy/src/interface.js:111-114`). **No sanitization at any stage**; arbitrary instructor HTML (including `<script>`) passes through.
5. Syntax highlighting is applied *after* render, debounced 400 ms, by a subscription that runs `window.hljs.highlightBlock(block)` over `.blockpy-instructions pre code` (`blockpy/src/interface.js:36-48`). `hljs` is the page-global highlight.js from `blockpy-server/controllers/assets.py:25-26` (`libs/highlight/highlight.min.js` + `highlightjs-line-numbers.min.js`).

The same `utilities.markdown` also renders the feedback pane message (with `hljs.highlightBlock` on its code blocks) at `blockpy/src/feedback.js:213-219`.

### 1.3 Related but distinct: Part extraction

`extractPart` splits **submission code** (not instructions) on `/^(##### Part (.+))$/gm` for multi-part pages (`blockpy/src/utilities.js:230-262`); the reader-side equivalent `injectCodePart` is at `blockpy-server/frontend/services/plugins.ts:284-314`.

### 1.4 What the client pipeline does NOT have

- **No LaTeX/MathJax/KaTeX.** No references anywhere in `blockpy/src` or in the server's asset bundles/templates (`blockpy-server/controllers/assets.py`; the `static/libs/math/` directory is math.js, a numeric library, not a renderer). README §11.1's "LaTeX if currently supported" resolves to: **not supported**.
- **No sanitization allowlist.** Neither pipeline sanitizes. The only escaping helper, `encodeHTML` (`blockpy/src/utilities.js:143-149`), is not used for instructions.
- **No dynamic placeholders/templating** beyond the two mechanisms above (instruction pools, `##### Part` extraction). There is no variable interpolation in instructions.

---

## 2. Server frontend reader/quiz content (`markdown-it` pipeline)

### 2.1 Renderer configuration

Defined once at `blockpy-server/frontend/services/plugins.ts:192-260` and shared by the reader, quizzes, explanations, and kettle (usage: `reader/reader.html:61-62`, `quizzes/questions_ui.html`, `explanations/explain.ts`, `kettle/kettle.ts`):

```ts
export let md: MarkdownIt = new MarkdownIt({
    html: true,          // raw HTML allowed — no sanitization
    highlight: function (str, lang, langAttrs) { ... }
})
```

- `html: true` (`plugins.ts:193`): instructor HTML passes through unsanitized.
- highlight.js is configured for `["python", "javascript", "typescript", "r"]` auto-detection (`plugins.ts:151-153`) but `md`'s `highlight` callback accepts any language hljs knows (`plugins.ts:196-197`).
- No LaTeX plugin, no markdown-it-container (a comment at `reader/reader.ts:5-7` shows markdown-it-container was *planned* for BlockPy regions, but the shipped mechanism is the fenced-code `langAttrs` scheme below).

### 2.2 The `highlight` callback: how a code block is marked runnable

`plugins.ts:194-243`. Behavior keys off the fence's language and its **info-string attributes** (`langAttrs` = anything after the language on the ``` line):

- **`python` with a non-empty `langAttrs`** (e.g. ```` ```python part1 ````): the attrs string is the **Part ID**. Emits (`plugins.ts:198-209`):
  1. `<pre class="reader-launch-blockpy" data-part-id="{attrs}">` containing hljs-highlighted code;
  2. a hidden `<div style="display: none">{raw source}</div>`;
  3. `<div data-bind="blockPyEditor: {partId: '{attrs}', launched: false, assignment..., submission...}"></div>`.
  A `python` fence **without** attrs takes the same code path but with an empty `launchBlockpy` class and `partId: ''`, and the `blockPyEditor` binding refuses to add a Run button when `partId` is falsy (`plugins.ts:353`) — so **runnable = python fence + non-empty part-ID attr**.
- **`typescript` / `ts` / `r` with attrs**: same scheme but class `reader-launch-kettle` and a `kettleLauncher` binding (`plugins.ts:213-225`).
- **Any other recognized language**: plain hljs-highlighted `<pre><code class="language-... hljs">` (`plugins.ts:229-239`).
- **Unrecognized language / no language**: escaped via `md.utils.escapeHtml` in `<pre class="hljs"><code>` (`plugins.ts:242`).

### 2.3 Hydration of runnable blocks

- `ko.bindingHandlers.blockPyEditor` (`plugins.ts:350-368`): renders a `Run` button (`btn blockpy-run`, fa-play icon) before the placeholder; on click it hides itself, reads the raw source from the hidden sibling div (`$(element).prev().prev().text()`, `plugins.ts:359`), hides the highlighted `<pre>` (`plugins.ts:362`), and calls `launchBlockPy`.
- `launchBlockPy` (`plugins.ts:317-348`) instantiates a full `blockpy.BlockPy` in place with:
  - `urls` = `window.$blockPyUrls` **minus** `saveAssignment`, `updateSubmission`, `updateSubmissionStatus` (`plugins.ts:321-326`) — embedded editors can save code (`saveFile` survives) but can never flip submission correctness;
  - `partId`, `"assignment.settings.small_layout": "true"`, `"display.python.mode": "text"`, and the block's source as `submission.code` (`plugins.ts:328-332`);
  - if a partId is present, it synthesizes assignment/submission data with `injectCodePart` so only that Part's region of `answer.py` is edited (`plugins.ts:334-342`, part splitting per `##### Part <id>` headers, `plugins.ts:284-314`);
  - every instance is pushed to `window.$ALL_BLOCKPY_EDITORS` (`plugins.ts:262`, `343`).
- `ko.bindingHandlers.kettleLauncher` (`plugins.ts:370-399`): analogous, with an `Edit` button (`btn-success kettle-launch`, fa-pencil), spawning a `<kettle>` component with `initialCode`, `language`, `partId`.
- The Run button floats right inside reader content via `reader .reader-launch-blockpy button { float: right }` (`blockpy-server/templates/blockpy/editor_includes.html:60-62`).

### 2.4 Link/image rewriting plugin (the only md plugin installed)

A custom core rule `replace-link` (`plugins.ts:244-260`) rewrites `link_open` `href` and `image` `src` tokens: any URL **not** starting with `http` is passed through `env.downloadUrl` (`plugins.ts:188-190`). The `markdowned` binding supplies the env (`plugins.ts:264-282`): when an assignment is in scope, relative paths become
`{$URL_ROOT}blockpy/download_file?placement=assignment&directory={assignmentId}&filename={link}` (`plugins.ts:271-273`); otherwise links pass through unchanged.

The `markdowned` binding also calls `ko.applyBindingsToDescendants` after setting `innerHTML` (`plugins.ts:276`) — this is what activates the `blockPyEditor`/`kettleLauncher` bindings emitted by the highlight callback. It sets `controlsDescendantBindings: true` (`plugins.ts:265-267`).

### 2.5 Images

- Rewritten to the `download_file` endpoint when relative (§2.4).
- Reader page CSS constrains them: centered block, `max-height: 256px` (`blockpy-server/templates/blockpy/editor_includes.html:53-58`).

### 2.6 Embedded YouTube / HTML5 video (reader)

Videos are **not** embedded through markdown; they come from the reading's `settings` JSON (parsed at `reader/reader.ts:223-257`):

- `settings.youtube`: either a video-id string or an object mapping voice-name → video-id (`reader.ts:226-232`); rendered as an iframe `https://www.youtube.com/embed/{id}?feature=oembed&rel=0&enablejsapi=1` with fullscreen attrs, id `reader-youtube-video` (`reader/reader.html:52-60`). A voice-choice dropdown appears when multiple options exist (`reader.html:17-30`); the choice is persisted in localStorage key `blockpy-reader-voice-choice` (`reader.ts:56`, `184-221`).
- `settings.video`: direct MP4 URL (same string-or-voices shape, `reader.ts:233-239`); rendered as `<video controls crossorigin preload="metadata">` with the source URL + `#t=1` and a `.vtt` captions track derived by swapping the extension (`reader.html:44-50`, `reader.ts:93-99`).
- Watch logging: HTML5 video events `"pause playing seeked ended loadeddata error ratechange waiting"` (`reader.ts:28`, bound at `reader.ts:306-309`) and YouTube `YT.Player` `onStateChange` (`reader.ts:311-334`) both log `Resource.View` / category `reading` / label `watch`, with a JSON message containing `event`, `time`, and (HTML5 pause only) `duration` (`reader.ts:259-280`).
- Other settings surfaced in the reader body: `header`, `summary`, `slides` (relative slides get the `download_file` URL treatment, `reader.ts:245-249`), `popout` toggle (`reader.ts:241-243`), `start_timer_button` for exams (`reader.ts:251-256`).

### 2.7 Reader instructions persistence

The reader saves its content as the assignment file `!instructions.md` through `saveFile` (`reader/reader.ts:374-382`); instructor editing uses the `markdowneditor` Knockout binding, which is a real EasyMDE instance with `renderingConfig.codeSyntaxHighlighting: true` (`plugins.ts:105-120`) — note that this **editor preview** therefore highlights code via marked/hljs, while the **student-facing render** goes through the markdown-it pipeline above.

---

## 3. Side-by-side summary

| Aspect | Client instructions pane | Server reader/quiz content |
|---|---|---|
| Library | `marked` (inside EasyMDE, page global) — `blockpy.js:1239`, `assets.py:31` | `markdown-it` — `plugins.ts:192` |
| Raw HTML | allowed (KO `html:` binding, `interface.js:112-114`) | allowed (`html: true`, `plugins.ts:193`) |
| Sanitization | none | none |
| Line breaks | `breaks: true` forced (EasyMDE default path) | markdown-it default (`breaks` not set → false) |
| Syntax highlighting | post-render hljs, 400 ms debounce (`interface.js:38-48`) | in-render hljs via `highlight` callback (`plugins.ts:194-243`) |
| Link rewriting | `target="_blank"` added by EasyMDE post-processing | relative href/src → `download_file` endpoint (`plugins.ts:244-260`) |
| Runnable code | n/a | ```` ```python <partId> ```` → Run-button BlockPy; `ts`/`r` → Kettle (`plugins.ts:198-225`) |
| LaTeX/MathJax/KaTeX | none | none |
| Templating | instruction pools (`pools.js:27-39`) + `##### Part` extraction (`utilities.js:230-262`) | `##### Part` injection for runnable blocks (`plugins.ts:284-314`) |

---

## Open questions

1. **Unify or preserve the split?** The rewrite must decide whether to keep two renderers (bug-for-bug) or one. Observable differences that could bite: `breaks:true` vs markdown-it's default `breaks:false` (single newlines become `<br>` in instructions but not in readings), and `target="_blank"` injection (instructions only).
2. **Sanitization policy.** Legacy has none in either pipeline (instructor-authored content is fully trusted, including `<script>`). README §11.1 says "sanitized HTML" — that is *not* legacy behavior; adopting sanitization is a deliberate (probably desirable) break that needs an explicit allowlist decision and a check against existing course content (some courses likely rely on `<script>`/`<style>`/iframes in instructions).
3. **markdown-it options drift.** `linkify` and `typographer` are left at defaults (off) — confirm no course content depends on autolinking behavior differences vs marked (marked autolinks GFM-style URLs; markdown-it with `linkify:false` does not).
4. **The `langAttrs` part-ID contract** is positional and unvalidated ("hopefully folks don't try to get fancy with that", `plugins.ts:195`). The rewrite should freeze the exact grammar: everything after the language word in the fence info string is the part ID, verbatim.
5. **Marked/EasyMDE and markdown-it versions** are whatever is vendored in `blockpy-server/static/libs/easymde/easymde.min.js` and the frontend's package-lock; pin the exact versions when building conformance fixtures (rendering differences across marked versions are real, e.g. header-id generation).
6. **Quiz question text** uses the same `markdowned` binding (`quizzes/questions_ui.html`) — meaning a quiz question can technically embed a runnable python block. Decide whether the rewrite preserves that accidental capability.
