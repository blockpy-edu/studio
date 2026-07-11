/**
 * Console panel — Row 2 left (A8 §1: `.blockpy-panel.blockpy-console`,
 * printer area 200px/resize-vertical with per-line dashed separators).
 */
import { useEditorChromeStore } from './store';

export interface ConsoleProps {
  /** "col-md-6" beside feedback, "col-md-12" alone (legacy ui.console.size). */
  size?: string;
}

export function Console({ size = 'col-md-6' }: ConsoleProps) {
  const entries = useEditorChromeStore((state) => state.console);
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
    </div>
  );
}
