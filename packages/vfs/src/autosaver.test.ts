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

describe('save failures, bundle cleanliness, and deletions', () => {
  it('routes a failed save to onSaveError and keeps the file dirty', async () => {
    const vfs = new Vfs();
    const errors: Array<{ filename: string; error: unknown }> = [];
    const timers: Array<() => void> = [];
    new Autosaver({
      vfs,
      api: {
        async saveFile() {
          throw new Error('network down');
        },
      },
      onSaveError: (filename, error) => errors.push({ filename, error }),
      schedule: (fn) => {
        timers.push(fn);
        return () => undefined;
      },
    });
    vfs.write('answer.py', 'x');
    for (const fire of timers.splice(0)) fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.filename).toBe('answer.py');
    expect((errors[0]!.error as Error).message).toBe('network down');
    expect(vfs.isDirty('answer.py')).toBe(true);
  });

  it('marks every bundle member clean after the bundle saves', async () => {
    const s = setup();
    s.vfs.write('?data.csv', 'a,b');
    s.vfs.write('&readme.md', 'hi');
    s.vfs.write('answer.py', 'unrelated'); // a different wire file stays dirty
    expect(s.vfs.isDirty('?data.csv')).toBe(true);
    await s.fireTimers();
    expect(s.vfs.isDirty('?data.csv')).toBe(false);
    expect(s.vfs.isDirty('&readme.md')).toBe(false);
    expect(s.vfs.isDirty('answer.py')).toBe(false);
  });

  it('persists the deletion of an individually-saved file as an empty save', async () => {
    const s = setup();
    s.vfs.write('!on_change.py', 'print(1)');
    await s.fireTimers();
    expect(s.vfs.delete('!on_change.py')).toBe(true);
    await s.fireTimers();
    expect(s.saved).toEqual([
      { filename: '!on_change.py', code: 'print(1)' },
      { filename: '!on_change.py', code: '' },
    ]);
    expect(s.vfs.isDirty('!on_change.py')).toBe(false);
  });

  it('a deleted bundle member is persisted through the bundle and marked clean', async () => {
    const s = setup();
    s.vfs.write('?data.csv', 'a,b');
    await s.fireTimers();
    s.vfs.delete('?data.csv');
    await s.fireTimers();
    expect(JSON.parse(s.saved.at(-1)!.code)).toEqual({});
    expect(s.vfs.isDirty('?data.csv')).toBe(false);
  });

  it('saveAnswerNow is a no-op when answer.py was never loaded', async () => {
    const s = setup();
    await s.autosaver.saveAnswerNow();
    expect(s.saved).toEqual([]);
  });

  it('surfaces a success:false response through onSaveError and keeps the file dirty', async () => {
    const vfs = new Vfs();
    const errors: Array<{ filename: string; error: unknown }> = [];
    const timers: Array<() => void> = [];
    new Autosaver({
      vfs,
      api: {
        async saveFile() {
          return { success: false, message: 'assignment locked' };
        },
      },
      onSaveError: (filename, error) => errors.push({ filename, error }),
      schedule: (fn) => {
        timers.push(fn);
        return () => undefined;
      },
    });
    vfs.write('answer.py', 'x');
    for (const fire of timers.splice(0)) fire();
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.filename).toBe('answer.py');
    expect((errors[0]!.error as Error).message).toBe('assignment locked');
    expect(vfs.isDirty('answer.py')).toBe(true);
  });
});

describe('ordering and teardown', () => {
  /** A saver whose saveFile resolves only when the test releases it. */
  function manualSetup() {
    const vfs = new Vfs();
    const saved: Saved[] = [];
    const releases: Array<() => void> = [];
    const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
    const autosaver = new Autosaver({
      vfs,
      api: {
        saveFile(filename, code) {
          saved.push({ filename, code });
          return new Promise((resolve) => {
            releases.push(() => resolve({ success: true }));
          });
        },
      },
      schedule: (fn) => {
        const timer = { fn, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      },
    });
    const fireTimers = () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
    };
    const settle = async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    };
    return { vfs, saved, releases, timers, autosaver, fireTimers, settle };
  }

  it('serializes saves per wire file: a second edit waits for the in-flight POST', async () => {
    const s = manualSetup();
    s.vfs.write('answer.py', 'v1');
    s.fireTimers();
    await s.settle();
    expect(s.saved.map((entry) => entry.code)).toEqual(['v1']);
    // Edit again while v1 is still in flight.
    s.vfs.write('answer.py', 'v2');
    s.fireTimers();
    await s.settle();
    expect(s.saved.map((entry) => entry.code)).toEqual(['v1']); // queued, not sent
    expect(s.vfs.isDirty('answer.py')).toBe(true);
    // v1 lands: v2 was written after it was read, so the file stays dirty.
    s.releases.shift()!();
    await s.settle();
    expect(s.vfs.isDirty('answer.py')).toBe(true);
    expect(s.saved.map((entry) => entry.code)).toEqual(['v1', 'v2']);
    // v2 lands: nothing newer, so the file is clean.
    s.releases.shift()!();
    await s.settle();
    expect(s.vfs.isDirty('answer.py')).toBe(false);
  });

  it('does not mark clean when an edit lands during the POST (saveAnswerNow path)', async () => {
    const s = manualSetup();
    s.vfs.write('answer.py', 'v1');
    const saving = s.autosaver.saveAnswerNow();
    await s.settle();
    s.vfs.write('answer.py', 'v2'); // newer content while v1 is in flight
    s.releases.shift()!();
    await saving;
    expect(s.vfs.isDirty('answer.py')).toBe(true);
    // The debounced v2 save is queued behind v1 and cleans up after itself.
    s.fireTimers();
    await s.settle();
    s.releases.shift()!();
    await s.settle();
    expect(s.saved.map((entry) => entry.code)).toEqual(['v1', 'v2']);
    expect(s.vfs.isDirty('answer.py')).toBe(false);
  });

  it('flush() and dispose() persist edits still inside the debounce window', async () => {
    const s = setup();
    s.vfs.write('answer.py', 'last words');
    s.vfs.write('?data.csv', 'a,b');
    s.autosaver.dispose(); // timers never fire
    await s.fireTimers();
    expect(s.saved.map((entry) => entry.filename).sort()).toEqual([
      '#extra_instructor_files.blockpy',
      'answer.py',
    ]);
    expect(s.vfs.isDirty('answer.py')).toBe(false);
    expect(s.vfs.isDirty('?data.csv')).toBe(false);
    // After dispose, further edits are no longer observed.
    s.vfs.write('answer.py', 'ignored');
    await s.fireTimers();
    expect(s.saved).toHaveLength(2);
  });

  it('flush() resolves once the flushed saves settle', async () => {
    const s = setup();
    s.vfs.write('answer.py', 'flush me');
    await s.autosaver.flush();
    expect(s.saved).toEqual([{ filename: 'answer.py', code: 'flush me' }]);
    expect(s.vfs.isDirty('answer.py')).toBe(false);
  });
});
