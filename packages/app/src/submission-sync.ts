/**
 * Submission lifecycle sync (spec §14.3 + §7.4 autosave) - the Studio port
 * of legacy server.js saveFile/_postLatestRetry/updateSubmission and the
 * on_run.js:162-175 grading sequence. The contract is pinned in
 * docs/appendices/skulpt-compat.md ("score semantics"):
 *
 * - feedback presents FIRST (the editor calls onGraded after setFeedback)
 * - score = clamp(SCORE, 0, 1) then max(previousScore) - monotonic
 * - the POSTed `correct` is the RAW success of THIS run
 * - markCorrect fires in the response handler when !hide && correct -
 *   legacy quirk: EVEN when the server responded success: false
 * - saveFile: per-filename trailing debounce (TIMER_DELAY 1000 ms),
 *   latest-wins; run start saves answer.py immediately (run.js:13)
 *
 * Studio hardening over legacy:
 * - every save/grade snapshots the wire ids (assignment, submission, …) at
 *   the moment of the edit, so a debounced save that fires after an
 *   assignment switch still lands on the assignment it belongs to
 * - saves are serialized per filename; a save superseded before it left
 *   is skipped, so an older POST can never overwrite a newer one
 * - pending debounced saves flush (keepalive) on dispose / page unload
 */
import type { ApiClient, WirePayload } from '@blockpy/api';
import type { GradeResult, ServerEndpoint, ServerStatusState } from '@blockpy/editor';

const TIMER_DELAY_MS = 1000; // legacy server.js:43

export interface SubmissionSyncOptions {
  api: ApiClient;
  /** Footer badge hook (legacy setStatus). */
  setStatus: (endpoint: ServerEndpoint, status: ServerStatusState, message?: string) => void;
  /** display.read_only gate - legacy checks it per call, so a getter. */
  readOnly: () => boolean;
  /** Legacy `callback.success` - the navigation markCorrect (§15.3). */
  markCorrect?: (assignmentId: number) => void;
  /**
   * saveFile responded `version_change: true` - the assignment changed
   * under this submission. Studio surfaces the §7.4 out-of-date banner
   * (legacy IGNORED the flag - ledger LD-11).
   */
  onVersionChange?: () => void;
  /**
   * Block-workspace PNG data URL for the updateSubmission payload -
   * legacy getPngFromBlocks (server.js:675-680); resolves '' when there
   * are no blocks or capture fails.
   */
  getImage?: () => Promise<string>;
  /** Scheduler injection for tests. */
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (timer: number) => void;
}

/** Assignment-owned filenames (server Assignment.INSTRUCTOR_FILENAMES). */
function isInstructorFile(filename: string): boolean {
  return (
    filename.startsWith('!') ||
    filename.startsWith('^') ||
    filename === '#extra_instructor_files.blockpy' ||
    filename === '#extra_starting_files.blockpy'
  );
}

/** The wire ids frozen at edit time (createServerData's id fields). */
export interface ContextSnapshot extends WirePayload {
  assignment_id: number | null;
  assignment_group_id: number | null;
  course_id: number | null;
  submission_id: number | null;
  version: number;
  assignment_version: number;
  part_id: string;
}

/** The serialization key for a save: same file AND same assignment/submission. */
function saveChainKey(filename: string, snapshot: ContextSnapshot): string {
  return `${filename}|${snapshot.assignment_id ?? ''}|${snapshot.submission_id ?? ''}`;
}

interface PendingSave {
  timer: number;
  contents: string;
  snapshot: ContextSnapshot;
}

export class SubmissionSync {
  /** Monotonic display score (legacy submission.score), seeded on load. */
  private score = 0;
  /** Monotonic display correctness (legacy submission.correct OR-chain). */
  private correct = false;
  private pending = new Map<string, PendingSave>();
  /**
   * Per-(filename, assignment, submission) save chain: an older POST never
   * overtakes a newer one for the SAME target. Every assignment's working
   * file is `answer.py`, so keying by filename alone would let a save for
   * assignment B supersede (and silently drop) a queued save for A.
   */
  private inflight = new Map<string, Promise<void>>();
  /** Per-chain sequence: the newest requested save for that target wins. */
  private latestSequence = new Map<string, number>();
  /**
   * This client saved an instructor file since the last version check.
   * Server-side, save_instructor_file bumps assignment.version, and the
   * NEXT student-file save reports `version_change` because the
   * submission row still carries the old assignment_version (save_code
   * then re-syncs it, so the flag fires exactly once). That "change" is
   * the instructor's own edit - not something to reload for - so the
   * one flag it produces is swallowed. Set only once the save actually
   * went out and succeeded; a failed save bumps nothing server-side.
   */
  private selfBumpedVersion = false;
  private schedule: (fn: () => void, ms: number) => number;
  private cancel: (timer: number) => void;

  constructor(private options: SubmissionSyncOptions) {
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  }

  /** Fail-soft image capture: a broken snapshot never blocks the POST. */
  private async captureImage(): Promise<string> {
    try {
      return (await this.options.getImage?.()) ?? '';
    } catch {
      return '';
    }
  }

  /** Freeze the ids a payload built RIGHT NOW would carry. */
  snapshotContext(): ContextSnapshot {
    const ctx = this.options.api.context;
    return {
      assignment_id: ctx.assignmentId,
      assignment_group_id: ctx.assignmentGroupId,
      course_id: ctx.courseId,
      submission_id: ctx.submissionId,
      version: ctx.submissionVersion,
      assignment_version: ctx.assignmentVersion,
      part_id: ctx.partId,
    };
  }

  /** Reset the monotonic state from a freshly loaded submission. */
  seed(score: number, correct: boolean): void {
    this.score = score;
    this.correct = correct;
  }

  get displayScore(): number {
    return this.score;
  }

  get displayCorrect(): boolean {
    return this.correct;
  }

  /** Filenames with a debounced save still waiting (tests, diagnostics). */
  get pendingFiles(): string[] {
    return [...this.pending.keys()];
  }

  private cancelPending(filename: string): PendingSave | undefined {
    const pending = this.pending.get(filename);
    if (pending !== undefined) {
      this.cancel(pending.timer);
      this.pending.delete(filename);
    }
    return pending;
  }

  /**
   * Debounced autosave (legacy saveFile default TIMER_DELAY): trailing,
   * latest-wins per filename - a newer edit cancels the pending POST. The
   * wire ids are frozen NOW, not when the timer fires.
   */
  saveFileDebounced(filename: string, contents: string): void {
    this.cancelPending(filename);
    const snapshot = this.snapshotContext();
    const timer = this.schedule(() => {
      this.pending.delete(filename);
      void this.saveFileNow(filename, contents, snapshot);
    }, TIMER_DELAY_MS);
    this.pending.set(filename, { timer, contents, snapshot });
  }

  /**
   * Immediate save (legacy `saveFile(..., null)` - run start, run.js:13).
   * Serialized per filename behind any in-flight save of the same file.
   */
  async saveFileNow(
    filename: string,
    contents: string,
    snapshot: ContextSnapshot = this.snapshotContext(),
  ): Promise<void> {
    // The immediate save IS the latest - drop the queued older one.
    this.cancelPending(filename);
    // A save is only superseded by a newer save for the SAME
    // assignment/submission - not by the next assignment's `answer.py`.
    const chainKey = saveChainKey(filename, snapshot);
    const sequence = (this.latestSequence.get(chainKey) ?? 0) + 1;
    this.latestSequence.set(chainKey, sequence);
    // Nothing in flight: start synchronously (the POST leaves before any
    // caller's next tick); otherwise queue behind the older save.
    const previous = this.inflight.get(chainKey);
    const run = previous
      ? previous.then(() => this.performSave(filename, contents, snapshot, chainKey, sequence))
      : this.performSave(filename, contents, snapshot, chainKey, sequence);
    this.inflight.set(chainKey, run);
    try {
      await run;
    } finally {
      if (this.inflight.get(chainKey) === run) this.inflight.delete(chainKey);
    }
  }

  private async performSave(
    filename: string,
    contents: string,
    snapshot: ContextSnapshot,
    chainKey: string,
    sequence: number,
  ): Promise<void> {
    // Superseded while queued behind an older POST: the newer save carries
    // the newer contents, so this one would only reorder them.
    if (this.latestSequence.get(chainKey) !== sequence) return;
    if (this.options.readOnly()) {
      this.options.setStatus('saveFile', 'offline');
      return;
    }
    if (!this.options.api.isEndpointConnected('saveFile')) {
      this.options.setStatus('saveFile', 'offline');
      return;
    }
    this.options.setStatus('saveFile', 'active');
    try {
      const response = await this.options.api.saveFile(filename, contents, snapshot, {
        onRetry: () => this.options.setStatus('saveFile', 'retrying'),
      });
      if (response.success === false) {
        this.options.setStatus(
          'saveFile',
          'failed',
          typeof response['message'] === 'string' ? response['message'] : '',
        );
        return;
      }
      this.options.setStatus('saveFile', 'ready');
      if (isInstructorFile(filename)) this.selfBumpedVersion = true;
      if (response['version_change'] === true) {
        if (this.selfBumpedVersion) {
          this.selfBumpedVersion = false;
        } else {
          this.options.onVersionChange?.();
        }
      }
    } catch (error) {
      // Retries exhausted (or a non-retryable 4xx): the save is lost.
      this.options.setStatus('saveFile', 'failed', String(error));
    }
  }

  /**
   * Fire every pending debounced save right now with the ids frozen at
   * edit time. `keepalive` is the unload path: one fire-and-forget POST
   * per file that the browser lets outlive the page.
   */
  flushPending(options: { keepalive?: boolean } = {}): Promise<void> {
    const saves: Promise<void>[] = [];
    for (const filename of [...this.pending.keys()]) {
      const pending = this.cancelPending(filename);
      if (!pending) continue;
      if (options.keepalive) {
        if (this.options.readOnly() || !this.options.api.isEndpointConnected('saveFile')) continue;
        void this.options.api
          .saveFile(filename, pending.contents, pending.snapshot, { keepalive: true })
          .catch(() => undefined);
      } else {
        saves.push(this.saveFileNow(filename, pending.contents, pending.snapshot));
      }
    }
    return Promise.all(saves).then(() => undefined);
  }

  /** Unmount: flush what is pending (keepalive) and stop scheduling. */
  dispose(): void {
    void this.flushPending({ keepalive: true });
  }

  /**
   * The footer badge's force-update (blockpy.js:1202-1208): re-POST the
   * current display score/correct with `force_update: true`.
   */
  async forceUpdate(): Promise<void> {
    if (this.options.readOnly() || !this.options.api.isEndpointConnected('updateSubmission')) {
      return;
    }
    this.options.setStatus('updateSubmission', 'active');
    try {
      const response = await this.options.api.updateSubmission({
        ...this.snapshotContext(),
        score: this.score,
        correct: this.correct,
        hidden_override: false,
        force_update: true,
        image: await this.captureImage(),
      });
      this.options.setStatus(
        'updateSubmission',
        response.success ? 'ready' : 'failed',
        response.success ? undefined : String(response['message'] ?? ''),
      );
    } catch (error) {
      this.options.setStatus('updateSubmission', 'failed', String(error));
    }
  }

  /**
   * Instructor "reset" on the feedback header (blockpy.js:784-788):
   * zero the display state, then POST score=0/correct=false with
   * hidden_override AND force_update both true.
   */
  async resetScore(): Promise<void> {
    this.score = 0;
    this.correct = false;
    if (this.options.readOnly() || !this.options.api.isEndpointConnected('updateSubmission')) {
      return;
    }
    this.options.setStatus('updateSubmission', 'active');
    try {
      const response = await this.options.api.updateSubmission({
        ...this.snapshotContext(),
        score: 0,
        correct: false,
        hidden_override: true,
        force_update: true,
        image: await this.captureImage(),
      });
      this.options.setStatus(
        'updateSubmission',
        response.success ? 'ready' : 'failed',
        response.success ? undefined : String(response['message'] ?? ''),
      );
    } catch (error) {
      this.options.setStatus('updateSubmission', 'failed', String(error));
    }
  }

  /**
   * The §14.3 grading sequence (on_run.js:164-175 + server.js:663-693).
   * Call AFTER the feedback pane presented. The ids are frozen before any
   * await so a switch during the POST never credits the wrong assignment.
   */
  async handleGraded(grade: GradeResult): Promise<void> {
    // Display state: monotonic OR / clamp + max (on_run.js:165-171).
    this.correct = grade.success || this.correct;
    const clamped = Math.max(0, Math.min(1, grade.score));
    this.score = Math.max(this.score, clamped);
    const snapshot = this.snapshotContext();
    if (this.options.readOnly()) {
      this.options.setStatus('updateSubmission', 'offline');
      return;
    }
    if (!this.options.api.isEndpointConnected('updateSubmission')) {
      return; // legacy: silently no-op when unconfigured (server.js:669)
    }
    this.options.setStatus('updateSubmission', 'active');
    let response;
    try {
      response = await this.options.api.updateSubmission(
        {
          ...snapshot,
          score: this.score,
          correct: grade.success, // RAW success of THIS run, not the OR
          hidden_override: grade.hideCorrectness,
          force_update: false,
          // Legacy awaits getPngFromBlocks before POSTing (server.js:675) -
          // the image field is always present, '' when capture yields none.
          image: await this.captureImage(),
        },
        { onRetry: () => this.options.setStatus('updateSubmission', 'retrying') },
      );
    } catch (error) {
      this.options.setStatus('updateSubmission', 'failed', String(error));
      return;
    }
    if (response.success) {
      this.options.setStatus('updateSubmission', 'ready');
    } else {
      this.options.setStatus(
        'updateSubmission',
        'failed',
        typeof response['message'] === 'string' ? response['message'] : '',
      );
    }
    // Legacy quirk (server.js:687-689): markCorrect fires on the response
    // REGARDLESS of response.success - only hide/correct gate it. It marks
    // the assignment that was GRADED, not whatever is current now.
    if (!grade.hideCorrectness && grade.success && this.options.markCorrect) {
      if (snapshot.assignment_id !== null) this.options.markCorrect(snapshot.assignment_id);
    }
  }
}
