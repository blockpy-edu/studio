// @vitest-environment jsdom
/**
 * A4 assignment settings → CodingEditor behavior. Each case pins the
 * legacy semantics (student-only gating where legacy read
 * `!display.instructor()`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { CodingEditor, type RunController, type RunOptions } from './CodingEditor';
import type { DualEditor } from '../dual/dual-editor';
import { useEditorChromeStore } from './store';

function resetStore() {
  const state = useEditorChromeStore.getState();
  state.clearConsole();
  state.clearFeedback();
  state.setRunState('idle');
  state.setPythonMode('split');
  state.setFocusedMode(false);
  state.setPoolSeed(null);
  state.setTrace([]);
}

function controllerCapturing(seen: { code?: string; options?: RunOptions }): RunController {
  return {
    async run(code, _handlers, options) {
      seen.code = code;
      seen.options = options;
      return { error: null, trace: [{ event: 'line', line: 1, studentLine: 1 }] };
    },
  };
}

describe('assignment settings wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetStore();
  });
  afterEach(cleanup);

  it('hide_editors / hide_middle_panel / small_layout / hide_all shape the chrome', () => {
    const { container, rerender } = render(<CodingEditor startingCode="a = 0" hideEditors />);
    expect(container.querySelector('.blockpy-editor')).toBeNull();
    expect(container.querySelector('.blockpy-console')).not.toBeNull();

    rerender(<CodingEditor startingCode="a = 0" hideMiddlePanel />);
    expect(container.querySelector('.blockpy-editor')).not.toBeNull();
    expect(container.querySelector('.blockpy-console')).toBeNull();

    rerender(<CodingEditor startingCode="a = 0" smallLayout />);
    // Console/feedback sit in the editor's row (col-md-5 / col-md-7), no
    // footer, no datasets button (blockpy.js:545-546, 664-666, 1211-1215).
    expect(container.querySelector('.col-md-5 .blockpy-console')).not.toBeNull();
    expect(container.querySelector('.blockpy-editor.col-md-7')).not.toBeNull();
    expect(container.querySelector('.blockpy-status')).toBeNull();
    expect(screen.queryByText(/Import datasets/)).toBeNull();

    rerender(<CodingEditor startingCode="a = 0" hideAll />);
    expect(container.querySelector('.blockpy-hidden-all')).not.toBeNull();
    expect(container.querySelector('.blockpy-editor')).toBeNull();
  });

  it('the instructor view is exempt from the student-only reductions', () => {
    const { container } = render(
      <CodingEditor
        startingCode="a = 0"
        instructor
        hideEditors
        smallLayout
        hideAll
        hideTraceButton
      />,
    );
    expect(container.querySelector('.blockpy-editor.col-md-12')).not.toBeNull();
    expect(container.querySelector('.blockpy-status')).not.toBeNull();
  });

  it('only_interactive hides editor + quick menu, auto-runs, and enters Evaluate', async () => {
    const seen: { code?: string; options?: RunOptions } = {};
    const { container } = render(
      <CodingEditor
        startingCode="print(1)"
        onlyInteractive
        runController={controllerCapturing(seen)}
      />,
    );
    expect(container.querySelector('.blockpy-editor')).toBeNull();
    expect(container.querySelector('.blockpy-quick-menu')).toBeNull();
    await waitFor(() => expect(seen.code).toBe('print(1)'));
    await waitFor(() => expect(useEditorChromeStore.getState().evalState).toBe('input'));
  });

  it('disable_student_run blanks the executed program but still saves the real code', async () => {
    const seen: { code?: string; options?: RunOptions } = {};
    const saved: string[] = [];
    render(
      <CodingEditor
        startingCode="print(1)"
        disableStudentRun
        runController={controllerCapturing(seen)}
        onRunStart={(code) => saved.push(code)}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(seen.code).toBe('');
    expect(saved).toEqual(['print(1)']);
  });

  it('disable_trace / disable_timeout reach the run options; hide_trace_button hides View Trace', async () => {
    const seen: { code?: string; options?: RunOptions } = {};
    const { rerender } = render(
      <CodingEditor
        startingCode="a = 0"
        disableTrace
        disableTimeout
        runController={controllerCapturing(seen)}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(seen.options?.trace).toBe(false);
    expect(seen.options?.disableTimeout).toBe(true);
    // The controller returned a trace anyway: the button shows by default…
    expect(screen.queryByText(/View Trace/)).not.toBeNull();
    // …and hide_trace_button removes it for students.
    rerender(
      <CodingEditor
        startingCode="a = 0"
        hideTraceButton
        runController={controllerCapturing(seen)}
      />,
    );
    expect(screen.queryByText(/View Trace/)).toBeNull();
  });

  it('save_turtle_output persists the last run image', async () => {
    const saves: Array<[string, string]> = [];
    const controller: RunController = {
      async run() {
        return { error: null, images: ['AAAA', 'BBBB'] };
      },
    };
    render(
      <CodingEditor
        startingCode="a = 0"
        saveTurtleOutput
        runController={controller}
        onSaveImage={(directory, dataUrl) => saves.push([directory, dataUrl])}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(saves).toEqual([['turtle_output', 'data:image/png;base64,BBBB']]);
  });

  it('instructions_pool draws instructions + on_run by seed (Seed box wins)', async () => {
    const seen: { code?: string; options?: RunOptions } = {};
    const instructions =
      'Pre\n<!----# a #---->\nQ-A\n<!----# b #---->\nQ-B\n<!----# end #---->\nPost';
    const { container } = render(
      <CodingEditor
        startingCode="a = 0"
        instructions={instructions}
        instructionsPool
        seed="0"
        runController={controllerCapturing(seen)}
      />,
    );
    const text = () => container.querySelector('.blockpy-instructions')!.textContent ?? '';
    expect(text()).toContain('Q-A');
    expect(text()).not.toContain('Q-B');
    act(() => useEditorChromeStore.getState().setPoolSeed('1'));
    expect(text()).toContain('Q-B');
    expect(text()).not.toContain('randomized question pool');
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(seen.options?.seed).toBe('1');
  });

  it('disable_edit / only_uploads lock answer.py for students; only_uploads keeps Upload', () => {
    const { container, rerender } = render(<CodingEditor startingCode="a = 0" disableEdit />);
    expect(container.querySelector('.block-mirror-read-only')).not.toBeNull();
    expect((screen.getByTitle(/Upload/) as HTMLButtonElement).disabled).toBe(true);

    rerender(<CodingEditor startingCode="a = 0" onlyUploads />);
    expect(container.querySelector('.block-mirror-read-only')).not.toBeNull();
    expect((screen.getByTitle(/Upload/) as HTMLButtonElement).disabled).toBe(false);

    rerender(<CodingEditor startingCode="a = 0" onlyUploads instructor />);
    expect(container.querySelector('.block-mirror-read-only')).toBeNull();
  });

  it('can_blocks=false locks only the block half', () => {
    render(<CodingEditor startingCode="a = 0" canBlocks={false} />);
    expect(document.querySelector('.blockly-readonly-layer')).not.toBeNull();
    expect(document.querySelector('.block-mirror-read-only')).toBeNull();
  });

  it('hide_submission removes History for students; hide_import_datasets_button removes the button', () => {
    const loadHistory = vi.fn(async () => []);
    const { rerender } = render(
      <CodingEditor
        startingCode="a = 0"
        loadHistory={loadHistory}
        hideSubmission
        hideImportDatasetsButton
      />,
    );
    expect((screen.getByRole('button', { name: /History/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByText(/Import datasets/)).toBeNull();
    rerender(
      <CodingEditor startingCode="a = 0" loadHistory={loadHistory} hideSubmission instructor />,
    );
    expect((screen.getByRole('button', { name: /History/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('is_parsons scatters the top-level blocks on load and on Reset', () => {
    let editor: DualEditor | null = null;
    render(
      <CodingEditor
        // Blank lines split top-level stacks (text-to-blocks.ts:401) - the
        // authoring convention for Parsons starting code.
        startingCode={'a = 1\n\nb = 2\n\nc = 3\n\nprint(a + b + c)'}
        isParsons
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />,
    );
    const positions = () =>
      editor!.blockEditor.workspace
        .getTopBlocks(false)
        .map((block) => block.getRelativeToSurfaceXY())
        .map((xy) => `${xy.x},${xy.y}`);
    expect(editor).not.toBeNull();
    const xs = editor!.blockEditor.workspace
      .getTopBlocks(false)
      .map((block) => block.getRelativeToSurfaceXY().x);
    // cleanUp() lines everything up at x=0; the shuffle scatters x
    // (the first block stays at the origin column, v1 utilities.js:160).
    expect(xs.length).toBeGreaterThan(1);
    expect(xs.slice(1).some((x) => x !== xs[0])).toBe(true);
    const before = positions();
    act(() => {
      screen.getByRole('button', { name: /Reset/ }).click();
    });
    // Re-shuffled: the odds of an identical random layout are negligible.
    expect(positions()).not.toEqual(before);
  });
});
