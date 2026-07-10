import { beforeEach, describe, expect, it } from 'vitest';
import { Autosaver } from './autosaver';
import { Vfs } from './vfs';

interface Saved {
  filename: string;
  code: string;
}

function setup(opts: { autoSave?: boolean; readOnly?: boolean; versionChange?: boolean } = {}) {
  const vfs = new Vfs();
  const saved: Saved[] = [];
  const staleFiles: string[] = [];
  const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
  const autosaver = new Autosaver({
    vfs,
    api: {
      async saveFile(filename, code) {
        saved.push({ filename, code });
        return { success: true, version_change: opts.versionChange ?? false };
      },
    },
    autoSave: () => opts.autoSave ?? true,
    readOnly: () => opts.readOnly ?? false,
    onVersionChange: (f) => staleFiles.push(f),
    schedule: (fn) => {
      const timer = { fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const fireTimers = async () => {
    const due = timers.splice(0);
    for (const t of due) if (!t.cancelled) t.fn();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { vfs, saved, staleFiles, autosaver, fireTimers };
}

describe('debounced autosave (legacy TIMER_DELAY semantics)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it('saves an individually-persisted file after the debounce', async () => {
    s.vfs.write('answer.py', 'x = 1');
    await s.fireTimers();
    expect(s.saved).toEqual([{ filename: 'answer.py', code: 'x = 1' }]);
    expect(s.vfs.isDirty('answer.py')).toBe(false);
  });

  it('coalesces rapid edits into one save (last contents win)', async () => {
    s.vfs.write('answer.py', 'v1');
    s.vfs.write('answer.py', 'v2');
    s.vfs.write('answer.py', 'v3');
    await s.fireTimers();
    expect(s.saved).toEqual([{ filename: 'answer.py', code: 'v3' }]);
  });

  it('saves bundle members as one save of their # bundle', async () => {
    s.vfs.write('?data.csv', 'a,b');
    s.vfs.write('&readme.md', 'hi');
    await s.fireTimers();
    expect(s.saved).toHaveLength(1);
    expect(s.saved[0]!.filename).toBe('#extra_instructor_files.blockpy');
    expect(JSON.parse(s.saved[0]!.code)).toEqual({ '?data.csv': 'a,b', '&readme.md': 'hi' });
  });

  it('never autosaves manual-only or never-persisted files', async () => {
    s.vfs.write('!assignment_settings.blockpy', '{}'); // manual saveAssignment
    s.vfs.write('$settings.blockpy', '{}'); // never persisted
    s.vfs.write('!tags.blockpy', '[]'); // no persistence path
    await s.fireTimers();
    expect(s.saved).toEqual([]);
  });

  it('saveAnswerNow persists immediately (legacy: on every Run)', async () => {
    s.vfs.write('answer.py', 'run me');
    await s.autosaver.saveAnswerNow();
    expect(s.saved).toEqual([{ filename: 'answer.py', code: 'run me' }]);
  });
});

describe('gating (A1 §2, A2 §2)', () => {
  it('read-only mode blocks all persistence', async () => {
    const s = setup({ readOnly: true });
    s.vfs.write('answer.py', 'x');
    await s.fireTimers();
    expect(s.saved).toEqual([]);
  });

  it('autoSave=false blocks automatic persistence', async () => {
    const s = setup({ autoSave: false });
    s.vfs.write('answer.py', 'x');
    await s.fireTimers();
    expect(s.saved).toEqual([]);
  });
});

describe('stale-version banner hook (spec §7.4)', () => {
  it('reports version_change and keeps the file dirty', async () => {
    const s = setup({ versionChange: true });
    s.vfs.write('answer.py', 'x');
    await s.fireTimers();
    expect(s.staleFiles).toEqual(['answer.py']);
    expect(s.vfs.isDirty('answer.py')).toBe(true);
  });
});
