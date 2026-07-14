/**
 * Assignment Settings form — the legacy ASSIGNMENT_SETTINGS_EDITOR_HTML port
 * (blockpy/src/editor/assignment_settings.js:4-300), M3.5. Previously the
 * `!assignment_settings.blockpy` tab fell through to a blank text editor.
 *
 * Canonical state is the raw settings blob: the form initializes from the
 * parsed JSON, and Save merges ONLY the edited keys back over the original
 * object — unknown keys round-trip untouched (D5-B / LD-5). A key is written
 * when it was already present or its value differs from the legacy default;
 * a raw-JSON escape hatch stays available for hand edits.
 *
 * Assignment-level columns (Name/URL/Points/IP Ranges + Public/Hidden/
 * Reviewed) are NOT settings-blob keys — they render only when the host
 * passes them and travel back through `onSave`'s second argument (the
 * legacy `save_assignment` wire fields).
 */
import { useMemo, useState } from 'react';

/** Legacy save_assignment wire columns (blockpy.py save_assignment). */
export interface AssignmentFields {
  name?: string;
  url?: string;
  points?: string;
  ipRanges?: string;
  public?: boolean;
  hidden?: boolean;
  reviewed?: boolean;
}

export interface SettingsEditorProps {
  /** Raw contents of `!assignment_settings.blockpy`. */
  blob: string;
  /** Assignment columns; the section renders only when provided. */
  assignment?: AssignmentFields;
  /** Persist the merged blob (+ edited assignment columns). */
  onSave(blob: string, fields: AssignmentFields): void | Promise<void>;
}

/**
 * The legacy ASSIGNMENT_SETTINGS boolean rows (assignment_settings.js:4-44),
 * wire key + default + doc verbatim (INCOMPLETE-marked rows kept, like
 * legacy). `allow_real_requests` is the M3.5 Studio addition.
 */
const BOOLEAN_SETTINGS: [key: string, def: boolean, doc: string][] = [
  [
    'disable_timeout',
    false,
    'If checked, then students code is allowed to run without timeouts (potentially allowing infinite loops).',
  ],
  ['is_parsons', false, "If checked, then this is a parson's style question (jumbled)."],
  [
    'save_turtle_output',
    false,
    'If checked, then turtle (and pygame) output is saved whenever the program uses it.',
  ],
  [
    'disable_feedback',
    false,
    'If checked, then no instructor scripts are run (e.g., on_run and on_eval).',
  ],
  [
    'disable_instructor_run',
    false,
    "If checked, then the instructor on_run will not automatically run the students' code. This still runs the students' code once beforehand, but the output/data will not be available to the instructor's on_run.py script.",
  ],
  [
    'disable_student_run',
    false,
    "If checked, then the run button no longer run the students' code. This still runs the instructor's feedback on_run script.",
  ],
  ['disable_tifa', false, 'If checked, then do not automatically run Tifa (which can be slow).'],
  [
    'disable_trace',
    false,
    'If checked, then the students code will not have its execution traced (no variables recorded, no coverage tracked).',
  ],
  ['disable_edit', false, "If checked, then the students' file will not be editable."],
  [
    'preload_all_files',
    false,
    'If checked, then the students can upload and use images and other files. This preloads all available files and images. You can filter them using the Preloaded Files setting.',
  ],
  [
    'can_image',
    false,
    'If checked, then users can copy/paste images directly into the text editor.',
  ],
  [
    'can_blocks',
    true,
    'If checked, then the student can edit the block interface (if not, then it is visible but not editable).',
  ],
  [
    'can_close',
    false,
    'If checked, then the student should mark their submission closed when they are done. There is no way to force a student to do so. Unlike Reviewed, this still submits the correctness.',
  ],
  [
    'only_interactive',
    false,
    'If checked, the editors are hidden, the program is automatically run, and then the console enters Eval mode (interactive).',
  ],
  [
    'only_uploads',
    false,
    "If checked, then the students' file will not be directly editable (they will have to upload submissions).",
  ],
  [
    'hide_submission',
    false,
    "If checked, then students will not be able to see their submission's code or history on Canvas.",
  ],
  ['hide_files', true, 'If checked, then students will not see the View Files toolbar.'],
  [
    'hide_queued_inputs',
    false,
    'If checked, then the students cannot access the queued inputs box (makes repeated debugging easier for the input function).',
  ],
  ['hide_editors', false, 'If checked, then all of the editors are hidden.'],
  ['hide_middle_panel', false, 'If checked, then the console and feedback areas is hidden.'],
  ['hide_all', false, 'INCOMPLETE: If checked, then the entire interface is hidden.'],
  ['hide_evaluate', false, 'If checked, then the Evaluate button is not shown on the console.'],
  [
    'hide_import_datasets_button',
    false,
    'If checked, then students cannot see the import datasets button.',
  ],
  [
    'hide_import_statements',
    false,
    'INCOMPLETE: If checked, certain kinds of import statements (matplotlib, turtle, datasets) are not shown in the block interface.',
  ],
  ['hide_coverage_button', false, 'INCOMPLETE: If checked, the coverage button is not shown.'],
  ['hide_trace_button', false, 'If checked, then the Trace button is not shown.'],
  ['small_layout', false, 'If checked, then the interface fits into a smaller region.'],
  ['has_clock', false, 'If checked, then a clock is shown in the top right corner.'],
  [
    'instructions_pool',
    false,
    'If checked, then the instructions will be interpreted as being from a pool. One of the prompts will be chosen from the pool based on the random seed.',
  ],
  // Studio addition (M3.5): opt-in real network for `requests`.
  [
    'allow_real_requests',
    false,
    'STUDIO: If checked, the `requests` module performs REAL network calls through the browser (subject to CORS) instead of resolving against the ?mock_urls.blockpy table. Default off preserves the legacy mock behavior.',
  ],
  // Studio addition (M7.2): autocomplete is an ASSIGNMENT setting, not a
  // user toggle (maintainer decision 2026-07-14, reversing M3.3).
  [
    'enable_autocomplete',
    false,
    'STUDIO: If checked, the text editor offers code autocompletion while students type. Default off.',
  ],
];

/** Legacy string settings rows (wire key, label, doc). */
const STRING_SETTINGS: [key: string, label: string, doc: string][] = [
  [
    'passcode',
    'Passcode',
    'A string that the user must enter to access the problem. If blank, then no passcode is prompted.',
  ],
  [
    'datasets',
    'Preloaded Datasets',
    'The current list of datasets available on load as a comma-separated string.',
  ],
  [
    'preload_files',
    'Preloaded Files',
    'A JSON structure representing the files that should be loaded on start from the remote, as if they were local.',
  ],
  [
    'part_id',
    'Part ID',
    'The Part ID of an Assignment that this editor is responsible for. Assignments can have regions ("Parts") that behave independently to the user but all correspond to the same assignment on the backend. Blank corresponds to the full document.',
  ],
  // Studio extension (M4.3, LD-25): course reference document for the
  // right-hand docs panel. No legacy analog; legacy clients drop the key
  // on instructor saves (the LD-5 legacy bug).
  [
    'docs_url',
    'Docs URL',
    'A URL to a markdown reference document shown in the collapsible Docs panel beside the editor. Blank hides the panel. (Studio extension.)',
  ],
];

const TOOLBOXES = ['normal', 'ct', 'ct2', 'minimal', 'full', 'empty', 'custom'];
const TYPES = ['blockpy', 'maze', 'quiz', 'reading'];
const START_VIEWS: [mode: string, label: string][] = [
  ['block', 'Blocks'],
  ['split', 'Split'],
  ['text', 'Text'],
];

function parseBlob(blob: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(blob);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid/empty blob = no settings (legacy tolerated both).
  }
  return {};
}

const asBool = (value: unknown, def: boolean): boolean =>
  value === undefined ? def : value === true || String(value).toLowerCase() === 'true';

const asString = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value);

function prettyName(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function SettingsEditor({ blob, assignment, onSave }: SettingsEditorProps) {
  const original = useMemo(() => parseBlob(blob), [blob]);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [fields, setFields] = useState<AssignmentFields>(assignment ?? {});
  const [rawOpen, setRawOpen] = useState(false);
  const [rawText, setRawText] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const current = (key: string): unknown => (key in edits ? edits[key] : original[key]);
  const setSetting = (key: string, value: unknown) => {
    setSaved(false);
    setEdits((prev) => ({ ...prev, [key]: value }));
  };
  const setField = (key: keyof AssignmentFields, value: unknown) => {
    setSaved(false);
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  /** Merge edited keys over the original (unknown keys survive, D5-B). */
  const mergedBlob = (): string => {
    if (rawText !== null) return rawText;
    const merged: Record<string, unknown> = { ...original };
    for (const [key, value] of Object.entries(edits)) {
      merged[key] = value;
    }
    // Drop keys explicitly reset to '' that the original never had — keeps
    // blobs minimal (a blank passcode should not persist as "").
    for (const [key, value] of Object.entries(merged)) {
      if (value === '' && !(key in original)) delete merged[key];
    }
    return JSON.stringify(merged, null, 2);
  };

  const save = () => {
    if (rawText !== null) {
      try {
        JSON.parse(rawText);
      } catch (error) {
        setRawError(String(error));
        return;
      }
    }
    setRawError(null);
    setSaved(true);
    void onSave(mergedBlob(), fields);
  };

  const boolRow = (key: string, def: boolean, doc: string) => (
    <div className="form-group row" key={key}>
      <div className="col-sm-2 text-right">
        <label className="form-check-label" htmlFor={`blockpy-settings-${key}`}>
          {prettyName(key)}
        </label>
      </div>
      <div className="col-sm-1">
        <div className="form-check">
          <input
            className="form-check-input"
            type="checkbox"
            id={`blockpy-settings-${key}`}
            checked={asBool(current(key), def)}
            onChange={(event) => setSetting(key, event.target.checked)}
          />
        </div>
      </div>
      <div className="col-sm-9">
        <small className="form-text text-muted">{doc}</small>
      </div>
    </div>
  );

  const textRow = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    doc?: string,
  ) => (
    <div className="form-group row" key={id}>
      <label htmlFor={id} className="col-sm-2 col-form-label text-right">
        {label}:
      </label>
      <div className="col-sm-10">
        <input
          type="text"
          className="form-control"
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {doc && <small className="form-text text-muted">{doc}</small>}
      </div>
    </div>
  );

  return (
    <div className="blockpy-view-settings blockpy-panel col-md-12">
      <form onSubmit={(event) => event.preventDefault()}>
        <div className="form-group row">
          <div className="col-sm-12">
            <button type="button" className="btn btn-success" onClick={save}>
              Save changes
            </button>{' '}
            {saved && <span className="text-muted">Saved.</span>}
          </div>
        </div>

        {assignment && (
          <>
            {textRow('blockpy-settings-name', 'Name', fields.name ?? '', (v) =>
              setField('name', v),
            )}
            {textRow('blockpy-settings-url', 'URL', fields.url ?? '', (v) => setField('url', v))}
            {textRow('blockpy-settings-points', 'Points', fields.points ?? '', (v) =>
              setField('points', v),
            )}
            {textRow(
              'blockpy-settings-ip-ranges',
              'IP Ranges',
              fields.ipRanges ?? '',
              (v) => setField('ipRanges', v),
              'A comma-separated list of IP address ranges allowed to submit.',
            )}
            {(
              [
                ['public', 'Public'],
                ['hidden', 'Hidden'],
                ['reviewed', 'Reviewed'],
              ] as const
            ).map(([key, label]) => (
              <div className="form-group row" key={key}>
                <div className="col-sm-2 text-right">
                  <label className="form-check-label" htmlFor={`blockpy-settings-${key}`}>
                    {label}
                  </label>
                </div>
                <div className="col-sm-10">
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`blockpy-settings-${key}`}
                      checked={fields[key] === true}
                      onChange={(event) => setField(key, event.target.checked)}
                    />
                  </div>
                </div>
              </div>
            ))}
            <hr />
          </>
        )}

        <div className="form-group row">
          <label htmlFor="blockpy-settings-toolbox" className="col-sm-2 col-form-label text-right">
            Block Toolbox:
          </label>
          <div className="col-sm-10">
            <select
              className="form-control"
              id="blockpy-settings-toolbox"
              value={asString(current('toolbox')) || 'normal'}
              onChange={(event) => setSetting('toolbox', event.target.value)}
            >
              {TOOLBOXES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <small className="form-text text-muted">
              Which version of the toolbox to present to the user.
            </small>
          </div>
        </div>

        <div className="form-group row">
          <label htmlFor="blockpy-settings-type" className="col-sm-2 col-form-label text-right">
            Problem Type:
          </label>
          <div className="col-sm-10">
            <select
              className="form-control"
              id="blockpy-settings-type"
              value={asString(current('type')) || 'blockpy'}
              onChange={(event) => setSetting('type', event.target.value)}
            >
              {TYPES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group row">
          <div className="col-sm-2 text-right">
            <label className="col-form-label">Starting View:</label>
          </div>
          <div className="col-sm-10">
            <div className="btn-group btn-group-toggle" role="group">
              {START_VIEWS.map(([mode, label]) => (
                <label
                  key={mode}
                  className={
                    'btn btn-outline-secondary' +
                    ((asString(current('start_view')) || 'text') === mode ? ' active' : '')
                  }
                >
                  <input
                    type="radio"
                    name="blockpy-start-view-set"
                    checked={(asString(current('start_view')) || 'text') === mode}
                    onChange={() => setSetting('start_view', mode)}
                    style={{ position: 'absolute', clip: 'rect(0,0,0,0)' }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <small className="form-text text-muted">
              The Python editor mode to start in when the student starts the problem.
            </small>
          </div>
        </div>

        {STRING_SETTINGS.map(([key, label, doc]) =>
          textRow(
            `blockpy-settings-${key}`,
            label,
            asString(current(key)),
            (v) => setSetting(key, v),
            doc,
          ),
        )}

        <hr />
        {BOOLEAN_SETTINGS.map(([key, def, doc]) => boolRow(key, def, doc))}

        <hr />
        <div className="form-group row">
          <div className="col-sm-12">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                if (!rawOpen) setRawText(mergedBlob());
                setRawOpen(!rawOpen);
              }}
            >
              {rawOpen ? 'Hide raw JSON' : 'Edit raw JSON'}
            </button>
            {rawOpen && (
              <>
                <textarea
                  className="form-control blockpy-settings-raw"
                  style={{ fontFamily: 'monospace', minHeight: '200px' }}
                  value={rawText ?? ''}
                  onChange={(event) => {
                    setSaved(false);
                    setRawText(event.target.value);
                  }}
                />
                {rawError && <small className="text-danger">{rawError}</small>}
                <small className="form-text text-muted">
                  Raw contents of !assignment_settings.blockpy — overrides the form on Save. Unknown
                  keys always round-trip (LD-5).
                </small>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
