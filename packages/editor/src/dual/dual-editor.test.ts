// @vitest-environment jsdom
/**
 * DualEditor (BlockMirror port) integration under jsdom: real CM6 + real
 * Blockly headless-ish inject. Rendering metrics are zero in jsdom, but the
 * data paths (convertSource → workspace → generator) are fully live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DualEditor } from './dual-editor';
import { makeToolboxXml } from './toolboxes';

function makeEditor(viewMode: 'block' | 'split' | 'text' = 'split') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new DualEditor({ container, viewMode, height: 500 });
}

describe('DualEditor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('throws without a container (legacy message)', () => {
    expect(() => new DualEditor({} as unknown as { container: HTMLElement })).toThrowError(
      'Invalid configuration: Missing "container" property.',
    );
  });

  it('applies legacy defaults', () => {
    const editor = makeEditor();
    expect(editor.configuration.height).toBe(500);
    expect(editor.configuration.viewMode).toBe('split');
    // M3.3: text→blocks regeneration debounces 300 ms by default (the code
    // mirror still updates immediately); `false` restores legacy-immediate.
    expect(editor.configuration.blockDelay).toBe(300);
    expect(editor.configuration.toolbox).toBe('normal');
    expect(editor.configuration.renderer).toBe('Thrasos');
    expect(editor.getMode()).toBe('split');
    editor.dispose();
  });

  it('setCode pushes into both editors and fires listeners', () => {
    const editor = makeEditor();
    const events: string[] = [];
    editor.addChangeListener((event) => events.push(event.value));
    editor.setCode('a = 0');
    expect(editor.getCode()).toBe('a = 0');
    expect(editor.textEditor.getCode()).toBe('a = 0');
    // Blocks side actually contains the assignment block.
    expect(editor.blockEditor.workspace.getAllBlocks(false).map((b) => b.type)).toContain(
      'ast_Assign',
    );
    expect(events).toEqual(['a = 0']);
    editor.dispose();
  });

  it('text edits sync to blocks and code_ (quiet pushes, one listener event)', () => {
    const editor = makeEditor();
    editor.setCode('a = 0');
    const events: string[] = [];
    editor.addChangeListener((event) => events.push(event.value));
    // Simulate a user keystroke: a loud (non-silent) CM dispatch.
    editor.textEditor.view.dispatch({
      changes: {
        from: 0,
        to: editor.textEditor.view.state.doc.length,
        insert: 'b = 1',
      },
    });
    expect(editor.getCode()).toBe('b = 1');
    expect(editor.blockEditor.workspace.getAllBlocks(false).map((b) => b.type)).toContain(
      'ast_Assign',
    );
    expect(events).toEqual(['b = 1']);
    editor.dispose();
  });

  it('blocks edits regenerate text (round trip through the workspace)', () => {
    const editor = makeEditor();
    editor.setCode('a = 0');
    // Blocks→text: regenerate from the live workspace the way the change
    // listener does.
    expect(editor.blockEditor.getCode().trim()).toBe('a = 0');
    editor.dispose();
  });

  it('mode fan-out reaches both editors', () => {
    const editor = makeEditor('text');
    expect(editor.tags.textContainer.style.width).toBe('100%');
    editor.setMode('block');
    expect(editor.tags.textContainer.style.display).toBe('none');
    editor.setMode('split');
    expect(editor.tags.textContainer.style.width).toBe('40%');
    editor.dispose();
  });

  it('setCode(..., notify=false) pushes into both editors without firing listeners', () => {
    const editor = makeEditor();
    const events: string[] = [];
    editor.addChangeListener((event) => events.push(event.value));
    editor.setCode('a = 0', false, false);
    expect(editor.getCode()).toBe('a = 0');
    expect(editor.textEditor.getCode()).toBe('a = 0');
    expect(editor.blockEditor.workspace.getAllBlocks(false).map((b) => b.type)).toContain(
      'ast_Assign',
    );
    expect(events).toEqual([]);
    editor.dispose();
  });

  it('switching files (external set + clearHistory) leaves nothing to undo', async () => {
    const { undo } = await import('@codemirror/commands');
    const editor = makeEditor();
    editor.setCode('a = 0', false, false);
    // User edit in file A.
    editor.textEditor.view.dispatch({ changes: { from: 0, to: 5, insert: 'a = 1' } });
    expect(editor.getCode()).toBe('a = 1');
    // Switch to file B.
    editor.setCode('b = 2', false, false);
    editor.clearHistory();
    expect(undo(editor.textEditor.view)).toBe(false);
    expect(editor.textEditor.getCode()).toBe('b = 2');
    editor.dispose();
  });

  describe('text→blocks debounce', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('an external setCode cancels a pending regeneration', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const editor = new DualEditor({ container, viewMode: 'split', height: 500, blockDelay: 300 });
      editor.setCode('a = 0');
      // A keystroke schedules the regeneration...
      editor.textEditor.view.dispatch({ changes: { from: 0, to: 5, insert: 'b = 1' } });
      // ...but an external set (file switch) arrives before it fires.
      editor.setCode('c = 2', false, false);
      vi.runAllTimers();
      // The workspace holds the external code, not the stale keystroke.
      expect(editor.blockEditor.getCode().trim()).toBe('c = 2');
      expect(editor.textEditor.getCode()).toBe('c = 2');
      editor.dispose();
    });
  });

  it('escapes custom toolbox category names in the XML', () => {
    const editor = makeEditor();
    const xml = makeToolboxXml(
      [{ name: 'Tom & "Jerry" <3', colour: 'VARIABLES', blocks: ['a = 0'] }],
      editor.blockEditor.converter,
    );
    expect(xml).toContain('name="Tom &amp; &quot;Jerry&quot; &lt;3"');
    editor.dispose();
  });

  it('hidden block editor defers code until shown', () => {
    const editor = makeEditor('text');
    editor.setCode('deferred = 1');
    // Hidden: workspace untouched.
    expect(editor.blockEditor.workspace.getAllBlocks(false)).toHaveLength(0);
    editor.setMode('split');
    expect(editor.blockEditor.workspace.getAllBlocks(false).map((b) => b.type)).toContain(
      'ast_Assign',
    );
    editor.dispose();
  });

  it('setReadOnly toggles the container class and both editors', () => {
    const editor = makeEditor();
    editor.setReadOnly(true);
    expect(editor.tags.container.classList.contains('block-mirror-read-only')).toBe(true);
    expect(editor.textEditor.view.state.readOnly).toBe(true);
    expect(document.querySelector('.blockly-readonly-layer')).not.toBeNull();
    editor.setReadOnly(false);
    expect(document.querySelector('.blockly-readonly-layer')).toBeNull();
    editor.dispose();
  });

  it('unparseable text still produces blocks (raw fallback, no lockout)', () => {
    const editor = makeEditor();
    editor.setCode('a = 0\nb = ');
    const types = editor.blockEditor.workspace.getAllBlocks(false).map((b) => b.type);
    expect(types).toContain('ast_Assign');
    expect(types).toContain('ast_Raw');
    editor.dispose();
  });
});
