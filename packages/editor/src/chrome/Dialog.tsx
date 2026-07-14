/**
 * Modal dialog — port of the legacy `DIALOG_HTML` Bootstrap modal
 * (dialog.js:3-26): `.blockpy-dialog.modal > .modal-dialog.modal-lg >
 * .modal-content` with header (title + ×), body, and a footer holding
 * btn-white "Close" and btn-success "Okay". Legacy reuses a single jQuery
 * modal instance; here each caller renders one controlled component.
 *
 * `show`-style dialogs (message only) hide the Okay button, exactly like
 * `BlockPyDialog.show` (dialog.js:70-80); `confirm`-style dialogs pass
 * `onOkay` and get both buttons (`BlockPyDialog.confirm`).
 *
 * Draggable by the title bar (M7.6): legacy used jQuery-UI
 * `draggable({handle: ".modal-title"})` (dialog.js:78-80); this port drags
 * via pointer events on the header, translating `.modal-dialog`, and
 * re-centers on every fresh open.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface DialogProps {
  title: string;
  visible: boolean;
  onClose(): void;
  /** When set, the Okay (confirm) button renders and fires this. */
  onOkay?(): void;
  /** Okay button label (legacy confirm lets callers override, e.g. "Save"). */
  okayLabel?: string;
  children: ReactNode;
}

export function Dialog(props: DialogProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(
    null,
  );

  // Fresh opens re-center (legacy re-showed the shared modal centered).
  useEffect(() => {
    if (props.visible) setOffset({ x: 0, y: 0 });
  }, [props.visible]);

  if (!props.visible) return null;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // The × button stays a plain click, not a drag handle.
    if ((event.target as HTMLElement).closest('button')) return;
    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      x: offset.x,
      y: offset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    setOffset({
      x: start.x + event.clientX - start.pointerX,
      y: start.y + event.clientY - start.pointerY,
    });
  };
  const endDrag = () => {
    dragStart.current = null;
  };

  return (
    <div
      className="blockpy-dialog modal"
      role="dialog"
      aria-label="Dialog"
      aria-modal="true"
      style={{ display: 'block' }}
    >
      <div
        className="modal-dialog modal-lg"
        role="document"
        style={
          offset.x !== 0 || offset.y !== 0
            ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
            : undefined
        }
      >
        <div className="modal-content" role="region" aria-label="Dialog content">
          <div
            className="modal-header"
            style={{ cursor: 'move', touchAction: 'none' }}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <h4 className="modal-title">{props.title}</h4>
            <button type="button" className="close" aria-label="Close" onClick={props.onClose}>
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div className="modal-body" style={{ maxWidth: '100%', maxHeight: 400 }}>
            {props.children}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-white modal-close" onClick={props.onClose}>
              Close
            </button>
            {props.onOkay && (
              <button type="button" className="btn btn-success modal-okay" onClick={props.onOkay}>
                {props.okayLabel ?? 'Okay'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
