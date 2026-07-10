# Spike S2 — Lezer CST → Blockly Feasibility

**Date:** 2026-07-10
**Verdict: GO** — one documented grammar gap, no blockers.
**Context:** maintainer decision (2026-07-10): text→blocks is driven by the
CodeMirror CST (`@lezer/python`), not CPython `ast` in the engine worker
(README §8.2, updated). This spike validates that decision against the
BlockMirror round-trip corpus.

**Method:** `spikes/s2-lezer-cst/parse-corpus.mjs` extracts the 79-program
`TESTS` corpus from `BlockMirror/test/simple.html` (the legacy round-trip
suite covering the full supported construct set), parses each with
`@lezer/python` 1.1.19, and compares accept/reject verdicts against CPython
3.11 `ast.parse` as ground truth.

## Results

- **Agreement: 78/79.** Every construct BlockMirror supports — comprehensions
  (all four kinds), decorators, star-args/kwargs, slices incl. multi-dim,
  annotated assignments, try/except/else/finally, with-multiple, lambda,
  chained comparisons, `___` placeholders — parses cleanly.
- **The one divergence: valueless `yield`.** `@lezer/python` marks bare
  `yield` (and `(yield)`) as a syntax error in every position; `yield expr`
  is fine. CPython accepts valueless yield. Corpus program #61 is the only
  failure. Minimal repro: `def f():\n    yield` → error node.
- **Comments are real CST nodes** (`Comment`), preserved with exact
  positions — supports B2's statement-granularity comment policy without a
  side channel.
- **Error nodes are precise and detectable** (`node.type.isError`, may be
  zero-width), giving B3 (disable blocks on unparseable text) a clean
  implementation: any error node in the tree ⇒ blocks/split unavailable.
- **Performance:** 1,000-line synthetic student program parses in ~35 ms
  cold (Node, this machine); corpus programs are sub-millisecond. Synchronous
  on-toggle conversion is comfortably viable; Lezer's incremental reparsing
  makes Split-mode live updates cheaper still.
- **CST inventory:** 96 node types encountered across the corpus (list in
  the script output) — the working vocabulary for the CST→workspace builder.

## Consequences / follow-ups

1. **Valueless `yield` gap:** options — (a) upstream a grammar fix to
   `@lezer/python` (best; small grammar change), (b) tolerate that specific
   error pattern in the blocks-availability check, or (c) accept that bare
   `yield` disables blocks mode (false-positive vs BlockMirror, which
   supports it). Track as a §16.1.2 known-delta until resolved. Novice-code
   impact is very low.
2. **B3 nuance:** because Lezer error-recovers, "has any error node" is the
   correct unparseable test — do NOT generate blocks from a recovered tree.
3. The round-trip suite (§16.1.2) should keep the CPython cross-check from
   this spike as a permanent test: Lezer-accepts ⇔ `ast.parse`-accepts over
   the corpus, so grammar drift in either direction surfaces immediately.
4. `ast.parse` accepts some programs that fail at bytecode-compile time
   (e.g. top-level `return` in corpus #71) — the corpus contains such code
   on purpose (BlockMirror supported it), and Lezer agrees. Blocks must
   therefore not assume parseable ⇒ runnable.

## Rerun

```
node spikes/s2-lezer-cst/parse-corpus.mjs
```
