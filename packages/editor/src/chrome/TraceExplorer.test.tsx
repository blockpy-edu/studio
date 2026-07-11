// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CodingEditor, type RunController } from './CodingEditor';
import { TraceExplorer, typeFromRepr } from './TraceExplorer';
import { useEditorChromeStore, type TraceStepView } from './store';

function resetStore() {
  const state = useEditorChromeStore.getState();
  state.clearConsole();
  state.clearFeedback();
  state.setRunState('idle');
  state.setPythonMode('split');
  state.setTrace([]);
  state.setTraceVisible(false);
}

const STEPS: TraceStepView[] = [
  { event: 'line', line: 1, studentLine: 1, locals: { a: '0' } },
  { event: 'line', line: 2, studentLine: 2, locals: { a: '0', b: "'hi'" } },
  { event: 'return', line: 2, studentLine: 2 },
];

describe('TraceExplorer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetStore();
  });

  it('steps through the buffer, clamped, and reports lines', () => {
    useEditorChromeStore.getState().setTrace(STEPS);
    const onStepLine = vi.fn();
    render(<TraceExplorer onStepLine={onStepLine} />);
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(onStepLine).toHaveBeenLastCalledWith(1);
    act(() => {
      screen.getByRole('button', { name: 'Next step' }).click();
    });
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(onStepLine).toHaveBeenLastCalledWith(2);
    // Variables table shows the step's locals with derived types.
    expect(screen.getByText('b')).toBeTruthy();
    expect(screen.getByText("'hi'")).toBeTruthy();
    act(() => {
      screen.getByRole('button', { name: 'Last step' }).click();
      screen.getByRole('button', { name: 'Next step' }).click(); // clamps
    });
    expect(screen.getByText('3 / 3')).toBeTruthy();
    act(() => {
      screen.getByRole('button', { name: 'First step' }).click();
    });
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('Hide Trace flips visibility back to feedback', () => {
    useEditorChromeStore.getState().setTrace(STEPS);
    useEditorChromeStore.getState().setTraceVisible(true);
    render(<TraceExplorer />);
    act(() => {
      screen.getByRole('button', { name: /Hide Trace/ }).click();
    });
    expect(useEditorChromeStore.getState().traceVisible).toBe(false);
  });
});

describe('typeFromRepr', () => {
  it('derives display types from reprs', () => {
    expect(typeFromRepr('42')).toBe('int');
    expect(typeFromRepr('-3.5')).toBe('float');
    expect(typeFromRepr("'hi'")).toBe('str');
    expect(typeFromRepr('True')).toBe('bool');
    expect(typeFromRepr('None')).toBe('NoneType');
    expect(typeFromRepr('[1, 2]')).toBe('list');
    expect(typeFromRepr("{'a': 1}")).toBe('dict');
    expect(typeFromRepr('(1, 2)')).toBe('tuple');
    expect(typeFromRepr('<function f at 0x0>')).toBe('function');
  });
});

describe('CodingEditor trace + eval integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetStore();
  });

  it('run collects the trace; View Trace swaps the feedback pane', async () => {
    const controller: RunController = {
      async run(_code, handlers, options) {
        expect(options?.trace).toBe(true);
        handlers.stdout('0');
        return { error: null, trace: STEPS };
      },
    };
    render(<CodingEditor startingCode="a = 0" runController={controller} />);
    await act(async () => {
      screen.getByRole('button', { name: /Run/ }).click();
    });
    expect(useEditorChromeStore.getState().traceSteps).toHaveLength(3);
    act(() => {
      screen.getByRole('button', { name: /View Trace/ }).click();
    });
    expect(screen.getByText('Variables after this step:')).toBeTruthy();
    act(() => {
      screen.getByRole('button', { name: /Hide Trace/ }).click();
    });
    expect(screen.getByText(/Feedback:/)).toBeTruthy();
  });

  it('Evaluate echoes the expression and prints value or error', async () => {
    const controller: RunController = {
      async run() {
        return { error: null };
      },
      async evaluate(expression) {
        return expression === 'a'
          ? { value: '0', error: null }
          : { value: null, error: "NameError: name 'b' is not defined" };
      },
    };
    render(<CodingEditor startingCode="a = 0" runController={controller} />);
    const input = screen.getByRole('textbox', {
      name: 'Evaluate expression',
    }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'a' } });
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Evaluate' }).click();
    });
    const texts = useEditorChromeStore
      .getState()
      .console.map((entry) => entry.text);
    expect(texts).toContain('>>> a');
    expect(texts).toContain('0');
  });
});
