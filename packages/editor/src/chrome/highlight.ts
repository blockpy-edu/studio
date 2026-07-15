/**
 * Code-block highlighting for instructions and feedback HTML.
 *
 * Legacy intent: `window.hljs.highlightBlock` over `pre code` after
 * instructions update (interface.js:38-47, 400 ms debounce) and feedback
 * presentation (feedback.js:218-220). In legacy this is DEAD CODE on the
 * editor page - no template ever loads highlight.js, so the calls throw
 * silently. Studio bundles highlight.js and makes the intended behavior
 * real (approved difference LD-10).
 */
import hljs from 'highlight.js/lib/common';

/** Highlight every `pre code` block under `root`. Fail-soft, like legacy. */
export function highlightCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('pre code').forEach((block) => {
    try {
      hljs.highlightElement(block);
    } catch {
      // Legacy's missing-hljs errors were swallowed by the console; a bad
      // language annotation should likewise never break the pane.
    }
  });
}
