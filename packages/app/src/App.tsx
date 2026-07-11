import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CodingEditor,
  MinifiedEditor,
  requestPasscode,
  useEditorChromeStore,
  type DualEditor,
  type HistoryEntry,
} from '@blockpy/editor';
import { Vfs } from '@blockpy/vfs';
import {
  ApiClient,
  Transport,
  decodeAssignment,
  decodeSubmission,
  type ApiContext,
  type DecodedAssignment,
  type DecodedSubmission,
  type RawRecord,
} from '@blockpy/api';
import { createEngineRunController } from './engine-adapter';
import { parseAssignmentSettings, vfsFromAssignment } from './assignment-loader';
import { SubmissionSync } from './submission-sync';
import '@blockpy/editor/styles/tokens.css';
import '@blockpy/editor/styles/bootstrap-subset.css';
import '@blockpy/editor/styles/blockpy.css';
import type { BootConfig, LegacyAssignmentPayload } from './boot-config';
import type { MountExtras, StudioActions } from './studio-handle';

interface LoadedAssignment {
  assignment: DecodedAssignment;
  submission: DecodedSubmission | null;
  vfs: Vfs;
}

/** Legacy settings coercion: `"" + value === "true"` (A4). */
const settingBool = (value: unknown): boolean =>
  value === true || String(value).toLowerCase() === 'true';

/**
 * The files legacy autosaves individually through saveFile
 * (createSubscriptions, server.js:123-134). Other files persist through
 * the `#extra_*_files.blockpy` bundles — pending with the uploads work.
 */
const AUTOSAVE_FILES = new Set([
  'answer.py',
  '!on_run.py',
  '!on_eval.py',
  '!on_change.py',
  '!instructions.md',
  '^starting_code.py',
]);

export interface AppProps {
  config: BootConfig;
  extras?: MountExtras;
  /** StudioHandle bridge (mountConfig); calls queue until registration. */
  registerActions?: (actions: StudioActions | null) => void;
}

/**
 * Application shell. Loads assignments through `@blockpy/api` when the
 * BootConfig carries endpoints (M1.6) and falls back to a canned dev
 * harness otherwise, so the editor pipeline stays exercisable offline.
 * AssignmentHost (spec §5.3, type dispatch) replaces the body in
 * Milestone 2.1 — until then the coding editor is the only renderer, which
 * matches its legacy role as the fallback for unknown types.
 */
export function App({ config, extras, registerActions }: AppProps) {
  const { user, assignment, display, paths } = config;
  const [, setCode] = useState('');
  // "View as instructor" (legacy display.instructor). The dev shell always
  // exposes the grader toggle for debugging; real role gating (ui.role
  // .isGrader) arrives with AssignmentHost (M2.1).
  const [instructorView, setInstructorView] = useState(display.instructor);
  // Preview toggle between the full editor and the §8.4 minified variant.
  const [minified, setMinified] = useState(false);
  const [loaded, setLoaded] = useState<LoadedAssignment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Legacy submission.submissionStatus/.correct display state (blockpy.js).
  const [submissionStatus, setSubmissionStatus] = useState('unknown');
  const [correct, setCorrect] = useState(false);
  // §7.4 out-of-date banner: saveFile responded version_change (LD-11).
  const [versionOutdated, setVersionOutdated] = useState(false);
  // Live dual editor — the updateSubmission block-PNG source (§14.3).
  const dualEditorRef = useRef<DualEditor | null>(null);
  const store = useEditorChromeStore;

  // -- server client (spec §14): built once per mount ------------------------
  const api = useMemo(() => {
    if (Object.keys(config.urls).length === 0) return null;
    const context: ApiContext = {
      assignmentId: assignment.currentAssignmentId,
      assignmentGroupId: assignment.assignmentGroupId,
      courseId: user.courseId,
      submissionId: null,
      userId: user.id,
      submissionVersion: 0,
      assignmentVersion: 0,
      passcode: '',
      partId: '',
    };
    // Late-bound so the transport's IP-change hook can log through the
    // client it belongs to (LD-2c: detection is live on every path).
    const holder: { client: ApiClient | null } = { client: null };
    const transport = new Transport({
      accessToken: config.accessToken,
      fetch: extras?.fetch ?? ((url, init) => fetch(url, init)),
      onIpChange: (oldIp, newIp) => {
        void holder.client
          ?.logEvent('X-IP.Change', '', '', JSON.stringify({ old: oldIp, new: newIp }))
          .catch(() => undefined);
      },
    });
    holder.client = new ApiClient({
      urls: config.urls,
      context,
      transport,
      readOnly: () => config.display.readOnly,
    });
    return holder.client;
  }, [config, assignment, user, extras]);

  // Autosave + §14.3 submission lifecycle rides the same client.
  const sync = useMemo(() => {
    if (!api) return null;
    return new SubmissionSync({
      api,
      setStatus: (endpoint, status, message) =>
        store.getState().setServerStatus(endpoint, status, message),
      readOnly: () => config.display.readOnly,
      markCorrect: extras?.markCorrect,
      onVersionChange: () => setVersionOutdated(true),
      getImage: () => dualEditorRef.current?.blockEditor.getPng() ?? Promise.resolve(''),
    });
  }, [api, config.display.readOnly, extras?.markCorrect, store]);

  // -- assignment adoption (legacy loadAssignmentData_, blockpy.js:491) ------
  const adoptAssignmentData = useCallback(
    (data: LegacyAssignmentPayload) => {
      const rawAssignment = data['assignment'];
      if (!rawAssignment || typeof rawAssignment !== 'object') return;
      const decoded = decodeAssignment(rawAssignment as RawRecord);
      const submission =
        data['submission'] && typeof data['submission'] === 'object'
          ? decodeSubmission(data['submission'] as RawRecord)
          : null;
      if (api) {
        // The wire context follows the loaded pair (legacy createServerData
        // reads the live model): every later call carries these ids.
        api.context.assignmentId = decoded.id;
        api.context.assignmentVersion = decoded.version;
        api.context.submissionId = submission?.id ?? null;
        api.context.submissionVersion = submission?.version ?? 0;
      }
      // Monotonic score/correct state starts from the stored submission
      // (loadSubmission, blockpy.js:473-484; wire score is a 0-1 float).
      sync?.seed(submission?.score ?? 0, submission?.correct ?? false);
      setCorrect(submission?.correct ?? false);
      setSubmissionStatus(String(submission?.raw['submission_status'] ?? 'unknown'));
      setVersionOutdated(false);
      setLoaded({ assignment: decoded, submission, vfs: vfsFromAssignment(decoded, submission ?? undefined) });
      setLoadError(null);
    },
    [api, sync],
  );

  const loadAssignment = useCallback(
    async (assignmentId: number) => {
      if (!api?.isEndpointConnected('loadAssignment')) {
        throw new Error('BlockPy Studio: no loadAssignment endpoint configured');
      }
      // Legacy _postBlocking badge lifecycle: active → ready/failed.
      store.getState().setServerStatus('loadAssignment', 'active');
      setLoading(true);
      try {
        const response = await api.loadAssignment(assignmentId);
        if (!response.success || !response.assignment) {
          store.getState().setServerStatus('loadAssignment', 'failed');
          setLoadError(`The assignment (${assignmentId}) failed to load.`);
          return;
        }
        adoptAssignmentData(response.raw as LegacyAssignmentPayload);
        store.getState().setServerStatus('loadAssignment', 'ready');
      } catch (error) {
        store.getState().setServerStatus('loadAssignment', 'failed');
        setLoadError(`The assignment (${assignmentId}) failed to load.`);
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [api, adoptAssignmentData, store],
  );

  // Boot-time load: inline assignment_data beats the id fetch, exactly the
  // editor.html:341-348 ordering.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (assignment.assignmentData) {
      adoptAssignmentData(assignment.assignmentData);
    } else if (
      assignment.currentAssignmentId !== null &&
      api?.isEndpointConnected('loadAssignment')
    ) {
      void loadAssignment(assignment.currentAssignmentId).catch(() => undefined);
    }
    if (config.passcodeProtected) requestPasscode();
    // Drain events queued while offline (legacy checkCaches, LIFO).
    if (api?.isEndpointConnected('logEvent')) {
      void api.flushEventQueue().catch(() => undefined);
    }
  }, [assignment, api, adoptAssignmentData, loadAssignment, config.passcodeProtected]);

  // §14.4 event stream: the chrome fires at the legacy call sites; drop
  // silently when no server is attached (legacy offline behavior).
  const logEvent = useCallback(
    (
      eventType: string,
      category: string,
      label: string,
      message: string,
      filePath: string,
      extended = false,
    ) => {
      if (!api) return;
      try {
        void api
          .logEvent(eventType, category, label, message, filePath, extended)
          .catch(() => undefined);
      } catch {
        // clientMayEmit refused the type — a chrome bug; never break the UI.
      }
    },
    [api],
  );

  // Imperative bridge for the legacy shim's BlockPy facade (§15.1).
  useEffect(() => {
    registerActions?.({
      loadAssignment,
      loadAssignmentData: adoptAssignmentData,
      requestPasscode: () => requestPasscode(),
    });
    return () => registerActions?.(null);
  }, [registerActions, loadAssignment, adoptAssignmentData]);

  // -- dev-harness fallback (no server, no inline payload) --------------------
  const harnessVfs = useMemo(() => {
    const files = new Vfs();
    files.write('answer.py', 'a = 0\nprint(a)');
    files.write('^starting_code.py', 'a = 0\nprint(a)');
    files.write(
      '!instructions.md',
      'Print the value of `a`.\n\nUse the **Run** button to execute:\n\n```python\na = 0\nprint(a)\n```',
    );
    files.write('!on_run.py', '');
    return files;
  }, []);

  const active: LoadedAssignment | null = loaded;
  // A boot-time load is coming: hold the "Loading" screen instead of
  // flashing the offline harness for one frame (legacy delete-on-load span).
  const bootPending =
    active === null &&
    loadError === null &&
    (assignment.assignmentData !== undefined ||
      (assignment.currentAssignmentId !== null && Boolean(config.urls.loadAssignment)));
  const vfs = active?.vfs ?? harnessVfs;
  const instructions = active
    ? active.assignment.instructions
    : (harnessVfs.read('!instructions.md') ?? '');

  // A4 settings: the assignment blob under the `settings-*` overrides
  // (§15.2 — query params are the debugging escape hatch, applied last).
  const settings = useMemo(
    () => ({
      ...(active ? parseAssignmentSettings(active.assignment.settings) : {}),
      ...config.settings,
    }),
    [active, config.settings],
  );

  const loadHistory = useMemo(() => {
    if (!api?.isEndpointConnected('loadHistory')) return undefined;
    return async () => {
      const response = await api.loadHistory();
      if (response.success === false) throw new Error('loadHistory failed');
      return (response['history'] ?? []) as HistoryEntry[];
    };
  }, [api]);

  const runController = useMemo(
    () =>
      createEngineRunController({
        indexURL: paths.pyodideIndexURL,
      }),
    [paths.pyodideIndexURL],
  );

  return (
    <main>
      <p style={{ fontSize: 'smaller' }}>
        Dev harness — {user.name ?? 'anonymous'} ({user.role});{' '}
        {active?.assignment.name ?? assignment.currentAssignmentId ?? 'no assignment'};{' '}
        {display.instructor ? 'instructor' : 'student'} view. AssignmentHost
        replaces this shell in Milestone 2.1.{' '}
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary blockpy-view-swap"
          onClick={() => setMinified(!minified)}
        >
          {minified ? 'Switch to full editor' : 'Switch to minified editor'}
        </button>
      </p>
      <h1 className="sr-only">BlockPy Studio</h1>
      {loadError !== null && <div className="alert alert-warning">{loadError}</div>}
      {versionOutdated && (
        <div className="alert alert-warning blockpy-version-outdated">
          The assignment has been updated since you started working on it.
          Reload the page to get the latest version — your code is saved.{' '}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setVersionOutdated(false)}
          >
            Dismiss
          </button>
        </div>
      )}
      {bootPending || (loading && active === null) ? (
        <p>Loading! Please wait.</p>
      ) : minified ? (
        <MinifiedEditor
          initialCode={vfs.read('answer.py') ?? ''}
          runController={runController}
          blocklyMediaPath={paths.blocklyMedia}
          onCodeChange={(newCode) => {
            vfs.write('answer.py', newCode);
            setCode(newCode);
          }}
        />
      ) : (
        <CodingEditor
          key={active?.assignment.id ?? 'harness'}
          assignmentName={active?.assignment.name ?? 'Dev Harness Problem'}
          instructions={instructions}
          vfs={vfs}
          role={instructorView ? 'instructor' : 'student'}
          instructor={instructorView}
          onCodeChange={setCode}
          readOnly={display.readOnly}
          blocklyMediaPath={paths.blocklyMedia}
          toolboxSetting={typeof settings['toolbox'] === 'string' ? settings['toolbox'] : undefined}
          hideFiles={
            settings['hide_files'] !== undefined ? settingBool(settings['hide_files']) : undefined
          }
          hideEvaluate={
            settings['hide_evaluate'] !== undefined
              ? settingBool(settings['hide_evaluate'])
              : undefined
          }
          assignmentHidden={active?.assignment.raw['hidden'] === true}
          runController={runController}
          onFileEdit={(filename, contents) => {
            if (sync && AUTOSAVE_FILES.has(filename)) {
              sync.saveFileDebounced(filename, contents);
            }
          }}
          onRunStart={(studentCode) => {
            // run.js:13 — answer.py saves immediately when a run starts.
            void sync?.saveFileNow('answer.py', studentCode);
          }}
          onGraded={(grade) => {
            void sync?.handleGraded(grade);
            // Display OR-chain (on_run.js:165) feeds the mark-submitted text.
            if (grade.success) setCorrect(true);
          }}
          onLogEvent={logEvent}
          onEditorReady={(editor) => {
            dualEditorRef.current = editor;
          }}
          loadHistory={loadHistory}
          quickMenu={{
            grader: true,
            instructor: instructorView,
            onInstructorChange: setInstructorView,
            hasClock: true,
            // Fullscreen event stream (X-Display.Fullscreen.*, A2).
            onLogEvent: (eventType, message) => logEvent(eventType, '', '', message, ''),
            // Legacy canShare (blockpy.js:632-650): parts base64 → shareUrl.
            ...(config.urls.shareUrl
              ? {
                  shareUrl: () => {
                    const base = config.urls.shareUrl as string;
                    const encoded = btoa(
                      [
                        'group',
                        user.courseId,
                        assignment.assignmentGroupId,
                        active?.assignment.id ?? '',
                        user.id,
                        new Date().toISOString(),
                      ].join('_'),
                    );
                    return base + (base.endsWith('/') ? '' : '/') + encoded;
                  },
                }
              : {}),
            // Mark-submitted ladder (blockpy.js:590-625) — the button shows
            // only for reviewed/can_close assignments (QuickMenu gates it).
            ...(active && api
              ? {
                  submission: {
                    status: submissionStatus,
                    reviewed: active.assignment.raw['reviewed'] === true,
                    canClose: settingBool(settings['can_close'] ?? false),
                    hidden: active.assignment.raw['hidden'] === true,
                    correct,
                    grouped: assignment.assignmentGroupId !== null,
                    onUpdateStatus: (status: string) => {
                      void api
                        .updateSubmissionStatus(status)
                        .then((response) => {
                          // Legacy postStatusChange (server.js:593-597):
                          // local status updates only on success; logical
                          // failures are silent.
                          if (response.success) setSubmissionStatus(status);
                        })
                        .catch(() => {
                          // Legacy _postBlocking exhausts 2 attempts then
                          // shows the error dialog (dialog.js:151-154).
                          alert(
                            'BlockPy encountered an error while updating your submission status.\n' +
                              'Please reload the page and try again.',
                          );
                        });
                    },
                  },
                }
              : {}),
          }}
          footer={{
            instructor: instructorView,
            // Instructor force-load: a JSON file replaces the loaded pair
            // (blockpy.js:1186-1200 → loadAssignmentData_).
            onForceLoadAssignment: (data) =>
              adoptAssignmentData(data as LegacyAssignmentPayload),
            // Update Submission badge click re-POSTs with force_update
            // (blockpy.js:1202-1208).
            onForceUpdateSubmission: () => void sync?.forceUpdate(),
            identity: {
              userId: user.id ?? undefined,
              userName: user.name,
              userRole: user.role,
              courseId: user.courseId ?? undefined,
              groupId: assignment.assignmentGroupId ?? undefined,
              assignmentId: active?.assignment.id ?? assignment.currentAssignmentId ?? undefined,
              editorVersion: '0.1.0',
            },
          }}
        />
      )}
    </main>
  );
}
