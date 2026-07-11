/**
 * Console panel — Row 2 left (A8 §1: `.blockpy-panel.blockpy-console`,
 * printer area 200px/resize-vertical with per-line dashed separators, and
 * the Evaluate strip at the bottom — legacy `.blockpy-btn-eval`). The eval
 * REPL executes `student.eval` jobs against the persistent run namespace
 * (§6.4) through the same RunController abstraction as Run.
 */
import { useState } from 'react';
import { useEditorChromeStore } from './store';

export interface ConsoleProps {
  /** "col-md-6" beside feedback, "col-md-12" alone (legacy ui.console.size). */
  size?: string;
  /** When provided, the Evaluate strip renders (legacy console eval). */
  onEvaluate?: (expression: string) => void;
}

export function Console({ size = 'col-md-6', onEvaluate }: ConsoleProps) {
  const entries = useEditorChromeStore((state) => state.console);
  const [expression, setExpression] = useState('');

  const submit = () => {
    const trimmed = expression.trim();
    if (trimmed === '' || !onEvaluate) return;
    setExpression('');
    onEvaluate(trimmed);
  };

  return (
    <div className={`blockpy-panel blockpy-console ${size}`}>
      <strong>Console:</strong>
      <div className="blockpy-printer blockpy-printer-default" role="log">
        {entries.map((entry, i) => (
          <div
            key={i}
            className={`blockpy-printer-output blockpy-printer-${entry.kind}`}
          >
            {entry.kind === 'stderr' ? (
              <span style={{ color: 'darkred' }}>{entry.text}</span>
            ) : (
              entry.text
            )}
          </div>
        ))}
      </div>
      {onEvaluate && (
        <div className="input-group input-group-sm blockpy-console-eval">
          <div className="input-group-prepend">
            <span className="input-group-text">
              <code>&gt;&gt;&gt;</code>
            </span>
          </div>
          <input
            type="text"
            className="form-control"
            aria-label="Evaluate expression"
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
          <div className="input-group-append">
            <button
              type="button"
              className="btn btn-outline-secondary blockpy-btn-eval"
              onClick={submit}
            >
              Evaluate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
