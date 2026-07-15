/**
 * Footer - Row 5 (A8 §1; legacy FOOTER_HTML, footer.js:2-41):
 * `.col-md-12.blockpy-panel.blockpy-status` with three lines -
 *   1. server-status badges, one per endpoint, class
 *      `server-status-<state>` (blockpy.js ui.server.status);
 *      "Load Assignment" wraps a hidden [INSTRUCTOR] force-load file input,
 *      "Update Submission" is clickable (force update);
 *   2. the first non-empty server status message;
 *   3. the identity line (user/course/group/assignment/submission versions).
 * Legacy visibility: `display.instructor() || !ui.smallLayout()`
 * (blockpy.js:1211-1215) - the parent decides; smallLayout lands with the
 * settings wiring.
 */
import type { ChangeEvent } from 'react';
import { SERVER_ENDPOINTS, useEditorChromeStore } from './store';

/** Badge captions in legacy DOM order (footer.js:4-21). */
const ENDPOINT_LABELS: Record<(typeof SERVER_ENDPOINTS)[number], string> = {
  loadAssignment: 'Load Assignment',
  saveAssignment: 'Save Assignment',
  loadFile: 'Load File',
  saveFile: 'Save File',
  loadDataset: 'Load Dataset',
  logEvent: 'Log Event',
  updateSubmission: 'Update Submission',
  onExecution: 'Execution',
};

/** The identity line's data (legacy model.user/assignment/submission). */
export interface FooterIdentity {
  userId?: number | string;
  userName?: string;
  userRole?: string;
  courseId?: number | string;
  groupId?: number | string;
  assignmentId?: number | string;
  assignmentVersion?: number | string;
  submissionId?: number | string;
  /** Shown as "(Owner ID: …)" only when it differs from userId. */
  submissionOwnerId?: number | string;
  submissionVersion?: number | string;
  editorVersion?: string;
}

export interface FooterProps {
  identity?: FooterIdentity;
  /** display.instructor - reveals the force-load-assignment file input. */
  instructor?: boolean;
  /** Legacy ui.server.force.loadAssignment: parsed JSON of the chosen file. */
  onForceLoadAssignment?(data: unknown): void;
  /** Legacy ui.server.force.updateSubmission (badge click). */
  onForceUpdateSubmission?(): void;
}

export function Footer(props: FooterProps) {
  const serverStatus = useEditorChromeStore((state) => state.serverStatus);
  const serverMessage = useEditorChromeStore((state) => state.serverMessage);
  const identity = props.identity ?? {};

  const handleForceLoad = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !props.onForceLoadAssignment) return;
    const reader = new FileReader();
    reader.onload = (loaded) => {
      props.onForceLoadAssignment?.(JSON.parse(String(loaded.target?.result ?? 'null')));
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  return (
    <div className="col-md-12 blockpy-panel blockpy-status">
      <div>
        <label className={`badge server-status-${serverStatus.loadAssignment}`}>
          Load Assignment
          {props.instructor && (
            <input
              type="file"
              className="blockpy-force-load-assignment-file blockpy-hidden-file"
              accept="application/JSON"
              onChange={handleForceLoad}
            />
          )}
        </label>
        {SERVER_ENDPOINTS.filter((endpoint) => endpoint !== 'loadAssignment').map((endpoint) => (
          <span key={endpoint}>
            {', '}
            <span
              className={`badge server-status-${serverStatus[endpoint]}`}
              onClick={endpoint === 'updateSubmission' ? props.onForceUpdateSubmission : undefined}
            >
              {ENDPOINT_LABELS[endpoint]}
            </span>
          </span>
        ))}
      </div>
      <div>
        <span>{serverMessage}</span>
      </div>
      <div>
        <span>
          User: <span>{identity.userId ?? ''}</span> (<span>{identity.userName ?? ''}</span>,{' '}
          <span>{identity.userRole ?? ''}</span>)
        </span>
        , <span>Course: {identity.courseId ?? ''}</span>,{' '}
        <span>Group: {identity.groupId ?? ''}</span>,{' '}
        <span>Assignment: {identity.assignmentId ?? ''}</span>,{' '}
        <span>Assignment Version: {identity.assignmentVersion ?? ''}</span>,{' '}
        <span>
          Submission: {identity.submissionId ?? ''}
          {identity.submissionOwnerId !== undefined &&
            identity.submissionOwnerId !== identity.userId && (
              <span> (Owner ID: {identity.submissionOwnerId})</span>
            )}
        </span>
        , <span>Submission Version: {identity.submissionVersion ?? ''}</span>,{' '}
        <span>Editor Version: {identity.editorVersion ?? ''}</span>
      </div>
    </div>
  );
}
