/**
 * "Add New" file menu — the dropdown at the end of the file tab strip
 * (files.js FILES_HTML:81-131 + blockpy.js ui.files.add:944-987). Items are
 * hidden once their file has contents; created files open immediately.
 *
 * Instructor menu, quirk-for-quirk:
 *  - URL Data / Images / Toolbox / Tags / Sample Submissions (Tags has NO
 *    click binding in legacy — a dead item, kept dead);
 *  - On Change / On Eval (hidden once the file exists at all);
 *  - Answer Prefix / Answer Suffix;
 *  - Starting File / Instructor File / Student File via the new-file dialog
 *    (NEW_INSTRUCTOR_FILE_DIALOG_HTML port: filename, derived filetype, and
 *    for instructor files the !/?/& namespace selector).
 * Students only get "Student File".
 *
 * Defaults on create match legacy: `images.blockpy` = "{}", toolbox =
 * pretty-printed normal toolbox JSON, everything else empty.
 */
import { useState } from 'react';
import type { Vfs } from '@blockpy/vfs';
import { TOOLBOXES } from '../dual/toolboxes';
import { Dialog } from './Dialog';

type DialogKind = 'instructor' | 'starting' | 'student';

export interface AddNewMenuProps {
  vfs: Vfs;
  instructor: boolean;
  /** Called with the created (or focused) file's legacy name. */
  onAdd(legacyName: string): void;
}

/** Legacy per-file default contents (blockpy.js:953-960). */
function defaultContents(legacyName: string): string {
  if (legacyName === 'images.blockpy') return '{}';
  if (legacyName === '?toolbox.blockpy') {
    return JSON.stringify(TOOLBOXES['normal'], null, 2);
  }
  return '';
}

export function AddNewMenu({ vfs, instructor, onAdd }: AddNewMenuProps) {
  const [open, setOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<DialogKind | null>(null);
  const [filename, setFilename] = useState('');
  const [namespace, setNamespace] = useState('!');

  const hasContents = (name: string) => Boolean(vfs.read(name));
  const exists = (name: string) => vfs.read(name) !== undefined;

  const add = (name: string) => {
    setOpen(false);
    if (!exists(name)) {
      vfs.write(name, defaultContents(name));
    }
    onAdd(name);
  };

  const openDialog = (kind: DialogKind) => {
    setOpen(false);
    setFilename('');
    setNamespace('!');
    setDialogKind(kind);
  };

  const createFromDialog = () => {
    if (filename) {
      const prefix = dialogKind === 'instructor' ? namespace : dialogKind === 'starting' ? '^' : '';
      add(prefix + filename);
    }
    setDialogKind(null);
  };

  // Legacy filetype display: the filename's extension (files.js:641-647).
  const extension = /(?:\.([^.]+))?$/.exec(filename)?.[1] ?? 'No extension';

  const item = (
    label: string,
    legacyName: string | null,
    options: { hidden?: boolean; instructorItem?: boolean } = {},
  ) =>
    options.hidden ? null : (
      <a
        key={label}
        className={'dropdown-item' + (options.instructorItem ? ' blockpy-file-instructor' : '')}
        href="#"
        onClick={(event) => {
          event.preventDefault();
          // Tags is click-less in legacy (dead item) — preserved.
          if (legacyName !== null) add(legacyName);
        }}
      >
        {label}
      </a>
    );

  return (
    <li className="nav-item dropdown">
      <a
        className="nav-link dropdown-toggle"
        href="#"
        role="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          setOpen(!open);
        }}
      >
        Add New
      </a>
      <div className={'dropdown-menu dropdown-menu-right' + (open ? ' show' : '')}>
        {instructor ? (
          <>
            {item('URL Data', '?mock_urls.blockpy', {
              hidden: hasContents('?mock_urls.blockpy'),
              instructorItem: true,
            })}
            {item('Images', 'images.blockpy', {
              hidden: hasContents('images.blockpy'),
              instructorItem: true,
            })}
            {item('Toolbox', '?toolbox.blockpy', {
              hidden: hasContents('?toolbox.blockpy'),
              instructorItem: true,
            })}
            {item('Tags', null, {
              hidden: hasContents('!tags.blockpy'),
              instructorItem: true,
            })}
            {item('Sample Submissions', '!sample_submissions.blockpy', {
              hidden: hasContents('!sample_submissions.blockpy'),
              instructorItem: true,
            })}
            <div className="dropdown-divider" />
            {item('On Change', '!on_change.py', {
              hidden: exists('!on_change.py'),
              instructorItem: true,
            })}
            {item('On Eval', '!on_eval.py', {
              hidden: exists('!on_eval.py'),
              instructorItem: true,
            })}
            <div className="dropdown-divider" />
            {item('Answer Prefix', '!answer_prefix.py', {
              hidden: hasContents('!answer_prefix.py'),
              instructorItem: true,
            })}
            {item('Answer Suffix', '!answer_suffix.py', {
              hidden: hasContents('!answer_suffix.py'),
              instructorItem: true,
            })}
            <div className="dropdown-divider" />
            <a
              className="dropdown-item blockpy-file-instructor"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                openDialog('starting');
              }}
            >
              Starting File
            </a>
            <a
              className="dropdown-item blockpy-file-instructor"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                openDialog('instructor');
              }}
            >
              Instructor File
            </a>
            <a
              className="dropdown-item"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                openDialog('student');
              }}
            >
              Student File
            </a>
          </>
        ) : (
          <a
            className="dropdown-item"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              openDialog('student');
            }}
          >
            Student File
          </a>
        )}
      </div>

      <Dialog
        title="Make New File"
        visible={dialogKind !== null}
        onClose={() => setDialogKind(null)}
        onOkay={createFromDialog}
        okayLabel="Create"
      >
        <form onSubmit={(event) => event.preventDefault()}>
          <div className="form-group row">
            {dialogKind === 'instructor' && (
              <div className="col-sm-12">
                <p>
                  This dialog box is for creating text files (e.g., Python code, Markdown, etc.)
                  that will be accessible from Python. If you want to upload a binary file (e.g., an
                  image, a sqlite database), then you should use the "Images" or "URL Data" options.
                </p>
                <p>
                  Students will not be able to see file tabs unless you change the "Hide Files"
                  setting to be unchecked.
                </p>
              </div>
            )}
            <div className="col-sm-2 text-right">
              <label htmlFor="blockpy-instructor-file-dialog-filename">Filename:</label>
            </div>
            <div className="col-sm-10">
              <input
                type="text"
                className="form-control blockpy-instructor-file-dialog-filename"
                id="blockpy-instructor-file-dialog-filename"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
              />
            </div>
            <div className="col-sm-2 text-right mt-2">
              <label htmlFor="blockpy-instructor-file-dialog-filetype">Filetype: </label>
            </div>
            <div className="col-sm-10">
              <span
                className="blockpy-instructor-file-dialog-filetype"
                id="blockpy-instructor-file-dialog-filetype"
              >
                {extension}
              </span>
            </div>
            {dialogKind === 'instructor' && (
              <>
                <div className="col-sm-2 text-right mt-2">
                  <label htmlFor="blockpy-instructor-file-dialog-namespace">Namespace: </label>
                </div>
                <div className="col-sm-4">
                  <select
                    className="form-control blockpy-instructor-file-dialog-namespace"
                    id="blockpy-instructor-file-dialog-namespace"
                    value={namespace}
                    onChange={(event) => setNamespace(event.target.value)}
                  >
                    <option value="!">Completely inaccessible</option>
                    <option value="?">Hidden from student, accessible programatically</option>
                    <option value="&">Visible to student, but not editable</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </form>
      </Dialog>
    </li>
  );
}
