/**
 * Quick Menu — Row 1 right column (A8 §1: `.col-md-3.blockpy-panel
 * .blockpy-quick-menu`, role=menubar, warm border-left). Legacy markup
 * interface.js:117-193; behaviors blockpy.js `ui.menu.*` (567-660).
 *
 * Ported here: mark-submitted button (full legacy text/click ladder),
 * "View as instructor" checkbox (graders), fullscreen toggle, Edit Queued
 * Inputs dialog (dialog.js EDIT_INPUTS — feeds compat-mode `inputsPrefill`),
 * Toggle Images, Get Shareable Link (hidden without a share URL, like
 * legacy `canShare`), the pink bug icon (rendered but `display:none` — dead
 * in legacy too: only ever `.hide()`, feedback.js:269), and the wall clock
 * (`has_clock`; A4 §6 documents the inverted `showClock` naming — behavior
 * ported, names not).
 *
 * Deferred: owner/readonly spying controls, instructor-stdout dialog, and
 * the pool seed input (M2 quiz pools).
 */
import { useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { Icon } from './icons';
import { useEditorChromeStore, type ThemeName } from './store';

/** Theme cycle order (M4.1): light → dark → win2000 → light. */
const NEXT_THEME: Record<ThemeName, ThemeName> = {
  light: 'dark',
  dark: 'win2000',
  win2000: 'light',
};

const THEME_LABELS: Record<ThemeName, string> = {
  light: 'Light',
  dark: 'Dark',
  win2000: 'Windows 2000',
};

/**
 * Legacy `getCurrentTime` (utilities.js:336-348) — including the quirk that
 * noon/midnight render as "0:05pm"/"0:05am" (`hours % 12`, never 12).
 */
export function formatClockTime(now: Date): string {
  const h = Math.floor(now.getHours() % 12);
  const m = now.getMinutes();
  const mm = m < 10 ? `0${m}` : `${m}`;
  const p = now.getHours() >= 12 ? 'pm' : 'am';
  return `${h}:${mm}${p}`;
}

/** Inputs to the mark-submitted ladder (legacy model slices). */
export interface SubmissionControls {
  /** submission.submissionStatus (case-insensitive in legacy). */
  status: string;
  /** assignment.reviewed */
  reviewed?: boolean;
  /** assignment.settings.canClose */
  canClose?: boolean;
  /** assignment.hidden */
  hidden?: boolean;
  /** submission.correct */
  correct?: boolean;
  /** user.groupId — only affects the "closed" caption. */
  grouped?: boolean;
  onUpdateStatus(status: 'inProgress' | 'Submitted'): void;
}

/**
 * Legacy `ui.menu.textMarkSubmitted` (blockpy.js:593-607). `dirty` is
 * `display.dirtySubmission`.
 */
export function markSubmittedText(controls: SubmissionControls, dirty: boolean): string {
  if (controls.status.toLowerCase() === 'completed') {
    return controls.grouped ? 'Problem closed' : 'Assignment closed';
  }
  if (isSubmitted(controls)) {
    return 'Reopen for editing';
  }
  if (dirty) {
    return 'Run';
  }
  return !controls.hidden && controls.correct ? 'Submit' : 'Submit early';
}

/** Legacy `ui.menu.isSubmitted` (blockpy.js:619-622). */
export function isSubmitted(controls: SubmissionControls): boolean {
  return (
    Boolean(controls.reviewed || controls.canClose) && controls.status.toLowerCase() === 'submitted'
  );
}

export interface QuickMenuProps {
  /** ui.role.isGrader — shows the "View as instructor" checkbox. */
  grader?: boolean;
  /** display.instructor (drives the checkbox state). */
  instructor?: boolean;
  onInstructorChange?(instructor: boolean): void;
  /** `has_clock` setting: true ⇒ ticking wall clock (A4 §6). */
  hasClock?: boolean;
  /** `hide_queued_inputs` setting. */
  hideQueuedInputs?: boolean;
  /**
   * Legacy canShare/getShareUrl (blockpy.js:632-657): the button renders
   * only when provided; clicking builds the link and opens START_SHARE.
   */
  shareUrl?(): string;
  /** Mark-submitted button — renders only when reviewed/canClose allow. */
  submission?: SubmissionControls;
  /** Legacy engine.delayedRun for the "Run" branch of mark-submitted. */
  onRun?(): void;
  /** X-Display.Fullscreen.* events (wired to the logger at M1.6). */
  onLogEvent?(eventType: string, message: string): void;
}

export function QuickMenu(props: QuickMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(false);
  const [inputsDraft, setInputsDraft] = useState('');
  const [reuseDraft, setReuseDraft] = useState(false);
  const [clockText, setClockText] = useState('');

  const store = useEditorChromeStore;
  const dirty = useEditorChromeStore((state) => state.dirtySubmission);
  const theme = useEditorChromeStore((state) => state.theme);

  // Track browser fullscreen so the icon flips even on Esc exits.
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  // Wall clock: 1 s tick while enabled (blockpy.js:1277-1295).
  useEffect(() => {
    if (!props.hasClock) return;
    const tick = () => setClockText(formatClockTime(new Date()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [props.hasClock]);

  const toggleFullscreen = () => {
    props.onLogEvent?.('X-Display.Fullscreen.Request', String(!fullscreen));
    if (document.fullscreenElement !== null) {
      void document.exitFullscreen().then(() => {
        props.onLogEvent?.('X-Display.Fullscreen.Exit', 'false');
      });
      return;
    }
    // Legacy targets the container's parent (blockpy.js:1084).
    const content = rootRef.current?.closest('.blockpy-content');
    const target = content?.parentElement ?? content;
    // Ledger LD-17: two-arm handling. Legacy chained .catch().then()
    // (interface.js:55-63), so Success ALSO logged after the Error path
    // swallowed a rejection — failures now log ONLY the Error event.
    void target?.requestFullscreen().then(
      () => {
        props.onLogEvent?.('X-Display.Fullscreen.Success', '');
      },
      (err: Error) => {
        const message = `Error attempting to enable full-screen mode: ${err.message} (${err.name})`;
        props.onLogEvent?.('X-Display.Fullscreen.Error', message);
        alert(message);
      },
    );
  };

  const [shareOpen, setShareOpen] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [sharePrompted, setSharePrompted] = useState(false);
  const openShare = (wasPrompted = false) => {
    if (!props.shareUrl) return;
    setShareLink(props.shareUrl());
    setCopied(false);
    setSharePrompted(wasPrompted);
    setShareOpen(true);
  };
  const copyShareLink = () => {
    void navigator.clipboard.writeText(shareLink).then(() => setCopied(true));
  };
  // A feedback rating requested the prompted variant (legacy rate →
  // startShare(true), blockpy.js:808-812) — the Feedback pane raises the
  // store flag; this menu owns the dialog.
  const promptedShareRequested = useEditorChromeStore((state) => state.promptedShare);
  const shareUrlRef = useRef(props.shareUrl);
  shareUrlRef.current = props.shareUrl;
  useEffect(() => {
    if (!promptedShareRequested) return;
    store.getState().clearPromptedShare();
    if (shareUrlRef.current) {
      setShareLink(shareUrlRef.current());
      setCopied(false);
      setSharePrompted(true);
      setShareOpen(true);
    }
  }, [promptedShareRequested, store]);

  const openInputsDialog = () => {
    const { queuedInputs, clearInputs } = store.getState();
    setInputsDraft(queuedInputs.join('\n'));
    setReuseDraft(!clearInputs);
    setInputsOpen(true);
  };

  const saveInputs = () => {
    const { setQueuedInputs, setClearInputs } = store.getState();
    setQueuedInputs(inputsDraft.split('\n'));
    setClearInputs(!reuseDraft);
    setInputsOpen(false);
  };

  const submission = props.submission;
  const clickMarkSubmitted = () => {
    if (!submission) return;
    if (submission.status.toLowerCase() === 'completed') {
      alert('You cannot reopen closed assignments. Contact a grader!');
    } else if (isSubmitted(submission)) {
      submission.onUpdateStatus('inProgress');
    } else if (dirty) {
      props.onRun?.();
    } else {
      submission.onUpdateStatus('Submitted');
    }
  };

  return (
    <div
      ref={rootRef}
      className="col-md-3 blockpy-panel blockpy-quick-menu"
      // Legacy said role=menubar (interface.js:117), but the children are
      // plain buttons, not menuitems — menubar's required-children ARIA
      // contract fails (WCAG audit M6.1). toolbar matches the actual
      // widgetry; non-visual delta.
      role="toolbar"
      aria-label="Quick Menu"
      title="Quick Menu"
    >
      {submission && isSubmitted(submission) && (
        <span>Your submission is ready to be reviewed!</span>
      )}
      {submission && (submission.reviewed || submission.canClose) && (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={clickMarkSubmitted}
        >
          {markSubmittedText(submission, dirty)}
        </button>
      )}
      {props.grader && (
        <div className="form-check">
          <input
            className="form-check-input"
            type="checkbox"
            id="blockpy-as-instructor"
            checked={props.instructor ?? false}
            onChange={(event) => props.onInstructorChange?.(event.target.checked)}
          />
          <label className="form-check-label" htmlFor="blockpy-as-instructor">
            View as instructor
          </label>
        </div>
      )}
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={toggleFullscreen}
        title="Full Screen"
      >
        <Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} />
      </button>
      {!props.hideQueuedInputs && (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={openInputsDialog}
          title="Edit Inputs"
        >
          <Icon name="inputs" />
        </button>
      )}
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={() => store.getState().toggleRenderImages()}
        title="Toggle Images"
      >
        <Icon name="images" />
      </button>
      {/* M4.1 theme cycler (Studio extension, LD-23): light is the parity
          default; dark/win2000 are explicit opt-ins, persisted. */}
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        onClick={() => store.getState().setTheme(NEXT_THEME[theme])}
        title={`Color Theme: ${THEME_LABELS[theme]} (click for ${THEME_LABELS[NEXT_THEME[theme]]})`}
      >
        <Icon name="theme" />
      </button>
      {props.shareUrl && (
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => openShare()}
          title="Get Shareable Link for Instructors or TAs"
        >
          <Icon name="share" />
        </button>
      )}
      {/* Dead in legacy: display:none, only ever .hide() (feedback.js:269). */}
      <span className="blockpy-student-error">
        <Icon name="bug" />
      </span>
      {props.hasClock && <span className="blockpy-menu-clock">{clockText}</span>}

      <Dialog
        title="Edit Remembered Inputs"
        visible={inputsOpen}
        onClose={() => setInputsOpen(false)}
        onOkay={saveInputs}
        okayLabel="Save"
      >
        <div className="form-check">
          <input
            type="checkbox"
            className="blockpy-remember-inputs form-check-input"
            id="blockpy-remember-inputs"
            checked={reuseDraft}
            onChange={(event) => setReuseDraft(event.target.checked)}
          />
          <label className="form-check-label" htmlFor="blockpy-remember-inputs">
            Reuse inputs for next execution
          </label>
        </div>
        <textarea
          className="blockpy-input-list form-control"
          rows={4}
          value={inputsDraft}
          onChange={(event) => setInputsDraft(event.target.value)}
        />
        <br />
        Edit the inputs above to store and reuse them across multiple executions. Each input should
        be put on its own line. You do not need quotes; the text will be entered literally.
      </Dialog>

      {/* Legacy START_SHARE (dialog.js:218-261), unprompted variant; the
          prompted variant attaches to feedback nudges (M2). QR rendering
          fails soft exactly like legacy without its QRCode lib. */}
      <Dialog
        title="Share Your Code"
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        onOkay={() => setShareOpen(false)}
        okayLabel="Close"
      >
        <div className="mb-4">
          {sharePrompted
            ? 'It looks like you are having some trouble with this problem, ' +
              'your code, or this feedback. If you plan to reach out for help ' +
              'from the course staff, then we recommend you include this link ' +
              'in your message. It will make it much easier for them to help ' +
              'you quickly.'
            : 'You can quickly share your code with instructors and TAs by ' +
              'providing them with this link:'}
        </div>
        <div className="mb-4">
          <pre className="blockpy-copy-share-link-area">{shareLink}</pre>
          <button
            type="button"
            className="btn btn-outline-secondary blockpy-copy-share-link"
            onClick={copyShareLink}
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
        <div className="mb-4">
          Note that you CANNOT share this link with other students, or access it yourself. This is
          strictly for sharing with the course staff when something goes wrong or you need help with
          your code.
        </div>
        <div className="mb-4">
          The link is also available through this QR code. Do not share this QR code unless your
          instructor or TA asks you to.
          <div className="blockpy-copy-share-qrcode">QR code generation failed.</div>
        </div>
      </Dialog>
    </div>
  );
}
