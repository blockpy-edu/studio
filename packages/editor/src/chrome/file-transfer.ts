/**
 * Local upload/download helpers (M7.4, LD-39) - ports of the legacy toolbar
 * flows: `uploadFile`/`downloadFile`/`sluggify` (abstract_editor.js:3-35)
 * and `convertIpynbToPython` (editor/python.js:161-181). Purely local: the
 * upload writes into the editor, the download saves the current code; no
 * server round trip. LD-39 delta: legacy auto-ran after upload
 * (python.js:462) - Studio does not.
 */

interface IpynbCell {
  cell_type?: string;
  source?: string[];
}

/**
 * convertIpynbToPython (python.js:161-181), quirk-for-quirk: code cells
 * survive when non-empty and not starting with a `%` magic; markdown/raw
 * cells wrap in triple-quotes; everything joins with newlines. Throws on
 * unparseable JSON (the caller falls back to the raw text).
 */
export function convertIpynbToPython(code: string): string {
  const ipynb = JSON.parse(code) as { cells?: IpynbCell[] };
  const isUsable = (cell: IpynbCell): boolean => {
    if (cell.cell_type === 'code') {
      return (cell.source?.length ?? 0) > 0 && !cell.source![0]!.startsWith('%');
    }
    return cell.cell_type === 'markdown' || cell.cell_type === 'raw';
  };
  const makePython = (cell: IpynbCell): string => {
    const source = (cell.source ?? []).join('\n');
    return cell.cell_type === 'code' ? source : "'''" + source + "'''";
  };
  return (ipynb.cells ?? []).filter(isUsable).map(makePython).join('\n');
}

/** sluggify (abstract_editor.js:14-16), verbatim. */
export function sluggify(text: string): string {
  return text.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/** Split a legacy filename into (name, extension) like the editors did. */
export function splitFilename(filename: string): { name: string; extension: string } {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return { name: filename, extension: '' };
  return { name: filename.slice(0, dot), extension: filename.slice(dot) };
}

/**
 * The download naming rules (abstract_editor.js:18-22 + python.js:466-471):
 * sluggified name + extension; `answer.py` downloads under the sluggified
 * assignment name; Python files are text/x-python.
 */
export function downloadPlan(
  filename: string,
  assignmentName?: string,
): { downloadName: string; mimetype: string } {
  const { name, extension } = splitFilename(filename);
  const effective =
    name === 'answer' && extension === '.py' && assignmentName ? assignmentName : name;
  return {
    downloadName: sluggify(effective) + extension,
    mimetype: extension === '.py' ? 'text/x-python' : 'text/plain',
  };
}

/** Blob + temporary <a download> click (abstract_editor.js:24-34; the
 *  obsolete msSaveOrOpenBlob arm dropped). */
export function triggerBrowserDownload(contents: string, name: string, mimetype: string): void {
  const blob = new Blob([contents], { type: mimetype });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(link.href);
}
