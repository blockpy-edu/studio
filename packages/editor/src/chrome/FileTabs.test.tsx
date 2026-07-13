// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { Vfs } from '@blockpy/vfs';
import { computeTabs, FileTabs } from './FileTabs';
import { resolveToolboxSetting } from './CodingEditor';
import { TOOLBOX_CATEGORY } from '../dual/toolboxes';

function seededVfs(): Vfs {
  const vfs = new Vfs();
  vfs.write('answer.py', 'a = 0');
  vfs.write('^starting_code.py', 'a = 0');
  vfs.write('!instructions.md', 'Do it.');
  vfs.write('!on_run.py', 'from pedal import *');
  // !on_change.py deliberately ABSENT → its starred tab hides (legacy
  // onChange === null); an existing-but-empty file would be visible.
  vfs.write('&sample_data.txt', 'x,1');
  return vfs;
}

describe('computeTabs (A8 §1 Row 3 / files.js order)', () => {
  it('students see answer.py and the readonly file, not instructor tabs', () => {
    const tabs = computeTabs(seededVfs(), 'student');
    const names = tabs.map((tab) => tab.legacyName);
    expect(names[0]).toBe('answer.py');
    expect(names).toContain('&sample_data.txt');
    expect(names).not.toContain('!instructions.md');
    expect(names).not.toContain('!on_run.py');
  });

  it('& files are uneditable for students (D3-A/LD-3)', () => {
    const tabs = computeTabs(seededVfs(), 'student');
    const readonly = tabs.find((tab) => tab.legacyName === '&sample_data.txt');
    expect(readonly!.uneditable).toBe(true);
    const answer = tabs.find((tab) => tab.legacyName === 'answer.py');
    expect(answer!.uneditable).toBe(false);
  });

  it('instructors get the fixed special-tab order, empty starred tabs hidden', () => {
    const tabs = computeTabs(seededVfs(), 'instructor');
    const labels = tabs.map((tab) => tab.label);
    expect(labels.slice(0, 5)).toEqual([
      'answer.py',
      'Instructions',
      'Settings',
      'Starting Code',
      'On Run',
    ]);
    // Empty !on_change.py stays hidden; missing On Eval etc. hidden too.
    expect(labels).not.toContain('On Change');
    expect(labels).not.toContain('On Eval');
  });
});

describe('FileTabs component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders legacy markup and marks active/uneditable tabs', () => {
    const vfs = seededVfs();
    const { container } = render(
      <FileTabs vfs={vfs} role="student" activeFile="answer.py" onSelect={() => {}} />,
    );
    expect(container.querySelector('ul.nav.nav-tabs')).not.toBeNull();
    const active = container.querySelector('.nav-link.active');
    expect(active!.textContent).toBe('answer.py');
    const uneditable = container.querySelector('.nav-link.uneditable');
    expect(uneditable!.textContent).toBe('&sample_data.txt');
  });

  it('re-renders when the VFS changes', () => {
    const vfs = seededVfs();
    const { container } = render(
      <FileTabs vfs={vfs} role="student" activeFile="answer.py" onSelect={() => {}} />,
    );
    act(() => {
      vfs.write('extra_notes.txt', 'hello');
    });
    const labels = [...container.querySelectorAll('.nav-link')].map((el) => el.textContent);
    expect(labels).toContain('extra_notes.txt');
  });
});

describe('resolveToolboxSetting (A4 toolbox key)', () => {
  it('maps presets and defaults unknown values to normal', () => {
    expect(resolveToolboxSetting(undefined)).toBe('normal');
    expect(resolveToolboxSetting('ct')).toBe('ct');
    expect(resolveToolboxSetting('nonsense')).toBe('normal');
  });

  it('custom reads ?toolbox.blockpy, falling back to empty (legacy)', () => {
    const vfs = new Vfs();
    expect(resolveToolboxSetting('custom', vfs)).toBe('empty');
    vfs.write('?toolbox.blockpy', 'not json');
    expect(resolveToolboxSetting('custom', vfs)).toBe('empty');
    vfs.write('?toolbox.blockpy', JSON.stringify([TOOLBOX_CATEGORY['VARIABLES']]));
    const custom = resolveToolboxSetting('custom', vfs);
    expect(Array.isArray(custom)).toBe(true);
  });
});
