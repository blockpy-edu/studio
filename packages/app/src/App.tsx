import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CodingEditor,
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
} from '@blockpy/api';
import { GroupNav, createGroupNavStore, type GroupNavStore } from '@blockpy/navigation';
import { Reader, type ReaderLoadResult } from '@blockpy/reader';
import { createEngineRunController } from './engine-adapter';
import { parseAssignmentSettings, vfsFromAssignment } from './assignment-loader';
import { AssignmentHost } from './AssignmentHost';
import { SubmissionSync } from './submission-sync';
import '@blockpy/editor/styles/tokens.css';
import '@blockpy/editor/styles/bootstrap-subset.css';
import '@blockpy/editor/styles/blockpy.css';
import '@blockpy/navigation/styles/navigation.css';
import '@blockpy/reader/styles/reader.css';
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
  // Legacy submission.submissionStatus/.correct/.score display state.
  const [submissionStatus, setSubmissionStatus] = useState('unknown');
  const [correct, setCorrect] = useState(false);
  const [score, setScore] = useState(0);
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

  // AssignmentHost dispatch (spec §5.3) — the modern loadAssignmentWrapper.
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
  }, [config.group, config.sessionStartTime, config.display.instructor, getGroupDuration, loadAssignment, logEvent]);
  navStoreRef.current = navStore;

  // §15.3 globals. `markCorrect` is the alias older content calls directly —
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
            // Unparseable URL — listed but not fetchable.
          }
        }
      }
      target.setRemoteFiles(urlMap);
      await Promise.all(
        entries.map(async (entry) => {
          // Legacy fetches only files it has not seen (files.js:725-731).
          if (target.hasRemoteContents(entry.filename)) return;
          try {
            const body = await api.downloadFile(
              entry.placement,
              entry.directory,
              entry.filename,
            );
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

  activeAssignmentUrlRef.current = active?.assignment.url ?? '';

  // Exam countdown feed (spec §9.4): the checker reads settings.time_limit
  // plus the per-student override and start from the submission — legacy
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
      }),
    [paths.pyodideIndexURL],
  );

  // -- reading slot (spec §11.2, M2.3) -----------------------------------------
  // The reader keeps its OWN loaded pair (legacy loadReading posts
  // loadAssignment without adopting into the editor model) — the editor's
  // `active` assignment is untouched while a reading is displayed.
  const renderReading = useMemo(() => {
    if (!api) return undefined;
    // Reading events attach to the READING's ids (§12; the legacy reader
    // builds its logEvent payload from its own pair, assignment_interface.ts
    // :266-284). One reading mounts at a time, so a shared slot suffices.
    const readingContext = { assignmentId: null as number | null, submissionId: null as number | null };
    const loadReading = async (id: number): Promise<ReaderLoadResult | null> => {
      const response = await api.loadAssignment(id);
      if (!response.success || !response.assignment) return null;
      readingContext.assignmentId = response.assignment.id ?? id;
      readingContext.submissionId = response.submission?.id ?? null;
      return {
        assignment: {
          id: response.assignment.id ?? id,
          name: response.assignment.name,
          url: response.assignment.url,
          instructions: response.assignment.instructions,
          settings: response.assignment.settings,
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
    // Legacy $URL_ROOT drives the popout editUrl (assignment.ts:103-107);
    // absent (app-owned pages without the global) the popout is hidden.
    const urlRoot = (window as unknown as Record<string, unknown>)['$URL_ROOT'];
    return (readingId: number) => (
      <Reader
        assignmentId={readingId}
        loadAssignment={loadReading}
        markRead={async (assignmentId, submissionId) => {
          // reader.ts:384-398 — updateSubmission {status: 1, correct: true}
          // with the READING's ids overriding the base payload.
          const response = await api.updateSubmission({
            assignment_id: assignmentId,
            submission_id: submissionId,
            status: 1,
            correct: true,
          });
          const message = response['message'];
          return {
            success: response.success === true,
            correct: response['correct'] === true,
            submissionStatus: response['submission_status'] as string | undefined,
            message:
              typeof message === 'object' && message !== null
                ? String((message as Record<string, unknown>)['message'] ?? '')
                : typeof message === 'string'
                  ? message
                  : undefined,
          };
        }}
        markCorrect={markCorrectEverywhere}
        logEvent={(eventType, category, label, message, filePath) => {
          try {
            void api
              .logEvent(eventType, category, label, message, filePath, false, {
                assignment_id: readingContext.assignmentId,
                submission_id: readingContext.submissionId,
              })
              .catch(() => undefined);
          } catch {
            // clientMayEmit refused the type — never break the reader.
          }
        }}
        downloadUrl={(assignmentId, filename) =>
          // Legacy leaves the filename unencoded (plugins.ts:272).
          `${config.urls.downloadFile}?placement=assignment&directory=${assignmentId}&filename=${filename}`
        }
        {...(typeof urlRoot === 'string'
          ? {
              editUrl: (a: { id: number; url: string }) =>
                urlRoot + '/assignments/reading/' + (a.url ? a.url : a.id) + '?',
            }
          : {})}
        runController={runController}
        blocklyMediaPath={paths.blocklyMedia}
        isInstructor={() => config.display.instructor}
        {...(api.isEndpointConnected('startAssignment')
          ? {
              startAssignment: async (assignmentId: number, dateStarted: string) => ({
                success:
                  (await api.startAssignment(assignmentId, dateStarted)).success === true,
              }),
            }
          : {})}
        onTimeLimitInfo={(info) =>
          navStoreRef.current?.setTimeLimit({
            timeLimit: info.timeLimit,
            studentTimeLimit: info.studentTimeLimit,
            dateStarted: info.dateStarted,
          })
        }
      />
    );
  }, [
    api,
    markCorrectEverywhere,
    config.urls.downloadFile,
    config.display.instructor,
    runController,
    paths.blocklyMedia,
  ]);

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
      {/* Dual-rendered group header/footer (spec §9): the legacy template
          includes the macro at the top AND bottom of the page body
          (editor.html:102-103, 188-190), synced through one store. */}
      {navStore && <GroupNav store={navStore} />}
      <AssignmentHost
        typeIndex={assignment.typeIndex}
        embed={display.embed}
        loadEditorAssignment={loadAssignment}
        renderAssignment={renderReading ? { reading: renderReading } : {}}
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
      </AssignmentHost>
      {navStore && <GroupNav store={navStore} />}
    </main>
  );
}
