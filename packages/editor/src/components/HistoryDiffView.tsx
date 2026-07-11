/**
 * History diff — the editor pane while history mode is on. Studio's upgrade
 * over legacy (which swapped the read-only editor contents wholesale): a CM6
 * side-by-side merge view, selected historical version on the left, current
 * code on the right, both read-only (the M1.4 "merge view for history"
 * commitment).
 */
import { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';

export interface HistoryDiffViewProps {
  /** The selected historical version (left side). */
  original: string;
  /** The current working code (right side). */
  current: string;
  height?: number;
}

function side(doc: string) {
  return {
    doc,
    extensions: [
      lineNumbers(),
      python(),
      syntaxHighlighting(defaultHighlightStyle),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
    ],
  };
}

export function HistoryDiffView(props: HistoryDiffViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { original, current } = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new MergeView({
      a: side(original),
      b: side(current),
      parent: host,
      highlightChanges: true,
      gutter: true,
    });
    return () => view.destroy();
  }, [original, current]);

  return (
    <div
      ref={hostRef}
      className="blockpy-history-diff"
      style={{ height: props.height ?? 400, overflow: 'auto' }}
    />
  );
}
