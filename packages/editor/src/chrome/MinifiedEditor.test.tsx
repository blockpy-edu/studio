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

  it('layout: console over feedback on the left, toolbar over editor on the right', async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<MinifiedEditor initialCode="print(1)" />));
    });
    const left = container.querySelector('.blockpy-minified-left')!;
    const right = container.querySelector('.blockpy-minified-right')!;
    // Left column: printer first, feedback second.
    expect(left.children[0]!.className).toContain('blockpy-minified-printer');
    expect(left.children[1]!.className).toContain('blockpy-minified-feedback');
    expect(left.querySelector('.blockpy-minified-feedback')!.textContent).toContain('Ready');
    // Right column: toolbar first, then the editor.
    expect(right.children[0]!.className).toContain('blockpy-minified-toolbar');
    expect(right.querySelector('.cm-editor')).not.toBeNull();
    expect(runButton(container)).not.toBeNull();
    // No full-chrome regions.
    expect(container.querySelector('.blockpy-files')).toBeNull();
    expect(container.querySelector('.blockpy-feedback')).toBeNull();
    // Empty console box renders (but holds no entries yet).
    expect(container.querySelector('.blockpy-minified-printer')!.textContent).toBe('');
  });

  it('Run streams output inline and presents feedback in the left column', async () => {
    const controller: RunController = {
      async run(code, handlers) {
        handlers.stdout('from ' + code);
        return {
          error: null,
          feedback: {
            category: 'complete',
            label: 'Great!',
            message: '<em>Nice.</em>',
          },
        };
      },
    };
    const { container } = render(
      <MinifiedEditor initialCode="print(1)" runController={controller} />,
    );
    await act(async () => {
      runButton(container).click();
    });
    expect(container.querySelector('.blockpy-minified-printer')!.textContent).toContain(
      'from print(1)',
    );
    const feedback = container.querySelector('.blockpy-minified-feedback')!;
    expect(feedback.textContent).toContain('Complete');
    expect(feedback.textContent).toContain('Great!');
    expect(feedback.querySelector('em')!.textContent).toBe('Nice.');
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
    expect(editors[0]!.querySelector('.blockpy-minified-printer')!.textContent).toContain('alpha');
    expect(editors[1]!.querySelector('.blockpy-minified-printer')!.textContent).toBe('');
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
