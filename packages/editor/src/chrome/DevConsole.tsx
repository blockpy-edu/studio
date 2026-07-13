/**
 * Dev console — STUDIO EXTENSION (no legacy analog; requirement added
 * 2026-07-10). A secondary console visible only in instructor view, so the
 * student console stays clean:
 *   - system messages (engine boot, grader lifecycle, respawns), which
 *     legacy had nowhere to put and Studio previously mixed into the
 *     student console;
 *   - instructor-code output (Pedal `on_run` stdout/stderr), which legacy
 *     exposed only through the quick-menu "instructor stdout" dialog.
 * It shares the console slot (Row 2 left): a header toggle swaps between
 * the student console and this one, each side badging the number of entries
 * the hidden console received. Entries accumulate across runs (unlike the
 * student printer) so boot-time messages survive; Clear empties it.
 */
import { useEffect, useRef } from 'react';
import { ConsoleToggleButton } from './Console';
import { useEditorChromeStore } from './store';

export interface DevConsoleProps {
  /** Same slot as the student console (legacy ui.console.size). */
  size?: string;
  /** Swap the slot back to the student console. */
  onShowStudent?: () => void;
}

export function DevConsole({ size = 'col-md-6', onShowStudent }: DevConsoleProps) {
  const entries = useEditorChromeStore((state) => state.devConsole);
  const consoleUnseen = useEditorChromeStore((state) => state.consoleUnseen);
  const clearDevConsole = useEditorChromeStore((state) => state.clearDevConsole);
  const printerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const printer = printerRef.current;
    if (printer) printer.scrollTop = printer.scrollHeight;
  }, [entries]);

  return (
    <div
      className={`blockpy-panel blockpy-dev-console ${size}`}
      role="region"
      aria-label="Dev Console"
    >
      <div className="blockpy-panel-header">
        <strong>Dev Console:</strong>
        {onShowStudent && (
          <ConsoleToggleButton label="Console" unseen={consoleUnseen} onClick={onShowStudent} />
        )}
        <button
          type="button"
          className={`btn btn-sm btn-outline-secondary${onShowStudent ? '' : ' blockpy-panel-header-action'}`}
          onClick={clearDevConsole}
        >
          Clear
        </button>
      </div>
      <div ref={printerRef} className="blockpy-printer blockpy-dev-printer" role="log">
        {entries.map((entry, i) => (
          <div key={i} className={`blockpy-printer-output blockpy-printer-${entry.kind}`}>
            {entry.kind === 'stderr' ? (
              // Grader tracebacks land here — same <pre> treatment as the
              // student console (M3.2).
              <pre className="blockpy-printer-traceback">{entry.text}</pre>
            ) : (
              entry.text
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
