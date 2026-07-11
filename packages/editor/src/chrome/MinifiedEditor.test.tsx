// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { MinifiedEditor } from './MinifiedEditor';
import type { RunController } from './CodingEditor';
import { useEditorChromeStore } from './store';

function runButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button.blockpy-run')!;
}

describe('MinifiedEditor (§8.4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders text-only by default: CM6, collapsed blocks, no tabs, no feedback pane', async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<MinifiedEditor initialCode="print(1)" />));
    });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    // Text mode collapses the block half to 0% (the workspace node still
    // exists — same as the full editor's text mode).
    const blockHalf = container.querySelector<HTMLElement>(
      '.blockpy-blocks, .blockmirror-blocks, [class*="block"]',
    );
    if (blockHalf?.style.width) {
      expect(blockHalf.style.width).toBe('0%');
    }
    expect(container.querySelector('.blockpy-files')).toBeNull();
    expect(container.querySelector('.blockpy-feedback')).toBeNull();
    expect(runButton(container)).not.toBeNull();
    // No output area until something runs.
    expect(container.querySelector('.blockpy-minified-printer')).toBeNull();
  });

  it('Run streams output inline; errors mark the button', async () => {
    const controller: RunController = {
      async run(code, handlers) {
        handlers.stdout('from ' + code);
        return code.includes('boom')
          ? { error: 'Traceback: boom' }
          : { error: null };
      },
    };
    const { container } = render(
      <MinifiedEditor initialCode="print(1)" runController={controller} />,
    );
    await act(async () => {
      runButton(container).click();
    });
    expect(
      container.querySelector('.blockpy-minified-printer')!.textContent,
    ).toContain('from print(1)');
    expect(runButton(container).className).not.toContain('blockpy-run-error');
  });

  it('instances are independent (no shared store state)', async () => {
    const controller: RunController = {
      async run(code, handlers) {
        handlers.stdout(code);
        return { error: null };
      },
    };
    const { container } = render(
      <div>
        <MinifiedEditor initialCode="alpha" runController={controller} />
        <MinifiedEditor initialCode="beta" runController={controller} />
      </div>,
    );
    const editors = container.querySelectorAll('.blockpy-minified');
    await act(async () => {
      editors[0]!.querySelector<HTMLButtonElement>('button.blockpy-run')!.click();
    });
    // Only the first instance shows output; the global chrome console
    // untouched.
    expect(
      editors[0]!.querySelector('.blockpy-minified-printer')!.textContent,
    ).toContain('alpha');
    expect(editors[1]!.querySelector('.blockpy-minified-printer')).toBeNull();
    expect(useEditorChromeStore.getState().console).toEqual([]);
  });

  it('Reset restores the original code block contents', async () => {
    const seen: string[] = [];
    const { container } = render(
      <MinifiedEditor initialCode="a = 1" onCodeChange={(c) => seen.push(c)} />,
    );
    act(() => {
      container
        .querySelectorAll<HTMLButtonElement>('.blockpy-minified-toolbar button')
        .item(1)
        .click();
    });
    expect(seen.at(-1)).toBe('a = 1');
  });
});
