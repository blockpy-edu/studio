/**
 * The dual (blocks ↔ text) editor controller — port of legacy
 * `BlockMirror/src/block_mirror.js` (the real `BlockMirror` class; legacy
 * `main.js` is a dead file).
 *
 * Ported semantics:
 *  - configuration validation and defaults (legacy names kept);
 *  - `setCode(code, quietly)` — a non-quiet set pushes into both editors
 *    quietly; listeners ALWAYS fire `{name: 'changed', value: code}`;
 *  - sync loop: each cross-editor push is quiet, so no cycles; text→blocks
 *    honors `blockDelay` (false = immediate);
 *  - `setMode` fans out to both editors' view tables (block 100%/0%,
 *    split 60/40, text 0%/100%) with the 675px stacking breakpoint;
 *  - `setReadOnly` toggles both editors + the `block-mirror-read-only`
 *    container class;
 *  - highlight APIs delegate to the text editor only (legacy parity).
 *
 * Deviations (deliberate, minor): Ctrl-Enter actually invokes `run` (legacy
 * bound an undefined property — the binding never worked); Skulpt options
 * (`skipSkulpt`) are gone (no Skulpt in Studio).
 */
import { DualBlockEditor } from './block-editor';
import { DualTextEditor, type EditorTheme } from './text-editor';
import type { ToolboxSpec } from './toolboxes';
import type { ConverterConfiguration } from '@blockpy/blocks';

export type DualEditorMode = 'block' | 'split' | 'text';
export type { EditorTheme };

export interface DualEditorConfiguration {
  /** Mount point. Required. */
  container: HTMLElement;
  blocklyMediaPath?: string;
  /** Bound to Ctrl-Enter in the text editor. */
  run?: () => void;
  readOnly?: boolean;
  height?: number;
  viewMode?: DualEditorMode;
  /** Text→blocks debounce in ms; `false` = immediate (legacy default). */
  blockDelay?: number | false;
  toolbox?: ToolboxSpec;
  renderer?: string;
  /** Passed through to the text→blocks converter (Image constructor etc.). */
  imageMode?: boolean;
  imageDetection?: ConverterConfiguration['imageDetection'];
  /**
   * Legacy text-mode indent sidebar (text_editor.js `updateGutter`): pads
   * the text editor's left so code aligns under the block toolbox when
   * toggling text↔split. Default true (legacy). The minified variant (§8.4)
   * turns it off — it has no block toolbox to align with.
   */
  indentSidebar?: boolean;
}

export interface DualEditorChangeEvent {
  name: 'changed';
  value: string;
}

export type DualEditorListener = (event: DualEditorChangeEvent) => void;

interface ResolvedConfiguration extends Required<
    Omit<DualEditorConfiguration, 'imageDetection' | 'imageMode'>
  > {
  imageMode: boolean;
  imageDetection: ConverterConfiguration['imageDetection'];
}

/** Legacy responsive stacking breakpoint (px). */
export const BREAK_WIDTH = 675;

export class DualEditor {
  readonly configuration: ResolvedConfiguration;
  readonly textEditor: DualTextEditor;
  readonly blockEditor: DualBlockEditor;

  /** DOM scaffold, structured exactly like legacy `initializeVariables`. */
  readonly tags: {
    container: HTMLElement;
    toolbar: HTMLDivElement;
    blockContainer: HTMLDivElement;
    blockEditor: HTMLDivElement;
    blockArea: HTMLDivElement;
    textContainer: HTMLDivElement;
    textSidebar: HTMLDivElement;
  };

  private code_ = '';
  private mode_: DualEditorMode | null = null;
  private theme_: EditorTheme = 'light';
  private listeners_: DualEditorListener[] = [];
  private textChangeTimer_: ReturnType<typeof setTimeout> | null = null;
  private readonly onWindowResize = () => {
    this.blockEditor.resized();
    this.textEditor.resizeResponsively();
  };

  constructor(configuration: DualEditorConfiguration) {
    if (!configuration.container) {
      throw new Error('Invalid configuration: Missing "container" property.');
    }
    this.configuration = {
      container: configuration.container,
      blocklyMediaPath: configuration.blocklyMediaPath ?? '../../blockly/media/',
      run:
        configuration.run ??
        function () {
          console.log('Ran!');
        },
      readOnly: configuration.readOnly ?? false,
      height: configuration.height ?? 500,
      viewMode: configuration.viewMode ?? 'split',
      // M3.3: default 300 ms — synchronous whole-workspace regeneration on
      // every split/block-mode keystroke was the perceived "slow
      // highlighting". Pass `false` for the legacy immediate behavior.
      blockDelay: configuration.blockDelay ?? 300,
      toolbox: configuration.toolbox ?? 'normal',
      renderer: configuration.renderer ?? 'Thrasos',
      imageMode: configuration.imageMode ?? false,
      imageDetection: configuration.imageDetection ?? 'string',
      indentSidebar: configuration.indentSidebar ?? true,
    };

    this.tags = this.buildDom(this.configuration.container);

    const isWide = () => window.innerWidth >= BREAK_WIDTH;

    this.blockEditor = new DualBlockEditor({
      blockContainer: this.tags.blockContainer,
      blockEditor: this.tags.blockEditor,
      blockArea: this.tags.blockArea,
      height: this.configuration.height,
      isWide,
      readOnly: this.configuration.readOnly,
      blocklyMediaPath: this.configuration.blocklyMediaPath,
      renderer: this.configuration.renderer,
      toolbox: this.configuration.toolbox,
      converterConfiguration: {
        imageMode: this.configuration.imageMode,
        imageDetection: this.configuration.imageDetection,
      },
      onBlocksChanged: (newCode) => this.handleBlocksChanged(newCode),
    });

    this.textEditor = new DualTextEditor(
      {
        textContainer: this.tags.textContainer,
        textSidebar: this.tags.textSidebar,
        height: this.configuration.height,
        isWide,
        indentSidebar: this.configuration.indentSidebar,
        getBlockToolbarWidth: () => this.blockEditor.getToolbarWidth(),
        run: () => this.configuration.run(),
        onTextChanged: (newCode) => this.handleTextChanged(newCode),
      },
      this.configuration.readOnly,
    );

    window.addEventListener('resize', this.onWindowResize);
    this.setMode(this.configuration.viewMode);
  }

  /** Legacy `initializeVariables` DOM scaffold (inline float layout). */
  private buildDom(container: HTMLElement) {
    const doc = container.ownerDocument;
    const toolbar = doc.createElement('div');
    const blockContainer = doc.createElement('div');
    blockContainer.style.cssFloat = 'left';
    blockContainer.style.boxSizing = 'border-box';
    const blockEditor = doc.createElement('div');
    const blockArea = doc.createElement('div');
    blockContainer.appendChild(blockEditor);
    blockContainer.appendChild(blockArea);
    const textContainer = doc.createElement('div');
    textContainer.style.cssFloat = 'left';
    textContainer.style.boxSizing = 'border-box';
    textContainer.style.border = '1px solid lightgray';
    const textSidebar = doc.createElement('div');
    textSidebar.style.cssFloat = 'left';
    textSidebar.style.height = '100%';
    textSidebar.style.backgroundColor = '#ddd';
    textContainer.appendChild(textSidebar);
    container.appendChild(toolbar);
    container.appendChild(blockContainer);
    container.appendChild(textContainer);
    return {
      container,
      toolbar,
      blockContainer,
      blockEditor,
      blockArea,
      textContainer,
      textSidebar,
    };
  }

  // -- sync loop --------------------------------------------------------------

  private handleTextChanged(newCode: string): void {
    // The code mirror + change listener fire IMMEDIATELY — Run/autosave must
    // never observe stale text (M3.3). Only the expensive text→blocks
    // regeneration debounces; in text mode the hidden block editor already
    // defers via its own outOfDate_ stash, so typing there costs nothing.
    this.setCode(newCode, true);
    const apply = () => {
      this.blockEditor.setCode(newCode, true);
    };
    if (this.configuration.blockDelay === false) {
      apply();
    } else {
      if (this.textChangeTimer_ !== null) clearTimeout(this.textChangeTimer_);
      this.textChangeTimer_ = setTimeout(apply, this.configuration.blockDelay);
    }
  }

  private handleBlocksChanged(newCode: string): void {
    this.textEditor.setCode(newCode, true);
    this.setCode(newCode, true);
  }

  // -- public API (legacy names) ----------------------------------------------

  setCode(code: string, quietly = false): void {
    this.code_ = code;
    if (!quietly) {
      this.textEditor.setCode(code, true);
      this.blockEditor.setCode(code, true);
    }
    this.fireChangeListener({ name: 'changed', value: code });
  }

  getCode(): string {
    return this.code_;
  }

  setMode(mode: DualEditorMode): void {
    this.mode_ = mode;
    this.blockEditor.setMode(mode);
    this.textEditor.setMode(mode);
  }

  getMode(): DualEditorMode | null {
    return this.mode_;
  }

  setReadOnly(isReadOnly: boolean): void {
    this.textEditor.setReadOnly(isReadOnly);
    this.blockEditor.setReadOnly(isReadOnly);
    this.configuration.container.classList.toggle(
      'block-mirror-read-only',
      isReadOnly,
    );
  }

  /** Live-toggle text-editor autocomplete (M3.3; default off). */
  setAutocomplete(enabled: boolean): void {
    this.textEditor.setAutocomplete(enabled);
  }

  /**
   * Live-swap the color theme on both halves (M4.1, LD-23). No-op when
   * unchanged — Blockly's setTheme forces a full workspace refresh, which
   * must not run on every mount (every editor starts light).
   */
  setTheme(theme: EditorTheme): void {
    if (theme === this.theme_) return;
    this.theme_ = theme;
    this.textEditor.setTheme(theme);
    this.blockEditor.setTheme(theme);
  }

  refresh(): void {
    this.blockEditor.resized();
    this.textEditor.refresh();
  }

  forceBlockRefresh(): void {
    this.blockEditor.setCode(this.code_, true);
  }

  setHighlightedLines(lines: number[], style: string): void {
    this.textEditor.setHighlightedLines(lines, style);
  }

  clearHighlightedLines(style: string | null = null): void {
    this.textEditor.clearHighlightedLines(style);
  }

  addChangeListener(callback: DualEditorListener): void {
    this.listeners_.push(callback);
  }

  removeChangeListener(callback: DualEditorListener): void {
    const index = this.listeners_.indexOf(callback);
    if (index !== -1) this.listeners_.splice(index, 1);
  }

  removeAllChangeListeners(): void {
    this.listeners_ = [];
  }

  fireChangeListener(event: DualEditorChangeEvent): void {
    for (const listener of this.listeners_) {
      listener(event);
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onWindowResize);
    if (this.textChangeTimer_ !== null) clearTimeout(this.textChangeTimer_);
    this.textEditor.dispose();
    this.blockEditor.dispose();
    this.tags.toolbar.remove();
    this.tags.blockContainer.remove();
    this.tags.textContainer.remove();
  }
}
