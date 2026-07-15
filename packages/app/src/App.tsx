import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, ListOrdered } from 'lucide-react';
import {
  CodingEditor,
  Dialog,
  MinifiedEditor,
  requestPasscode,
  useEditorChromeStore,
  type DualEditor,
  type HistoryEntry,
  type UploadedFilesMap,
  type UploadsController,
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
  type WirePayload,
} from '@blockpy/api';
import {
  GroupNav,
  createGroupNavStore,
  publishNavigationGlobals,
  type GroupNavStore,
} from '@blockpy/navigation';
import { Textbook } from '@blockpy/textbook';
import { LegacyIsland, createLegacyServerBridge } from './LegacyIsland';
import { installCookieFallback, installFrameResize, removeLoadingScreen } from '@blockpy/lti-embed';
import { Reader, type ReaderLoadResult } from '@blockpy/reader';
import { Quizzer } from '@blockpy/quizzer';
import { createEngineRunController } from './engine-adapter';
import { parseAssignmentSettings, vfsFromAssignment } from './assignment-loader';
import { AssignmentHost } from './AssignmentHost';
import { GroupOrganizer } from './GroupOrganizer';
import { SubmissionSync } from './submission-sync';
import '@blockpy/editor/styles/tokens.css';
import '@blockpy/editor/styles/bootstrap-subset.css';
import '@blockpy/editor/styles/blockpy.css';
import '@blockpy/editor/styles/themes.css';
import '@blockpy/navigation/styles/navigation.css';
import '@blockpy/reader/styles/reader.css';
import '@blockpy/quizzer/styles/quizzer.css';
import '@blockpy/textbook/styles/textbook.css';
import type { BootConfig, LegacyAssignmentPayload } from './boot-config';
import type { MountExtras, StudioActions } from './studio-handle';

/**
 * LD-33: legacy appends "?placement=…" blindly (plugins.ts:272), which
 * produces a double question mark when the configured downloadFile url
 * already carries a query string. Join with "&" instead (the transport's
 * getJson separator rule); the filename stays unencoded, as legacy.
 */
export function buildDownloadUrl(base: string, assignmentId: number, filename: string): string {
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}placement=assignment&directory=${assignmentId}&filename=${filename}`;
}

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
 * the `#extra_*_files.blockpy` bundles - pending with the uploads work.
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
 * Milestone 2.1 - until then the coding editor is the only renderer, which
 * matches its legacy role as the fallback for unknown types.
 */
export function App({ config, extras, registerActions }: AppProps) {
  const { user, assignment, display, paths } = config;
  const [, setCode] = useState('');
  // "View as instructor" (legacy display.instructor). The dev shell always
  // exposes the grader toggle for debugging; real role gating (ui.role
  // .isGrader) arrives with AssignmentHost (M2.1).
  const [instructorView, setInstructorView] = useState(display.instructor);
  // Live handle for the reading/quiz surfaces: seeds from the real role and
  // only graders ever see the toggle, so production behavior is unchanged -
  // but the dev harness's "as instructor" checkbox reaches the quiz editor.
  const instructorViewRef = useRef(display.instructor);
  instructorViewRef.current = instructorView;
  // Preview toggle between the full editor and the §8.4 minified variant.
  const [minified, setMinified] = useState(false);
  const [loaded, setLoaded] = useState<LoadedAssignment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Assignment-switch loading overlay (LD-32): the label of whatever is
  // currently loading, or null when nothing is. Counter-guarded so
  // overlapping loads keep the overlay up until the LAST one settles.
  const [overlayLabel, setOverlayLabel] = useState<string | null>(null);
  const overlayCountRef = useRef(0);
  const withLoadingOverlay = useCallback(
    async <T,>(label: string, task: () => Promise<T>): Promise<T> => {
      overlayCountRef.current += 1;
      setOverlayLabel(label);
      try {
        return await task();
      } finally {
        overlayCountRef.current -= 1;
        if (overlayCountRef.current <= 0) setOverlayLabel(null);
      }
    },
    [],
  );
  // "What is loading": the group-nav name when the id is in the group,
  // otherwise the surface kind + id.
  const groupAssignments = config.group?.assignments;
  const assignmentLabel = useCallback(
    (assignmentId: number, kind: string) =>
      groupAssignments?.find((entry) => entry.id === assignmentId)?.name ??
      `${kind} ${assignmentId}`,
    [groupAssignments],
  );
  // Legacy submission.submissionStatus/.correct/.score display state.
  const [submissionStatus, setSubmissionStatus] = useState('unknown');
  const [correct, setCorrect] = useState(false);
  const [score, setScore] = useState(0);
  // §7.4 out-of-date banner: saveFile responded version_change (LD-11).
  const [versionOutdated, setVersionOutdated] = useState(false);
  // Live dual editor - the updateSubmission block-PNG source (§14.3).
  const dualEditorRef = useRef<DualEditor | null>(null);
  const store = useEditorChromeStore;
  // Focused editor mode (M4.2) hides the group-nav headers around the
  // editor - the flag lives in the editor chrome store.
  const focusedMode = useEditorChromeStore((state) => state.focusedMode);
  // Group organizer dialog (M4.6 slice 1, LD-28).
  const [organizerOpen, setOrganizerOpen] = useState(false);
  // OFFER_FORK dialog (M7.9, LD-42): opened when save_assignment rejects
  // with `forkable: true` (helpers.py:55-60) or proactively from the
  // not-owned notice. Legacy rendered this dialog with DEAD buttons
  // (dialog.js:161-190 bound no handlers); these work.
  const [forkOffer, setForkOffer] = useState<{ message: string } | null>(null);
  const [forkUrl, setForkUrl] = useState('');
  const [forkBusy, setForkBusy] = useState(false);
  const [forkError, setForkError] = useState('');

  // -- server client (spec §14): built once per mount ------------------------
  const apiBundle = useMemo(() => {
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
    // The transport rides along for the legacy-island server bridge
    // (raw named-endpoint posts, §17 islands).
    return { client: holder.client, transport };
  }, [config, assignment, user, extras]);
  const api = apiBundle?.client ?? null;

  // Grading success reaches the group header (spec §9.3) AND any host-page
  // hook; the ref breaks the memo cycle (sync → markCorrect → navStore →
  // loadAssignment → adoptAssignmentData → sync).
  const navStoreRef = useRef<GroupNavStore | null>(null);
  const markCorrectEverywhere = useCallback(
    (assignmentId: number) => {
      navStoreRef.current?.markCorrect(assignmentId);
      extras?.markCorrect?.(assignmentId);
    },
    [extras],
  );

  // Autosave + §14.3 submission lifecycle rides the same client.
  const sync = useMemo(() => {
    if (!api) return null;
    return new SubmissionSync({
      api,
      setStatus: (endpoint, status, message) =>
        store.getState().setServerStatus(endpoint, status, message),
      readOnly: () => config.display.readOnly,
      markCorrect: markCorrectEverywhere,
      onVersionChange: () => setVersionOutdated(true),
      getImage: () => dualEditorRef.current?.blockEditor.getPng() ?? Promise.resolve(''),
    });
  }, [api, config.display.readOnly, markCorrectEverywhere, store]);

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
      setScore(submission?.score ?? 0);
      setSubmissionStatus(String(submission?.raw['submission_status'] ?? 'unknown'));
      setVersionOutdated(false);
      setLoaded({
        assignment: decoded,
        submission,
        vfs: vfsFromAssignment(decoded, submission ?? undefined),
      });
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
        const response = await withLoadingOverlay(assignmentLabel(assignmentId, 'assignment'), () =>
          api.loadAssignment(assignmentId),
        );
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
    [api, adoptAssignmentData, store, withLoadingOverlay, assignmentLabel],
  );

  // AssignmentHost dispatch (spec §5.3) - the modern loadAssignmentWrapper.
  const dispatchRef = useRef<((assignmentId: number) => Promise<void>) | null>(null);

  // Boot-time load: inline assignment_data beats the id fetch, exactly the
  // editor.html:341-348 ordering; the id path routes through the host's
  // type dispatch (legacy loadAssignmentWrapper(current_assignment_id)).
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
      const load = dispatchRef.current ?? loadAssignment;
      void load(assignment.currentAssignmentId).catch(() => undefined);
    } else if (assignment.textbookPath && api) {
      // Standalone textbook route (M4.7; the load_textbook contract,
      // assignments.py:95-130): resolve the path BY URL FIRST, THEN as a
      // numeric id - the flagged server template passes the raw <path>
      // instead of resolving it. The initial ?page= is honored by the
      // Textbook component itself (url-then-id, Textbook.tsx pageParam).
      const path = assignment.textbookPath;
      void (async () => {
        const byUrl = await api.loadAssignmentByUrl(path);
        const resolved = byUrl?.id ?? (/^\d+$/.test(path) ? Number(path) : null);
        if (resolved === null) {
          setLoadError(`There is no textbook at "${path}".`);
          return;
        }
        const load = dispatchRef.current ?? loadAssignment;
        await load(resolved);
      })().catch(() => undefined);
    }
    if (config.passcodeProtected) requestPasscode();
    // Drain events queued while offline (legacy checkCaches, LIFO).
    if (api?.isEndpointConnected('logEvent')) {
      void api.flushEventQueue().catch(() => undefined);
    }
  }, [assignment, api, adoptAssignmentData, loadAssignment, config.passcodeProtected]);

  // LTI page environment (§13): cookie fallback + loading-screen removal
  // once at mount; frame resize while embedded. Shim pages (unmodified
  // templates) run the cookie script inline themselves - the
  // ltiLoadedCorrectly guard keeps the handshake from double-running.
  useEffect(() => {
    const globals = window as unknown as Record<string, unknown>;
    const cookieResult =
      globals['ltiLoadedCorrectly'] === undefined ? installCookieFallback() : null;
    removeLoadingScreen();
    return () => cookieResult?.dispose();
  }, []);
  useEffect(() => {
    // Legacy gates the resize loop on `{% if embed %}` (editor.html:351).
    if (!display.embed) return;
    return installFrameResize();
  }, [display.embed]);

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
        // clientMayEmit refused the type - a chrome bug; never break the UI.
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

  // -- assignment-group navigation (spec §9) ----------------------------------

  // Total-duration fetcher for the clock's activity mode. Legacy is a $.get
  // global with the ids baked into the URL (editor.html:395-399); ours rides
  // the base payload (createServerData already carries the group/course ids)
  // against the same GET-or-POST endpoint (blockpy.py:1248-1262).
  const getGroupDuration = useMemo(() => {
    if (!api?.isEndpointConnected('estimateGroupDuration')) return undefined;
    return async () => {
      const response = await api.estimateGroupDuration();
      if (response.success !== true) throw new Error('estimate_group_duration failed');
      return Number(response['duration'] ?? 0);
    };
  }, [api]);

  // Timer telemetry attaches to the assignment URL (assignment_interface.ts
  // passes this.assignment().url() as the event file path).
  const activeAssignmentUrlRef = useRef('');

  const navStore = useMemo(() => {
    if (!config.group) return null;
    return createGroupNavStore(config.group, {
      loadAssignment: (assignmentId) =>
        void (dispatchRef.current ?? loadAssignment)(assignmentId).catch(() => undefined),
      ...(getGroupDuration ? { getGroupDuration } : {}),
      logEvent: (eventType, category, label, message) =>
        logEvent(eventType, category, label, message, activeAssignmentUrlRef.current),
      // The real role, not the view-as toggle: legacy's isInstructor comes
      // from the page render and never flips (assignment_interface.ts:76-80).
      isInstructor: () => config.display.instructor,
      sessionStartTime: config.sessionStartTime,
    });
  }, [
    config.group,
    config.sessionStartTime,
    config.display.instructor,
    getGroupDuration,
    loadAssignment,
    logEvent,
  ]);
  navStoreRef.current = navStore;

  // §15.3 globals. `markCorrect` is the alias older content calls directly -
  // a no-op on group-less pages (editor.html:109-114). Never clobber a
  // legacy-template-owned global when we don't own the navigation (shim
  // mode against unmodified pages defines both itself).
  useEffect(() => {
    const globals = window as unknown as Record<string, unknown>;
    if (!navStore && 'markCorrect' in globals) return;
    globals['markCorrect'] = navStore
      ? (assignmentId: number) => navStore.markCorrect(assignmentId)
      : () => undefined;
    return () => {
      delete globals['markCorrect'];
    };
  }, [navStore]);
  useEffect(() => {
    const globals = window as unknown as Record<string, unknown>;
    if (!getGroupDuration || 'ACTIVITY_GET_DURATION' in globals) return;
    globals['ACTIVITY_GET_DURATION'] = getGroupDuration;
    return () => {
      delete globals['ACTIVITY_GET_DURATION'];
    };
  }, [getGroupDuration]);
  // §15.3 navigation compatibility globals (URL_MAP, INDICES, …): published
  // only when we own the navigation; on unmodified templates the
  // assignment_groups.html macro defines them itself and always wins.
  useEffect(() => {
    if (!config.group) return;
    return publishNavigationGlobals(config.group);
  }, [config.group]);

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
  const activeVfsRef = useRef<Vfs | null>(null);
  activeVfsRef.current = active?.vfs ?? null;

  // Remote uploaded files (legacy reorganizeFiles + downloadRemoteFiles,
  // files.js:669-737): register the url map on the VFS and fetch each new
  // file's body so runs can stage it (consulted last in the search order).
  const syncRemoteFiles = useCallback(
    async (files: UploadedFilesMap) => {
      const target = activeVfsRef.current;
      if (!target || !api) return;
      const urlMap: Record<string, string> = {};
      const entries: Array<{ filename: string; placement: string; directory: string }> = [];
      for (const placed of Object.values(files)) {
        for (const [filename, url] of placed) {
          urlMap[filename] = url;
          try {
            const params = new URL(url, window.location.origin).searchParams;
            entries.push({
              filename,
              placement: params.get('placement') ?? '',
              directory: params.get('directory') ?? '',
            });
          } catch {
            // Unparseable URL - listed but not fetchable.
          }
        }
      }
      target.setRemoteFiles(urlMap);
      await Promise.all(
        entries.map(async (entry) => {
          // Legacy fetches only files it has not seen (files.js:725-731).
          if (target.hasRemoteContents(entry.filename)) return;
          try {
            const body = await api.downloadFile(entry.placement, entry.directory, entry.filename);
            target.setRemoteContents(entry.filename, body);
          } catch {
            // Fail-soft: an unfetchable file just is not staged.
          }
        }),
      );
    },
    [api],
  );

  // Uploaded-files server actions for the images.blockpy manager
  // (placement→directory ids per images.js:208-221).
  const uploads = useMemo<UploadsController | undefined>(() => {
    if (!api?.isEndpointConnected('listUploadedFiles')) return undefined;
    const failure = (response: Record<string, unknown>): Error =>
      new Error(String(response['message'] ?? 'The server rejected the request.'));
    const placementDirectory = (placement: string): string => {
      switch (placement) {
        case 'submission':
          return String(api.context.submissionId ?? '');
        case 'assignment':
          return String(api.context.assignmentId ?? '');
        case 'course':
          return String(api.context.courseId ?? '');
        case 'user':
          return String(api.context.userId ?? '');
        default:
          return '';
      }
    };
    return {
      async list() {
        const response = await api.listUploadedFiles();
        if (response.success !== true) throw failure(response);
        const files = (response['files'] ?? {}) as UploadedFilesMap;
        void syncRemoteFiles(files);
        return files;
      },
      async upload(placement, filename, contents) {
        const response = await api.uploadFile(
          placement,
          placementDirectory(placement),
          filename,
          contents,
        );
        if (response.success !== true) throw failure(response);
      },
      async remove(placement, directory, filename) {
        // Legacy delete = upload with empty contents + delete flag.
        const response = await api.uploadFile(placement, directory, filename, '', true);
        if (response.success !== true) throw failure(response);
      },
      async rename(placement, directory, oldFilename, newFilename) {
        const response = await api.renameFile(placement, directory, oldFilename, newFilename);
        if (response.success !== true) throw failure(response);
      },
    };
  }, [api, syncRemoteFiles]);
  // A boot-time load is coming: hold the "Loading" screen instead of
  // flashing the offline harness for one frame (legacy delete-on-load span).
  const bootPending =
    active === null &&
    loadError === null &&
    (assignment.assignmentData !== undefined ||
      ((assignment.currentAssignmentId !== null ||
        // Standalone textbook boot (M4.7) resolves then loads.
        assignment.textbookPath !== undefined) &&
        Boolean(config.urls.loadAssignment)));
  const vfs = active?.vfs ?? harnessVfs;
  const instructions = active
    ? active.assignment.instructions
    : (harnessVfs.read('!instructions.md') ?? '');

  // A4 settings: the assignment blob under the `settings-*` overrides
  // (§15.2 - query params are the debugging escape hatch, applied last).
  const settings = useMemo(
    () => ({
      ...(active ? parseAssignmentSettings(active.assignment.settings) : {}),
      ...config.settings,
    }),
    [active, config.settings],
  );

  activeAssignmentUrlRef.current = active?.assignment.url ?? '';

  // Exam countdown feed (spec §9.4): the checker reads settings.time_limit
  // plus the per-student override and start from the submission - legacy
  // reads the same live pair (assignment_interface.ts:186-193). The raw
  // setting passes through unconverted: a numeric time_limit crashes
  // parseTimeLimit into the timer_error path in legacy too.
  useEffect(() => {
    if (!navStore) return;
    if (!active) {
      navStore.setTimeLimit(null);
      return;
    }
    navStore.setTimeLimit({
      timeLimit: (settings['time_limit'] ?? null) as string | null,
      studentTimeLimit: (active.submission?.raw['time_limit'] ?? null) as string | null,
      dateStarted: (active.submission?.raw['date_started'] ?? null) as string | null,
    });
  }, [navStore, active, settings]);

  // preload_all_files (files.js:677-696): fetch the uploaded listing at
  // assignment load instead of waiting for the images tab. The specific
  // `preload_files` JSON variant lands with CORGIS (§10.4).
  useEffect(() => {
    if (active && uploads && settingBool(settings['preload_all_files'] ?? false)) {
      void uploads.list().catch(() => undefined);
    }
  }, [active, uploads, settings]);

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
        // paths.assets: deployed location of the build's assets/ dir -
        // overrides the build-time worker URL (engine-adapter).
        ...(paths.assets ? { assetsBase: paths.assets } : {}),
        // LD-37: one-time setup waits (Pyodide boot, Pedal wheels) drive
        // the Run-button spinner + console banner instead of reading as a
        // hang. Chrome UI, not a routed system message - the dev-console
        // rule (system output never in the student console) is untouched.
        onBootStateChange: (booting, label) =>
          useEditorChromeStore.getState().setEngineBooting(booting ? (label ?? 'Loading…') : null),
      }),
    [paths.pyodideIndexURL, paths.assets],
  );

  // -- reading + quiz slots (spec §11.2/§11.3, M2.3/M2.4) -----------------------
  // Each component keeps its OWN loaded pair (legacy posts loadAssignment
  // without adopting into the editor model) - the editor's `active`
  // assignment is untouched while a reading/quiz is displayed. Their events
  // and persistence carry their OWN ids over the base payload (§12; the
  // legacy AssignmentInterface builds payloads from its own pair).
  const assignmentRenderers = useMemo(() => {
    if (!api) return undefined;
    // Per-surface owning-id slots (§12): a quiz and its preamble reading
    // mount TOGETHER, so one shared slot pair would cross-attribute their
    // events - each requested id keeps its own loaded pair instead.
    const surfaceIds = new Map<
      number,
      { assignmentId: number | null; submissionId: number | null }
    >();
    const loadPair = async (requestedId: number) => {
      const response = await api.loadAssignment(requestedId);
      if (!response.success || !response.assignment) return null;
      surfaceIds.set(requestedId, {
        assignmentId: response.assignment.id ?? requestedId,
        submissionId: response.submission?.id ?? null,
      });
      return response;
    };
    const makeSurfaceLogEvent =
      (requestedId: number) =>
      (eventType: string, category: string, label: string, message: string, filePath: string) => {
        const ids = surfaceIds.get(requestedId);
        try {
          void api
            .logEvent(eventType, category, label, message, filePath, false, {
              assignment_id: ids?.assignmentId ?? null,
              submission_id: ids?.submissionId ?? null,
            })
            .catch(() => undefined);
        } catch {
          // clientMayEmit refused the type - never break the surface.
        }
      };
    const downloadUrl = (assignmentId: number, filename: string) =>
      buildDownloadUrl(config.urls.downloadFile ?? '', assignmentId, filename);
    const extractMessage = (message: unknown): string | undefined =>
      typeof message === 'object' && message !== null
        ? String((message as Record<string, unknown>)['message'] ?? '')
        : typeof message === 'string'
          ? message
          : undefined;
    const onTimeLimitInfo = (info: {
      timeLimit: string | null;
      studentTimeLimit: string | null;
      dateStarted: string | null;
    }) => navStoreRef.current?.setTimeLimit(info);
    // Legacy $URL_ROOT drives the popout editUrl (assignment.ts:103-107);
    // absent (app-owned pages without the global) the popout is hidden.
    const urlRoot = (window as unknown as Record<string, unknown>)['$URL_ROOT'];

    const loadReading = async (id: number): Promise<ReaderLoadResult | null> => {
      const response = await loadPair(id);
      if (!response) return null;
      return {
        assignment: {
          id: response.assignment!.id ?? id,
          name: response.assignment!.name,
          url: response.assignment!.url,
          instructions: response.assignment!.instructions,
          settings: response.assignment!.settings,
        },
        submission: response.submission
          ? {
              id: response.submission.id,
              correct: response.submission.correct,
              dateStarted: (response.submission.raw['date_started'] as string | null) ?? null,
              timeLimit: (response.submission.raw['time_limit'] as string | null) ?? null,
            }
          : null,
      };
    };

    const reading = (readingId: number, preamble = false) => (
      <Reader
        assignmentId={readingId}
        asPreamble={preamble}
        // Overlay only for top-level readings: a preamble loads inside an
        // already-visible surface whose own load was overlaid (LD-32).
        loadAssignment={
          preamble
            ? loadReading
            : (id) => withLoadingOverlay(assignmentLabel(id, 'reading'), () => loadReading(id))
        }
        markRead={async (assignmentId, submissionId) => {
          // reader.ts:384-398 - updateSubmission {status: 1, correct: true}
          // with the READING's ids overriding the base payload.
          const response = await api.updateSubmission({
            assignment_id: assignmentId,
            submission_id: submissionId,
            status: 1,
            correct: true,
          });
          return {
            success: response.success === true,
            correct: response['correct'] === true,
            submissionStatus: response['submission_status'] as string | undefined,
            message: extractMessage(response['message']),
          };
        }}
        // A preamble reading never touches navigation - the legacy quizzer
        // passes markCorrect: ()=>{} to it (quiz_ui.ts:201).
        markCorrect={preamble ? () => undefined : markCorrectEverywhere}
        logEvent={makeSurfaceLogEvent(readingId)}
        downloadUrl={downloadUrl}
        {...(typeof urlRoot === 'string'
          ? {
              editUrl: (a: { id: number; url: string }) =>
                urlRoot + '/assignments/reading/' + (a.url ? a.url : a.id) + '?',
            }
          : {})}
        runController={runController}
        blocklyMediaPath={paths.blocklyMedia}
        isInstructor={() => instructorViewRef.current}
        {...(api.isEndpointConnected('startAssignment')
          ? {
              startAssignment: async (assignmentId: number, dateStarted: string) => ({
                success: (await api.startAssignment(assignmentId, dateStarted)).success === true,
              }),
            }
          : {})}
        onTimeLimitInfo={onTimeLimitInfo}
      />
    );

    const quiz = (quizId: number) => (
      <Quizzer
        assignmentId={quizId}
        loadAssignment={(requestedId) =>
          withLoadingOverlay(assignmentLabel(requestedId, 'quiz'), async () => {
            const id = requestedId;
            const response = await loadPair(id);
            if (!response) return null;
            return {
              assignment: {
                id: response.assignment!.id ?? id,
                name: response.assignment!.name,
                url: response.assignment!.url,
                instructions: response.assignment!.instructions,
                settings: response.assignment!.settings,
                // The checks document - the server blanks it for students
                // (encode_quiz_json); instructors get it for the editor.
                onRun: response.assignment!.onRun,
              },
              submission: response.submission
                ? {
                    id: response.submission.id,
                    code: response.submission.code,
                    correct: response.submission.correct,
                    dateStarted: (response.submission.raw['date_started'] as string | null) ?? null,
                    timeLimit: (response.submission.raw['time_limit'] as string | null) ?? null,
                  }
                : null,
            };
          })
        }
        saveAnswer={async (assignmentId, submissionId, code) => {
          // quizzer.ts:143-153 - the whole submission JSON as answer.py,
          // with the QUIZ's ids riding over the base payload.
          const response = await api.saveFile('answer.py', code, {
            assignment_id: assignmentId,
            submission_id: submissionId,
          });
          return { success: response.success === true };
        }}
        submitQuiz={async (assignmentId, submissionId) => {
          // quizzer.ts:207-244 - status: 0, correct: false; the server
          // grades (regrade_if_quiz) and returns the feedbacks map.
          const response = await api.updateSubmission({
            assignment_id: assignmentId,
            submission_id: submissionId,
            status: 0,
            correct: false,
          });
          const message = response['message'];
          const messageText = extractMessage(message);
          // Legacy quirk: feedbacks apply on success OR the specific LTI
          // failure message (quizzer.ts:226-229).
          const includeFeedbacks =
            response.success === true ||
            messageText === 'Generic LTI Failure - perhaps not logged into LTI session?';
          const feedbacks =
            (response['feedbacks'] as Record<string, never> | undefined) ??
            (typeof message === 'object' && message !== null
              ? ((message as Record<string, unknown>)['feedbacks'] as
                  Record<string, never> | undefined)
              : undefined);
          return {
            success: response.success === true,
            correct: response['correct'] === true,
            ...(includeFeedbacks && feedbacks ? { feedbacks } : {}),
            submissionStatus: response['submission_status'] as string | undefined,
            message: messageText,
          };
        }}
        markCorrect={markCorrectEverywhere}
        logEvent={makeSurfaceLogEvent(quizId)}
        downloadUrl={downloadUrl}
        isInstructor={() => instructorViewRef.current}
        // Subordinate-reading preamble beneath no one: the quiz renders the
        // reading ABOVE itself (quiz_ui.ts:194-208).
        renderReading={(readingId) => reading(readingId, true)}
        // quizzer.ts:108-110 - url-slug readingIds resolve through the
        // assignment store's by_url fallback; unresolved slugs fail soft
        // inside the Quizzer (readingId stays null, console.error).
        lookupReadingId={async (url) => {
          const resolved = await api.loadAssignmentByUrl(url);
          if (!resolved) throw new Error(`No assignment found for url ${url}`);
          return resolved.id;
        }}
        onTimeLimitInfo={onTimeLimitInfo}
        // Quiz editor persistence: the two documents through saveFile with
        // the QUIZ's ids (legacy saveAssignment, quizzer.ts:195-205).
        saveQuizAssignment={async (assignmentId, instructionsText, checksText) => {
          const ids = { assignment_id: assignmentId };
          const first = await api.saveFile('!instructions.md', instructionsText, ids);
          if (first.success !== true) return { success: false };
          const second = await api.saveFile('!on_run.py', checksText, ids);
          return { success: second.success === true };
        }}
      />
    );

    // Textbook (spec §11.4): a thin reader composition; each opened page is
    // a full Reader rendered as an embedded surface with a NO-OP markCorrect
    // (textbook.html:109) - the reading still posts its own markRead.
    const textbook = (textbookId: number) => (
      <Textbook
        assignmentId={textbookId}
        loadAssignment={(id) =>
          withLoadingOverlay(assignmentLabel(id, 'textbook'), async () => {
            const response = await loadPair(id);
            if (!response) return null;
            return {
              assignment: {
                id: response.assignment!.id ?? id,
                name: response.assignment!.name,
                url: response.assignment!.url,
                instructions: response.assignment!.instructions,
                settings: response.assignment!.settings,
              },
              submission: response.submission ? { id: response.submission.id } : null,
            };
          })
        }
        renderReading={(readingId) => reading(readingId, true)}
        // LD-16 closure (M4.7): url-string sidebar refs rehydrate through
        // the GET-only /assignments/by_url route when the template
        // publishes its key; otherwise Missing Reading, as before.
        resolveAssignment={(slug) => api.loadAssignmentByUrl(slug)}
        isInstructor={() => instructorViewRef.current}
        logEvent={makeSurfaceLogEvent(textbookId)}
        saveTextbookAssignment={async (assignmentId, instructionsText, settingsText) => {
          // Legacy textbook.ts:111-119: !instructions.md via saveFile plus
          // saveAssignmentSettings (points/name/url editing deferred, like
          // the quiz editor's).
          const ids = { assignment_id: assignmentId };
          const first = await api.saveFile('!instructions.md', instructionsText, ids);
          if (first.success !== true) return { success: false };
          if (!api.isEndpointConnected('saveAssignment')) return { success: true };
          const second = await api.saveAssignment({ ...ids, settings: settingsText });
          return { success: second.success === true };
        }}
      />
    );

    // Kettle/Explain stay on the legacy frontend bundle (§17 islands); the
    // bridge gives the old components their $MAIN_BLOCKPY_EDITOR server
    // surface, delegating to the api client/transport.
    const islandBridge = createLegacyServerBridge({
      buildPayload: () => api.buildPayload(),
      post: (endpointName, payload) => {
        const url = config.urls[endpointName];
        if (!url) {
          return Promise.reject(new Error(`No URL configured for endpoint "${endpointName}"`));
        }
        return apiBundle!.transport.post(url, payload as WirePayload);
      },
    });
    const island = (component: 'kettle' | 'explain') => (islandId: number) => (
      <LegacyIsland
        component={component}
        assignmentId={islandId}
        courseId={user.courseId}
        assignmentGroupId={assignment.assignmentGroupId}
        isInstructor={config.display.instructor}
        markCorrect={markCorrectEverywhere}
        user={{ id: user.id, name: user.name }}
        serverBridge={islandBridge}
        passcode={() => api.context.passcode}
      />
    );

    return {
      reading: (id: number) => reading(id),
      quiz,
      textbook,
      typescript: island('kettle'),
      explain: island('explain'),
    };
  }, [
    api,
    apiBundle,
    markCorrectEverywhere,
    withLoadingOverlay,
    assignmentLabel,
    config.urls,
    config.display.instructor,
    runController,
    paths.blocklyMedia,
    user.courseId,
    user.id,
    user.name,
    assignment.assignmentGroupId,
  ]);

  // Instructor tools (LD-34): icon-only buttons living at the far right of
  // the TOP group-nav bar (right of the clock). Never rendered for
  // students - gated on the page's instructor flag (with the dev shell's
  // devHarness flag standing in until real role gating lands, the M2.1
  // TODO). The persistent toggle survives assignment-type switches so the
  // quiz editor and instructor views are reachable from ANY surface.
  const instructorTools = (display.instructor || (display.devHarness ?? false)) && (
    <>
      {instructorView && api && config.group && (
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary blockpy-organize-group mr-1"
          aria-label="Organize Group"
          title="Organize Group"
          onClick={() => setOrganizerOpen(true)}
        >
          <ListOrdered
            size={14}
            strokeWidth={1.75}
            aria-hidden
            style={{ verticalAlign: 'text-bottom' }}
          />
        </button>
      )}
      <button
        type="button"
        id="blockpy-instructor-mode"
        className={`btn btn-sm ${instructorView ? 'btn-success' : 'btn-outline-secondary'} blockpy-instructor-mode`}
        aria-pressed={instructorView}
        aria-label="Instructor mode"
        title={
          instructorView
            ? 'Instructor mode is ON - click to view as a student'
            : 'Instructor mode is OFF - click to enable'
        }
        onClick={() => setInstructorView(!instructorView)}
      >
        <GraduationCap
          size={14}
          strokeWidth={1.75}
          aria-hidden
          style={{ verticalAlign: 'text-bottom' }}
        />
      </button>
    </>
  );
  const topNavVisible = Boolean(navStore && !focusedMode);

  return (
    <main>
      {(display.devHarness ?? false) && (
        <p style={{ fontSize: 'smaller' }}>
          Dev harness - {user.name ?? 'anonymous'} ({user.role});{' '}
          {active?.assignment.name ?? assignment.currentAssignmentId ?? 'no assignment'};{' '}
          {display.instructor ? 'instructor' : 'student'} view. AssignmentHost replaces this shell
          in Milestone 2.1.{' '}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary blockpy-view-swap"
            onClick={() => setMinified(!minified)}
          >
            {minified ? 'Switch to full editor' : 'Switch to minified editor'}
          </button>
        </p>
      )}
      <h1 className="sr-only">BlockPy Studio</h1>
      {instructorView && api && config.group && organizerOpen && (
        <GroupOrganizer
          api={api}
          groupId={assignment.assignmentGroupId}
          assignments={config.group.assignments}
          navStore={navStore}
          visible={organizerOpen}
          onClose={() => setOrganizerOpen(false)}
        />
      )}
      {/* Assignment-switch overlay (LD-32): legacy's .blockpy-overlay was a
          bare darkening layer on blocking POSTs; this one says WHAT is
          loading, with a spinner. */}
      {overlayLabel !== null && (
        <div className="blockpy-loading-overlay" role="status">
          <div className="blockpy-loading-overlay-card">
            <span className="blockpy-loading-spinner" aria-hidden="true" />
            Loading {overlayLabel}…
          </div>
        </div>
      )}
      {loadError !== null && <div className="alert alert-warning">{loadError}</div>}
      {/* Proactive not-owned notice (M7.9, LD-42): decoded ownership predicts
          the fork BEFORE the first rejected save is the discovery moment. */}
      {instructorView &&
        !focusedMode &&
        api !== null &&
        active?.assignment.courseId != null &&
        api.context.courseId != null &&
        active.assignment.courseId !== Number(api.context.courseId) && (
          <div className="alert alert-warning blockpy-fork-notice">
            This assignment belongs to another course (course ID {active.assignment.courseId}), so
            your edits cannot be saved to it.{' '}
            {api.isEndpointConnected('forkAssignment') ? (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary blockpy-fork-open"
                onClick={() => {
                  setForkError('');
                  setForkOffer({ message: '' });
                }}
              >
                Fork it into your course…
              </button>
            ) : (
              <span>
                (Forking is not configured on this page - ask your server administrator to publish
                the forkAssignment endpoint.)
              </span>
            )}
          </div>
        )}
      {/* OFFER_FORK (M7.9, LD-42) - the legacy dialog with WORKING buttons.
          Single-assignment fork via /assignments/fork (forks into the
          CALLER's course); "fork entire group" needs a server route a
          non-owner may call (server-team flag). */}
      <Dialog
        title="Assignment Not Owned; Fork?"
        visible={forkOffer !== null}
        onClose={() => {
          setForkOffer(null);
          setForkUrl('');
        }}
        onOkay={() => {
          if (!api || active?.assignment.id == null || forkBusy) return;
          setForkBusy(true);
          setForkError('');
          void api
            .forkAssignment(active.assignment.id, {
              ...(forkUrl.trim() ? { url: forkUrl.trim() } : {}),
            })
            .then((response) => {
              setForkBusy(false);
              if (response.success === true && typeof response['id'] === 'number') {
                setForkOffer(null);
                setForkUrl('');
                // Adopt the fork: navigate to the new assignment id through
                // the host dispatch (URL + nav stay consistent).
                const load = dispatchRef.current ?? loadAssignment;
                void load(response['id'] as number).catch(() => undefined);
              } else {
                setForkError(String(response['message'] ?? 'The fork request failed.'));
              }
            });
        }}
        okayLabel={forkBusy ? 'Forking…' : 'Fork just this assignment'}
      >
        <p>
          {forkOffer?.message ||
            'It looks like you want to edit this assignment, but you are not an instructor ' +
              'in the course that owns it.'}
        </p>
        <p>
          Forking creates your own copy, owned by your course, that you can edit freely. You will
          need to update the Launch URL in the assignment&apos;s settings on your LMS to point at
          your copy.
        </p>
        <div className="form-group">
          <label htmlFor="blockpy-fork-url">
            New URL for your copy (optional; must be unique):{' '}
            <input
              id="blockpy-fork-url"
              type="text"
              className="form-control"
              value={forkUrl}
              onChange={(event) => setForkUrl(event.target.value)}
            />
          </label>
        </div>
        {forkError && <div className="alert alert-danger">{forkError}</div>}
      </Dialog>
      {versionOutdated && (
        <div className="alert alert-warning blockpy-version-outdated">
          The assignment has been updated since you started working on it. Reload the page to get
          the latest version - your code is saved.{' '}
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => setVersionOutdated(false)}
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Dual-rendered group header/footer (spec §9): the legacy template
          includes the macro at the top AND bottom of the page body
          (editor.html:102-103, 188-190), synced through one store. The TOP
          instance carries the instructor tools (LD-34); the bottom stays
          pure legacy. */}
      {topNavVisible && navStore && (
        <GroupNav store={navStore} {...(instructorTools ? { extras: instructorTools } : {})} />
      )}
      {/* Group-less pages have no nav bar to host the tools - a plain
          (non-sticky) right-aligned strip keeps instructor mode reachable. */}
      {!topNavVisible && instructorTools && (
        <div className="blockpy-instructor-bar" style={{ textAlign: 'right', padding: '2px 8px' }}>
          {instructorTools}
        </div>
      )}
      <AssignmentHost
        typeIndex={assignment.typeIndex}
        embed={display.embed}
        loadEditorAssignment={loadAssignment}
        renderAssignment={
          assignmentRenderers
            ? {
                reading: assignmentRenderers.reading,
                quiz: assignmentRenderers.quiz,
                textbook: assignmentRenderers.textbook,
                typescript: assignmentRenderers.typescript,
                explain: assignmentRenderers.explain,
              }
            : {}
        }
        onReady={(dispatch) => {
          dispatchRef.current = async (assignmentId: number) => {
            // Keep the selectors honest when the dispatch is host-driven
            // (boot deep link; nav-driven calls are already set).
            navStore?.setCurrentId(assignmentId);
            await dispatch(assignmentId);
          };
        }}
      >
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
            toolboxSetting={
              typeof settings['toolbox'] === 'string' ? settings['toolbox'] : undefined
            }
            hideFiles={
              settings['hide_files'] !== undefined ? settingBool(settings['hide_files']) : undefined
            }
            // preload_all_files forces the files UI visible (legacy
            // files.visible ORs it in, blockpy.js:914).
            preloadAllFiles={settingBool(settings['preload_all_files'] ?? false)}
            // enable_autocomplete ASSIGNMENT setting (M7.2, Studio
            // extension): default off; no per-user toggle exists.
            enableAutocomplete={settingBool(settings['enable_autocomplete'] ?? false)}
            hideEvaluate={
              settings['hide_evaluate'] !== undefined
                ? settingBool(settings['hide_evaluate'])
                : undefined
            }
            disableFeedback={
              settings['disable_feedback'] !== undefined
                ? settingBool(settings['disable_feedback'])
                : undefined
            }
            allowRealRequests={settingBool(settings['allow_real_requests'] ?? false)}
            // Docs panel source (M4.3, LD-25): raw string per A4 semantics.
            docsUrl={
              typeof settings['docs_url'] === 'string' && settings['docs_url']
                ? settings['docs_url']
                : undefined
            }
            disableTifa={settingBool(settings['disable_tifa'] ?? false)}
            disableInstructorRun={settingBool(settings['disable_instructor_run'] ?? false)}
            // Pool-question seed (on_run.js:43-45; LD-22): legacy currentSeed
            // = poolSeed || submission.id - no poolSeed UI yet (M2 deferral).
            seed={active?.submission?.id != null ? String(active.submission.id) : undefined}
            // Settings form (M3.5): assignment columns prefill from the
            // decoded assignment; Save persists blob + columns through
            // save_assignment (legacy saveAssignmentSettings) and live-applies
            // by updating the loaded assignment's settings string.
            assignmentFields={
              active
                ? {
                    name: active.assignment.name,
                    url: active.assignment.url,
                    points: String(active.assignment.raw['points'] ?? ''),
                    ipRanges: String(active.assignment.raw['ip_ranges'] ?? ''),
                    public: active.assignment.raw['public'] === true,
                    hidden: active.assignment.raw['hidden'] === true,
                    reviewed: active.assignment.raw['reviewed'] === true,
                  }
                : undefined
            }
            onSaveSettings={(blob, fields) => {
              setLoaded((prev) =>
                prev
                  ? {
                      ...prev,
                      assignment: {
                        ...prev.assignment,
                        settings: blob,
                        name: fields.name ?? prev.assignment.name,
                        url: fields.url ?? prev.assignment.url,
                      },
                    }
                  : prev,
              );
              if (api && active && api.isEndpointConnected('saveAssignment')) {
                void api
                  .saveAssignment({
                    assignment_id: active.assignment.id ?? '',
                    settings: blob,
                    ...(fields.name !== undefined ? { name: fields.name } : {}),
                    ...(fields.url !== undefined ? { url: fields.url } : {}),
                    ...(fields.points !== undefined && fields.points !== ''
                      ? { points: fields.points }
                      : {}),
                    ...(fields.ipRanges !== undefined ? { ip_ranges: fields.ipRanges } : {}),
                    ...(fields.public !== undefined ? { public: String(fields.public) } : {}),
                    ...(fields.hidden !== undefined ? { hidden: String(fields.hidden) } : {}),
                    ...(fields.reviewed !== undefined ? { reviewed: String(fields.reviewed) } : {}),
                  })
                  .then((response) => {
                    // Non-owner instructor save: the server rejects with
                    // forkable=true (helpers.py:55-60) - offer the fork
                    // (M7.9, LD-42; legacy startPossibleFork, server.js:657).
                    if (response.success === false && response['forkable'] === true) {
                      setForkError('');
                      setForkOffer({ message: String(response['message'] ?? '') });
                    }
                  });
              }
            }}
            assignmentHidden={active?.assignment.raw['hidden'] === true}
            runController={runController}
            onFileEdit={(filename, contents) => {
              if (sync && AUTOSAVE_FILES.has(filename)) {
                sync.saveFileDebounced(filename, contents);
              }
            }}
            onRunStart={(studentCode) => {
              // run.js:13 - answer.py saves immediately when a run starts.
              void sync?.saveFileNow('answer.py', studentCode);
            }}
            onGraded={(grade) => {
              void sync?.handleGraded(grade);
              // Display OR-chain (on_run.js:165) feeds the mark-submitted
              // text; the monotonic score feeds the instructor header.
              if (grade.success) setCorrect(true);
              if (sync) setScore(sync.displayScore);
            }}
            onLogEvent={logEvent}
            onEditorReady={(editor) => {
              dualEditorRef.current = editor;
            }}
            uploads={uploads}
            // Ratings render unless the assignment is hidden (blockpy.js:789).
            provideRatings={active ? active.assignment.raw['hidden'] !== true : true}
            submissionScore={score}
            onResetScore={() => {
              void sync?.resetScore();
              setScore(0);
              setCorrect(false);
            }}
            loadHistory={loadHistory}
            quickMenu={{
              grader: true,
              instructor: instructorView,
              onInstructorChange: setInstructorView,
              // has_clock ASSIGNMENT setting (A4 §6: default false; QuickMenu
              // resolved the legacy showClock inversion internally - pass the
              // positive value). Hardcoding `true` here was the M7.2 bug.
              hasClock: settingBool(settings['has_clock'] ?? false),
              // hide_queued_inputs (blockpy.js:627): hides Edit Inputs.
              hideQueuedInputs: settingBool(settings['hide_queued_inputs'] ?? false),
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
              // Mark-submitted ladder (blockpy.js:590-625) - the button shows
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
              onForceLoadAssignment: (data) => adoptAssignmentData(data as LegacyAssignmentPayload),
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
      </AssignmentHost>
      {navStore && !focusedMode && <GroupNav store={navStore} />}
    </main>
  );
}
