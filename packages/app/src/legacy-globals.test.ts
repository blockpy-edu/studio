import { describe, expect, it } from 'vitest';
import { bootConfigFromLegacyGlobals, settingsFromSearch } from './legacy-globals';

describe('settingsFromSearch (§15.2)', () => {
  it('strips the prefix and keeps values as RAW strings (A4)', () => {
    const settings = settingsFromSearch(
      '?settings-toolbox=ct2&settings-hide_files=true&other=1&settings-text_first_toolbox=%22quoted%22',
    );
    expect(settings).toEqual({
      toolbox: 'ct2',
      hide_files: 'true', // string, never parsed to a boolean
      text_first_toolbox: '"quoted"', // JSON stays embedded in the string
    });
  });

  it('returns empty for no params', () => {
    expect(settingsFromSearch('')).toEqual({});
    expect(settingsFromSearch('?a=1')).toEqual({});
  });
});

describe('bootConfigFromLegacyGlobals (§5.2 compatibility rule)', () => {
  const legacyPage = {
    globals: {
      $blockPyUrls: {
        loadAssignment: '/blockpy/load_assignment',
        importDatasets: 'https://corgis.example/datasets/',
      },
      $blockPyUserData: {
        'user.id': 42,
        'user.name': 'Ada Lovelace',
        'user.role': 'grader',
        'user.course_id': 7,
        access_token: 'tok-123',
      },
      $blocklyMediaPath: '/static/blockly/media/',
      QUIZZES: [102],
      READINGS: [103],
      TEXTBOOKS: [],
      JAVAS: [],
      KETTLES: [],
      EXPLAINS: [],
      BLOCKPYS: [101],
    },
    search: '?assignment_id=101&assignment_group_id=11&embed=True&settings-toolbox=minimal',
  };

  it('assembles the full BootConfig from the editor.html globals', () => {
    const config = bootConfigFromLegacyGlobals(legacyPage);
    expect(config.urls.loadAssignment).toBe('/blockpy/load_assignment');
    expect(config.user).toEqual({
      id: 42,
      name: 'Ada Lovelace',
      role: 'grader',
      courseId: 7,
    });
    expect(config.accessToken).toBe('tok-123');
    expect(config.assignment.currentAssignmentId).toBe(101);
    expect(config.assignment.assignmentGroupId).toBe(11);
    expect(config.assignment.typeIndex.quiz).toEqual([102]);
    expect(config.assignment.typeIndex.blockpy).toEqual([101]);
    // editor.html:277 — instructor display derives from the role.
    expect(config.display.instructor).toBe(true);
    // Jinja url_for booleans serialize as True/False.
    expect(config.display.embed).toBe(true);
    expect(config.display.readOnly).toBe(false);
    expect(config.paths.blocklyMedia).toBe('/static/blockly/media/');
    expect(config.paths.emojiProxy).toBe('/static/images/emoji/');
    expect(config.settings).toEqual({ toolbox: 'minimal' });
    expect(config.corgisUrl).toBe('https://corgis.example/datasets/');
  });

  it('degrades to safe defaults on a bare page', () => {
    const config = bootConfigFromLegacyGlobals({ globals: {}, search: '' });
    expect(config.user).toEqual({
      id: null,
      name: undefined,
      role: 'anonymous',
      courseId: null,
    });
    expect(config.display.instructor).toBe(false);
    expect(config.assignment.currentAssignmentId).toBeNull();
    expect(config.assignment.typeIndex.blockpy).toEqual([]);
    expect(config.corgisUrl).toBe('');
  });

  it('falls back to window.accessToken when user data lacks the token', () => {
    const config = bootConfigFromLegacyGlobals({
      globals: { accessToken: 'window-token' },
      search: '',
    });
    expect(config.accessToken).toBe('window-token');
  });
});
