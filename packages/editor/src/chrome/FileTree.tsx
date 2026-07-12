/**
 * Filesystem tree rail (M3.7) — STUDIO EXTENSION with no legacy analog.
 * Off by default (store `fileTree`, persisted); a collapsible left rail
 * listing `vfs.listVisible(role)` bucketed by namespace. Instructor view
 * labels every bucket AND row with its prefix so the namespace is obvious;
 * students see friendly bucket names only. In text-only mode the tree
 * REPLACES the horizontal tab strip (CodingEditor owns that swap).
 *
 * Row actions (LD-21): Rename / Move-namespace / Delete — rendered only
 * when the host passes a handler AND the VFS capability guards allow it
 * (magic names immovable; role editability respected).
 */
import { useEffect, useState } from 'react';
import type { Role, Space, Vfs, VfsEntry } from '@blockpy/vfs';
import { Icon } from './icons';

/** Bucket order + labels; prefixes shown in instructor view. */
const SPACE_META: [space: Space, label: string, prefix: string][] = [
  ['student', 'Student Files', ''],
  ['starting', 'Starting Files', '^'],
  ['instructor', 'Instructor Files', '!'],
  ['hidden', 'Hidden Files', '?'],
  ['readonly', 'Read-Only Files', '&'],
  ['generated', 'Generated Files', '*'],
];

export interface FileTreeProps {
  vfs: Vfs;
  role: Role;
  activeFile: string;
  onSelect(legacyName: string): void;
  instructor?: boolean;
  /** LD-21 actions — omitted handler = no button. */
  onRename?(legacyName: string): void;
  onMove?(legacyName: string): void;
  onDelete?(legacyName: string): void;
}

export function FileTree({
  vfs,
  role,
  activeFile,
  onSelect,
  instructor = false,
  onRename,
  onMove,
  onDelete,
}: FileTreeProps) {
  const [, setVersion] = useState(0);
  useEffect(() => vfs.onChange(() => setVersion((v) => v + 1)), [vfs]);

  const buckets = new Map<Space, VfsEntry[]>();
  for (const entry of vfs.listVisible(role)) {
    const list = buckets.get(entry.space) ?? [];
    list.push(entry);
    buckets.set(entry.space, list);
  }

  const actionsFor = (entry: VfsEntry) => {
    const editable = vfs.canEdit(entry.legacyName, role);
    return (
      <span className="blockpy-file-tree-actions">
        {onRename && editable && vfs.canRenameName(entry.legacyName) && (
          <button
            type="button"
            className="blockpy-file-tree-action"
            title={`Rename ${entry.legacyName}`}
            onClick={(event) => {
              event.stopPropagation();
              onRename(entry.legacyName);
            }}
          >
            <Icon name="rename" />
          </button>
        )}
        {onMove && instructor && vfs.canRenameName(entry.legacyName) && (
          <button
            type="button"
            className="blockpy-file-tree-action"
            title={`Change namespace of ${entry.legacyName}`}
            onClick={(event) => {
              event.stopPropagation();
              onMove(entry.legacyName);
            }}
          >
            <Icon name="moveFile" />
          </button>
        )}
        {onDelete && editable && vfs.canDeleteName(entry.legacyName) && (
          <button
            type="button"
            className="blockpy-file-tree-action blockpy-file-tree-delete"
            title={`Delete ${entry.legacyName}`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(entry.legacyName);
            }}
          >
            <Icon name="delete" />
          </button>
        )}
      </span>
    );
  };

  return (
    <div className="blockpy-file-tree" role="tree" aria-label="Files">
      {SPACE_META.map(([space, label, prefix]) => {
        const entries = buckets.get(space);
        if (!entries || entries.length === 0) return null;
        entries.sort((a, b) => (a.basename < b.basename ? -1 : 1));
        return (
          <div key={space} className="blockpy-file-tree-bucket">
            <div className="blockpy-file-tree-header">
              {label}
              {instructor && prefix && (
                <code className="blockpy-file-tree-prefix">{prefix}</code>
              )}
            </div>
            {entries.map((entry) => (
              <div
                key={entry.legacyName}
                role="treeitem"
                aria-selected={entry.legacyName === activeFile}
                className={
                  'blockpy-file-tree-row' +
                  (entry.legacyName === activeFile ? ' active' : '') +
                  (space === 'readonly' ? ' uneditable' : '')
                }
                onClick={() => onSelect(entry.legacyName)}
              >
                <span className="blockpy-file-tree-name">
                  {instructor ? entry.legacyName : entry.basename}
                </span>
                {actionsFor(entry)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
