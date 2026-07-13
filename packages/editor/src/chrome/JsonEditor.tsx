/**
 * JSON editor (M4.4; STUDIO EXTENSION, LD-26). Replaces the plain text
 * editor for `.json` tabs: CM6 JSON language + live parse status (a
 * synchronous banner; the CM lint gutter rides jsonParseLinter), plus an
 * optional collapsible tree view of the parsed document. Edits flow
 * through the caller's normal code-change path (VFS/autosave/dirty).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { linter } from '@codemirror/lint';
import { json, jsonParseLinter } from '@codemirror/lang-json';

export interface JsonEditorProps {
  value: string;
  readOnly?: boolean;
  onChange(next: string): void;
  /** "Raw text" escape hatch — the caller swaps in the text editor. */
  onRawView(): void;
}

/** Parse status shown in the banner (independent of the async CM lint). */
function parseStatus(text: string): { ok: boolean; message: string } {
  try {
    JSON.parse(text);
    return { ok: true, message: 'Valid JSON' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function JsonTree({ value, name }: { value: unknown; name?: string }) {
  const label = name === undefined ? '' : `${name}: `;
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    const entries = Array.isArray(value)
      ? value.map((item, index) => [String(index), item] as const)
      : Object.entries(value as Record<string, unknown>);
    const summary = Array.isArray(value)
      ? `${label}[${entries.length}]`
      : `${label}{${entries.length}}`;
    return (
      <details open className="blockpy-json-tree-node">
        <summary>{summary}</summary>
        <ul>
          {entries.map(([key, item]) => (
            <li key={key}>
              <JsonTree value={item} name={key} />
            </li>
          ))}
        </ul>
      </details>
    );
  }
  return (
    <span>
      {label}
      <code>{JSON.stringify(value)}</code>
    </span>
  );
}

export function JsonEditor({ value, readOnly, onChange, onRawView }: JsonEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;
  const [treeView, setTreeView] = useState(false);
  const status = useMemo(() => parseStatus(value), [value]);
  const parsed = useMemo(
    () => (status.ok ? (JSON.parse(value) as unknown) : undefined),
    [status.ok, value],
  );

  useEffect(() => {
    const view = new EditorView({
      parent: mountRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          foldGutter(),
          bracketMatching(),
          json(),
          linter(jsonParseLinter()),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly ?? false)),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              latestOnChange.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount-once: external value changes sync through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt external writes (file switch happens via remount/key upstream).
  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly ?? false)),
    });
  }, [readOnly]);

  return (
    <div className="blockpy-json-editor">
      <div className="blockpy-json-toolbar">
        <span
          className={
            'blockpy-json-status badge ' + (status.ok ? 'label-no-errors' : 'label-syntax-error')
          }
        >
          {status.ok ? 'Valid JSON' : 'Invalid JSON'}
        </span>
        {!status.ok && <span className="blockpy-json-status-detail">{status.message}</span>}
        <button
          type="button"
          className={
            'btn btn-sm btn-outline-secondary blockpy-json-tree-toggle' +
            (treeView ? ' active' : '')
          }
          disabled={!status.ok}
          aria-pressed={treeView}
          onClick={() => setTreeView((current) => !current)}
        >
          Tree View
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary blockpy-json-raw"
          title="Edit the file as raw text"
          onClick={onRawView}
        >
          Raw Text
        </button>
      </div>
      <div
        ref={mountRef}
        className="blockpy-json-code"
        style={{ display: treeView && status.ok ? 'none' : undefined }}
      />
      {treeView && status.ok && (
        <div className="blockpy-json-tree">
          <JsonTree value={parsed} />
        </div>
      )}
    </div>
  );
}
