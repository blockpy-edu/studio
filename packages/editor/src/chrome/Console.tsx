/**
 * Console panel - Row 2 left (A8 §1: `.blockpy-panel.blockpy-console`,
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
  /** Instructor-only: swap the slot to the dev console (Studio extension). */
  onShowDev?: () => void;
}

/**
 * Header button that swaps the console slot, with a count badge for entries
 * the other console received while hidden.
 */
export function ConsoleToggleButton(props: { label: string; unseen: number; onClick(): void }) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-secondary blockpy-panel-header-action blockpy-console-toggle"
      onClick={props.onClick}
    >
      {props.label}
      {props.unseen > 0 && (
        <span className="badge badge-pill blockpy-console-toggle-badge">{props.unseen}</span>
      )}
    </button>
  );
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

/** A frozen (already-answered) input() line - legacy ConsoleLineInput after
 *  submit: prompt text, then the disabled textbox + Enter button. */
function FrozenInputLine({ prompt, value }: { prompt: string; value: string }) {
  return (
    <div className="blockpy-printer-output">
      {prompt !== '' && (
        <>
          <samp>{prompt}</samp>
          <br />
        </>
      )}
      <div className="blockpy-console-input">
        <input type="text" value={value} disabled readOnly />
        <button type="button" disabled>
          Enter
        </button>
      </div>
    </div>
  );
}

function entryBody(entry: ConsoleEntry, renderImages: boolean) {
  if (entry.kind === 'eval') {
    return <FrozenEvalLine expression={entry.text} />;
  }
  if (entry.kind === 'input-prompt') {
    return <FrozenInputLine prompt={entry.text} value={entry.value ?? ''} />;
  }
  if (entry.kind === 'image') {
    // Legacy quick-menu Toggle Images: off = the image stays "as text code".
    return (
      <div className="blockpy-printer-output blockpy-console-image-output">
        {renderImages ? (
          <img src={entry.text} alt="Plot output" />
        ) : (
          <code>{entry.text.slice(0, 64)}…</code>
        )}
      </div>
    );
  }
  return (
    <div className={`blockpy-printer-output blockpy-printer-${entry.kind}`}>
      {entry.kind === 'stderr' ? (
        // Tracebacks are multi-line and indentation-significant (M3.2):
        // <pre> + mono via .blockpy-printer-traceback, not a wrapping span.
        <pre className="blockpy-printer-traceback">{entry.text}</pre>
      ) : entry.kind === 'value' ? (
        <code>{entry.text}</code>
      ) : (
        entry.text
      )}
    </div>
  );
}

export function Console({ size = 'col-md-6', onEvaluate, onShowDev }: ConsoleProps) {
  const entries = useEditorChromeStore((state) => state.console);
  const evalState = useEditorChromeStore((state) => state.evalState);
  const devUnseen = useEditorChromeStore((state) => state.devUnseen);
  const renderImages = useEditorChromeStore((state) => state.renderImages);
  const pendingInput = useEditorChromeStore((state) => state.pendingInput);
  // LD-37: one-time engine/wheel download status shown IN the console so
  // the first Run doesn't read as a hang.
  const engineBooting = useEditorChromeStore((state) => state.engineBooting);
  const [expression, setExpression] = useState('');
  const [inputValue, setInputValue] = useState('');
  const printerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stdinRef = useRef<HTMLInputElement>(null);
  const store = useEditorChromeStore;

  const evalVisible = onEvaluate !== undefined && evalState !== 'hidden';

  // Legacy scrollToBottom on new content.
  useEffect(() => {
    const printer = printerRef.current;
    if (printer) printer.scrollTop = printer.scrollHeight;
  }, [entries, evalState, pendingInput, engineBooting]);

  // Legacy focuses the input as soon as the evaluate line renders.
  useEffect(() => {
    if (evalState === 'input') inputRef.current?.focus();
  }, [evalState]);

  // The input() line grabs focus when Python suspends on it (§6.5).
  useEffect(() => {
    if (pendingInput !== null) {
      setInputValue('');
      stdinRef.current?.focus();
    }
  }, [pendingInput]);

  const submitInput = () => {
    // Empty submissions are valid input() results (just pressing Enter).
    store.getState().submitConsoleInput(inputValue);
    setInputValue('');
  };

  const submit = () => {
    const trimmed = expression.trim();
    if (trimmed === '' || !onEvaluate) return;
    setExpression('');
    // The submitted line freezes into the history (legacy disables it).
    store.getState().appendConsole({ kind: 'eval', text: trimmed });
    onEvaluate(trimmed);
  };

  return (
    <div className={`blockpy-panel blockpy-console ${size}`} role="region" aria-label="Console">
      <div className="blockpy-panel-header">
        <strong>Console:</strong>
        {onShowDev && (
          <ConsoleToggleButton label="Dev Console" unseen={devUnseen} onClick={onShowDev} />
        )}
      </div>
      <div ref={printerRef} className="blockpy-printer blockpy-printer-default" role="log">
        {entries.map((entry, i) => (
          <div key={i}>{entryBody(entry, renderImages)}</div>
        ))}
        {engineBooting !== null && (
          <div className="blockpy-printer-output blockpy-console-booting" role="status">
            <span className="blockpy-loading-spinner" aria-hidden="true" />
            <span>{engineBooting}</span>
          </div>
        )}
        {pendingInput !== null && (
          <div className="blockpy-printer-output blockpy-console-input-live">
            {pendingInput !== '' && (
              <>
                <samp>{pendingInput}</samp>
                <br />
              </>
            )}
            <div className="blockpy-console-input">
              <input
                ref={stdinRef}
                type="text"
                aria-label={pendingInput === '' ? 'Program input' : pendingInput}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitInput();
                }}
              />
              <button type="button" onClick={submitInput}>
                Enter
              </button>
            </div>
          </div>
        )}
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
