/**
 * @blockpy/editor — Dual block/text Python editor and coding-assignment
 * surface (spec §8, §11.1).
 *
 * The dual editor (`DualEditor`) is the port of legacy BlockMirror; the
 * React chrome around it (toolbar, console, feedback pane — A8 parity)
 * builds on top.
 */
export {
  DualEditor,
  BREAK_WIDTH,
  type DualEditorConfiguration,
  type DualEditorMode,
  type DualEditorChangeEvent,
  type DualEditorListener,
} from './dual/dual-editor';
export { DualTextEditor } from './dual/text-editor';
export { DualBlockEditor } from './dual/block-editor';
export {
  TOOLBOXES,
  TOOLBOX_CATEGORY,
  EXTRA_TOOLS,
  makeToolboxXml,
  toolboxPythonToBlocks,
} from './dual/toolboxes';
export type { ToolboxSpec, ToolboxCategory, ToolboxEntry } from './dual/toolboxes';
export { DualEditorView, type DualEditorViewProps } from './components/DualEditorView';

export {
  CodingEditor,
  type CodingEditorProps,
  type RunController,
  type RunHandlers,
  type RunOutcome,
} from './chrome/CodingEditor';
export { Console } from './chrome/Console';
export { Feedback } from './chrome/Feedback';
export { Instructions, renderInstructions } from './chrome/Instructions';
export { PythonToolbar } from './chrome/PythonToolbar';
export {
  useEditorChromeStore,
  type ConsoleEntry,
  type EditorChromeState,
  type FeedbackState,
  type RunState,
} from './chrome/store';
export { categoryPresentation } from './chrome/categories';

export const PACKAGE_NAME = '@blockpy/editor';
