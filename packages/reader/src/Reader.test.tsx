// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Reader, type ReaderLoadResult, type ReaderProps } from './Reader';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

function loadResult(
  overrides: Partial<ReaderLoadResult['assignment']> = {},
  submission = true,
): ReaderLoadResult {
  return {
    assignment: {
      id: 103,
      name: 'Reading: Variables',
      url: 'reading_variables',
      instructions: '# Variables\n\nBody text.\n\n```python part1\nprint(1)\n```',
      settings: JSON.stringify({ header: 'Chapter 1', summary: 'A summary.' }),
      ...overrides,
    },
    submission: submission
      ? { id: 5003, correct: false, dateStarted: null, timeLimit: null }
      : null,
  };
}

function renderReader(props: Partial<ReaderProps> = {}, result = loadResult()) {
  const loadAssignment = vi.fn(async () => result);
  const view = render(<Reader assignmentId={103} loadAssignment={loadAssignment} {...props} />);
  return { view, loadAssignment };
}

describe('Reader (reader.ts port, §11.2)', () => {
  it('renders header, summary, and the markdown body after load', async () => {
    renderReader();
    await waitFor(() => {
      expect(screen.getByText('Chapter 1')).toBeDefined();
    });
    expect(screen.getByText('A summary.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Variables' })).toBeDefined();
  });

  it('load ⇒ markRead when a submission exists; markCorrect on the echo (A7 §4)', async () => {
    const markRead = vi.fn(async () => ({
      success: true,
      correct: true,
      submissionStatus: 'Completed',
    }));
    const markCorrect = vi.fn();
    renderReader({ markRead, markCorrect });
    await waitFor(() => {
      expect(markRead).toHaveBeenCalledWith(103, 5003);
    });
    await waitFor(() => {
      expect(markCorrect).toHaveBeenCalledWith(103);
    });
  });

  it('anonymous loads (no submission) never mark', async () => {
    const markRead = vi.fn(async () => ({ success: true }));
    renderReader({ markRead }, loadResult({}, false));
    await waitFor(() => {
      expect(screen.getByText('Chapter 1')).toBeDefined();
    });
    expect(markRead).not.toHaveBeenCalled();
  });

  it('server rejection surfaces via the error message (reader.ts:405-408)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const markRead = vi.fn(async () => ({
      success: false,
      message: 'Passcode rejected.',
    }));
    renderReader({ markRead });
    await waitFor(() => {
      expect(screen.getByText('Passcode rejected.')).toBeDefined();
    });
    errorSpy.mockRestore();
  });

  it('hydrates runnable blocks: Run button → minified editor, pre hidden', async () => {
    const { view } = renderReader();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Run/ })).toBeDefined();
    });
    const pre = view.container.querySelector<HTMLElement>('.reader-launch-blockpy')!;
    expect(pre.style.display).not.toBe('none');
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    expect(pre.style.display).toBe('none');
    await waitFor(() => {
      expect(view.container.querySelector('.blockpy-minified')).not.toBeNull();
    });
  });

  it('exam gate: hides the group selector until the timer starts', async () => {
    const selector = document.createElement('div');
    selector.className = 'assignment-selector-div';
    document.body.appendChild(selector);
    const startAssignment = vi.fn(async () => ({ success: true }));
    const onTimeLimitInfo = vi.fn();
    renderReader(
      { startAssignment, onTimeLimitInfo, isInstructor: () => false },
      loadResult({
        settings: JSON.stringify({ start_timer_button: true, time_limit: '10min' }),
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'I am ready to start the exam!' })).toBeDefined();
    });
    expect(selector.style.display).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'I am ready to start the exam!' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Exam has begun/ })).toBeDefined();
    });
    expect(selector.style.display).toBe('');
    expect(startAssignment).toHaveBeenCalledWith(103, expect.any(String));
    // Countdown feed: load reported no start; the exam start reports one.
    expect(onTimeLimitInfo).toHaveBeenLastCalledWith({
      timeLimit: '10min',
      studentTimeLimit: null,
      dateStarted: expect.any(String),
    });
  });

  it('logs read pings through the lti.fetchWindowSize round trip', async () => {
    vi.useFakeTimers();
    try {
      const logEvent = vi.fn();
      renderReader({ logEvent });
      await vi.waitFor(() => {
        expect(screen.getByText('Chapter 1')).toBeDefined();
      });
      // The 1 s kickoff posts the window-size probe; unframed, our own
      // message echoes straight back (top === self).
      await vi.advanceTimersByTimeAsync(1100);
      const readEvents = logEvent.mock.calls.filter(([, , label]) => label === 'read');
      expect(readEvents.length).toBe(1);
      const payload = JSON.parse(readEvents[0]![3] as string) as { count: number; delay: number };
      expect(payload.count).toBe(2); // legacy: logCount seeds at 1, ping increments
      expect(payload.delay).toBe(60000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('popout and slides buttons render with legacy hrefs', async () => {
    const { view } = renderReader(
      { editUrl: (a) => `/assignments/reading/${a.url}?` },
      loadResult({ settings: JSON.stringify({ slides: 'deck.pdf' }) }),
    );
    await waitFor(() => {
      expect(screen.getByText('Popout')).toBeDefined();
    });
    const popout = screen.getByText('Popout').closest('a')!;
    expect(popout.getAttribute('href')).toBe('/assignments/reading/reading_variables?&embed=true');
    const download = screen.getByText('Download').closest('a')!;
    expect(download.getAttribute('href')).toBe('deck.pdf');
    expect(view.container.querySelector('video')).toBeNull();
  });
});
