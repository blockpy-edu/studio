/**
 * Console panel — Row 2 left (A8 §1: `.blockpy-panel.blockpy-console`,
 * printer area 200px/resize-vertical with per-line dashed separators).
 *
 * The Evaluate affordance follows legacy console.js exactly: after a
 * successful run, `beginEval` appends a button line inside the printer
 * (`.blockpy-btn-eval`, pinned bottom-left by CSS); clicking it swaps in an
 * inline "Evaluate:" input line (`.blockpy-console-input`, input + Enter);
 * submitting freezes that line in the history and the next input line
 * re-arms after the evaluation (engine.js:136-156). Evaluations run
 * `student.eval` jobs against the persistent run namespace (§6.4).
 */
import { useEffect, useRef, useState } from 'react';
import { useEditorChromeStore, type ConsoleEntry } from './store';

export interface ConsoleProps {
  /** "col-md-6" beside feedback, "col-md-12" alone (legacy ui.console.size). */
  size?: string;
  /** When provided, the Evaluate affordance can appear (legacy console eval). */
  onEvaluate?: (expression: string) => void;
}

/** One frozen (already-submitted) Evaluate line, legacy disabled-input look. */
function FrozenEvalLine({ expression }: { expression: string }) {
  return (
    <div className="blockpy-printer-output">
      <samp>Evaluate:</samp>
      <br />
      <div className="blockpy-console-input">
        <input type="text" value={expression} disabled readOnly />
        <button type="button" disabled>
          Enter
        </button>
      </div>
    </div>
  );
}

function entryBody(entry: ConsoleEntry) {
  if (entry.kind === 'eval') {
    return <FrozenEvalLine expression={entry.text} />;
  }
  return (
    <div className={`blockpy-printer-output blockpy-printer-${entry.kind}`}>
      {entry.kind === 'stderr' ? (
        <span style={{ color: 'darkred' }}>{entry.text}</span>
      ) : entry.kind === 'value' ? (
        <code>{entry.text}</code>
      ) : (
        entry.text
      )}
    </div>
  );
}

export function Console({ size = 'col-md-6', onEvaluate }: ConsoleProps) {
  const entries = useEditorChromeStore((state) => state.console);
  const evalState = useEditorChromeStore((state) => state.evalState);
  const [expression, setExpression] = useState('');
  const printerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const store = useEditorChromeStore;

  const evalVisible = onEvaluate !== undefined && evalState !== 'hidden';

  // Legacy scrollToBottom on new content.
  useEffect(() => {
    const printer = printerRef.current;
    if (printer) printer.scrollTop = printer.scrollHeight;
  }, [entries, evalState]);

  // Legacy focuses the input as soon as the evaluate line renders.
  useEffect(() => {
    if (evalState === 'input') inputRef.current?.focus();
  }, [evalState]);

  const submit = () => {
    const trimmed = expression.trim();
    if (trimmed === '' || !onEvaluate) return;
    setExpression('');
    // The submitted line freezes into the history (legacy disables it).
    store.getState().appendConsole({ kind: 'eval', text: trimmed });
    onEvaluate(trimmed);
  };

  return (
    <div
      className={`blockpy-panel blockpy-console ${size}`}
      role="region"
      aria-label="Console"
    >
      <strong>Console:</strong>
      <div
        ref={printerRef}
        className="blockpy-printer blockpy-printer-default"
        role="log"
      >
        {entries.map((entry, i) => (
          <div key={i}>{entryBody(entry)}</div>
        ))}
        {evalVisible && evalState === 'input' && (
          <div className="blockpy-printer-output">
            <samp>Evaluate:</samp>
            <br />
            <div className="blockpy-console-input">
              <input
                ref={inputRef}
                type="text"
                aria-label="Evaluate expression"
                value={expression}
                onChange={(event) => setExpression(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit();
                }}
              />
              <button type="button" onClick={submit}>
                Enter
              </button>
            </div>
          </div>
        )}
      </div>
      {evalVisible && evalState === 'button' && (
        <button
          type="button"
          className="btn btn-sm btn-outline float-right blockpy-btn-eval"
          onClick={() => store.getState().setEvalState('input')}
        >
          Evaluate
        </button>
      )}
    </div>
  );
}
