/**
 * Uploaded-files manager — the legacy "Image" editor for `images.blockpy`
 * tabs (IMAGE_EDITOR_HTML, editor/images.js): the per-placement "Available
 * Files" tables with previews and Delete/Rename, plus the upload form.
 * Server calls go through the injected controller (the app layer owns the
 * ApiClient and placement→directory id mapping).
 */
import { useCallback, useEffect, useState } from 'react';

/** `{placement: [[filename, url], …]}` — the listUploadedFiles wire shape. */
export type UploadedFilesMap = Record<string, Array<[string, string]>>;

export interface UploadsController {
  list(): Promise<UploadedFilesMap>;
  upload(placement: string, filename: string, contents: Blob): Promise<void>;
  /** Legacy delete = upload with empty contents + delete flag. */
  remove(placement: string, directory: string, filename: string): Promise<void>;
  rename(
    placement: string,
    directory: string,
    oldFilename: string,
    newFilename: string,
  ): Promise<void>;
}

export interface ImagesManagerProps {
  uploads: UploadsController;
  /** display.instructor — placement choice + modify rights (blockpy.js:1118-1119). */
  instructor?: boolean;
}

/** Legacy canModify (blockpy.js:1119). */
export function canModifyPlacement(placement: string, instructor: boolean): boolean {
  return instructor || placement === 'submission' || placement === 'user';
}

/** The file's own placement/directory ride its URL's query params. */
function urlParams(url: string): { placement: string; directory: string } {
  try {
    const params = new URL(url, 'https://placeholder.invalid').searchParams;
    return {
      placement: params.get('placement') ?? '',
      directory: params.get('directory') ?? '',
    };
  } catch {
    return { placement: '', directory: '' };
  }
}

export function ImagesManager(props: ImagesManagerProps) {
  const [files, setFiles] = useState<UploadedFilesMap | null>(null);
  const [error, setError] = useState('');
  const [placement, setPlacement] = useState('submission');
  const [filename, setFilename] = useState('');
  const [chosen, setChosen] = useState<File | null>(null);
  const { uploads } = props;
  const instructor = props.instructor ?? false;

  const reload = useCallback(() => {
    uploads.list().then(
      (listing) => {
        setFiles(listing);
        setError('');
      },
      (failure) => setError(String(failure)),
    );
  }, [uploads]);

  useEffect(() => {
    // Legacy loads the listing on first entry (images.js:127-131).
    reload();
  }, [reload]);

  const handleUpload = () => {
    if (!chosen || !filename) return;
    uploads.upload(placement, filename, chosen).then(
      () => {
        setChosen(null);
        setFilename('');
        reload();
      },
      (failure) => setError(String(failure)),
    );
  };

  const handleDelete = (name: string, url: string) => {
    const where = urlParams(url);
    void uploads.remove(where.placement, where.directory, name).then(reload, (failure) =>
      setError(String(failure)),
    );
  };

  const handleRename = (name: string, url: string) => {
    // Legacy uses a plain prompt (images.js:260).
    const newFilename = prompt('Enter the new filename for this file:', name);
    if (!newFilename) return;
    const where = urlParams(url);
    void uploads
      .rename(where.placement, where.directory, name, newFilename)
      .then(reload, (failure) => setError(String(failure)));
  };

  return (
    <div className="blockpy-images-manager">
      <div>
        <strong>Available Files</strong>
        <br />
        All the files available to open with <code>PIL</code> for this
        assignment:
        <button
          type="button"
          className="btn btn-outline-secondary float-right"
          onClick={reload}
        >
          Reload Available Images
        </button>
        {error !== '' && <div className="alert alert-warning">{error}</div>}
        {files !== null && (
          <ul>
            {Object.keys(files).map((group) => (
              <li key={group}>
                <strong>{group[0]!.toUpperCase() + group.slice(1)}</strong>:
                <table className="table table-striped table-bordered table-hover table-sm">
                  <thead>
                    <tr>
                      <th>Filename</th>
                      <th>Preview</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files[group]!.map(([name, url]) => (
                      <tr key={name}>
                        <td>
                          <code>{name}</code>
                        </td>
                        <td>
                          <details>
                            <summary>
                              <img src={url} alt={name} width="30px" height="30px" />
                            </summary>
                            <img src={url} alt={name} />
                          </details>
                        </td>
                        <td>
                          {canModifyPlacement(group, instructor) && (
                            <>
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => handleDelete(name, url)}
                              >
                                Delete
                              </button>{' '}
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => handleRename(name, url)}
                              >
                                Rename
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        )}
      </div>

      <strong>Add more files</strong>
      <br />
      Upload more files using the forms below:
      <div className="form-group row">
        <div className="col-sm-2 text-right">
          <label className="form-label" htmlFor="blockpy-editor-images-upload-file">
            File:
          </label>
        </div>
        <div className="col-sm-10">
          <input
            type="file"
            className="form-control blockpy-editor-images-upload-file"
            id="blockpy-editor-images-upload-file"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setChosen(file);
              // Legacy pre-fills the target name from the chosen file
              // (images.js:120-122).
              if (file) setFilename(file.name);
            }}
          />
          <small className="form-text text-muted">
            The file to make available in your code
          </small>
        </div>
      </div>
      {/* Legacy canChoosePlacement = instructor (blockpy.js:1118); students
          always upload into their submission. */}
      {instructor && (
        <div className="form-group row">
          <div className="col-sm-2 text-right">
            <label
              className="form-label"
              htmlFor="blockpy-editor-images-upload-placement"
            >
              Placement:
            </label>
          </div>
          <div className="col-sm-10">
            <select
              id="blockpy-editor-images-upload-placement"
              className="form-control blockpy-editor-images-upload-placement"
              value={placement}
              onChange={(event) => setPlacement(event.target.value)}
            >
              <option value="submission">Only your submission</option>
              <option value="assignment">For all submissions of this assignment</option>
              <option value="course">Across the entire course</option>
              <option value="user">For just your user account</option>
            </select>
            <small className="form-text text-muted">
              The placement of the file in the system. This controls whether
              other users can see the file. If you want to provide a file to
              all students for just this specific problem, then you should use{' '}
              <code>For all submissions of this assignment</code>. If you want
              to use this same image across other assignments (including
              assignments within this assignment group), then you should use{' '}
              <code>Across the entire course</code>.
            </small>
          </div>
        </div>
      )}
      <div className="form-group row">
        <div className="col-sm-2 text-right">
          <label className="form-label" htmlFor="blockpy-editor-images-upload-filename">
            Filename:
          </label>
        </div>
        <div className="col-sm-10">
          <input
            type="text"
            className="form-control blockpy-editor-images-upload-filename"
            id="blockpy-editor-images-upload-filename"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
          />
          <small className="form-text text-muted">
            The filename that will be made available in the code. This should
            be a valid filename for the system, and should not contain spaces
            or special characters. It should also have a valid file extension
            (e.g., <code>.png</code>, <code>.jpg</code>, <code>.txt</code>).
          </small>
        </div>
      </div>
      <div className="form-group row">
        <button type="button" className="btn btn-success" onClick={handleUpload}>
          Upload
        </button>
      </div>
    </div>
  );
}
