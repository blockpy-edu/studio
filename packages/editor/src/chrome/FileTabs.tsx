/**
 * File tab strip - Row 3 (A8 §1: `ul.nav.nav-tabs` with the "View:" label
 * pseudo-tab; §4.4 states). Driven by the VFS:
 *  - answer.py first (always student-visible),
 *  - instructor special tabs in the legacy fixed order, starred ones hidden
 *    while empty (legacy files.js:36-43),
 *  - remaining visible files as dynamic tabs, `&`-space files carrying the
 *    legacy `uneditable` class (darkblue italic; D3-A/LD-3: read-only for
 *    students in EVERY editor).
 */
import { useEffect, useState } from 'react';
import { parse, type Role, type Vfs } from '@blockpy/vfs';
import { AddNewMenu } from './AddNewMenu';
import { Icon } from './icons';
import { useEditorChromeStore } from './store';

/** Legacy instructor tab order (files.js): [legacy name, label, hideWhenEmpty]. */
const INSTRUCTOR_TABS: [string, string, boolean][] = [
  ['!instructions.md', 'Instructions', false],
  ['!assignment_settings.blockpy', 'Settings', false],
  ['^starting_code.py', 'Starting Code', false],
  ['!on_run.py', 'On Run', false],
  ['!on_change.py', 'On Change', true],
  ['!on_eval.py', 'On Eval', true],
  ['!sample_submissions.blockpy', 'Sample Submissions', true],
  ['!tags.blockpy', 'Tags', true],
];

export interface FileTab {
  legacyName: string;
  label: string;
  instructorOnly: boolean;
  uneditable: boolean;
}

/** Compute the tab list for a role (exported for tests). */
export function computeTabs(vfs: Vfs, role: Role): FileTab[] {
  const visible = vfs.listVisible(role);
  const byName = new Map(visible.map((entry) => [entry.legacyName, entry]));
  const claimed = new Set<string>(['answer.py']);
  const tabs: FileTab[] = [
    {
      legacyName: 'answer.py',
      label: 'answer.py',
      instructorOnly: false,
      uneditable: !vfs.canEdit('answer.py', role),
    },
  ];
  if (role === 'instructor') {
    for (const [legacyName, label, hideWhenEmpty] of INSTRUCTOR_TABS) {
      claimed.add(legacyName);
      const entry = byName.get(legacyName);
      // Legacy hides these while unconfigured (e.g. onChange === null); an
      // EXISTING-but-empty file is configured (the post-"Add New" state,
      // blockpy.js:965-967) and stays visible.
      if (hideWhenEmpty && !entry) continue;
      tabs.push({
        legacyName,
        label,
        instructorOnly: true,
        uneditable: !vfs.canEdit(legacyName, role),
      });
    }
  }
  for (const entry of visible) {
    if (claimed.has(entry.legacyName)) continue;
    tabs.push({
      legacyName: entry.legacyName,
      label: entry.legacyName,
      instructorOnly: false,
      uneditable:
        parse(entry.legacyName).space === 'readonly' || !vfs.canEdit(entry.legacyName, role),
    });
  }
  return tabs;
}

export interface FileTabsProps {
  vfs: Vfs;
  role: Role;
  activeFile: string;
  onSelect(legacyName: string): void;
  /**
   * Show the "Add New" dropdown (legacy `ui.files.addIsVisible` =
   * instructor || !hideFiles). `instructor` also picks the menu variant.
   */
  addVisible?: boolean;
  instructor?: boolean;
}

export function FileTabs({
  vfs,
  role,
  activeFile,
  onSelect,
  addVisible = false,
  instructor = false,
}: FileTabsProps) {
  const [, setVersion] = useState(0);
  useEffect(() => vfs.onChange(() => setVersion((v) => v + 1)), [vfs]);
  const fileTree = useEditorChromeStore((state) => state.fileTree);
  const toggleFileTree = useEditorChromeStore((state) => state.toggleFileTree);
  const tabs = computeTabs(vfs, role);
  return (
    <div className="blockpy-panel blockpy-files col-md-12">
      {/* Plain navigation list, NOT an ARIA tab widget (audit M6.1): the
          strip mixes non-tab children (View label + toggle, Add New menu)
          and never annotated a tabpanel, so tablist/tab/aria-selected were
          an incomplete contract axe rightly rejects. The active file is
          announced via aria-current instead. */}
      <ul className="nav nav-tabs">
        <li className="nav-item">
          <strong>View: </strong>
        </li>
        {tabs.map((tab) => (
          <li
            key={tab.legacyName}
            className={'nav-item' + (tab.instructorOnly ? ' blockpy-file-instructor' : '')}
          >
            <a
              className={
                'nav-link' +
                (tab.legacyName === activeFile ? ' active' : '') +
                (tab.uneditable ? ' uneditable' : '')
              }
              href="#"
              aria-current={tab.legacyName === activeFile ? 'true' : undefined}
              onClick={(event) => {
                event.preventDefault();
                onSelect(tab.legacyName);
              }}
            >
              {tab.label}
            </a>
          </li>
        ))}
        {addVisible && <AddNewMenu vfs={vfs} instructor={instructor} onAdd={onSelect} />}
        <li className="nav-item">
          {/* File-tree rail toggle (M3.7; Studio extension, default off).
              Lives at the RIGHT end beside Add New so the file-management
              affordances read as one cluster (M7.4). */}
          <button
            type="button"
            className={
              'btn btn-sm btn-outline-secondary blockpy-toggle-filetree' +
              (fileTree ? ' active' : '')
            }
            aria-pressed={fileTree}
            title="Toggle file tree"
            onClick={toggleFileTree}
          >
            <Icon name="fileTree" />
          </button>
        </li>
      </ul>
    </div>
  );
}
