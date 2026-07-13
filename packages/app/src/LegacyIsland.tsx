/**
 * Kettle/Explain legacy islands (spec §17, M2.5) — these assignment types
 * stay on the OLD frontend bundle: a sandboxed Knockout island renders the
 * legacy custom element (`<kettle params=…>` / `<explain params=…>`,
 * editor.html:168-185) when the page provides `window.ko` with the
 * component registered (shim-mode pages load the bundle via
 * editor_includes.html; app-owned deployments may include it for flagged
 * courses). Without the bundle the slot degrades to a plain notice.
 *
 * The legacy components reach into `$MAIN_BLOCKPY_EDITOR.components.server`
 * (createServerData/_postBlocking/_postRetry/altLogEntry, kettle.ts:1003,
 * explain.ts:274) and `$MAIN_BLOCKPY_EDITOR.model.display.passcode()` — on
 * pages where Studio owns that global (the shim facade) those paths don't
 * exist, so the island grafts a compatibility bridge delegating to
 * `@blockpy/api` before binding.
 */
import { useEffect, useRef, useState } from 'react';
import type { WirePayload } from '@blockpy/api';

/** The BlockPyServer sub-surface the island components drive. */
export interface LegacyServerBridge {
  /** assignment_interface.ts:86 assigns the component's logEvent here. */
  altLogEntry: unknown;
  createServerData(): Record<string, unknown>;
  _postBlocking(
    name: string,
    data: Record<string, unknown>,
    attempts: number,
    onSuccess?: (response: unknown) => void,
    onFailure?: (error: unknown, textStatus: string, errorThrown: unknown) => void,
  ): void;
  _postRetry(
    data: Record<string, unknown>,
    name: string,
    delay: number,
    callback?: (response: unknown) => void,
  ): void;
}

export interface LegacyServerBridgeOptions {
  /** ApiClient.buildPayload — the eleven-field base context (§14.1). */
  buildPayload: () => WirePayload;
  /** Transport post (retry ladder included) to a NAMED endpoint url. */
  post: (endpointName: string, payload: Record<string, unknown>) => Promise<unknown>;
  /** Legacy FAIL_DELAY between _postBlocking attempts (server.js). */
  failDelay?: number;
}

export function createLegacyServerBridge(options: LegacyServerBridgeOptions): LegacyServerBridge {
  const failDelay = options.failDelay ?? 1000;
  const bridge: LegacyServerBridge = {
    altLogEntry: null,
    createServerData: () => ({ ...options.buildPayload() }),
    _postBlocking(name, data, attempts, onSuccess, onFailure) {
      const attempt = (remaining: number) => {
        options.post(name, data).then(
          (response) => onSuccess?.(response),
          (error) => {
            if (remaining > 1) {
              setTimeout(() => attempt(remaining - 1), failDelay);
            } else {
              onFailure?.(error, 'error', error);
            }
          },
        );
      };
      attempt(Math.max(1, attempts));
    },
    _postRetry(data, name, _delay, callback) {
      options.post(name, data).then(
        (response) => callback?.(response),
        () => undefined,
      );
    },
  };
  return bridge;
}

/** Graft `components.server` + `model.display.passcode` onto whatever owns
 *  `$MAIN_BLOCKPY_EDITOR` (the shim facade), or publish a stub owner —
 *  never overwriting a REAL editor's own surfaces. */
export function ensureEditorBridge(
  globals: Record<string, unknown>,
  bridge: LegacyServerBridge,
  passcode: () => string,
): void {
  const owner = (globals['$MAIN_BLOCKPY_EDITOR'] ?? {}) as Record<string, unknown>;
  if (owner['components'] === undefined) {
    owner['components'] = { server: bridge };
  }
  if (owner['model'] === undefined) {
    owner['model'] = { display: { passcode } };
  }
  globals['$MAIN_BLOCKPY_EDITOR'] = owner;
}

export interface LegacyIslandProps {
  component: 'kettle' | 'explain';
  assignmentId: number;
  courseId: number | null;
  assignmentGroupId: number | null;
  isInstructor: boolean;
  markCorrect: (assignmentId: number) => void;
  user: Record<string, unknown>;
  /** Installed onto $MAIN_BLOCKPY_EDITOR before binding (when provided). */
  serverBridge?: LegacyServerBridge;
  passcode?: () => string;
  /** Injectable for tests; defaults to window. */
  globals?: Record<string, unknown>;
}

interface KnockoutLike {
  observable: (value: unknown) => unknown;
  applyBindings: (model: unknown, node: Node) => void;
  cleanNode?: (node: Node) => void;
  components?: { isRegistered?: (name: string) => boolean };
}

export function LegacyIsland(props: LegacyIslandProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const current = propsRef.current;
    const globals = current.globals ?? (window as unknown as Record<string, unknown>);
    const host = hostRef.current;
    if (!host) return;
    const ko = globals['ko'] as KnockoutLike | undefined;
    const frontend = globals['frontend'] as
      | { Server?: new (courseId: number | null, ids: unknown, data: unknown) => unknown }
      | undefined;
    if (
      !ko ||
      typeof ko.applyBindings !== 'function' ||
      ko.components?.isRegistered?.(current.component) !== true ||
      typeof frontend?.Server !== 'function'
    ) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    if (current.serverBridge) {
      ensureEditorBridge(globals, current.serverBridge, current.passcode ?? (() => ''));
    }
    // The mainModel slice the template binds (editor.html:242-257).
    const model = {
      server: new frontend.Server(current.courseId, {}, { users: [current.user], courses: [] }),
      courseId: current.courseId,
      user: current.user,
      isInstructor: current.isInstructor,
      currentAssignmentId: ko.observable(current.assignmentId),
      assignmentGroupId: current.assignmentGroupId,
      markCorrect: current.markCorrect,
    };
    host.innerHTML =
      `<${current.component} params="server: server,` +
      ' courseId: courseId,' +
      ' currentAssignmentId: currentAssignmentId,' +
      ' assignmentGroupId: assignmentGroupId,' +
      ' isInstructor: isInstructor,' +
      ' markCorrect: markCorrect,' +
      ` user: user"></${current.component}>`;
    ko.applyBindings(model, host);
    return () => {
      try {
        ko.cleanNode?.(host);
      } catch {
        // Disposal is best-effort; the island div is discarded anyway.
      }
      host.innerHTML = '';
    };
    // Remount per component/assignment (the host keys the slot anyway).
  }, [props.component, props.assignmentId]);

  return (
    <div className={`blockpy-legacy-island blockpy-legacy-${props.component}`}>
      {/* The ko binding owns this div's subtree; React never renders into
          it, so the two renderers cannot fight over nodes. */}
      <div ref={hostRef} />
      {unavailable && (
        <div className="alert alert-warning blockpy-legacy-island-missing">
          This {props.component === 'kettle' ? 'Kettle (TypeScript)' : 'Explain'} assignment needs
          the legacy BlockPy frontend bundle, which is not loaded on this page. Please contact your
          instructor if you believe this is an error.
        </div>
      )}
    </div>
  );
}
