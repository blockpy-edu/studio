/**
 * Imperative bridge between the host page and the mounted React app.
 * Legacy pages drive the editor synchronously right after construction
 * (`new blockpy.BlockPy(...)` then `editor.loadAssignmentData_(...)` in the
 * same tick — editor.html:263-348), but React commits asynchronously, so
 * the handle queues calls until the App registers its actions and replays
 * them in order.
 */
import type { LegacyAssignmentPayload } from './boot-config';

/**
 * Non-JSON wiring a host (the legacy shim, tests) can hand the app —
 * callbacks and injectables that have no place in the BootConfig block.
 */
export interface MountExtras {
  /** Legacy `callback.success` / navigation markCorrect (§14.3, §15.3). */
  markCorrect?: (assignmentId: number) => void;
  /** Transport fetch override (tests); defaults to window.fetch. */
  fetch?: typeof fetch;
}

/** What the App registers once it has rendered. */
export interface StudioActions {
  loadAssignment(assignmentId: number): Promise<void>;
  loadAssignmentData(payload: LegacyAssignmentPayload): void;
  requestPasscode(): void;
}

export class StudioHandle {
  private actions: StudioActions | null = null;
  private pending: Array<(actions: StudioActions) => void> = [];

  constructor(
    private rootElement: HTMLElement,
    private unmountFn: () => void,
  ) {}

  /** Called by the App (mount effect); null on unmount. */
  _registerActions(actions: StudioActions | null): void {
    this.actions = actions;
    if (actions) {
      const queued = this.pending;
      this.pending = [];
      for (const call of queued) call(actions);
    }
  }

  private withActions(call: (actions: StudioActions) => void): void {
    if (this.actions) {
      call(this.actions);
    } else {
      this.pending.push(call);
    }
  }

  loadAssignment(assignmentId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.withActions((actions) => {
        actions.loadAssignment(assignmentId).then(resolve, reject);
      });
    });
  }

  loadAssignmentData(payload: LegacyAssignmentPayload): void {
    this.withActions((actions) => actions.loadAssignmentData(payload));
  }

  requestPasscode(): void {
    this.withActions((actions) => actions.requestPasscode());
  }

  /** Legacy BlockPy.hide()/show() = jQuery toggle of the container
   *  (blockpy.js:1263-1270); the root element is the container. */
  hide(): void {
    this.rootElement.style.display = 'none';
  }

  show(): void {
    this.rootElement.style.display = '';
  }

  unmount(): void {
    this.unmountFn();
  }
}
