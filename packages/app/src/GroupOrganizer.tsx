/**
 * Assignment-group organizer, slice 1 (M4.6; STUDIO EXTENSION, LD-28).
 *
 * Instructor tooling for the CURRENT group over endpoints that already
 * exist server-side: rename/edit the group (`POST /assignment_group/edit`),
 * rename assignments + url/points/public/hidden/reviewed
 * (`POST /blockpy/save_assignment`), and move an assignment out/in
 * (`POST /assignment_group/move_membership`; `new_group_id = -1` removes).
 *
 * Reference investigated 2026-07-11: the legacy `courses/edit_settings.html`
 * is a bulk FORM, not a drag-drop UI, and the editor page never linked it —
 * this is the group-scoped equivalent, not a port. Slice 2 (true
 * reordering, type changes, subordinate JSON toggles) needs server-team
 * flags (plan M4.6 / R10).
 *
 * Capability-detected: each control renders only when its endpoint URL is
 * published (`editAssignmentGroup` / `moveMembership` are new template
 * keys; `saveAssignment` ships on every editor page today).
 *
 * Field semantics: ONLY fields the instructor touches go on the wire —
 * boot data doesn't carry points/public/reviewed, so untouched inputs are
 * "unknown", never "false".
 */
import { useState } from 'react';
import { Dialog } from '@blockpy/editor';
import type { ApiClient } from '@blockpy/api';
import type { GroupNavStore } from '@blockpy/navigation';
import type { GroupBootData } from './boot-config';

export interface GroupOrganizerProps {
  api: ApiClient;
  groupId: number | null;
  assignments: GroupBootData['assignments'];
  navStore: GroupNavStore | null;
  visible: boolean;
  onClose(): void;
}

interface RowEdits {
  name?: string;
  url?: string;
  points?: string;
  public?: boolean;
  hidden?: boolean;
  reviewed?: boolean;
}

export function GroupOrganizer(props: GroupOrganizerProps) {
  const { api } = props;
  const [rows, setRows] = useState(props.assignments);
  const [edits, setEdits] = useState<Record<number, RowEdits>>({});
  const [groupName, setGroupName] = useState('');
  const [groupUrl, setGroupUrl] = useState('');
  const [addId, setAddId] = useState('');
  const [status, setStatus] = useState('');

  const canEditGroup = api.isEndpointConnected('editAssignmentGroup');
  const canMove = api.isEndpointConnected('moveMembership');
  const canSave = api.isEndpointConnected('saveAssignment');

  const edit = (id: number, patch: RowEdits) =>
    setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const report = (outcome: { success?: unknown }, action: string) => {
    setStatus(outcome.success === true ? `${action}: saved.` : `${action}: FAILED.`);
    return outcome.success === true;
  };

  const saveGroup = async () => {
    if (props.groupId === null || groupName.trim() === '') return;
    const outcome = await api.editAssignmentGroup({
      assignment_group_id: props.groupId,
      new_name: groupName.trim(),
      ...(groupUrl.trim() !== '' ? { new_url: groupUrl.trim() } : {}),
    });
    report(outcome, 'Group');
  };

  const saveRow = async (id: number) => {
    const rowEdits = edits[id];
    if (!rowEdits) return;
    const outcome = await api.saveAssignment({
      assignment_id: id,
      ...(rowEdits.name !== undefined ? { name: rowEdits.name } : {}),
      ...(rowEdits.url !== undefined ? { url: rowEdits.url } : {}),
      ...(rowEdits.points !== undefined && rowEdits.points !== ''
        ? { points: rowEdits.points }
        : {}),
      ...(rowEdits.public !== undefined ? { public: String(rowEdits.public) } : {}),
      ...(rowEdits.hidden !== undefined ? { hidden: String(rowEdits.hidden) } : {}),
      ...(rowEdits.reviewed !== undefined ? { reviewed: String(rowEdits.reviewed) } : {}),
    });
    if (report(outcome, `Assignment ${id}`)) {
      if (rowEdits.name !== undefined) {
        props.navStore?.renameEntry(id, rowEdits.name);
        setRows((current) =>
          current.map((row) => (row.id === id ? { ...row, name: rowEdits.name! } : row)),
        );
      }
      setEdits((current) => ({ ...current, [id]: {} }));
    }
  };

  const removeRow = async (id: number) => {
    if (props.groupId === null) return;
    if (!window.confirm(`Remove assignment ${id} from this group?`)) return;
    const outcome = await api.moveMembership({
      assignment_id: id,
      old_group_id: props.groupId,
      new_group_id: -1,
    });
    if (report(outcome, `Remove ${id}`)) {
      props.navStore?.removeEntry(id);
      setRows((current) => current.filter((row) => row.id !== id));
    }
  };

  const addAssignment = async () => {
    const id = Number(addId);
    if (props.groupId === null || !Number.isInteger(id) || id <= 0) return;
    const outcome = await api.moveMembership({
      assignment_id: id,
      old_group_id: -1,
      new_group_id: props.groupId,
    });
    if (report(outcome, `Add ${id}`)) {
      setRows((current) =>
        current.some((row) => row.id === id)
          ? current
          : [
              ...current,
              {
                id,
                name: `Assignment ${id}`,
                url: '',
                subordinate: false,
                hidden: false,
                correct: false,
              },
            ],
      );
      setAddId('');
      setStatus(`Add ${id}: saved. Reload the page to refresh the navigation header.`);
    }
  };

  return (
    <Dialog
      title="Organize Assignment Group"
      visible={props.visible}
      onClose={props.onClose}
      onOkay={props.onClose}
      okayLabel="Close"
    >
      <div className="blockpy-group-organizer">
        {status && <p className="blockpy-organizer-status">{status}</p>}
        {canEditGroup && props.groupId !== null && (
          <fieldset className="blockpy-organizer-group">
            <legend>Group #{props.groupId}</legend>
            <label>
              New name:{' '}
              <input
                className="form-control form-control-sm blockpy-organizer-group-name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              />
            </label>
            <label>
              New URL (optional):{' '}
              <input
                className="form-control form-control-sm blockpy-organizer-group-url"
                value={groupUrl}
                onChange={(event) => setGroupUrl(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={groupName.trim() === ''}
              onClick={() => void saveGroup()}
            >
              Rename Group
            </button>
          </fieldset>
        )}
        <table className="table blockpy-organizer-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>URL</th>
              <th title="Only touched fields are saved — blank means unchanged.">Points</th>
              <th title="Unknown until changed — checking/unchecking sends it.">Pub/Hid/Rev</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowEdits = edits[row.id] ?? {};
              return (
                <tr key={row.id} data-assignment-id={row.id}>
                  <td>{row.id}</td>
                  <td>
                    <input
                      aria-label={`Name of assignment ${row.id}`}
                      className="form-control form-control-sm"
                      value={rowEdits.name ?? row.name}
                      disabled={!canSave}
                      onChange={(event) => edit(row.id, { name: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`URL of assignment ${row.id}`}
                      className="form-control form-control-sm"
                      value={rowEdits.url ?? ''}
                      placeholder="(unchanged)"
                      disabled={!canSave}
                      onChange={(event) => edit(row.id, { url: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Points of assignment ${row.id}`}
                      className="form-control form-control-sm blockpy-organizer-points"
                      value={rowEdits.points ?? ''}
                      placeholder="?"
                      disabled={!canSave}
                      onChange={(event) => edit(row.id, { points: event.target.value })}
                    />
                  </td>
                  <td className="blockpy-organizer-flags">
                    {(['public', 'hidden', 'reviewed'] as const).map((flag) => (
                      <label key={flag} title={flag}>
                        <input
                          type="checkbox"
                          aria-label={`${flag} for assignment ${row.id}`}
                          checked={rowEdits[flag] ?? (flag === 'hidden' ? row.hidden : false)}
                          disabled={!canSave}
                          onChange={(event) => edit(row.id, { [flag]: event.target.checked })}
                        />
                        {flag[0]!.toUpperCase()}
                      </label>
                    ))}
                  </td>
                  <td>
                    {canSave && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        disabled={Object.keys(rowEdits).length === 0}
                        onClick={() => void saveRow(row.id)}
                      >
                        Save
                      </button>
                    )}{' '}
                    {canMove && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary blockpy-organizer-remove"
                        onClick={() => void removeRow(row.id)}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {canMove && props.groupId !== null && (
          <div className="blockpy-organizer-add">
            <label>
              Add existing assignment by ID:{' '}
              <input
                className="form-control form-control-sm blockpy-organizer-add-id"
                value={addId}
                onChange={(event) => setAddId(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={!Number.isInteger(Number(addId)) || Number(addId) <= 0}
              onClick={() => void addAssignment()}
            >
              Add to Group
            </button>
          </div>
        )}
        {!canEditGroup && !canMove && (
          <p>
            This server page has not published the group-management endpoints (
            <code>editAssignmentGroup</code>, <code>moveMembership</code>) — only per-assignment
            saves are available.
          </p>
        )}
      </div>
    </Dialog>
  );
}
