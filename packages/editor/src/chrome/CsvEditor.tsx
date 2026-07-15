/**
 * CSV grid editor (M4.4; STUDIO EXTENSION, LD-26). Replaces the text
 * editor for `.csv` tabs when the content parses: header-row toggle,
 * add/remove rows/columns, cell editing. Every edit serializes back
 * through the caller's normal code-change path, so VFS writes, autosave,
 * and dirty tracking just work. `&`-space files render read-only (D3-A).
 */
import { useState } from 'react';
import { parseCsv, serializeCsv } from './csv';
import { Icon } from './icons';

export interface CsvEditorProps {
  value: string;
  readOnly?: boolean;
  onChange(next: string): void;
  /** "Raw text" escape hatch - the caller swaps in the text editor. */
  onRawView(): void;
}

export function CsvEditor({ value, readOnly, onChange, onRawView }: CsvEditorProps) {
  // The caller guarantees parseability at dispatch; a mid-session
  // regression (external write) degrades gracefully to the raw notice.
  const rows = parseCsv(value);
  const [headerRow, setHeaderRow] = useState(true);
  if (rows === null) {
    return (
      <div className="blockpy-csv-editor">
        <p>
          This file no longer parses as CSV.{' '}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRawView}>
            Edit as text
          </button>
        </p>
      </div>
    );
  }

  const update = (mutate: (next: string[][]) => void) => {
    const next = rows.map((row) => [...row]);
    mutate(next);
    onChange(serializeCsv(next));
  };
  const width = rows[0]?.length ?? 1;

  return (
    <div className="blockpy-csv-editor">
      <div className="blockpy-csv-toolbar">
        <label className="blockpy-csv-header-toggle">
          <input
            type="checkbox"
            checked={headerRow}
            onChange={(event) => setHeaderRow(event.target.checked)}
          />{' '}
          First row is a header
        </label>
        {!readOnly && (
          <>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary blockpy-csv-add-row"
              onClick={() => update((next) => next.push(Array<string>(width).fill('')))}
            >
              Add Row
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary blockpy-csv-add-column"
              onClick={() => update((next) => next.forEach((row) => row.push('')))}
            >
              Add Column
            </button>
          </>
        )}
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary blockpy-csv-raw"
          title="Edit the file as raw text"
          onClick={onRawView}
        >
          Raw Text
        </button>
      </div>
      <div className="blockpy-csv-grid-wrap">
        <table className="blockpy-csv-grid">
          {headerRow && rows.length > 0 && (
            <thead>
              <tr>
                {rows[0]!.map((cell, columnIndex) => (
                  <th key={columnIndex}>
                    <input
                      aria-label={`Header ${columnIndex + 1}`}
                      value={cell}
                      disabled={readOnly}
                      onChange={(event) =>
                        update((next) => {
                          next[0]![columnIndex] = event.target.value;
                        })
                      }
                    />
                  </th>
                ))}
                {!readOnly && <th className="blockpy-csv-row-actions" />}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.slice(headerRow ? 1 : 0).map((row, visibleIndex) => {
              const rowIndex = visibleIndex + (headerRow ? 1 : 0);
              return (
                <tr key={rowIndex}>
                  {row.map((cell, columnIndex) => (
                    <td key={columnIndex}>
                      <input
                        aria-label={`Row ${rowIndex + 1} column ${columnIndex + 1}`}
                        value={cell}
                        disabled={readOnly}
                        onChange={(event) =>
                          update((next) => {
                            next[rowIndex]![columnIndex] = event.target.value;
                          })
                        }
                      />
                    </td>
                  ))}
                  {!readOnly && (
                    <td className="blockpy-csv-row-actions">
                      <button
                        type="button"
                        className="blockpy-csv-delete-row"
                        title="Delete this row"
                        onClick={() => update((next) => next.splice(rowIndex, 1))}
                      >
                        <Icon name="delete" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && width > 1 && (
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary blockpy-csv-delete-column"
          title="Delete the last column"
          onClick={() => update((next) => next.forEach((row) => row.pop()))}
        >
          Delete Last Column
        </button>
      )}
    </div>
  );
}
