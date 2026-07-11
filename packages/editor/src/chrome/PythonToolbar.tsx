/**
 * Python editor toolbar — Row 4 top (A8 §1 button groups, in legacy order).
 * Class names and FA icon classes are legacy hooks (§9.6, A8 §3.2); the
 * groups not yet backed by functionality (datasets, upload, history, save,
 * delete, extra) render disabled so the layout is conformant while their
 * wiring lands incrementally.
 */
import { useEditorChromeStore } from './store';
import type { DualEditorMode } from '../dual/dual-editor';

export interface PythonToolbarProps {
  onRun(): void;
  onStop(): void;
  onReset(): void;
  /** Legacy `assignment.settings.enableBlocks` — hides the view toggle. */
  enableBlocks?: boolean;
}

const MODE_TABS: { name: string; icon: string; mode: DualEditorMode }[] = [
  { name: 'Blocks', icon: 'fa-th-large', mode: 'block' },
  { name: 'Split', icon: 'fa-columns', mode: 'split' },
  { name: 'Text', icon: 'fa-align-left', mode: 'text' },
];

export function PythonToolbar({
  onRun,
  onStop,
  onReset,
  enableBlocks = true,
}: PythonToolbarProps) {
  const runState = useEditorChromeStore((state) => state.runState);
  const pythonMode = useEditorChromeStore((state) => state.pythonMode);
  const setPythonMode = useEditorChromeStore((state) => state.setPythonMode);
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
          <span className="fas fa-play" /> {running ? 'Stop' : 'Run'}
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
              <span className={`fas ${tab.icon}`} /> {tab.name}
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
          <span className="fas fa-sync" /> Reset
        </button>
      </div>
      <div className="btn-group mr-2" role="group">
        <button type="button" className="btn btn-outline-secondary" disabled>
          <span className="fas fa-cloud-download-alt" /> Import datasets
        </button>
      </div>
      <div className="btn-group mr-2" role="group">
        <button type="button" className="btn btn-outline-secondary" disabled>
          <span className="fas fa-file-upload" /> Upload
        </button>
        <button type="button" className="btn btn-outline-secondary" disabled>
          <span className="fas fa-download" />
        </button>
      </div>
      <div className="btn-group mr-2" role="group">
        <button type="button" className="btn btn-outline-secondary" disabled>
          <span className="fas fa-history" /> History
        </button>
      </div>
      <div className="btn-group mr-2" role="group">
        <button type="button" className="btn btn-outline-secondary" disabled>
          <span className="fas fa-ellipsis-v" />
        </button>
      </div>
    </div>
  );
}
