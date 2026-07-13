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
 */
import type { ReactNode } from 'react';

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
  if (!props.visible) return null;
  return (
    <div
      className="blockpy-dialog modal"
      role="dialog"
      aria-label="Dialog"
      aria-modal="true"
      style={{ display: 'block' }}
    >
      <div className="modal-dialog modal-lg" role="document">
        <div className="modal-content" role="region" aria-label="Dialog content">
          <div className="modal-header">
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
