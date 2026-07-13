// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  state.setFocusedMode(false);
  if (state.docsPanel) state.toggleDocsPanel();
  if (state.blockKeyboardNav) state.toggleBlockKeyboardNav();
}

describe('CodingEditor chrome', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetStore();
  });

  // RTL auto-cleanup is off (no vitest globals) — unmount stale editors so
  // their window-level listeners (focused-mode keys, M4.2) don't stack.
  afterEach(cleanup);

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

  it('logs the run event stream in legacy order (§14.4, A2)', async () => {
    const events: Array<{ type: string; category: string; message: string; file: string }> = [];
    const logEvent = (
      type: string,
      category: string,
      _label: string,
      message: string,
      file: string,
    ) => events.push({ type, category, message, file });
    const controller: RunController = {
      async run(_code, handlers) {
        handlers.stdout('4\n');
        return {
          error: null,
          feedback: { category: 'complete', label: 'Great!', message: 'ok' },
          grade: {
            success: true,
            score: 1,
            hideCorrectness: false,
            unitTests: { tests: 2, feedbacks: 3, successes: 2, feedbackSuccess: 3 },
          },
        };
      },
    };
    render(
      <CodingEditor startingCode="print(2+2)" runController={controller} onLogEvent={logEvent} />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    await waitFor(() => {
      expect(events.map((e) => e.type)).toEqual(['Compile', 'Run.Program', 'Intervention']);
    });
    // Run.Program carries the {inputs, outputs} JSON (run.js:44-48).
    expect(JSON.parse(events[1]!.message)).toEqual({ inputs: '', outputs: '4' });
    // Intervention carries the feedback payload with resolver tallies
    // (feedback.js:223-230), extended flag on the wire.
    expect(JSON.parse(events[2]!.message)).toEqual({
      message: 'ok',
      syntaxError: false,
      runtimeError: false,
      unitTests: { tests: 2, feedbacks: 3, successes: 2, feedbackSuccess: 3 },
    });
    expect(events.every((e) => e.file === 'answer.py')).toBe(true);
  });

  it('logs Compile.Error for syntax failures (run.js:85)', async () => {
    const events: string[] = [];
    const controller: RunController = {
      async run() {
        return {
          error: 'SyntaxError: bad',
          feedback: { category: 'syntax', label: 'SyntaxError', message: 'bad' },
        };
      },
    };
    render(
      <CodingEditor
        startingCode="def broken(:"
        runController={controller}
        onLogEvent={(type) => events.push(type)}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    await waitFor(() => {
      expect(events).toEqual(['Compile', 'Compile.Error', 'Intervention']);
    });
  });

  it('exposes the editor for block-PNG capture; getPng fails soft in jsdom', async () => {
    let captured: import('../dual/dual-editor').DualEditor | null = null;
    render(<CodingEditor startingCode="a = 0" onEditorReady={(editor) => (captured = editor)} />);
    expect(captured).not.toBeNull();
    // jsdom has no SVG layout (getBBox) — the legacy-ported fail-soft path
    // must resolve '' instead of throwing (block_editor.js:381-383).
    await expect(captured!.blockEditor.getPng()).resolves.toBe('');
  });

  it('logs X-File.Reset on reset (blockpy.js:1046)', async () => {
    const events: string[] = [];
    render(<CodingEditor startingCode="a = 0" onLogEvent={(type) => events.push(type)} />);
    await act(async () => {
      screen.getByRole('button', { name: /Reset/ }).click();
    });
    expect(events).toEqual(['X-File.Reset']);
  });

  it('marks the run button with blockpy-run-error on failure', async () => {
    const controller: RunController = {
      async run() {
        return { error: 'Traceback: boom' };
      },
    };
    const { container } = render(<CodingEditor startingCode="a = 0" runController={controller} />);
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
    expect(screen.getByText('No execution engine attached to this editor.')).toBeTruthy();
  });

  it('view toggle drives the store and marks the active tab', () => {
    const { container } = render(<CodingEditor startingCode="a = 0" />);
    const textRadio = screen.getByRole('radio', { name: /Text/ });
    act(() => {
      (textRadio as HTMLInputElement).click();
    });
    expect(useEditorChromeStore.getState().pythonMode).toBe('text');
    const activeLabels = container.querySelectorAll('.blockpy-mode-set-blocks.active');
    expect(activeLabels).toHaveLength(1);
    expect(activeLabels[0]!.textContent).toContain('Text');
  });

  it('focused mode (M4.2): chrome hides, drawer serves feedback, Esc exits', () => {
    const events: string[] = [];
    const { container } = render(
      <CodingEditor
        assignmentName="Focus Test"
        instructions="Solve it."
        startingCode="a = 0"
        onLogEvent={(eventType) => events.push(eventType)}
      />,
    );
    // Enter via the toolbar button.
    const focusButton = container.querySelector<HTMLButtonElement>('.blockpy-toggle-focus')!;
    act(() => void fireEvent.click(focusButton));
    expect(useEditorChromeStore.getState().focusedMode).toBe(true);
    expect(events).toContain('X-Display.Focus.Enter');
    // Instructions pane, quick menu, and file strip are gone; toolbar stays.
    expect(container.querySelector('.blockpy-header')).toBeNull();
    expect(container.querySelector('.blockpy-quick-menu')).toBeNull();
    expect(container.querySelector('.blockpy-python-toolbar')).not.toBeNull();
    // Drawer: collapsed by default, badge visible; clicking it expands the
    // console + feedback pair.
    expect(container.querySelector('.blockpy-focus-drawer')).not.toBeNull();
    expect(container.querySelector('.blockpy-printer')).toBeNull();
    const badge = container.querySelector<HTMLElement>('.blockpy-focus-feedback-badge')!;
    expect(badge.textContent).toBe('Ready');
    act(() => void fireEvent.click(badge));
    expect(container.querySelector('.blockpy-printer')).not.toBeNull();
    expect(container.querySelector('.blockpy-feedback')).not.toBeNull();
    // Instructions stay reachable through the overlay toggle.
    act(() => void fireEvent.click(container.querySelector('.blockpy-focus-instructions')!));
    expect(container.querySelector('.blockpy-dialog')).not.toBeNull();
    // Esc restores the normal chrome and logs the exit.
    act(() => void fireEvent.keyDown(window, { key: 'Escape' }));
    expect(useEditorChromeStore.getState().focusedMode).toBe(false);
    expect(events).toContain('X-Display.Focus.Exit');
    expect(container.querySelector('.blockpy-header')).not.toBeNull();
    expect(container.querySelector('.blockpy-focus-drawer')).toBeNull();
  });

  it('focused mode: Ctrl+Alt+F enters from the keyboard (M4.2)', () => {
    render(<CodingEditor startingCode="a = 0" />);
    act(() => void fireEvent.keyDown(window, { key: 'f', ctrlKey: true, altKey: true }));
    expect(useEditorChromeStore.getState().focusedMode).toBe(true);
    act(() => void fireEvent.keyDown(window, { key: 'F', ctrlKey: true, altKey: true }));
    expect(useEditorChromeStore.getState().focusedMode).toBe(false);
  });

  it('docs panel (M4.3): docs_url exposes the toolbar toggle; opening shrinks the editor', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('# Reference\nUseful facts.'),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      // No docs_url → no toggle at all.
      const bare = render(<CodingEditor startingCode="a = 0" />);
      expect(bare.container.querySelector('.blockpy-toggle-docs')).toBeNull();
      cleanup();

      const { container } = render(
        <CodingEditor startingCode="a = 0" docsUrl="https://example.com/ref.md" />,
      );
      expect(container.querySelector('.blockpy-editor')!.className).toContain('col-md-12');
      await act(async () => void fireEvent.click(container.querySelector('.blockpy-toggle-docs')!));
      expect(container.querySelector('.blockpy-docs-rail')).not.toBeNull();
      expect(container.querySelector('.blockpy-editor')!.className).toContain('col-md-9');
      expect(container.querySelector('.blockpy-docs-body')!.textContent).toContain('Useful facts.');
      // Collapse from the panel header restores full width.
      await act(
        async () => void fireEvent.click(container.querySelector('[title="Hide docs panel"]')!),
      );
      expect(container.querySelector('.blockpy-docs-rail')).toBeNull();
      expect(container.querySelector('.blockpy-editor')!.className).toContain('col-md-12');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keyboard-nav toggle (M6.2/LD-30) arms the plugin without crashing', async () => {
    const { container } = render(<CodingEditor startingCode="a = 0" />);
    const toggle = container.querySelector<HTMLButtonElement>('.blockpy-toggle-keyboard-nav')!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    // On → the effect calls NavigationController.addWorkspace/enable on
    // the live jsdom workspace; off → disable. Both must not throw.
    await act(async () => void fireEvent.click(toggle));
    expect(useEditorChromeStore.getState().blockKeyboardNav).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await act(async () => void fireEvent.click(toggle));
    expect(useEditorChromeStore.getState().blockKeyboardNav).toBe(false);
  });

  it('hides the view toggle when blocks are disabled (enableBlocks)', () => {
    const { container } = render(<CodingEditor startingCode="a = 0" enableBlocks={false} />);
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
      <CodingEditor startingCode="a = 0" runController={controller} instructor />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    const state = useEditorChromeStore.getState();
    // Student console only has program output.
    expect(state.console.map((e) => e.text)).toEqual(['student output']);
    // System message landed in the dev console (newline trimmed)…
    expect(state.devConsole.map((e) => e.text)).toEqual(['Loading Python engine…']);
    // …and the run completed with the Execution badge back to ready.
    expect(state.serverStatus.onExecution).toBe('ready');
    // The console slot still shows the student console; the toggle badges
    // the one unseen dev entry.
    const toggle = container.querySelector('.blockpy-console-toggle')!;
    expect(toggle.textContent).toContain('Dev Console');
    expect(toggle.querySelector('.blockpy-console-toggle-badge')!.textContent).toBe('1');
    // Swapping the slot shows the dev console and clears the badge.
    act(() => (toggle as HTMLButtonElement).click());
    expect(container.querySelector('.blockpy-dev-console')!.textContent).toContain(
      'Loading Python engine…',
    );
    expect(container.querySelector('.blockpy-console .blockpy-printer-default')).toBeNull();
    expect(useEditorChromeStore.getState().devUnseen).toBe(0);
    // Student output arriving now badges the Console toggle instead.
    act(() =>
      useEditorChromeStore.getState().appendConsole({ kind: 'stdout', text: 'late output' }),
    );
    const backToggle = container.querySelector('.blockpy-console-toggle')!;
    expect(backToggle.textContent).toContain('Console');
    expect(backToggle.querySelector('.blockpy-console-toggle-badge')!.textContent).toBe('1');
    act(() => (backToggle as HTMLButtonElement).click());
    expect(useEditorChromeStore.getState().consoleUnseen).toBe(0);
  });

  it('dev console toggle is instructor-only; leaving instructor view restores the console', () => {
    useEditorChromeStore.getState().setActiveConsole('student');
    const { container, rerender } = render(<CodingEditor startingCode="a = 0" />);
    expect(container.querySelector('.blockpy-console-toggle')).toBeNull();
    rerender(<CodingEditor startingCode="a = 0" instructor />);
    act(() => (container.querySelector('.blockpy-console-toggle') as HTMLButtonElement).click());
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
    render(<CodingEditor startingCode="a = 0" runController={controller} hideEvaluate />);
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
    render(<CodingEditor vfs={vfs} role="instructor" runController={controller} />);
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
    const { container } = render(<CodingEditor startingCode="a = 0" runController={controller} />);
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    const image = container.querySelector<HTMLImageElement>('.blockpy-console-image-output img');
    expect(image).not.toBeNull();
    expect(image!.src).toBe('data:image/png;base64,AAAA');
    // Quick-menu Toggle Images: off = image stays as text code (legacy).
    act(() => useEditorChromeStore.getState().toggleRenderImages());
    expect(container.querySelector('.blockpy-console-image-output img')).toBeNull();
    expect(container.querySelector('.blockpy-console-image-output code')!.textContent).toContain(
      'data:image/png;base64,AAAA',
    );
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
    const html = renderInstructions('Line one\nLine two\n\n<b>raw</b> [link](https://example.com)');
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
