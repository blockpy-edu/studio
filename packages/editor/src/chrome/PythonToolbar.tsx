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
}

const MODE_TABS: { name: string; iconName: IconName; mode: DualEditorMode }[] =
  [
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
}: PythonToolbarProps) {
  const runState = useEditorChromeStore((state) => state.runState);
  const pythonMode = useEditorChromeStore((state) => state.pythonMode);
  const setPythonMode = useEditorChromeStore((state) => state.setPythonMode);
  const historyMode = useEditorChromeStore((state) => state.historyMode);
  const autocomplete = useEditorChromeStore((state) => state.autocomplete);
  const toggleAutocomplete = useEditorChromeStore(
    (state) => state.toggleAutocomplete,
  );
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
        <div
          className="btn-group btn-group-toggle mr-2"
          role="group"
          aria-label="View mode"
        >
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
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={onReset}
        >
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
        <button type="button" className="btn btn-outline-secondary" disabled>
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
      <div className="btn-group mr-2" role="group" aria-label="History Group">
        <button
          type="button"
          className={
            'btn btn-outline-secondary' + (historyMode ? ' active' : '')
          }
          aria-pressed={historyMode}
          disabled={!onHistory}
          onClick={onHistory}
        >
          <Icon name="history" /> History
        </button>
      </div>
      <div className="btn-group mr-2" role="group">
        <button type="button" className="btn btn-outline-secondary" disabled>
          <Icon name="extra" />
        </button>
      </div>
    </div>
  );
}
