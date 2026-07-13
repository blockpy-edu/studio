// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { StudioHandle, type BootConfig } from '@blockpy/app';
import { BlockPy, asLegacyDeferred, installLegacyShim, optionsToBootConfig } from './facade';

/** The exact option bag editor.html:263-292 passes. */
const EDITOR_HTML_OPTIONS = {
  'blockly.path': '/static/blockly/media/',
  'attachment.point': '#blockpy-div',
  urls: { loadAssignment: '/blockpy/load_assignment', importDatasets: '/corgis/' },
  'user.id': 42,
  'user.name': 'Ada Lovelace',
  'user.role': 'grader',
  'user.course_id': 7,
  'user.group_id': 11,
  access_token: 'tok-123',
  'display.instructor': true,
  'callback.success': () => undefined,
  // Jinja settings-* loop output: raw strings (editor.html:287-291).
  toolbox: 'ct2',
};

describe('optionsToBootConfig (§15.1)', () => {
  it('maps the editor.html option bag structurally', () => {
    const config = optionsToBootConfig(EDITOR_HTML_OPTIONS);
    expect(config.user).toEqual({ id: 42, name: 'Ada Lovelace', role: 'grader', courseId: 7 });
    expect(config.accessToken).toBe('tok-123');
    expect(config.assignment.assignmentGroupId).toBe(11);
    expect(config.display.instructor).toBe(true);
    expect(config.display.readOnly).toBe(false);
    expect(config.paths.blocklyMedia).toBe('/static/blockly/media/');
    expect(config.paths.emojiProxy).toBe('/static/images/emoji/');
    expect(config.corgisUrl).toBe('/corgis/');
    // Unknown keys land in settings as raw strings.
    expect(config.settings).toEqual({ toolbox: 'ct2' });
  });

  it('stringifies non-string settings for the legacy "" + v coercion', () => {
    const config = optionsToBootConfig({ hide_files: true, start_view: 5 });
    expect(config.settings).toEqual({ hide_files: 'true', start_view: '5' });
  });

  it('applies the page URL settings-* params LAST (§15.2)', () => {
    const config = optionsToBootConfig({ toolbox: 'normal' }, '?settings-toolbox=minimal');
    expect(config.settings['toolbox']).toBe('minimal');
  });
});

describe('asLegacyDeferred', () => {
  it('supports .done chaining like a jQuery Deferred', async () => {
    const done = vi.fn();
    const always = vi.fn();
    const deferred = asLegacyDeferred(Promise.resolve('ok'));
    expect(deferred.done(done).always(always)).toBe(deferred);
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toHaveBeenCalledWith('ok');
    expect(always).toHaveBeenCalled();
  });

  it('routes rejections to .fail without unhandled rejections', async () => {
    const fail = vi.fn();
    const done = vi.fn();
    asLegacyDeferred(Promise.reject(new Error('nope')))
      .done(done)
      .fail(fail);
    await Promise.resolve();
    await Promise.resolve();
    expect(fail).toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
});

/** Fake mount capturing what the facade forwards. */
function fakeMount() {
  const calls: { rootElement: HTMLElement; config: BootConfig }[] = [];
  const actions = {
    loadAssignment: vi.fn(() => Promise.resolve()),
    loadAssignmentData: vi.fn(),
    requestPasscode: vi.fn(),
  };
  const mount = (rootElement: HTMLElement, config: BootConfig) => {
    calls.push({ rootElement, config });
    const handle = new StudioHandle(rootElement, () => undefined);
    handle._registerActions(actions);
    return handle;
  };
  return { mount, calls, actions };
}

describe('BlockPy facade (§15.1)', () => {
  const setup = () => {
    document.body.innerHTML = '<div id="blockpy-div"></div>';
    const { mount, calls, actions } = fakeMount();
    const globals: Record<string, unknown> = {};
    const editor = new BlockPy(EDITOR_HTML_OPTIONS, {
      mount: mount as never,
      globals,
      document,
      search: '',
    });
    return { editor, calls, actions, globals };
  };

  it('mounts at attachment.point and points $MAIN_BLOCKPY_EDITOR at itself', () => {
    const { editor, calls, globals } = setup();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.rootElement.id).toBe('blockpy-div');
    expect(globals['$MAIN_BLOCKPY_EDITOR']).toBe(editor);
  });

  it('loadAssignment returns a Deferred whose .done fires on completion', async () => {
    const { editor, actions } = setup();
    const done = vi.fn();
    editor.loadAssignment(101).done(done);
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.loadAssignment).toHaveBeenCalledWith(101);
    expect(done).toHaveBeenCalled();
  });

  it('forwards loadAssignmentData_, hide/show, requestPasscode', () => {
    const { editor, calls, actions } = setup();
    const payload = { assignment: { id: 1 } };
    editor.loadAssignmentData_(payload);
    expect(actions.loadAssignmentData).toHaveBeenCalledWith(payload);
    editor.hide();
    expect(calls[0]!.rootElement.style.display).toBe('none');
    editor.show();
    expect(calls[0]!.rootElement.style.display).toBe('');
    editor.requestPasscode();
    expect(actions.requestPasscode).toHaveBeenCalled();
  });

  it('queues calls made before the app registers (template same-tick flow)', async () => {
    document.body.innerHTML = '<div id="blockpy-div"></div>';
    const actions = {
      loadAssignment: vi.fn(() => Promise.resolve()),
      loadAssignmentData: vi.fn(),
      requestPasscode: vi.fn(),
    };
    let handle: StudioHandle | undefined;
    const editor = new BlockPy(EDITOR_HTML_OPTIONS, {
      mount: ((rootElement: HTMLElement) => {
        handle = new StudioHandle(rootElement, () => undefined);
        return handle; // React has NOT committed yet — no actions registered
      }) as never,
      globals: {},
      document,
      search: '',
    });
    const done = vi.fn();
    editor.loadAssignment(101).done(done); // same tick as the constructor
    expect(actions.loadAssignment).not.toHaveBeenCalled();
    handle!._registerActions(actions); // React commits later
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.loadAssignment).toHaveBeenCalledWith(101);
    expect(done).toHaveBeenCalled();
  });

  it('installLegacyShim publishes window.blockpy.BlockPy', () => {
    const target: Record<string, unknown> = {};
    installLegacyShim(target);
    expect((target['blockpy'] as { BlockPy: unknown }).BlockPy).toBe(BlockPy);
  });
});
