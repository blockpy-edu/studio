/**
 * Request context: the base payload every legacy endpoint receives
 * (`createServerData()`, legacy client/server.js:178-200; verified A2 §1.2
 * and live in the golden transcript).
 */

/** Exactly the keys of window.$blockPyUrls (spec §14.2). */
export interface LegacyUrlMap {
  loadAssignment?: string;
  saveAssignment?: string;
  loadHistory?: string;
  logEvent?: string;
  saveFile?: string;
  saveImage?: string;
  listUploadedFiles?: string;
  uploadFile?: string;
  renameFile?: string;
  downloadFile?: string;
  updateSubmission?: string;
  updateSubmissionStatus?: string;
  forkAssignment?: string;
  importDatasets?: string;
  instructionsAssignmentSetup?: string;
  openaiProxy?: string;
  shareUrl?: string;
  [key: string]: string | undefined;
}

export interface ApiContext {
  assignmentId: number | null;
  assignmentGroupId: number | null;
  courseId: number | null;
  submissionId: number | null;
  userId: number | null;
  /** submission.version — goes on the wire as `version` (A2 §1.2). */
  submissionVersion: number;
  assignmentVersion: number;
  passcode: string;
  /** Reader-embedded editor region id (empty when not embedded). */
  partId: string;
}

export type WireValue = string | number | boolean | null;
export type WirePayload = Record<string, WireValue>;

/**
 * The eleven base fields (A2 §1.2). `timestamp` is epoch **milliseconds**,
 * `timezone` is `getTimezoneOffset()` minutes — both stored verbatim by the
 * server and parsed downstream by research code, so the encoding is
 * load-bearing (A2 §1.4).
 */
export function createServerData(ctx: ApiContext, now: () => Date): WirePayload {
  const date = now();
  return {
    assignment_id: ctx.assignmentId,
    assignment_group_id: ctx.assignmentGroupId,
    course_id: ctx.courseId,
    submission_id: ctx.submissionId,
    user_id: ctx.userId,
    version: ctx.submissionVersion,
    assignment_version: ctx.assignmentVersion,
    timestamp: date.getTime(),
    timezone: date.getTimezoneOffset(),
    passcode: ctx.passcode,
    part_id: ctx.partId,
  };
}
