// @vitest-environment jsdom
/**
 * §15.3 navigation compatibility globals: shape parity with the
 * assignment_groups.html macro (:27-38, :204), never-clobber semantics,
 * and disposer scope.
 */
import { describe, expect, it, vi } from 'vitest';
import { publishNavigationGlobals } from './globals';
import type { GroupNavBootData } from './store';

const GROUP: GroupNavBootData = {
  assignments: [
    {
      id: 101,
      name: 'A',
      url: '/load?assignment_id=101',
      subordinate: false,
      hidden: false,
      correct: false,
    },
    {
      id: 104,
      name: 'B',
      url: '/load?assignment_id=104',
      subordinate: false,
      hidden: false,
      correct: false,
    },
    {
      id: 102,
      name: 'Sub',
      url: '/load?assignment_id=102',
      subordinate: true,
      hidden: false,
      correct: false,
    },
    {
      id: 103,
      name: 'C',
      url: '/load?assignment_id=103',
      subordinate: false,
      hidden: false,
      correct: false,
    },
  ],
  anySecretive: false,
  currentAssignmentId: 101,
};

describe('publishNavigationGlobals (§15.3)', () => {
  it('publishes the macro-shaped globals from non-subordinate assignments', () => {
    const globals: Record<string, unknown> = {};
    document.body.innerHTML =
      '<div class="assignment-selector-div"><div class="row">header</div></div>';
    const dispose = publishNavigationGlobals(GROUP, { globals, document });
    expect(globals['URL_MAP']).toEqual({
      101: '/load?assignment_id=101',
      104: '/load?assignment_id=104',
      103: '/load?assignment_id=103',
    });
    expect(globals['INDICES']).toEqual([101, 104, 103]);
    expect(globals['FIRST_ID']).toBe(101);
    expect(globals['LAST_ID']).toBe(103);
    expect(globals['FULL_SELECTOR_DIV']).toBe('<div class="row">header</div>');
    expect(typeof globals['loadNavigation']).toBe('function');
    dispose();
    expect(Object.keys(globals)).toHaveLength(0);
  });

  it('never clobbers template-owned globals and only disposes its own', () => {
    const templateUrlMap = { 7: '/legacy' };
    const globals: Record<string, unknown> = { URL_MAP: templateUrlMap, FIRST_ID: 7 };
    const dispose = publishNavigationGlobals(GROUP, { globals, document });
    expect(globals['URL_MAP']).toBe(templateUrlMap);
    expect(globals['FIRST_ID']).toBe(7);
    expect(globals['LAST_ID']).toBe(103);
    dispose();
    expect(globals['URL_MAP']).toBe(templateUrlMap);
    expect(globals['FIRST_ID']).toBe(7);
    expect(globals['LAST_ID']).toBeUndefined();
  });

  it('re-fires the provided hook from loadNavigation()', () => {
    const globals: Record<string, unknown> = {};
    const onLoadNavigation = vi.fn();
    const dispose = publishNavigationGlobals(GROUP, { globals, document, onLoadNavigation });
    (globals['loadNavigation'] as () => void)();
    expect(onLoadNavigation).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('publishes nothing for a group with no non-subordinate assignments', () => {
    const globals: Record<string, unknown> = {};
    const dispose = publishNavigationGlobals(
      { assignments: [], anySecretive: false, currentAssignmentId: 0 },
      { globals, document },
    );
    expect(Object.keys(globals)).toHaveLength(0);
    dispose();
  });
});
