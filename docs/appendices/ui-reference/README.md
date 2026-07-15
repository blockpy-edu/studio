# Legacy UI Reference Screenshots (B6 visual parity)

Captured from the live legacy client (dev blockpy-server, course 3 / group 189) via `node tools/capture-ui-reference.mjs` on 2026-07-10, at 1440px
viewport width. These are the ground truth for the B6 visual-parity
requirement (spec §8.1); the layout/palette extraction lives in
[A8-ui-parity.md](../A8-ui-parity.md).

| File                          | Shows                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `legacy-editor-default.png`   | Coding editor as loaded (text view, toolbar, console, feedback pane)               |
| `legacy-editor-after-run.png` | After a successful run: console output, "Complete" feedback chip, status badge row |
| `legacy-editor-blocks.png`    | Blocks view (Blockly workspace)                                                    |
| `legacy-reading.png`          | Reading assignment                                                                 |

> A quiz screenshot was deliberately removed (2026-07-10): group 189's quiz
> is an **exam** and its questions are sensitive. Capture the quiz UI
> reference from a non-exam practice quiz before Milestone 2.4.

Notable details visible in the captures (conformance targets):

- Warm cream/yellow page background behind all editor regions.
- Green Run button (leftmost), then the Blocks/Split/Text toggle group with
  the active view highlighted dark, then Reset / Import datasets / Upload /
  History.
- Console (top-left, with Evaluate button) beside the Feedback pane
  (top-right, category chip + View Trace button).
- Status badge row under the editor (Load Assignment / Save Assignment /
  Load File / Save File / Load Dataset / Log Event / Update Submission /
  Execution) in green/red.
- Navigation header rendered twice (top + bottom) with First/Back/select/
  completion box/Next/Last and the session clock right-aligned; the captured
  group is secretive, so the completion box shows `??/5` - live confirmation
  of the A7/§9.1 masking behavior.
