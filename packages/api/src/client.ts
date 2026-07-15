/**
 * Typed client for the legacy blockpy-server endpoints (spec §14.2-14.3).
 * Payload shapes are validated against the golden transcript
 * (docs/appendices/transcripts/, appendix A5) by the replay suite.
 */
import { createServerData, type ApiContext, type LegacyUrlMap, type WirePayload } from './context';
import { decodeAssignment, decodeSubmission, type RawRecord } from './decoder';
import { clientMayEmit } from './events';
import type { LegacyResponse, Transport } from './transport';

export interface ApiClientOptions {
  urls: LegacyUrlMap;
  context: ApiContext;
  transport: Transport;
  /** Injectable clock (tests); defaults to `() => new Date()`. */
  now?: () => Date;
  /** display.readOnly: blocks ALL persistence calls (A1 §2, A2 §2). */
  readOnly?: () => boolean;
}

export class ApiClient {
  private now: () => Date;

  constructor(private options: ApiClientOptions) {
    this.now = options.now ?? (() => new Date());
  }

  get context(): ApiContext {
    return this.options.context;
  }

  /** The base + extra fields a given endpoint call puts on the wire. */
  buildPayload(extra: WirePayload = {}): WirePayload {
    return { ...createServerData(this.options.context, this.now), ...extra };
  }

  private url(key: keyof LegacyUrlMap): string {
    const url = this.options.urls[key as string];
    if (!url) throw new Error(`No URL configured for endpoint "${String(key)}"`);
    return url;
  }

  isEndpointConnected(key: keyof LegacyUrlMap): boolean {
    return Boolean(this.options.urls[key as string]);
  }

  private guardReadOnly(): boolean {
    return this.options.readOnly?.() === true;
  }

  // -- assignment & submission ------------------------------------------------

  async loadAssignment(assignmentId: number) {
    const payload = this.buildPayload({ assignment_id: assignmentId });
    const response = await this.options.transport.postRetry(this.url('loadAssignment'), payload);
    return {
      success: response.success === true,
      assignment: response.assignment
        ? decodeAssignment(response.assignment as RawRecord)
        : undefined,
      submission: response.submission
        ? decodeSubmission(response.submission as RawRecord)
        : undefined,
      raw: response,
    };
  }

  /**
   * Persist one legacy-named file. The response's `version_change: true`
   * drives the "your code is out of date / reload" banner (spec §7.4).
   * `overrides` lets non-editor surfaces (quiz autosave) attach their own
   * ids, mirroring the AssignmentInterface's hand-built payload
   * (assignment_interface.ts:287-341).
   */
  async saveFile(
    filename: string,
    code: string,
    overrides: WirePayload = {},
  ): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(
      this.url('saveFile'),
      this.buildPayload({ filename, code, ...overrides }),
    );
  }

  async saveAssignment(fields: WirePayload): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(this.url('saveAssignment'), this.buildPayload(fields));
  }

  /**
   * Group organizer endpoints (M4.6 slice 1). Server routes exist today
   * (`/assignment_group/edit`, `/assignment_group/move_membership`,
   * assignment_groups.py:89-137) but the legacy editor template never
   * published their URLs - capability-detected via `isEndpointConnected`.
   */
  async editAssignmentGroup(fields: {
    assignment_group_id: number;
    new_name: string;
    new_url?: string;
  }): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(
      this.url('editAssignmentGroup'),
      this.buildPayload(fields as unknown as WirePayload),
    );
  }

  /**
   * `/assignments/by_url` (M4.7; closes LD-16): resolve an assignment url
   * slug to its record. GET-only route; returns null on any failure - the
   * textbook renders unresolved refs as Missing Reading.
   */
  async loadAssignmentByUrl(
    url: string,
  ): Promise<{ id: number; name: string; url: string } | null> {
    if (!this.isEndpointConnected('loadAssignmentByUrl')) return null;
    try {
      const courseId = this.options.context.courseId;
      const response = await this.options.transport.getJson(this.url('loadAssignmentByUrl'), {
        url,
        ...(courseId !== null ? { course_id: courseId } : {}),
      });
      const record = response['assignment'] as
        { id?: unknown; name?: unknown; url?: unknown } | undefined;
      if (response.success !== true || !record || typeof record.id !== 'number') {
        return null;
      }
      return {
        id: record.id,
        name: typeof record.name === 'string' ? record.name : `Assignment ${record.id}`,
        url: typeof record.url === 'string' ? record.url : url,
      };
    } catch {
      return null; // Fail soft: unresolved = legacy Missing Reading style.
    }
  }

  /**
   * Fork a non-owned assignment into the CALLER's course (M7.9, LD-42).
   * Wire contract = the WORKING `/assignments/fork` route
   * (assignments.py:133-178): `assignment_id`, optional `group` (target
   * group id) and `url` (collision → failure "URL is already taken");
   * course from the base payload. Response carries the FORK's
   * `{id, url, name, redirect, edit}`. SERVER-TEAM FLAG: today's templates
   * publish `forkAssignment` = `blockpy.fork_assignment`
   * (editor.html:205), a half-finished route that never returns the
   * fork's id (blockpy.py:1139-1178) - repoint it at
   * `url_for('assignments.fork')`. Callers must treat a success response
   * WITHOUT a numeric `id` as failure (the App does).
   */
  async forkAssignment(
    assignmentId: number,
    options: { group?: number; url?: string } = {},
  ): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(
      this.url('forkAssignment'),
      this.buildPayload({
        assignment_id: assignmentId,
        ...(options.group !== undefined ? { group: options.group } : {}),
        ...(options.url !== undefined ? { url: options.url } : {}),
      }),
    );
  }

  /** `new_group_id: -1` removes the assignment from any group. */
  async moveMembership(fields: {
    assignment_id: number;
    old_group_id: number;
    new_group_id: number;
  }): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(
      this.url('moveMembership'),
      this.buildPayload(fields as unknown as WirePayload),
    );
  }

  async loadHistory(): Promise<LegacyResponse> {
    return this.options.transport.postRetry(this.url('loadHistory'), this.buildPayload());
  }

  /**
   * Autograding score/correctness update (spec §14.3). Field set per the
   * golden transcript: status, correct (+ optional image/score/hidden).
   */
  async updateSubmission(
    fields: { status?: number; correct?: boolean; score?: number; image?: string } & WirePayload,
  ): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(
      this.url('updateSubmission'),
      this.buildPayload(fields),
    );
  }

  /** `status` is a STRING on the wire ("Submitted", "inProgress" - the
   *  server passes it verbatim to grade_submission, blockpy.py:567-585). */
  async updateSubmissionStatus(status: string): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(
      this.url('updateSubmissionStatus'),
      this.buildPayload({ status }),
    );
  }

  /**
   * Exam-timer start (spec §9.4/§11.2): the reader's "I am ready to start
   * the exam!" button POSTs blockpy/start_assignment with the reading's id
   * and the client-chosen ISO start (legacy ajax_post, reader.ts:109-135).
   * The base payload's ids ride along like every other call.
   */
  async startAssignment(assignmentId: number, dateStarted: string): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(
      this.url('startAssignment'),
      this.buildPayload({ assignment_id: assignmentId, date_started: dateStarted }),
    );
  }

  /**
   * Total time spent across the group's sessions - the clock's "activity"
   * mode (spec §9.4). Legacy is a page-level `$.get` global with the ids
   * baked into the URL (editor.html:395-399); the endpoint takes GET or
   * POST (blockpy.py:1248-1262) and the base payload already carries
   * assignment_group_id/course_id. Response: `{success, duration}`.
   */
  async estimateGroupDuration(): Promise<LegacyResponse> {
    return this.options.transport.postRetry(this.url('estimateGroupDuration'), this.buildPayload());
  }

  async saveImage(directory: string, image: string): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postRetry(
      this.url('saveImage'),
      this.buildPayload({ directory, image }),
    );
  }

  // -- uploaded files (spec §14.2; legacy server.js:468-544, images.js) --------

  /**
   * Response shape: `{success, files: {placement: [[filename, url], …]}}`.
   * Legacy `_postBlocking(…, 2 attempts)` with the base urlencoded payload.
   */
  async listUploadedFiles(): Promise<LegacyResponse> {
    return this.options.transport.postRetry(this.url('listUploadedFiles'), this.buildPayload());
  }

  /**
   * Multipart upload; `deleteInstead` reuses the endpoint with empty
   * contents + `delete: true` (legacy images.js:239-256).
   */
  async uploadFile(
    placement: string,
    directory: string | number,
    filename: string,
    contents: Blob | string,
    deleteInstead = false,
  ): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    const fields: Record<string, string | number | boolean | null | Blob> = {
      ...this.buildPayload(),
      placement,
      directory: String(directory),
      filename,
      contents,
    };
    if (deleteInstead) fields['delete'] = true;
    return this.options.transport.postForm(this.url('uploadFile'), fields, {
      attempts: 3,
    }) as Promise<LegacyResponse>;
  }

  /** Raw text response (legacy dataType: "text", server.js:507-524). */
  async downloadFile(
    placement: string,
    directory: string | number,
    filename: string,
  ): Promise<string> {
    return this.options.transport.postForm(
      this.url('downloadFile'),
      { ...this.buildPayload(), placement, directory: String(directory), filename },
      { attempts: 3, text: true },
    ) as Promise<string>;
  }

  async renameFile(
    placement: string,
    directory: string | number,
    oldFilename: string,
    newFilename: string,
  ): Promise<LegacyResponse> {
    if (this.guardReadOnly()) return { success: false, readOnly: true };
    return this.options.transport.postForm(
      this.url('renameFile'),
      {
        ...this.buildPayload(),
        placement,
        directory: String(directory),
        old_filename: oldFilename,
        new_filename: newFilename,
      },
      { attempts: 3 },
    ) as Promise<LegacyResponse>;
  }

  // -- event logging (A2 §1-2) -------------------------------------------------

  /**
   * Per-event POST with offline queueing. Drops events (legacy behavior)
   * when read-only or the endpoint is unconfigured. Refuses server-fabricated
   * and dead event types (registry-enforced, D2).
   */
  async logEvent(
    eventType: string,
    category = '',
    label = '',
    message = '',
    filePath = '',
    extended = false,
    overrides: WirePayload = {},
  ): Promise<LegacyResponse | undefined> {
    if (!clientMayEmit(eventType)) {
      throw new Error(
        `Event type "${eventType}" must not be emitted by the client (see events.ts)`,
      );
    }
    if (this.guardReadOnly() || !this.isEndpointConnected('logEvent')) return undefined;
    // `overrides` lets a non-editor surface attach its OWN ids - the legacy
    // reader/quiz AssignmentInterface builds its payload from its own loaded
    // pair, not the editor model (assignment_interface.ts:266-284, §12).
    const payload = this.buildPayload({
      event_type: eventType,
      category,
      label,
      message,
      file_path: filePath,
      extended,
      ...overrides,
    });
    const transport = this.options.transport;
    transport.enqueue(payload);
    const response = await transport.postRetry(this.url('logEvent'), payload);
    if (response.success !== false) transport.dequeue(payload);
    return response;
  }

  /** Boot-time drain of the offline event queue (LIFO, legacy semantics). */
  flushEventQueue(): Promise<number> {
    return this.options.transport.flushQueue(this.url('logEvent'));
  }
}
