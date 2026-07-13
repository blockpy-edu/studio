/**
 * Submission lifecycle sync (spec §14.3 + §7.4 autosave) — the Studio port
 * of legacy server.js saveFile/_postLatestRetry/updateSubmission and the
 * on_run.js:162-175 grading sequence. The contract is pinned in
 * docs/appendices/skulpt-compat.md ("score semantics"):
 *
 * - feedback presents FIRST (the editor calls onGraded after setFeedback)
 * - score = clamp(SCORE, 0, 1) then max(previousScore) — monotonic
 * - the POSTed `correct` is the RAW success of THIS run
 * - markCorrect fires in the response handler when !hide && correct —
 *   legacy quirk: EVEN when the server responded success: false
 * - saveFile: per-filename trailing debounce (TIMER_DELAY 1000 ms),
 *   latest-wins; run start saves answer.py immediately (run.js:13)
 */
import type { ApiClient } from '@blockpy/api';
import type { GradeResult, ServerEndpoint, ServerStatusState } from '@blockpy/editor';

const TIMER_DELAY_MS = 1000; // legacy server.js:43

export interface SubmissionSyncOptions {
  api: ApiClient;
  /** Footer badge hook (legacy setStatus). */
  setStatus: (endpoint: ServerEndpoint, status: ServerStatusState, message?: string) => void;
  /** display.read_only gate — legacy checks it per call, so a getter. */
  readOnly: () => boolean;
  /** Legacy `callback.success` — the navigation markCorrect (§15.3). */
  markCorrect?: (assignmentId: number) => void;
  /**
   * saveFile responded `version_change: true` — the assignment changed
   * under this submission. Studio surfaces the §7.4 out-of-date banner
   * (legacy IGNORED the flag — ledger LD-11).
   */
  onVersionChange?: () => void;
  /**
   * Block-workspace PNG data URL for the updateSubmission payload —
   * legacy getPngFromBlocks (server.js:675-680); resolves '' when there
   * are no blocks or capture fails.
   */
  getImage?: () => Promise<string>;
  /** Scheduler injection for tests. */
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (timer: number) => void;
}

export class SubmissionSync {
  /** Monotonic display score (legacy submission.score), seeded on load. */
  private score = 0;
  /** Monotonic display correctness (legacy submission.correct OR-chain). */
  private correct = false;
  private timers = new Map<string, number>();
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

  /**
   * Debounced autosave (legacy saveFile default TIMER_DELAY): trailing,
   * latest-wins per filename — a newer edit cancels the pending POST.
   */
  saveFileDebounced(filename: string, contents: string): void {
    const pending = this.timers.get(filename);
    if (pending !== undefined) this.cancel(pending);
    this.timers.set(
      filename,
      this.schedule(() => {
        this.timers.delete(filename);
        void this.saveFileNow(filename, contents);
      }, TIMER_DELAY_MS),
    );
  }

  /** Immediate save (legacy `saveFile(..., null)` — run start, run.js:13). */
  async saveFileNow(filename: string, contents: string): Promise<void> {
    const pending = this.timers.get(filename);
    if (pending !== undefined) {
      // The immediate save IS the latest — drop the queued older one.
      this.cancel(pending);
      this.timers.delete(filename);
    }
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
      const response = await this.options.api.saveFile(filename, contents);
      if (response.success === false) {
        this.options.setStatus(
          'saveFile',
          'failed',
          typeof response['message'] === 'string' ? response['message'] : '',
        );
      } else {
        this.options.setStatus('saveFile', 'ready');
        if (response['version_change'] === true) {
          this.options.onVersionChange?.();
        }
      }
    } catch {
      // Transport.postRetry only rejects when a test caps retries; legacy
      // keeps retrying forever and shows RETRYING meanwhile.
      this.options.setStatus('saveFile', 'retrying');
    }
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
   * Call AFTER the feedback pane presented.
   */
  async handleGraded(grade: GradeResult): Promise<void> {
    // Display state: monotonic OR / clamp + max (on_run.js:165-171).
    this.correct = grade.success || this.correct;
    const clamped = Math.max(0, Math.min(1, grade.score));
    this.score = Math.max(this.score, clamped);
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
      response = await this.options.api.updateSubmission({
        score: this.score,
        correct: grade.success, // RAW success of THIS run, not the OR
        hidden_override: grade.hideCorrectness,
        force_update: false,
        // Legacy awaits getPngFromBlocks before POSTing (server.js:675) —
        // the image field is always present, '' when capture yields none.
        image: await this.captureImage(),
      });
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
    // REGARDLESS of response.success — only hide/correct gate it.
    if (!grade.hideCorrectness && grade.success && this.options.markCorrect) {
      const assignmentId = this.options.api.context.assignmentId;
      if (assignmentId !== null) this.options.markCorrect(assignmentId);
    }
  }
}
