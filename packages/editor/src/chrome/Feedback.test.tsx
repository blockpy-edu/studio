// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { Feedback } from './Feedback';
import { useEditorChromeStore } from './store';

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

  it('rates: logs, dims the thumbs, thanks, then prompts a share (quirk)', () => {
    vi.useFakeTimers();
    const onRate = vi.fn();
    const { container } = render(<Feedback onRate={onRate} />);
    const thumbsUp = container.querySelector('.blockpy-rating-up')!;
    fireEvent.click(thumbsUp);
    expect(onRate).toHaveBeenCalledWith('thumbs-up');
    expect((thumbsUp as HTMLElement).style.opacity).toBe('0.5');
    expect(
      container.querySelector('.blockpy-feedback-thank-you')!.className,
    ).toContain('show');
    // Legacy quirk: ANY rating opens the prompted share dialog after 1 s
    // (the suggestShare parameter was dead, blockpy.js:801-813).
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
    const { container } = render(
      <Feedback instructor score={0.5} onResetScore={onResetScore} />,
    );
    expect(container.textContent).toContain('50%');
    fireEvent.click(container.querySelector('.blockpy-feedback-reset')!);
    expect(onResetScore).toHaveBeenCalled();
    const { container: zero } = render(
      <Feedback instructor score={0} onResetScore={onResetScore} />,
    );
    expect(zero.querySelector('.blockpy-feedback-reset')).toBeNull();
  });
});
