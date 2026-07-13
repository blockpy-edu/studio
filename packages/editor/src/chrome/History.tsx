/**
 * History toolbar — port of legacy `HISTORY_TOOLBAR_HTML` + `BlockPyHistory`
 * (history.js): a full-width strip between the Python toolbar and the editor
 * (visible only in history mode) with Start / Previous / selector / Use /
 * Next / Most Recent controls.
 *
 * The selector lists every (filtered) history event with a pretty timestamp
 * and remapped caption; only File.Edit/File.Create events for the current
 * file are selectable ("edit events"), everything else renders disabled —
 * exactly the legacy option list. Selection drives the editor pane, which in
 * Studio is a CM6 merge diff against the current code rather than legacy's
 * plain read-only swap (the M1.4 merge-view commitment).
 */
import { Icon } from './icons';

/** One `log_event` row as `loadHistory` returns it (history.js usage). */
export interface HistoryEntry {
  event_type: string;
  file_path: string;
  /** Epoch milliseconds as a string (legacy `client_timestamp`). */
  client_timestamp?: string;
  /** The file contents for edit events. */
  message: string;
}

/** history.js REMAP_EVENT_TYPES. */
const REMAP_EVENT_TYPES: Record<string, string> = {
  'Session.Start': 'Began session',
  'X-IP.Change': 'Changed IP address',
  'File.Edit': 'Edited code',
  'File.Create': 'Started assignment',
  'Run.Program': 'Ran program',
  'Compile.Error': 'Syntax error',
  'X-Submission.LMS': 'Updated grade',
};

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'June',
  'July',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
];
const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isSameDay(first: Date, second: Date): boolean {
  return (
    first.getDate() === second.getDate() &&
    first.getMonth() === second.getMonth() &&
    first.getFullYear() === second.getFullYear()
  );
}

/** Legacy `prettyPrintDateTime` (history.js), `now` injectable for tests. */
export function prettyPrintDateTime(
  timeString: string | undefined,
  now: Date = new Date(),
): string {
  if (timeString === undefined) {
    return 'Undefined Time';
  }
  const past = new Date(parseInt(timeString, 10));
  if (isSameDay(now, past)) {
    return 'Today at ' + past.toLocaleTimeString();
  }
  const date =
    WEEK_DAYS[past.getDay()] + ', ' + MONTH_NAMES[past.getMonth()] + ' ' + past.getDate();
  if (now.getFullYear() === past.getFullYear()) {
    return date + ' at ' + past.toLocaleTimeString();
  }
  return date + ', ' + past.getFullYear() + ' at ' + past.toLocaleTimeString();
}

/** Legacy load() filter (history.js:57-62). */
export function filterHistory(entries: HistoryEntry[], assignmentHidden = false): HistoryEntry[] {
  return entries.filter(
    (entry) =>
      !entry.file_path.startsWith('_instructor.') &&
      entry.event_type !== 'Compile' &&
      entry.event_type !== 'Intervention' &&
      (!assignmentHidden || entry.event_type !== 'X-Submission.LMS'),
  );
}

/** Legacy isEditEvent: a selectable version of the current file. */
export function isEditEvent(entry: HistoryEntry, filename: string): boolean {
  return (
    (entry.event_type === 'File.Edit' || entry.event_type === 'File.Create') &&
    entry.file_path === filename
  );
}

/** The selectable versions of `filename`, in log order. */
export function editEvents(
  entries: HistoryEntry[],
  filename: string,
  assignmentHidden = false,
): HistoryEntry[] {
  return filterHistory(entries, assignmentHidden).filter((entry) => isEditEvent(entry, filename));
}

export interface HistoryToolbarProps {
  entries: HistoryEntry[];
  /** The file whose versions are selectable (legacy display.filename()). */
  filename: string;
  /** Index into the edit-event list. */
  index: number;
  onSelect(index: number): void;
  /** Adopt the selected version and leave history mode (legacy `use`). */
  onUse(): void;
  assignmentHidden?: boolean;
}

export function HistoryToolbar(props: HistoryToolbarProps) {
  const visible = filterHistory(props.entries, props.assignmentHidden);
  const edits = visible.filter((entry) => isEditEvent(entry, props.filename));
  const last = edits.length - 1;
  const clamp = (index: number) => Math.max(0, Math.min(last, index));
  const select = (index: number) => props.onSelect(clamp(index));

  // Option values index into the edit-event list, like legacy editId.
  let editId = -1;
  return (
    <div className="blockpy-history-toolbar col-md-12">
      <form className="form-inline" onSubmit={(event) => event.preventDefault()}>
        <button
          className="blockpy-history-start btn btn-outline-secondary mr-2"
          type="button"
          onClick={() => select(0)}
        >
          <Icon name="stepFirst" /> Start
        </button>
        <button
          className="btn btn-outline-secondary mr-2"
          type="button"
          onClick={() => select(props.index - 1)}
        >
          <Icon name="historyPrev" /> Previous
        </button>
        <select
          className="blockpy-history-selector form-control custom-select mr-2"
          aria-label="History Selector"
          value={props.index}
          onChange={(event) => select(parseInt(event.target.value, 10))}
        >
          {visible.map((entry, i) => {
            const caption =
              prettyPrintDateTime(entry.client_timestamp) +
              ' - ' +
              (REMAP_EVENT_TYPES[entry.event_type] ?? entry.event_type);
            const editable = isEditEvent(entry, props.filename);
            if (editable) editId += 1;
            return (
              <option
                key={i}
                disabled={entry.event_type !== 'File.Edit'}
                value={editable ? editId : `x${i}`}
              >
                {caption}
              </option>
            );
          })}
        </select>
        <button className="btn btn-outline-secondary mr-2" type="button" onClick={props.onUse}>
          <Icon name="historyUse" /> Use
        </button>
        <button
          className="btn btn-outline-secondary mr-2"
          type="button"
          onClick={() => select(props.index + 1)}
        >
          <Icon name="historyNext" /> Next
        </button>
        <button className="btn btn-outline-secondary" type="button" onClick={() => select(last)}>
          <Icon name="stepLast" /> Most Recent
        </button>
      </form>
    </div>
  );
}
