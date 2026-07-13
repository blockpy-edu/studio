/**
 * Python editor toolbar — Row 4 top (A8 §1 button groups, in legacy order).
 * Class names and FA icon classes are legacy hooks (§9.6, A8 §3.2); the
 * groups not yet backed by functionality (datasets, upload, history, save,
 * delete, extra) render disabled so the layout is conformant while their
 * wiring lands incrementally.
 */
import { useEditorChromeStore } from './store';
import { Icon, type IconName } from './icons';
import type { DualEditorMode } from '../dual/dual-editor';

export interface PythonToolbarProps {
  onRun(): void;
  onStop(): void;
  onReset(): void;
  /** Legacy `assignment.settings.enableBlocks` — hides the view toggle. */
  enableBlocks?: boolean;
  /**
   * Toggles history mode. Button enabled only when provided (legacy
   * `isHistoryAvailable` = loadHistory endpoint connected).
   */
  onHistory?(): void;
  /**
   * File management for the ACTIVE file (M3.7 / LD-21). Legacy had a
   * working Delete (python.js:117-123) and a DEAD Rename; Studio ships
   * both. Buttons render only with a handler and enable per `can*`.
   */
  onDeleteFile?(): void;
  onRenameFile?(): void;
  canDeleteFile?: boolean;
  canRenameFile?: boolean;
  /**
   * Focused editor mode toggle (M4.2; STUDIO EXTENSION). Renders only with
   * a handler; Esc exits, Ctrl+Alt+F toggles (wired by the CodingEditor).
   */
  onToggleFocus?(): void;
  focusedMode?: boolean;
  /**
   * Docs panel toggle (M4.3; STUDIO EXTENSION). Renders only with a
   * handler — the CodingEditor supplies one when `docs_url` is set.
   */
  onToggleDocs?(): void;
  docsOpen?: boolean;
}

const MODE_TABS: { name: string; iconName: IconName; mode: DualEditorMode }[] = [
  { name: 'Blocks', iconName: 'blocks', mode: 'block' },
  { name: 'Split', iconName: 'split', mode: 'split' },
  { name: 'Text', iconName: 'text', mode: 'text' },
];

export function PythonToolbar({
  onRun,
  onStop,
  onReset,
  enableBlocks = true,
  onHistory,
  onDeleteFile,
  onRenameFile,
  canDeleteFile = false,
  canRenameFile = false,
  onToggleFocus,
  focusedMode = false,
  onToggleDocs,
  docsOpen = false,
}: PythonToolbarProps) {
  const runState = useEditorChromeStore((state) => state.runState);
  const pythonMode = useEditorChromeStore((state) => state.pythonMode);
  const setPythonMode = useEditorChromeStore((state) => state.setPythonMode);
  const historyMode = useEditorChromeStore((state) => state.historyMode);
  const autocomplete = useEditorChromeStore((state) => state.autocomplete);
  const toggleAutocomplete = useEditorChromeStore((state) => state.toggleAutocomplete);
  const blockKeyboardNav = useEditorChromeStore((state) => state.blockKeyboardNav);
  const toggleBlockKeyboardNav = useEditorChromeStore((state) => state.toggleBlockKeyboardNav);
  const running = runState === 'running';

  return (
    <div className="blockpy-python-toolbar col-md-12 btn-toolbar" role="toolbar">
      <div className="btn-group mr-2" role="group">
        <button
          type="button"
          className={
            'btn blockpy-run notransition' +
            (running ? ' blockpy-run-running' : '') +
            (runState === 'error' ? ' blockpy-run-error' : '')
          }
          onClick={running ? onStop : onRun}
        >
          <Icon name={running ? 'stop' : 'run'} /> {running ? 'Stop' : 'Run'}
        </button>
      </div>
      {enableBlocks && (
        <div className="btn-group btn-group-toggle mr-2" role="group" aria-label="View mode">
          {MODE_TABS.map((tab) => (
            <label
              key={tab.mode}
              className={
                'btn btn-outline-secondary blockpy-mode-set-blocks' +
                (pythonMode === tab.mode ? ' active' : '')
              }
            >
              <input
                type="radio"
                name="blockpy-mode"
                checked={pythonMode === tab.mode}
                onChange={() => setPythonMode(tab.mode)}
                style={{ position: 'absolute', clip: 'rect(0,0,0,0)' }}
              />
              <Icon name={tab.iconName} /> {tab.name}
            </label>
          ))}
        </div>
      )}
      <div className="btn-group mr-2" role="group">
        <button type="button" className="btn btn-outline-secondary" onClick={onReset}>
          <Icon name="reset" /> Reset
        </button>
      </div>
      <div className="btn-group mr-2" role="group">
        <button type="button" className="btn btn-outline-secondary" disabled>
          <Icon name="datasets" /> Import datasets
        </button>
      </div>
      <div className="btn-group mr-2" role="group">
        <button type="button" className="btn btn-outline-secondary" disabled>
          <Icon name="upload" /> Upload
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          aria-label="Download the current file"
          disabled
        >
          <Icon name="download" />
        </button>
      </div>
      {/* Autocomplete toggle (M3.3; Studio extension — default off). */}
      <div className="btn-group mr-2" role="group">
        <button
          type="button"
          className={
            'btn btn-outline-secondary blockpy-toggle-autocomplete' +
            (autocomplete ? ' active' : '')
          }
          aria-pressed={autocomplete}
          title="Toggle code autocomplete"
          onClick={toggleAutocomplete}
        >
          <Icon name="autocomplete" /> Autocomplete
        </button>
      </div>
      {/* Blockly keyboard navigation (M6.2, LD-30; §16.3 best-effort —
          default off, persisted). Only meaningful with a block workspace. */}
      {enableBlocks && (
        <div className="btn-group mr-2" role="group">
          <button
            type="button"
            className={
              'btn btn-outline-secondary blockpy-toggle-keyboard-nav' +
              (blockKeyboardNav ? ' active' : '')
            }
            aria-pressed={blockKeyboardNav}
            title="Toggle keyboard navigation for the block workspace"
            onClick={toggleBlockKeyboardNav}
          >
            <Icon name="keyboardNav" />
          </button>
        </div>
      )}
      {/* Docs panel toggle (M4.3; Studio extension — docs_url set). */}
      {onToggleDocs && (
        <div className="btn-group mr-2" role="group">
          <button
            type="button"
            className={
              'btn btn-outline-secondary blockpy-toggle-docs' + (docsOpen ? ' active' : '')
            }
            aria-pressed={docsOpen}
            title="Toggle the documentation panel"
            onClick={onToggleDocs}
          >
            <Icon name="docs" /> Docs
          </button>
        </div>
      )}
      {/* Focused mode toggle (M4.2; Studio extension — exam display). */}
      {onToggleFocus && (
        <div className="btn-group mr-2" role="group">
          <button
            type="button"
            className={
              'btn btn-outline-secondary blockpy-toggle-focus' + (focusedMode ? ' active' : '')
            }
            aria-pressed={focusedMode}
            title={
              focusedMode ? 'Exit focused editor mode (Esc)' : 'Focused editor mode (Ctrl+Alt+F)'
            }
            onClick={onToggleFocus}
          >
            <Icon name="focus" /> Focus
          </button>
        </div>
      )}
      <div className="btn-group mr-2" role="group" aria-label="History Group">
        <button
          type="button"
          className={'btn btn-outline-secondary' + (historyMode ? ' active' : '')}
          aria-pressed={historyMode}
          disabled={!onHistory}
          onClick={onHistory}
        >
          <Icon name="history" /> History
        </button>
      </div>
      {(onDeleteFile || onRenameFile) && (
        <div className="btn-group mr-2" role="group" aria-label="File actions">
          {onRenameFile && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              disabled={!canRenameFile}
              title="Rename the current file"
              onClick={onRenameFile}
            >
              <Icon name="rename" /> Rename
            </button>
          )}
          {onDeleteFile && (
            <button
              type="button"
              className="btn btn-outline-secondary blockpy-delete-file"
              disabled={!canDeleteFile}
              title="Delete the current file"
              onClick={onDeleteFile}
            >
              <Icon name="delete" /> Delete
            </button>
          )}
        </div>
      )}
      <div className="btn-group mr-2" role="group">
        <button
          type="button"
          className="btn btn-outline-secondary"
          aria-label="More options"
          disabled
        >
          <Icon name="extra" />
        </button>
      </div>
    </div>
  );
}
