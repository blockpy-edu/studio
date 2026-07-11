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

  it('fires the run lifecycle hooks in legacy order (§14.3)', async () => {
    const order: string[] = [];
    const controller: RunController = {
      async run() {
        order.push('run');
        return {
          error: null,
          feedback: { category: 'complete', label: 'Great!', message: 'ok' },
          grade: { success: true, score: 1, hideCorrectness: false },
        };
      },
    };
    const onRunStart = (code: string) => order.push(`start:${code}`);
    const onGraded = () => {
      // presentFeedback-first ordering (on_run.js:162): by the time the
      // grade reaches the submission lifecycle, the pane already shows it.
      order.push(`graded:${useEditorChromeStore.getState().feedback.category}`);
    };
    render(
      <CodingEditor
        startingCode="a = 0"
        runController={controller}
        onRunStart={onRunStart}
        onGraded={onGraded}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    await waitFor(() => {
      expect(order).toEqual(['start:a = 0', 'run', 'graded:complete']);
    });
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
    // Consumed at run START (run.js:37 → clearInput), not completion.
    expect(useEditorChromeStore.getState().queuedInputs).toEqual([]);
    // A clean run un-stales the submission (run.js:49).
    expect(useEditorChromeStore.getState().dirtySubmission).toBe(false);
  });

  it('routes system messages to the footer status + dev console, not the student console', async () => {
    useEditorChromeStore.getState().clearDevConsole();
    useEditorChromeStore.getState().setActiveConsole('student');
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
    // …and the run completed with the Execution badge back to ready.
    expect(state.serverStatus.onExecution).toBe('ready');
    // The console slot still shows the student console; the toggle badges
    // the one unseen dev entry.
    const toggle = container.querySelector('.blockpy-console-toggle')!;
    expect(toggle.textContent).toContain('Dev Console');
    expect(
      toggle.querySelector('.blockpy-console-toggle-badge')!.textContent,
    ).toBe('1');
    // Swapping the slot shows the dev console and clears the badge.
    act(() => (toggle as HTMLButtonElement).click());
    expect(container.querySelector('.blockpy-dev-console')!.textContent).toContain(
      'Loading Python engine…',
    );
    expect(container.querySelector('.blockpy-console .blockpy-printer-default')).toBeNull();
    expect(useEditorChromeStore.getState().devUnseen).toBe(0);
    // Student output arriving now badges the Console toggle instead.
    act(() =>
      useEditorChromeStore
        .getState()
        .appendConsole({ kind: 'stdout', text: 'late output' }),
    );
    const backToggle = container.querySelector('.blockpy-console-toggle')!;
    expect(backToggle.textContent).toContain('Console');
    expect(
      backToggle.querySelector('.blockpy-console-toggle-badge')!.textContent,
    ).toBe('1');
    act(() => (backToggle as HTMLButtonElement).click());
    expect(useEditorChromeStore.getState().consoleUnseen).toBe(0);
  });

  it('dev console toggle is instructor-only; leaving instructor view restores the console', () => {
    useEditorChromeStore.getState().setActiveConsole('student');
    const { container, rerender } = render(<CodingEditor startingCode="a = 0" />);
    expect(container.querySelector('.blockpy-console-toggle')).toBeNull();
    rerender(<CodingEditor startingCode="a = 0" instructor />);
    act(() =>
      (
        container.querySelector('.blockpy-console-toggle') as HTMLButtonElement
      ).click(),
    );
    expect(container.querySelector('.blockpy-dev-console')).not.toBeNull();
    // Unchecking "View as instructor" while the dev console is shown swaps
    // back to the student console.
    rerender(<CodingEditor startingCode="a = 0" />);
    expect(container.querySelector('.blockpy-dev-console')).toBeNull();
    expect(container.querySelector('.blockpy-console')).not.toBeNull();
    expect(useEditorChromeStore.getState().activeConsole).toBe('student');
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

  it('each run grades with the CURRENT !on_run.py from the VFS', async () => {
    const { Vfs } = await import('@blockpy/vfs');
    const vfs = new Vfs();
    vfs.write('answer.py', 'a = 0');
    vfs.write('!on_run.py', 'from pedal import *\nset_success()');
    const scripts: (string | undefined)[] = [];
    const controller: RunController = {
      async run(_code, _handlers, options) {
        scripts.push(options?.onRun);
        return { error: null };
      },
    };
    render(
      <CodingEditor vfs={vfs} role="instructor" runController={controller} />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    // Simulate an instructor edit to the grader between runs.
    vfs.write('!on_run.py', 'from pedal import *\ngently("Edited!")');
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(scripts).toEqual([
      'from pedal import *\nset_success()',
      'from pedal import *\ngently("Edited!")',
    ]);
  });

  it('runs stage the VFS: student view for the run, instructor view for grading', async () => {
    const { Vfs } = await import('@blockpy/vfs');
    const vfs = new Vfs();
    vfs.write('answer.py', 'a = 0');
    vfs.write('&sample_data.txt', 'temperature,42');
    vfs.write('!helper.py', 'def check(): pass');
    const captured: Array<{
      files?: Record<string, string>;
      graderFiles?: Record<string, string>;
    }> = [];
    const controller: RunController = {
      async run(_code, _handlers, options) {
        captured.push({ files: options?.files, graderFiles: options?.graderFiles });
        return { error: null };
      },
    };
    render(<CodingEditor vfs={vfs} runController={controller} />);
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    // Student staging: prefix-stripped, no instructor-only files.
    expect(captured[0]!.files).toMatchObject({
      'sample_data.txt': 'temperature,42',
      'answer.py': 'a = 0',
    });
    expect(captured[0]!.files!['helper.py']).toBeUndefined();
    // Grader staging: instructor view includes the helper.
    expect(captured[0]!.graderFiles!['helper.py']).toBe('def check(): pass');
  });

  it('a VFS without !on_run.py passes an empty script (no grader)', async () => {
    const { Vfs } = await import('@blockpy/vfs');
    const vfs = new Vfs();
    vfs.write('answer.py', 'a = 0');
    const scripts: (string | undefined)[] = [];
    const controller: RunController = {
      async run(_code, _handlers, options) {
        scripts.push(options?.onRun);
        return { error: null };
      },
    };
    render(<CodingEditor vfs={vfs} runController={controller} />);
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(scripts).toEqual(['']);
  });

  it('plot images print into the console; Toggle Images falls back to text', async () => {
    const controller: RunController = {
      async run() {
        return { error: null, images: ['AAAA'] };
      },
    };
    const { container } = render(
      <CodingEditor startingCode="a = 0" runController={controller} />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    const image = container.querySelector<HTMLImageElement>(
      '.blockpy-console-image-output img',
    );
    expect(image).not.toBeNull();
    expect(image!.src).toBe('data:image/png;base64,AAAA');
    // Quick-menu Toggle Images: off = image stays as text code (legacy).
    act(() => useEditorChromeStore.getState().toggleRenderImages());
    expect(container.querySelector('.blockpy-console-image-output img')).toBeNull();
    expect(
      container.querySelector('.blockpy-console-image-output code')!.textContent,
    ).toContain('data:image/png;base64,AAAA');
    act(() => useEditorChromeStore.getState().toggleRenderImages());
  });

  it('inputs queued DURING a run survive its completion (clear-at-start)', async () => {
    const state = useEditorChromeStore.getState();
    state.setQueuedInputs([]);
    state.setClearInputs(true);
    let finish!: () => void;
    const running = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const controller: RunController = {
      async run() {
        await running;
        return { error: null };
      },
    };
    render(<CodingEditor startingCode="a = 0" runController={controller} />);
    const clicked = act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
      // While the run is in flight, the user queues inputs for the NEXT run.
      useEditorChromeStore.getState().setQueuedInputs(['Ada']);
      finish();
      await running;
    });
    await clicked;
    expect(useEditorChromeStore.getState().queuedInputs).toEqual(['Ada']);
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
