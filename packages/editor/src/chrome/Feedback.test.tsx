// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { Feedback, renderFeedbackMessage } from './Feedback';
import { useEditorChromeStore } from './store';

describe('renderFeedbackMessage (feedback.js:213 markdown pass)', () => {
  it('renders markdown like legacy utilities.markdown', () => {
    // Inline code backticks become <code> at PRESENTATION time — Pedal
    // sends raw markdown; the legacy env relied on this exact client pass.
    expect(renderFeedbackMessage('Check your `total` variable')).toContain('<code>total</code>');
    // Inline HTML passes through (D4-A unsanitized).
    expect(renderFeedbackMessage('a <b>bold</b> claim')).toContain('<b>bold</b>');
    // The legacy <pre>\n doubling quirk (feedback.js:213) fires on literal
    // instructor HTML — marked itself emits `<pre><code>` with no newline,
    // exactly as legacy's EasyMDE pipeline did.
    expect(renderFeedbackMessage('<pre>\nx = 1</pre>')).toContain('<pre>\n\n');
  });
});

describe('Feedback rating region (feedback.js:46-74, blockpy.js:789-817)', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      useEditorChromeStore.getState().setFeedback({
        category: 'complete',
        label: 'Complete',
        message: 'ok',
      });
      useEditorChromeStore.getState().clearPromptedShare();
    });
  });

  afterEach(() => {
    act(() => useEditorChromeStore.getState().clearFeedback());
    vi.useRealTimers();
  });

  it('thumbs-up: logs, dims the thumbs, thanks — and does NOT prompt a share', () => {
    vi.useFakeTimers();
    const onRate = vi.fn();
    const { container } = render(<Feedback onRate={onRate} />);
    const thumbsUp = container.querySelector('.blockpy-rating-up')!;
    fireEvent.click(thumbsUp);
    expect(onRate).toHaveBeenCalledWith('thumbs-up');
    expect((thumbsUp as HTMLElement).style.opacity).toBe('0.5');
    expect(container.querySelector('.blockpy-feedback-thank-you')!.className).toContain('show');
    // Ledger LD-18: the legacy quirk (ANY rating → prompted share after 1 s,
    // blockpy.js:801-813) is fixed — positive ratings just say thanks.
    act(() => vi.advanceTimersByTime(1000));
    expect(useEditorChromeStore.getState().promptedShare).toBe(false);
  });

  it('thumbs-down still opens the prompted share dialog after 1 s (LD-18)', () => {
    vi.useFakeTimers();
    const { container } = render(<Feedback onRate={() => undefined} />);
    fireEvent.click(container.querySelector('.blockpy-rating-down')!);
    act(() => vi.advanceTimersByTime(1000));
    expect(useEditorChromeStore.getState().promptedShare).toBe(true);
  });

  it('collapse toggle persists like legacy localSettings', () => {
    const { container, unmount } = render(<Feedback onRate={() => undefined} />);
    expect(container.querySelector('.blockpy-feedback-response-full')).not.toBeNull();
    fireEvent.click(container.querySelector('[title="Hide rating"]')!);
    expect(container.querySelector('.blockpy-feedback-response-full')).toBeNull();
    expect(container.querySelector('.blockpy-feedback-response-collapsed')).not.toBeNull();
    expect(localStorage.getItem('BLOCKPY_display.showRating')).toBe('false');
    unmount();
    // A fresh mount reads the persisted preference.
    const { container: remounted } = render(<Feedback onRate={() => undefined} />);
    expect(remounted.querySelector('.blockpy-feedback-response-full')).toBeNull();
  });

  it('renders no rating region without a handler or without a label', () => {
    const { container } = render(<Feedback />);
    expect(container.querySelector('.blockpy-rating-up')).toBeNull();
    act(() => useEditorChromeStore.getState().clearFeedback());
    const { container: unlabeled } = render(<Feedback onRate={() => undefined} />);
    expect(unlabeled.querySelector('.blockpy-rating-up')).toBeNull();
  });

  it('instructor header shows the score % and reset only when scored', () => {
    const onResetScore = vi.fn();
    const { container } = render(<Feedback instructor score={0.5} onResetScore={onResetScore} />);
    expect(container.textContent).toContain('50%');
    fireEvent.click(container.querySelector('.blockpy-feedback-reset')!);
    expect(onResetScore).toHaveBeenCalled();
    const { container: zero } = render(
      <Feedback instructor score={0} onResetScore={onResetScore} />,
    );
    expect(zero.querySelector('.blockpy-feedback-reset')).toBeNull();
  });
});
