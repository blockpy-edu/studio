/**
 * window.blockpy.BlockPy facade (spec §15.1): the constructor an UNMODIFIED
 * blockpy-server editor.html drives (templates/blockpy/editor.html:263-348).
 * Accepts the legacy option bag, assembles a BootConfig, and mounts the
 * React app at `attachment.point`; the public methods the template (and
 * course content in the wild) calls are preserved.
 */
import {
  mountConfig,
  settingsFromSearch,
  type BootConfig,
  type LegacyAssignmentPayload,
  type LegacyUrlMap,
  type MountExtras,
  type StudioHandle,
} from '@blockpy/app';

export type BlockPyOptions = Record<string, unknown>;

/**
 * jQuery-Deferred-compatible thenable (§15.1): editor.html only ever calls
 * `.done()` (line 325), but content in the wild also chains `.fail()` /
 * `.always()`, so the whole read surface is covered. Methods return the
 * wrapper for chaining, like a real Deferred.
 */
export interface LegacyDeferred<T> {
  done(callback: (value: T) => void): LegacyDeferred<T>;
  fail(callback: (error: unknown) => void): LegacyDeferred<T>;
  always(callback: () => void): LegacyDeferred<T>;
  then<U>(onDone?: (value: T) => U, onFail?: (error: unknown) => U): Promise<U>;
  catch<U>(onFail: (error: unknown) => U): Promise<U>;
}

export function asLegacyDeferred<T>(promise: Promise<T>): LegacyDeferred<T> {
  const deferred: LegacyDeferred<T> = {
    done(callback) {
      promise.then(callback, () => undefined);
      return deferred;
    },
    fail(callback) {
      promise.then(undefined, callback);
      return deferred;
    },
    always(callback) {
      promise.then(callback, callback);
      return deferred;
    },
    then: (onDone, onFail) => promise.then(onDone, onFail),
    catch: (onFail) => promise.then(undefined, onFail),
  };
  return deferred;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** The option-bag keys the facade consumes structurally (editor.html). */
const KNOWN_KEYS = new Set([
  'blockly.path',
  'attachment.point',
  'urls',
  'user.id',
  'user.name',
  'user.role',
  'user.course_id',
  'user.group_id',
  'access_token',
  'display.instructor',
  'display.read_only',
  'callback.success',
]);

/**
 * Legacy option bag → BootConfig (§15.1). Every key editor.html passes maps
 * structurally; anything else (the Jinja `settings-*` loop lands here as
 * raw strings, editor.html:287-291) goes into `settings`, then the page
 * URL's own `settings-*` params apply LAST (§15.2).
 */
export function optionsToBootConfig(options: BlockPyOptions, search = ''): BootConfig {
  const urls = (options['urls'] ?? {}) as LegacyUrlMap;
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(options)) {
    if (KNOWN_KEYS.has(key) || value === undefined) continue;
    // Raw-string semantics (A4): the legacy client coerces per key with
    // `"" + value === "true"`, which JSON.stringify round-trips for
    // booleans/numbers exactly.
    settings[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  Object.assign(settings, settingsFromSearch(search));
  const role = str(options['user.role']) ?? 'anonymous';
  const blocklyMedia = str(options['blockly.path']) ?? '';
  return {
    urls,
    user: {
      id: num(options['user.id']),
      name: str(options['user.name']),
      role,
      courseId: num(options['user.course_id']),
    },
    accessToken: str(options['access_token']),
    assignment: {
      currentAssignmentId: null,
      assignmentGroupId: num(options['user.group_id']),
      typeIndex: {
        quiz: [],
        reading: [],
        textbook: [],
        java: [],
        typescript: [],
        explain: [],
        blockpy: [],
      },
    },
    display: {
      instructor: options['display.instructor'] === true,
      readOnly: options['display.read_only'] === true,
      embed: false,
    },
    passcodeProtected: false,
    sessionStartTime: null,
    paths: {
      blocklyMedia,
      emojiProxy: blocklyMedia ? blocklyMedia.replace(/blockly\/media\/?$/, 'images/emoji/') : '',
      pyodideIndexURL: '',
    },
    settings,
    corgisUrl: str(urls.importDatasets) ?? '',
  };
}

/** Injectables for tests; production uses the real mount + window. */
export interface BlockPyFacadeDeps {
  mount?: typeof mountConfig;
  globals?: Record<string, unknown>;
  document?: Document;
  search?: string;
}

export class BlockPy {
  readonly config: BootConfig;
  readonly handle: StudioHandle;
  /** Legacy `callback.success` — fires on markCorrect (§14.3, §15.3). */
  readonly successCallback: ((assignmentId: number) => void) | undefined;

  constructor(options: BlockPyOptions, deps: BlockPyFacadeDeps = {}) {
    const doc = deps.document ?? document;
    const globals = deps.globals ?? (globalThis as unknown as Record<string, unknown>);
    const search =
      deps.search ?? (typeof location === 'undefined' ? '' : location.search);
    const selector = str(options['attachment.point']) ?? '#blockpy-div';
    const rootElement = doc.querySelector(selector);
    if (!(rootElement instanceof HTMLElement)) {
      throw new Error(`BlockPy: no element matches attachment.point "${selector}"`);
    }
    this.config = optionsToBootConfig(options, search);
    const success = options['callback.success'];
    this.successCallback =
      typeof success === 'function' ? (success as (id: number) => void) : undefined;
    const extras: MountExtras = { markCorrect: this.successCallback };
    this.handle = (deps.mount ?? mountConfig)(rootElement, this.config, extras, search);
    // editor.html:296 assigns this itself; keep both paths pointed here.
    globals['$MAIN_BLOCKPY_EDITOR'] = this;
  }

  /** jQuery-Deferred-compatible (editor.html:323-330 chains `.done()`). */
  loadAssignment(assignmentId: number): LegacyDeferred<void> {
    return asLegacyDeferred(this.handle.loadAssignment(Number(assignmentId)));
  }

  loadAssignmentData_(payload: LegacyAssignmentPayload): void {
    this.handle.loadAssignmentData(payload);
  }

  hide(): void {
    this.handle.hide();
  }

  show(): void {
    this.handle.show();
  }

  requestPasscode(): void {
    this.handle.requestPasscode();
  }
}

/**
 * Publish the legacy globals (§15.1): `window.blockpy.BlockPy`. The iife
 * bundle calls this at load so an unmodified editor.html's
 * `new blockpy.BlockPy({...})` finds the facade.
 */
export function installLegacyShim(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
  target['blockpy'] = { BlockPy };
}
