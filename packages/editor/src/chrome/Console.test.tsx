// @vitest-environment jsdom
/**
 * Console interactive input() line (spec §6.5): prompt + textbox + Enter
 * while Python is suspended; submitting freezes the line into history
 * (legacy ConsoleLineInput) and pushes the value into queuedInputs
 * (legacy execution.input(), console.js:326-329).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Console } from './Console';
import { useEditorChromeStore } from './store';

afterEach(() => {
  cleanup();
  useEditorChromeStore.getState().cancelConsoleInput();
  useEditorChromeStore.getState().clearConsole();
  useEditorChromeStore.getState().setQueuedInputs([]);
});

describe('Console input() line', () => {
  it('shows prompt + textbox, resolves on Enter, freezes into history', async () => {
    const view = render(<Console />);
    let promise!: Promise<string>;
    act(() => {
      promise = useEditorChromeStore.getState().requestConsoleInput('Fav animal?');
    });
    expect(screen.getByText('Fav animal?')).toBeDefined();
    const input = screen.getByLabelText('Fav animal?');
    fireEvent.change(input, { target: { value: 'penguin' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await expect(promise).resolves.toBe('penguin');
    // The live line is gone; a frozen disabled copy holds the value.
    expect(useEditorChromeStore.getState().pendingInput).toBeNull();
    const frozen = view.container.querySelector<HTMLInputElement>(
      '.blockpy-console-input input[disabled]',
    );
    expect(frozen?.value).toBe('penguin');
    // The live answer is NOT folded into queuedInputs — otherwise the next
    // run would replay it instead of prompting again (grading gets live
    // answers separately, via the engine adapter).
    expect(useEditorChromeStore.getState().queuedInputs).toEqual([]);
  });

  it('submits via the Enter button, including empty lines', async () => {
    render(<Console />);
    let promise!: Promise<string>;
    act(() => {
      promise = useEditorChromeStore.getState().requestConsoleInput('');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));
    await expect(promise).resolves.toBe('');
  });

  it('cancelConsoleInput drops an orphaned line without resolving', () => {
    render(<Console />);
    let settled = false;
    act(() => {
      void useEditorChromeStore
        .getState()
        .requestConsoleInput('gone')
        .then(() => {
          settled = true;
        });
    });
    act(() => {
      useEditorChromeStore.getState().cancelConsoleInput();
    });
    expect(useEditorChromeStore.getState().pendingInput).toBeNull();
    expect(settled).toBe(false);
  });
});
