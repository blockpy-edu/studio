// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import {
  formatClockTime,
  isSubmitted,
  markSubmittedText,
  QuickMenu,
  type SubmissionControls,
} from './QuickMenu';
import { Footer } from './Footer';
import { requestPasscode, useEditorChromeStore } from './store';

function controls(overrides: Partial<SubmissionControls> = {}): SubmissionControls {
  return {
    status: 'inProgress',
    reviewed: true,
    onUpdateStatus: () => {},
    ...overrides,
  };
}

function resetStore() {
  const state = useEditorChromeStore.getState();
  state.setQueuedInputs([]);
  state.setClearInputs(true);
  state.setDirtySubmission(true);
  state.setPasscode('');
  state.setTheme('light');
}

describe('formatClockTime (utilities.js getCurrentTime)', () => {
  it('formats h:mm with am/pm and zero-padded minutes', () => {
    expect(formatClockTime(new Date(2026, 6, 10, 9, 5))).toBe('9:05am');
    expect(formatClockTime(new Date(2026, 6, 10, 15, 42))).toBe('3:42pm');
  });

  it('replicates the legacy hours%12 quirk: noon and midnight show hour 0', () => {
    expect(formatClockTime(new Date(2026, 6, 10, 12, 30))).toBe('0:30pm');
    expect(formatClockTime(new Date(2026, 6, 10, 0, 7))).toBe('0:07am');
  });
});

describe('markSubmittedText ladder (blockpy.js:593-607)', () => {
  it('completed → closed caption, grouped variant', () => {
    expect(markSubmittedText(controls({ status: 'Completed' }), false)).toBe('Assignment closed');
    expect(markSubmittedText(controls({ status: 'completed', grouped: true }), false)).toBe(
      'Problem closed',
    );
  });

  it('submitted (reviewed/canClose) → reopen', () => {
    expect(markSubmittedText(controls({ status: 'Submitted' }), false)).toBe('Reopen for editing');
    expect(isSubmitted(controls({ status: 'submitted', reviewed: false }))).toBe(false);
  });

  it('dirty → Run; clean → Submit when visible+correct, else Submit early', () => {
    expect(markSubmittedText(controls(), true)).toBe('Run');
    expect(markSubmittedText(controls({ correct: true }), false)).toBe('Submit');
    expect(markSubmittedText(controls({ correct: true, hidden: true }), false)).toBe(
      'Submit early',
    );
    expect(markSubmittedText(controls({ correct: false }), false)).toBe('Submit early');
  });
});

describe('QuickMenu component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the legacy region markup with fullscreen/inputs/images buttons', () => {
    const { container } = render(<QuickMenu />);
    const menu = container.querySelector('.blockpy-quick-menu');
    expect(menu).not.toBeNull();
    expect(menu!.getAttribute('role')).toBe('menubar');
    expect(menu!.querySelector('[title="Full Screen"]')).not.toBeNull();
    expect(menu!.querySelector('[title="Edit Inputs"]')).not.toBeNull();
    expect(menu!.querySelector('[title="Toggle Images"]')).not.toBeNull();
    // Bug icon present but display:none via CSS (dead in legacy too).
    expect(menu!.querySelector('.blockpy-student-error')).not.toBeNull();
    // No share URL configured → no share button (legacy canShare).
    expect(menu!.querySelector('[title^="Get Shareable Link"]')).toBeNull();
  });

  it('hides the queued-inputs button under hide_queued_inputs', () => {
    const { container } = render(<QuickMenu hideQueuedInputs />);
    expect(container.querySelector('[title="Edit Inputs"]')).toBeNull();
  });

  it('shows the view-as-instructor checkbox only for graders', () => {
    const seen: boolean[] = [];
    const { container, rerender } = render(<QuickMenu />);
    expect(container.querySelector('#blockpy-as-instructor')).toBeNull();
    rerender(<QuickMenu grader onInstructorChange={(on) => seen.push(on)} />);
    const checkbox = container.querySelector<HTMLInputElement>('#blockpy-as-instructor');
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox!);
    expect(seen).toEqual([true]);
  });

  it('EDIT_INPUTS dialog round-trips queued inputs and the reuse flag', () => {
    const { container } = render(<QuickMenu />);
    fireEvent.click(container.querySelector('[title="Edit Inputs"]')!);
    const dialog = container.querySelector('.blockpy-dialog');
    expect(dialog).not.toBeNull();

    fireEvent.change(dialog!.querySelector('textarea.blockpy-input-list')!, {
      target: { value: 'first\nsecond' },
    });
    fireEvent.click(dialog!.querySelector('.blockpy-remember-inputs')!);
    fireEvent.click(dialog!.querySelector('.modal-okay')!);

    const state = useEditorChromeStore.getState();
    expect(state.queuedInputs).toEqual(['first', 'second']);
    // "Reuse inputs" checked ⇒ clearInputs false (dialog.js:196-199).
    expect(state.clearInputs).toBe(false);
    expect(container.querySelector('.blockpy-dialog')).toBeNull();
  });

  it('mark-submitted ladder: dirty run → onRun, clean → Submitted', () => {
    const statuses: string[] = [];
    let ran = 0;
    const submission = controls({
      onUpdateStatus: (status) => statuses.push(status),
    });
    const { container, rerender } = render(
      <QuickMenu submission={submission} onRun={() => ran++} />,
    );
    const button = () =>
      Array.from(container.querySelectorAll('button')).find((b) =>
        ['Run', 'Submit early', 'Submit', 'Reopen for editing'].includes(b.textContent ?? ''),
      )!;
    expect(button().textContent).toBe('Run');
    fireEvent.click(button());
    expect(ran).toBe(1);

    act(() => useEditorChromeStore.getState().setDirtySubmission(false));
    rerender(<QuickMenu submission={submission} onRun={() => ran++} />);
    expect(button().textContent).toBe('Submit early');
    fireEvent.click(button());
    expect(statuses).toEqual(['Submitted']);
  });

  it('share button opens START_SHARE with the built link + copy (dialog.js:218)', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(<QuickMenu shareUrl={() => 'https://share.example/abc123'} />);
    fireEvent.click(
      container.querySelector('[title="Get Shareable Link for Instructors or TAs"]')!,
    );
    expect(container.querySelector('.blockpy-copy-share-link-area')!.textContent).toBe(
      'https://share.example/abc123',
    );
    // QR fails soft exactly like legacy without its QRCode lib.
    expect(container.querySelector('.blockpy-copy-share-qrcode')!.textContent).toContain(
      'QR code generation failed',
    );
    const copy = container.querySelector('.blockpy-copy-share-link')!;
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith('https://share.example/abc123');
    await act(async () => {});
    expect(copy.textContent).toBe('Copied!');
  });

  it('renders no share button without a shareUrl (legacy canShare)', () => {
    const { container } = render(<QuickMenu />);
    expect(
      container.querySelector('[title="Get Shareable Link for Instructors or TAs"]'),
    ).toBeNull();
  });

  it('theme cycler: light → dark → win2000 → light, persisted + data-theme (M4.1)', () => {
    const { container } = render(<QuickMenu />);
    const button = () => container.querySelector<HTMLButtonElement>('[title^="Color Theme:"]')!;
    expect(button().title).toContain('Light');
    expect(document.documentElement.dataset.theme).toBeUndefined();

    act(() => void fireEvent.click(button()));
    expect(useEditorChromeStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('BLOCKPY_display.theme')).toBe('dark');

    act(() => void fireEvent.click(button()));
    expect(useEditorChromeStore.getState().theme).toBe('win2000');
    expect(document.documentElement.dataset.theme).toBe('win2000');

    // Back to light: the attribute clears so the parity tokens bind.
    act(() => void fireEvent.click(button()));
    expect(useEditorChromeStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('BLOCKPY_display.theme')).toBe('light');
  });

  it('ticks the wall clock only when has_clock is on (A4 §6 inversion note)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 10, 9, 5));
    const { container, rerender } = render(<QuickMenu />);
    expect(container.querySelector('.blockpy-menu-clock')).toBeNull();
    rerender(<QuickMenu hasClock />);
    expect(container.querySelector('.blockpy-menu-clock')!.textContent).toBe('9:05am');
    act(() => {
      vi.setSystemTime(new Date(2026, 6, 10, 9, 6));
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelector('.blockpy-menu-clock')!.textContent).toBe('9:06am');
  });
});

describe('Footer (footer.js FOOTER_HTML)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders one badge per endpoint with server-status-* classes', () => {
    const { container } = render(<Footer />);
    const status = container.querySelector('.blockpy-status');
    expect(status).not.toBeNull();
    const badges = status!.querySelectorAll('.badge');
    expect(badges.length).toBe(8);
    // Defaults to offline until an API client attaches.
    badges.forEach((badge) => expect(badge.className).toContain('server-status-offline'));
    expect(badges[0]!.textContent).toContain('Load Assignment');
    expect(badges[7]!.textContent).toBe('Execution');
  });

  it('reflects store status transitions and the capitalized message line', () => {
    act(() =>
      useEditorChromeStore
        .getState()
        .setServerStatus('saveFile', 'retrying', 'timeout contacting server'),
    );
    const { container } = render(<Footer />);
    expect(container.querySelector('.badge.server-status-retrying')!.textContent).toBe('Save File');
    expect(container.textContent).toContain('Timeout contacting server');
    act(() => useEditorChromeStore.getState().setServerStatus('saveFile', 'offline', ''));
  });

  it('identity line shows owner id only when it differs from the user', () => {
    const identity = {
      userId: 7,
      userName: 'Ada',
      userRole: 'student',
      submissionId: 99,
      submissionOwnerId: 7,
      editorVersion: '0.1.0',
    };
    const { container, rerender } = render(<Footer identity={identity} />);
    expect(container.textContent).not.toContain('Owner ID');
    rerender(<Footer identity={{ ...identity, submissionOwnerId: 8 }} />);
    expect(container.textContent).toContain('(Owner ID: 8)');
  });

  it('instructor force-load input renders only for instructors', () => {
    const { container, rerender } = render(<Footer />);
    expect(container.querySelector('.blockpy-force-load-assignment-file')).toBeNull();
    rerender(<Footer instructor onForceLoadAssignment={() => {}} />);
    expect(container.querySelector('.blockpy-force-load-assignment-file')).not.toBeNull();
  });
});

describe('requestPasscode (A7 §1)', () => {
  it('stores the prompt answer; cancel stores empty string', () => {
    const prompt = vi
      .spyOn(window, 'prompt')
      .mockReturnValueOnce('sekrit')
      .mockReturnValueOnce(null);
    requestPasscode();
    expect(prompt).toHaveBeenCalledWith('Please enter the passcode.');
    expect(useEditorChromeStore.getState().passcode).toBe('sekrit');
    requestPasscode();
    expect(useEditorChromeStore.getState().passcode).toBe('');
    prompt.mockRestore();
  });
});
