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
  resolveToolboxSetting,
  type CodingEditorProps,
  type EvalOutcome,
  type RunController,
  type RunHandlers,
  type RunOptions,
  type RunOutcome,
} from './chrome/CodingEditor';
export { FileTabs, computeTabs, type FileTab } from './chrome/FileTabs';
export { AddNewMenu, type AddNewMenuProps } from './chrome/AddNewMenu';
export { TraceExplorer, typeFromRepr } from './chrome/TraceExplorer';
export { Console } from './chrome/Console';
export { DevConsole } from './chrome/DevConsole';
export { Feedback } from './chrome/Feedback';
export { Instructions, renderInstructions } from './chrome/Instructions';
export { PythonToolbar } from './chrome/PythonToolbar';
export { Footer, type FooterIdentity, type FooterProps } from './chrome/Footer';
export {
  HistoryToolbar,
  editEvents,
  filterHistory,
  isEditEvent,
  prettyPrintDateTime,
  type HistoryEntry,
  type HistoryToolbarProps,
} from './chrome/History';
export { HistoryDiffView, type HistoryDiffViewProps } from './components/HistoryDiffView';
export {
  QuickMenu,
  formatClockTime,
  isSubmitted,
  markSubmittedText,
  type QuickMenuProps,
  type SubmissionControls,
} from './chrome/QuickMenu';
export { Dialog, type DialogProps } from './chrome/Dialog';
export { highlightCodeBlocks } from './chrome/highlight';
export {
  requestPasscode,
  useEditorChromeStore,
  SERVER_ENDPOINTS,
  type ConsoleEntry,
  type EditorChromeState,
  type EvalState,
  type FeedbackState,
  type RunState,
  type ServerEndpoint,
  type ServerStatusState,
  type TraceStepView,
} from './chrome/store';
export { categoryPresentation } from './chrome/categories';

export const PACKAGE_NAME = '@blockpy/editor';
