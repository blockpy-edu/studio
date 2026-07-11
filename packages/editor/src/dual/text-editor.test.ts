// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DualTextEditor, type TextEditorHost } from './text-editor';

function makeHost(): TextEditorHost & { changes: string[]; runs: number } {
  const textContainer = document.createElement('div');
  const textSidebar = document.createElement('div');
  document.body.appendChild(textContainer);
  const host = {
    textContainer,
    textSidebar,
    height: 500,
    isWide: () => true,
    indentSidebar: true,
    getBlockToolbarWidth: () => 100,
    changes: [] as string[],
    runs: 0,
    run() {
      host.runs += 1;
    },
    onTextChanged(newCode: string) {
      host.changes.push(newCode);
    },
  };
  return host;
}

describe('DualTextEditor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('round-trips code through setCode/getCode', () => {
    const host = makeHost();
    const editor = new DualTextEditor(host, false);
    editor.setMode('text');
    editor.setCode('a = 0', true);
    expect(editor.getCode()).toBe('a = 0');
    editor.dispose();
  });

  it('quiet sets do not fire the sync loop; loud sets do', () => {
    const host = makeHost();
    const editor = new DualTextEditor(host, false);
    editor.setMode('text');
    editor.setCode('a = 0', true);
    expect(host.changes).toEqual([]);
    editor.setCode('b = 1', false);
    expect(host.changes).toEqual(['b = 1']);
    editor.dispose();
  });

  it('defers setCode while hidden and flushes on show (outOfDate_)', () => {
    const host = makeHost();
    const editor = new DualTextEditor(host, false);
    editor.setMode('block'); // hidden
    editor.setCode('later = True', true);
    expect(editor.getCode()).toBe('');
    editor.setMode('text');
    expect(editor.getCode()).toBe('later = True');
    // The flush is quiet — no sync-loop echo.
    expect(host.changes).toEqual([]);
    editor.dispose();
  });

  it('mode table controls container visibility and width', () => {
    const host = makeHost();
    const editor = new DualTextEditor(host, false);
    editor.setMode('split');
    expect(host.textContainer.style.display).toBe('block');
    expect(host.textContainer.style.width).toBe('40%');
    editor.setMode('text');
    expect(host.textContainer.style.width).toBe('100%');
    editor.setMode('block');
    expect(host.textContainer.style.display).toBe('none');
    editor.dispose();
  });

  it('line highlights add and clear by style', () => {
    const host = makeHost();
    const editor = new DualTextEditor(host, false);
    editor.setMode('text');
    editor.setCode('a = 0\nb = 1\nc = 2', true);
    editor.setHighlightedLines([2], 'editor-error-line');
    editor.setHighlightedLines([3], 'editor-traced-line');
    let html = host.textContainer.innerHTML;
    expect(html).toContain('editor-error-line');
    expect(html).toContain('editor-traced-line');
    editor.clearHighlightedLines('editor-error-line');
    html = host.textContainer.innerHTML;
    expect(html).not.toContain('editor-error-line');
    expect(html).toContain('editor-traced-line');
    editor.clearHighlightedLines();
    expect(host.textContainer.innerHTML).not.toContain('editor-traced-line');
    editor.dispose();
  });

  it('read-only blocks edits', () => {
    const host = makeHost();
    const editor = new DualTextEditor(host, true);
    editor.setMode('text');
    editor.setCode('locked = True', true);
    // Simulate a user keystroke path: dispatch without the silent annotation
    // is still allowed programmatically, but the state readOnly facet is on.
    expect(editor.view.state.readOnly).toBe(true);
    editor.setReadOnly(false);
    expect(editor.view.state.readOnly).toBe(false);
    editor.dispose();
  });

  it('Ctrl-Enter run callback is wired', () => {
    const host = makeHost();
    const editor = new DualTextEditor(host, false);
    editor.setMode('text');
    const spy = vi.spyOn(host, 'run');
    // Invoke the keymap binding directly through the view's key handling.
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
    });
    editor.view.contentDOM.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();
    editor.dispose();
  });
});
