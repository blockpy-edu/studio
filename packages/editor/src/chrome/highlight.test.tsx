// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Instructions } from './Instructions';
import { Feedback } from './Feedback';
import { useEditorChromeStore } from './store';

/**
 * LD-10: legacy intended hljs highlighting over instructions/feedback
 * `pre code` blocks but never loaded highlight.js on the editor page;
 * studio bundles it and makes the behavior real.
 */
describe('code highlighting (LD-10)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('highlights instruction code fences after the legacy 400 ms debounce', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Instructions markdown={'Try this:\n\n```python\nprint(1 + 2)\n```'} />,
    );
    const block = container.querySelector('pre code')!;
    expect(block.className).not.toContain('hljs');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(block.className).toContain('hljs');
    // Python tokens got span-wrapped (built-in print).
    expect(block.querySelector('.hljs-built_in')).not.toBeNull();
  });

  it('highlights feedback message code immediately (feedback.js:218-220)', () => {
    act(() =>
      useEditorChromeStore.getState().setFeedback({
        category: 'instructor',
        label: 'Try again',
        message: '<pre><code class="language-python">x = [1]</code></pre>',
      }),
    );
    const { container } = render(<Feedback />);
    const block = container.querySelector('.blockpy-feedback-message code')!;
    expect(block.className).toContain('hljs');
    act(() => useEditorChromeStore.getState().clearFeedback());
  });
});
