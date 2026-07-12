/**
 * M3.7 / LD-21: rename + namespace-move. Magic names are immovable
 * (UNRENAMABLE_FILES, files.js:234); targets never clobber; events fire so
 * the file UI stays live.
 */
import { describe, expect, it } from 'vitest';
import { Vfs } from './vfs';

describe('Vfs.rename (LD-21)', () => {
  it('renames within the space and fires write+delete events', () => {
    const vfs = new Vfs();
    vfs.write('!helpers.py', 'x = 1');
    const events: string[] = [];
    vfs.onChange((change) => events.push(`${change.type}:${change.legacyName}`));
    expect(vfs.rename('!helpers.py', 'utilities.py')).toBe(true);
    expect(vfs.read('!helpers.py')).toBeUndefined();
    expect(vfs.read('!utilities.py')).toBe('x = 1');
    expect(events).toEqual(['write:!utilities.py', 'delete:!helpers.py']);
  });

  it('refuses magic names, missing sources, and clobbering', () => {
    const vfs = new Vfs();
    vfs.write('answer.py', 'a');
    vfs.write('data.txt', 'd');
    vfs.write('other.txt', 'o');
    expect(vfs.rename('answer.py', 'main.py')).toBe(false);
    expect(vfs.rename('missing.txt', 'x.txt')).toBe(false);
    expect(vfs.rename('data.txt', 'other.txt')).toBe(false);
    // Renaming ONTO a magic name is also refused.
    expect(vfs.rename('data.txt', 'answer.py')).toBe(false);
    expect(vfs.read('data.txt')).toBe('d');
  });

  it('capability helpers mirror the guards', () => {
    const vfs = new Vfs();
    expect(vfs.canRenameName('answer.py')).toBe(false);
    expect(vfs.canRenameName('?data.txt')).toBe(true);
    expect(vfs.canDeleteName('!on_change.py')).toBe(true); // files.js:229
    expect(vfs.canDeleteName('answer.py')).toBe(false);
    expect(vfs.canDeleteName('plain.txt')).toBe(true);
  });
});

describe('Vfs.changeSpace (M3.7, net-new)', () => {
  it('moves between namespaces keeping the basename', () => {
    const vfs = new Vfs();
    vfs.write('?secret.txt', 'hidden data');
    expect(vfs.changeSpace('?secret.txt', 'readonly')).toBe(true);
    expect(vfs.read('?secret.txt')).toBeUndefined();
    expect(vfs.read('&secret.txt')).toBe('hidden data');
  });

  it('refuses same-space moves, magic names, and clobbering', () => {
    const vfs = new Vfs();
    vfs.write('?a.txt', '1');
    vfs.write('&a.txt', '2');
    expect(vfs.changeSpace('?a.txt', 'hidden')).toBe(false);
    expect(vfs.changeSpace('?a.txt', 'readonly')).toBe(false); // &a.txt exists
    expect(vfs.changeSpace('answer.py', 'instructor')).toBe(false);
  });
});
