/**
 * BootConfig assembly from the legacy page environment (spec §5.2
 * compatibility rule + §15.2): `mountLegacy()` reads the globals an
 * UNMODIFIED blockpy-server editor.html emits (editor.html:192-230) so the
 * rewrite can ship without a synchronized server release.
 */
import type { AssignmentTypeIndex, BootConfig, LegacyUrlMap } from './boot-config';

/**
 * The `settings-*` query-parameter loop (spec §15.2, editor.html:287-291):
 * prefix stripped, value kept as the RAW STRING — the Jinja loop passes
 * `request.args` values through `tojson` verbatim and the legacy client
 * coerces per key (A4), so JSON-parsing here would change behavior.
 * Applied LAST, over every other BootConfig source.
 */
export function settingsFromSearch(search: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (key.startsWith('settings-')) {
      settings[key.slice('settings-'.length)] = value;
    }
  }
  return settings;
}

/**
 * editor.html declares the type-index lists as top-level `const`
 * (editor.html:193-199), which lands in the global LEXICAL environment —
 * visible to later classic scripts but NOT a `window` property. Probe
 * `window` first (covers `var`/assignment variants), then indirect eval
 * (reaches lexical bindings); a CSP that blocks eval degrades to undefined.
 * Names are compile-time literals here, never caller input.
 */
function readLexicalGlobal(name: string, globals: Record<string, unknown>): unknown {
  if (globals[name] !== undefined) return globals[name];
  try {
    return (0, eval)(`typeof ${name} === 'undefined' ? undefined : ${name}`);
  } catch {
    return undefined;
  }
}

const idList = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : [];

/** Jinja `url_for` serializes flags as `True`/`False`; tolerate both cases. */
const flag = (value: string | null): boolean =>
  value !== null && ['true', '1'].includes(value.toLowerCase());

export interface LegacyGlobalsSource {
  /** Usually `window`; injectable for tests. */
  globals: Record<string, unknown>;
  /** Usually `location.search`. */
  search: string;
}

/**
 * Assemble a BootConfig purely from the legacy globals + page URL. Fields
 * the template only ever INLINED into its scripts (group header data,
 * passcode_protected, session_start_time, assignment_data) have no global
 * to read and take their defaults; the shim's BlockPy facade covers those
 * flows (`requestPasscode()` is invoked by the template itself, §15.1).
 */
export function bootConfigFromLegacyGlobals(source: LegacyGlobalsSource): BootConfig {
  const { globals, search } = source;
  const urls = (globals['$blockPyUrls'] ?? {}) as LegacyUrlMap;
  const userData = (globals['$blockPyUserData'] ?? {}) as Record<string, unknown>;
  const params = new URLSearchParams(search);

  const typeIndex: AssignmentTypeIndex = {
    quiz: idList(readLexicalGlobal('QUIZZES', globals)),
    reading: idList(readLexicalGlobal('READINGS', globals)),
    textbook: idList(readLexicalGlobal('TEXTBOOKS', globals)),
    java: idList(readLexicalGlobal('JAVAS', globals)),
    typescript: idList(readLexicalGlobal('KETTLES', globals)),
    explain: idList(readLexicalGlobal('EXPLAINS', globals)),
    blockpy: idList(readLexicalGlobal('BLOCKPYS', globals)),
  };

  const assignmentIdParam = params.get('assignment_id');
  const groupIdParam = params.get('assignment_group_id');
  const role = typeof userData['user.role'] === 'string' ? (userData['user.role'] as string) : 'anonymous';
  const blocklyMedia = typeof globals['$blocklyMediaPath'] === 'string' ? (globals['$blocklyMediaPath'] as string) : '';

  return {
    urls,
    user: {
      id: typeof userData['user.id'] === 'number' ? (userData['user.id'] as number) : null,
      name: typeof userData['user.name'] === 'string' ? (userData['user.name'] as string) : undefined,
      role,
      courseId:
        typeof userData['user.course_id'] === 'number' ? (userData['user.course_id'] as number) : null,
    },
    accessToken:
      typeof userData['access_token'] === 'string'
        ? (userData['access_token'] as string)
        : typeof globals['accessToken'] === 'string'
          ? (globals['accessToken'] as string)
          : undefined,
    assignment: {
      currentAssignmentId: assignmentIdParam ? Number(assignmentIdParam) : null,
      assignmentGroupId: groupIdParam ? Number(groupIdParam) : null,
      typeIndex,
    },
    display: {
      // editor.html:277 — instructor display is derived from the role.
      instructor: role === 'owner' || role === 'grader',
      readOnly: flag(params.get('read_only')),
      embed: flag(params.get('embed')),
    },
    passcodeProtected: false,
    sessionStartTime: null,
    paths: {
      blocklyMedia,
      // editor.html:294 hardcodes static/images/emoji/ next to the blockly
      // media dir; derive it from the same static root.
      emojiProxy: blocklyMedia ? blocklyMedia.replace(/blockly\/media\/?$/, 'images/emoji/') : '',
      pyodideIndexURL: '',
    },
    settings: settingsFromSearch(search),
    corgisUrl: typeof urls.importDatasets === 'string' ? urls.importDatasets : '',
  };
}
