// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { CodingEditor, type RunController } from './CodingEditor';
import { renderInstructions } from './Instructions';
import { categoryPresentation } from './categories';
import { useEditorChromeStore } from './store';

function resetStore() {
  const state = useEditorChromeStore.getState();
  state.clearConsole();
  state.clearFeedback();
  state.setRunState('idle');
  state.setPythonMode('split');
}

describe('CodingEditor chrome', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetStore();
  });

  it('renders the A8 row structure with legacy class hooks', () => {
    const { container } = render(
      <CodingEditor
        assignmentName="Test Assignment"
        instructions="Do the thing."
        startingCode="a = 0"
      />,
    );
    expect(container.querySelector('.blockpy-content')).not.toBeNull();
    expect(container.querySelector('.blockpy-header')).not.toBeNull();
    expect(container.querySelector('.blockpy-instructions')).not.toBeNull();
    expect(container.querySelector('.blockpy-console .blockpy-printer')).not.toBeNull();
    expect(container.querySelector('.blockpy-feedback .feedback-badge')).not.toBeNull();
    expect(container.querySelector('.blockpy-python-toolbar')).not.toBeNull();
    expect(container.querySelector('.blockpy-python-blockmirror')).not.toBeNull();
    expect(container.querySelector('button.blockpy-run')).not.toBeNull();
    // Row 1 right column and Row 5 (quick menu + status footer).
    expect(container.querySelector('.blockpy-quick-menu')).not.toBeNull();
    expect(container.querySelector('.blockpy-status .badge')).not.toBeNull();
    // The dual editor actually mounted (Blockly + CM6).
    expect(container.querySelector('.blocklySvg')).not.toBeNull();
    expect(container.querySelector('.cm-editor')).not.toBeNull();
  });

  it('runs code through the RunController: console streaming + feedback + states', async () => {
    const controller: RunController = {
      async run(code, handlers) {
        handlers.stdout('hello from ' + code.split('\n')[0]);
        return {
          error: null,
          feedback: {
            category: 'complete',
            label: 'Great!',
            message: '<em>Nice work.</em>',
          },
        };
      },
    };
    render(<CodingEditor startingCode="a = 0" runController={controller} />);
    const runButton = screen.getByRole('button', { name: /Run/ });
    await act(async () => {
      runButton.click();
    });
    await waitFor(() => {
      expect(screen.getByText('hello from a = 0')).toBeTruthy();
    });
    expect(screen.getByText('Complete')).toBeTruthy();
    expect(screen.getByText('Great!')).toBeTruthy();
    expect(useEditorChromeStore.getState().runState).toBe('idle');
  });

  it('marks the run button with blockpy-run-error on failure', async () => {
    const controller: RunController = {
      async run() {
        return { error: 'Traceback: boom' };
      },
    };
    const { container } = render(
      <CodingEditor startingCode="a = 0" runController={controller} />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    await waitFor(() => {
      expect(container.querySelector('.blockpy-run-error')).not.toBeNull();
    });
    expect(screen.getByText('Traceback: boom')).toBeTruthy();
  });

  it('reports a missing engine instead of failing silently', async () => {
    render(<CodingEditor startingCode="a = 0" />);
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(
      screen.getByText('No execution engine attached to this editor.'),
    ).toBeTruthy();
  });

  it('view toggle drives the store and marks the active tab', () => {
    const { container } = render(<CodingEditor startingCode="a = 0" />);
    const textRadio = screen.getByRole('radio', { name: /Text/ });
    act(() => {
      (textRadio as HTMLInputElement).click();
    });
    expect(useEditorChromeStore.getState().pythonMode).toBe('text');
    const activeLabels = container.querySelectorAll(
      '.blockpy-mode-set-blocks.active',
    );
    expect(activeLabels).toHaveLength(1);
    expect(activeLabels[0]!.textContent).toContain('Text');
  });

  it('hides the view toggle when blocks are disabled (enableBlocks)', () => {
    const { container } = render(
      <CodingEditor startingCode="a = 0" enableBlocks={false} />,
    );
    expect(container.querySelector('.blockpy-mode-set-blocks')).toBeNull();
  });

  it('replays queued inputs into the run and clears them after (clearInputs)', async () => {
    const state = useEditorChromeStore.getState();
    state.setQueuedInputs(['Ada', '42']);
    state.setClearInputs(true);
    const seenInputs: (string[] | undefined)[] = [];
    const controller: RunController = {
      async run(_code, _handlers, options) {
        seenInputs.push(options?.inputs);
        return { error: null };
      },
    };
    render(<CodingEditor startingCode="a = 0" runController={controller} />);
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(seenInputs).toEqual([['Ada', '42']]);
    // Consumed after the run cycle (configurations.js clearInput).
    expect(useEditorChromeStore.getState().queuedInputs).toEqual([]);
    // A clean run un-stales the submission (run.js:49).
    expect(useEditorChromeStore.getState().dirtySubmission).toBe(false);
  });

  it('routes system messages to the footer status + dev console, not the student console', async () => {
    useEditorChromeStore.getState().clearDevConsole();
    const controller: RunController = {
      async run(_code, handlers) {
        handlers.system?.('Loading Python engine…\n');
        handlers.stdout('student output');
        return { error: null };
      },
    };
    const { container } = render(
      <CodingEditor
        startingCode="a = 0"
        runController={controller}
        instructor
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    const state = useEditorChromeStore.getState();
    // Student console only has program output.
    expect(state.console.map((e) => e.text)).toEqual(['student output']);
    // System message landed in the dev console (newline trimmed)…
    expect(state.devConsole.map((e) => e.text)).toEqual([
      'Loading Python engine…',
    ]);
    expect(container.querySelector('.blockpy-dev-console')!.textContent).toContain(
      'Loading Python engine…',
    );
    // …and the run completed with the Execution badge back to ready.
    expect(state.serverStatus.onExecution).toBe('ready');
  });

  it('dev console is instructor-only', () => {
    const { container, rerender } = render(<CodingEditor startingCode="a = 0" />);
    expect(container.querySelector('.blockpy-dev-console')).toBeNull();
    rerender(<CodingEditor startingCode="a = 0" instructor />);
    expect(container.querySelector('.blockpy-dev-console')).not.toBeNull();
  });

  it('hide_evaluate suppresses the console Evaluate button', async () => {
    const controller: RunController = {
      async run() {
        return { error: null };
      },
      async evaluate() {
        return { value: '0', error: null };
      },
    };
    render(
      <CodingEditor
        startingCode="a = 0"
        runController={controller}
        hideEvaluate
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(useEditorChromeStore.getState().evalState).toBe('hidden');
    expect(screen.queryByRole('button', { name: 'Evaluate' })).toBeNull();
  });

  it('keeps queued inputs across runs when reuse is on (clearInputs=false)', async () => {
    const state = useEditorChromeStore.getState();
    state.setQueuedInputs(['keep me']);
    state.setClearInputs(false);
    const controller: RunController = {
      async run() {
        return { error: null };
      },
    };
    render(<CodingEditor startingCode="a = 0" runController={controller} />);
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(useEditorChromeStore.getState().queuedInputs).toEqual(['keep me']);
    useEditorChromeStore.getState().setQueuedInputs([]);
    useEditorChromeStore.getState().setClearInputs(true);
  });
});

describe('renderInstructions (A6/D4-A)', () => {
  it('renders markdown with breaks, raw HTML preserved, links targeted', () => {
    const html = renderInstructions(
      'Line one\nLine two\n\n<b>raw</b> [link](https://example.com)',
    );
    expect(html).toContain('<br');
    expect(html).toContain('<b>raw</b>');
    expect(html).toContain('target="_blank"');
  });

  it('does NOT sanitize (legacy parity, D4-A)', () => {
    const html = renderInstructions('<script>alert(1)</script>');
    expect(html).toContain('<script>');
  });
});

describe('categoryPresentation', () => {
  it('maps the legacy category vocabulary', () => {
    expect(categoryPresentation('complete')).toEqual({
      badgeClass: 'label-problem-complete',
      displayText: 'Complete',
    });
    expect(categoryPresentation('Instructor')).toEqual({
      badgeClass: 'label-feedback-error',
      displayText: 'Incorrect Answer',
    });
    expect(categoryPresentation(null).badgeClass).toBe('label-none');
    expect(categoryPresentation('unknown-thing').badgeClass).toBe('label-none');
  });
});
