/**
 * React wrapper around the imperative `DualEditor` (the BlockMirror port).
 * The editor owns its DOM; React owns the mount point and prop plumbing.
 *
 * Construction-time configuration (toolbox, height, renderer, …) is captured
 * on first render — remounting is the way to change it, matching how legacy
 * BlockPy rebuilt BlockMirror. `mode`, `code`, and `readOnly` are live props.
 */
import { useEffect, useRef } from 'react';
import {
  DualEditor,
  type DualEditorConfiguration,
  type DualEditorMode,
} from '../dual/dual-editor';

export interface DualEditorViewProps
  extends Omit<DualEditorConfiguration, 'container' | 'viewMode' | 'readOnly'> {
  /** Current code; pushed into the editor quietly when it differs. */
  code?: string;
  /** Fired on every code change (user edit in either half, or programmatic). */
  onCodeChange?: (code: string) => void;
  mode?: DualEditorMode;
  readOnly?: boolean;
  className?: string;
  /** Receive the imperative editor instance (highlights, refresh, …). */
  editorRef?: (editor: DualEditor | null) => void;
}

export function DualEditorView(props: DualEditorViewProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const editor = useRef<DualEditor | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;

  useEffect(() => {
    const initial = latestProps.current;
    const instance = new DualEditor({
      container: mountRef.current!,
      viewMode: initial.mode ?? 'split',
      readOnly: initial.readOnly ?? false,
      blocklyMediaPath: initial.blocklyMediaPath,
      run: initial.run,
      height: initial.height,
      blockDelay: initial.blockDelay,
      toolbox: initial.toolbox,
      renderer: initial.renderer,
      imageMode: initial.imageMode,
      imageDetection: initial.imageDetection,
      indentSidebar: initial.indentSidebar,
    });
    editor.current = instance;
    if (initial.code) instance.setCode(initial.code);
    instance.addChangeListener((event) => {
      latestProps.current.onCodeChange?.(event.value);
    });
    initial.editorRef?.(instance);
    return () => {
      latestProps.current.editorRef?.(null);
      instance.dispose();
      editor.current = null;
    };
    // Construction-time config: first render only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      editor.current &&
      props.code !== undefined &&
      props.code !== editor.current.getCode()
    ) {
      editor.current.setCode(props.code);
    }
  }, [props.code]);

  useEffect(() => {
    if (editor.current && props.mode && editor.current.getMode() !== props.mode) {
      editor.current.setMode(props.mode);
    }
  }, [props.mode]);

  useEffect(() => {
    if (editor.current && props.readOnly !== undefined) {
      editor.current.setReadOnly(props.readOnly);
    }
  }, [props.readOnly]);

  return <div ref={mountRef} className={props.className} />;
}
