/**
 * Block half of the dual editor — port of legacy
 * `BlockMirror/src/block_editor.js` on Blockly 11 (same major version as
 * legacy).
 *
 * Ported semantics:
 *  - `setCode`: text → blocks via the shared `TextToBlocksConverter`
 *    (parse failures degrade to `ast_Raw` blocks inside the converter — the
 *    user always sees blocks, never an error lockout; B3's "no blocks from a
 *    recovered tree" is enforced in the converter itself);
 *    children get `y = line_number * 100` for vertical ordering, then
 *    `clearWorkspaceAndLoadFromXml` + `cleanUp()`, wrapped in
 *    `Events.disable()/enable()` when quiet.
 *  - `changed` fires text regeneration only for CREATE/DELETE/CHANGE/MOVE/
 *    VAR_RENAME events while not dragging.
 *  - `outOfDate_` deferral while hidden; mode table split 60% / block 100% /
 *    text hidden; 675px responsive stacking; read-only overlay layer.
 */
import * as Blockly from 'blockly/core';
import {
  TextToBlocksConverter,
  workspaceToPython,
  type ConverterConfiguration,
} from '@blockpy/blocks';
import { makeToolboxXml, type ToolboxSpec } from './toolboxes';

const BLOCKLY_CHANGE_EVENTS: string[] = [
  Blockly.Events.BLOCK_CREATE,
  Blockly.Events.BLOCK_DELETE,
  Blockly.Events.BLOCK_CHANGE,
  Blockly.Events.BLOCK_MOVE,
  Blockly.Events.VAR_RENAME,
];

export interface BlockEditorViewConfiguration {
  width: string;
  visible: boolean;
}

export interface BlockEditorHost {
  blockContainer: HTMLElement;
  blockEditor: HTMLElement;
  blockArea: HTMLElement;
  height: number;
  isWide(): boolean;
  readOnly: boolean;
  blocklyMediaPath: string;
  renderer: string;
  toolbox: ToolboxSpec;
  converterConfiguration: ConverterConfiguration;
  /** Sync-loop entry: user edited the blocks. */
  onBlocksChanged(newCode: string): void;
}

export class DualBlockEditor {
  static readonly VIEW_CONFIGURATIONS: Record<
    string,
    BlockEditorViewConfiguration
  > = {
    split: { width: '60%', visible: true },
    block: { width: '100%', visible: true },
    text: { width: '0%', visible: false },
  };

  readonly workspace: Blockly.WorkspaceSvg;
  readonly converter: TextToBlocksConverter;
  private readonly host: BlockEditorHost;
  private mode_: keyof typeof DualBlockEditor.VIEW_CONFIGURATIONS = 'split';
  private outOfDate_: string | null = null;
  private readOnlyDiv_: HTMLElement | null = null;
  private toolbox_: ToolboxSpec;

  constructor(host: BlockEditorHost) {
    this.host = host;
    this.toolbox_ = host.toolbox;
    this.converter = new TextToBlocksConverter(host.converterConfiguration);

    host.blockContainer.style.cssFloat = 'left';
    host.blockEditor.style.position = 'absolute';
    host.blockEditor.style.width = '100%';
    host.blockArea.style.height = host.height + 'px';

    this.workspace = Blockly.inject(host.blockEditor as HTMLElement, {
      media: host.blocklyMediaPath,
      zoom: { controls: true },
      comments: false,
      disable: false,
      oneBasedIndex: false,
      readOnly: host.readOnly,
      scrollbars: true,
      toolbox: this.makeToolbox(),
      renderer: host.renderer,
    });
    this.workspace.addChangeListener(this.changed.bind(this));
  }

  makeToolbox(): string {
    return makeToolboxXml(this.toolbox_, this.converter);
  }

  remakeToolbox(toolbox?: ToolboxSpec): void {
    if (toolbox !== undefined) {
      this.toolbox_ = toolbox;
    }
    this.workspace.updateToolbox(this.makeToolbox());
    this.resized();
  }

  /** Toolbox flyout width — used by the text editor's indent sidebar. */
  getToolbarWidth(): number {
    if (this.host.readOnly) return 0;
    const toolbox = this.workspace.getToolbox();
    return toolbox ? toolbox.getWidth() : 0;
  }

  getCode(): string {
    return workspaceToPython(this.workspace);
  }

  setCode(code: string, quietly = false): void {
    if (!this.isVisible()) {
      this.outOfDate_ = code;
      return;
    }
    this.applyCode(code, quietly);
  }

  private applyCode(code: string, quietly: boolean): void {
    const result = this.converter.convertSource('__main__.py', code);
    try {
      const xml = Blockly.utils.xml.textToDom(result.xml);
      // Vertical ordering: y = source line * 100 (legacy).
      for (let i = 0; i < xml.children.length; i += 1) {
        const child = xml.children[i]!;
        const lineNumber = parseInt(
          child.getAttribute('line_number') ?? '1',
          10,
        );
        child.setAttribute('y', String((lineNumber || 1) * 100));
        child.setAttribute('x', '0');
      }
      if (quietly) {
        Blockly.Events.disable();
        try {
          Blockly.Xml.clearWorkspaceAndLoadFromXml(xml, this.workspace);
          this.workspace.cleanUp();
        } finally {
          Blockly.Events.enable();
        }
      } else {
        Blockly.Xml.clearWorkspaceAndLoadFromXml(xml, this.workspace);
        this.workspace.cleanUp();
      }
    } catch (error) {
      console.error(error);
    }
  }

  isVisible(): boolean {
    return DualBlockEditor.VIEW_CONFIGURATIONS[this.mode_]!.visible;
  }

  setMode(mode: string): void {
    this.mode_ = mode as keyof typeof DualBlockEditor.VIEW_CONFIGURATIONS;
    const config = DualBlockEditor.VIEW_CONFIGURATIONS[mode]!;
    this.workspace.setVisible(config.visible);
    if (config.visible) {
      this.host.blockEditor.style.width = '100%';
      this.resized();
      if (this.outOfDate_ !== null) {
        const pending = this.outOfDate_;
        this.outOfDate_ = null;
        this.applyCode(pending, true);
      }
    } else {
      this.host.blockContainer.style.height = '0%';
      this.host.blockArea.style.height = '0%';
      this.resizeReadOnlyDiv();
    }
  }

  resized(): void {
    this.resizeResponsively();
    this.host.blockEditor.style.width = this.host.blockArea.offsetWidth + 'px';
    this.host.blockEditor.style.height =
      this.host.blockArea.offsetHeight + 'px';
    Blockly.svgResize(this.workspace);
    this.resizeReadOnlyDiv();
  }

  private resizeResponsively(): void {
    const config = DualBlockEditor.VIEW_CONFIGURATIONS[this.mode_]!;
    const style = this.host.blockContainer.style;
    if (this.mode_ === 'split') {
      if (this.host.isWide()) {
        style.width = config.width;
        style.height = this.host.height + 'px';
        this.host.blockArea.style.height = this.host.height + 'px';
      } else {
        style.width = '100%';
        style.height = this.host.height / 2 + 'px';
        this.host.blockArea.style.height = this.host.height / 2 + 'px';
      }
    } else if (config.visible) {
      style.width = config.width;
      style.height = this.host.height + 'px';
      this.host.blockArea.style.height = this.host.height + 'px';
    }
  }

  /** Legacy read-only overlay (`.blockly-readonly-layer`). */
  setReadOnly(isReadOnly: boolean): void {
    if (isReadOnly) {
      if (!this.readOnlyDiv_) {
        this.readOnlyDiv_ = document.createElement('div');
        this.readOnlyDiv_.className = 'blockly-readonly-layer';
        document.body.appendChild(this.readOnlyDiv_);
      }
      this.resizeReadOnlyDiv();
    } else if (this.readOnlyDiv_) {
      this.readOnlyDiv_.remove();
      this.readOnlyDiv_ = null;
    }
  }

  private resizeReadOnlyDiv(): void {
    if (!this.readOnlyDiv_) return;
    const rect = this.host.blockArea.getBoundingClientRect();
    const style = this.readOnlyDiv_.style;
    style.left = rect.left + window.scrollX + 'px';
    style.top = rect.top + window.scrollY + 'px';
    style.width = rect.width + 'px';
    style.height = rect.height + 'px';
  }

  private changed(event: Blockly.Events.Abstract): void {
    if (
      BLOCKLY_CHANGE_EVENTS.indexOf(event.type) === -1 ||
      this.workspace.isDragging()
    ) {
      return;
    }
    this.host.onBlocksChanged(this.getCode());
  }

  dispose(): void {
    this.setReadOnly(false);
    this.workspace.dispose();
  }
}
