/**
 * Dev console — STUDIO EXTENSION (no legacy analog; requirement added
 * 2026-07-10). A secondary console visible only in instructor view, so the
 * student console stays clean:
 *   - system messages (engine boot, grader lifecycle, respawns), which
 *     legacy had nowhere to put and Studio previously mixed into the
 *     student console;
 *   - instructor-code output (Pedal `on_run` stdout/stderr), which legacy
 *     exposed only through the quick-menu "instructor stdout" dialog.
 * Entries accumulate across runs (unlike the student printer) so boot-time
 * messages survive; Clear empties it.
 */
import { useEffect, useRef } from 'react';
import { useEditorChromeStore } from './store';

export function DevConsole() {
  const entries = useEditorChromeStore((state) => state.devConsole);
  const clearDevConsole = useEditorChromeStore(
    (state) => state.clearDevConsole,
  );
  const printerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const printer = printerRef.current;
    if (printer) printer.scrollTop = printer.scrollHeight;
  }, [entries]);

  return (
    <div
      className="blockpy-panel blockpy-dev-console col-md-12"
      role="region"
      aria-label="Dev Console"
    >
      <div className="clearfix">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary float-right"
          onClick={clearDevConsole}
        >
          Clear
        </button>
        <strong>Dev Console:</strong>
      </div>
      <div ref={printerRef} className="blockpy-printer blockpy-dev-printer" role="log">
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
    </div>
  );
}
