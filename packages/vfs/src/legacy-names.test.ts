/**
 * Conformance suite: legacy-name adapter (spec §16.1.1).
 * Fixture authority: docs/appendices/A1-filename-prefixes.md.
 */
import { describe, expect, it } from 'vitest';
import {
  format,
  MAGIC_NAMES,
  magicName,
  parse,
  persistencePlan,
  SPACE_LAYER,
  SPACE_PREFIX,
  SPACES,
} from './legacy-names';

describe('parse/format', () => {
  it('round-trips every prefix (full files.js set "!^?&$*#", A1 §7.8)', () => {
    for (const space of SPACES) {
      const legacy = SPACE_PREFIX[space] + 'example.py';
      const parsed = parse(legacy);
      expect(parsed.space).toBe(space);
      expect(parsed.basename).toBe('example.py');
      expect(format(parsed.space, parsed.basename)).toBe(legacy);
    }
  });

  it('parses the canonical examples from A1 §1', () => {
    expect(parse('!on_run.py')).toEqual({
      space: 'instructor',
      basename: 'on_run.py',
      legacyName: '!on_run.py',
    });
    expect(parse('answer.py').space).toBe('student');
    expect(parse('^starting_code.py').space).toBe('starting');
    expect(parse('?mock_urls.blockpy').space).toBe('hidden');
    expect(parse('&data.txt').space).toBe('readonly');
    expect(parse('$settings.blockpy').space).toBe('secret');
    expect(parse('*plot.png').space).toBe('generated');
    expect(parse('#extra_student_files.blockpy').space).toBe('bundle');
  });

  it('round-trips every magic name', () => {
    for (const magic of MAGIC_NAMES) {
      const parsed = parse(magic.legacyName);
      expect(format(parsed.space, parsed.basename)).toBe(magic.legacyName);
    }
  });
});

describe('layer ownership (A1 §1 model-storage mapping)', () => {
  it("assigns '&' to the assignment layer, not submission (A1 delta 1)", () => {
    expect(SPACE_LAYER.readonly).toBe('assignment');
  });
  it("assigns '*' generated files to the submission layer (files.js:585)", () => {
    expect(SPACE_LAYER.generated).toBe('submission');
  });
  it("'$' is local-only and '#' is wire format (A1 deltas 3-4)", () => {
    expect(SPACE_LAYER.secret).toBe('local');
    expect(SPACE_LAYER.bundle).toBe('wire');
  });
});

describe('persistence plans (A1 §4d)', () => {
  const individually = [
    'answer.py',
    '!on_run.py',
    '!on_change.py',
    '!on_eval.py',
    '!instructions.md',
    '^starting_code.py',
  ];
  it('autosaves the six individual saveFile names', () => {
    for (const name of individually) {
      expect(persistencePlan(name)).toEqual({ kind: 'saveFile', wireName: name });
    }
  });

  it('routes generic extras to their space bundles (server.js:131-133)', () => {
    expect(persistencePlan('data.txt')).toEqual({
      kind: 'bundle',
      wireName: '#extra_student_files.blockpy',
    });
    expect(persistencePlan('^extra_start.py')).toEqual({
      kind: 'bundle',
      wireName: '#extra_starting_files.blockpy',
    });
    for (const name of ['!secret.py', '?data.csv', '&readme.md']) {
      expect(persistencePlan(name)).toEqual({
        kind: 'bundle',
        wireName: '#extra_instructor_files.blockpy',
      });
    }
    expect(persistencePlan('*artifact.txt')).toEqual({
      kind: 'bundle',
      wireName: '#extra_student_files.blockpy',
    });
  });

  it('settings blob is manual saveAssignment only (A1 delta 6)', () => {
    expect(persistencePlan('!assignment_settings.blockpy').kind).toBe('saveAssignment');
  });

  it('never persists $settings, tags, or sample submissions (A1 §4d)', () => {
    for (const name of ['$settings.blockpy', '!tags.blockpy', '!sample_submissions.blockpy']) {
      expect(persistencePlan(name)).toEqual({ kind: 'none', wireName: null });
    }
    expect(persistencePlan('$anything.txt').kind).toBe('none');
  });

  it('magic ?/& names ride the instructor bundle', () => {
    for (const name of ['?toolbox.blockpy', '?mock_urls.blockpy', '!answer_prefix.py']) {
      expect(persistencePlan(name)).toEqual({
        kind: 'bundle',
        wireName: '#extra_instructor_files.blockpy',
      });
    }
  });
});

describe('deletion guards (files.js:229-239; A1 §7.4)', () => {
  it('marks only on_change/on_eval deletable', () => {
    const deletable = MAGIC_NAMES.filter((m) => m.deletable).map((m) => m.legacyName);
    expect(deletable.sort()).toEqual(['!on_change.py', '!on_eval.py']);
  });
  it('protects the real .blockpy settings name (legacy had a .py typo)', () => {
    expect(magicName('!assignment_settings.blockpy')?.deletable).toBe(false);
  });
});
