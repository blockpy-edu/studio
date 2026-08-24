// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveStartPythonMode, useEditorChromeStore } from './store';

describe('editor mode persistence', () => {
  beforeEach(() => {
    localStorage.removeItem('BLOCKPY_display.pythonMode');
  });

  it("defaults to the assignment's start_view when the user never chose", () => {
    expect(resolveStartPythonMode('block')).toBe('block');
    expect(resolveStartPythonMode('split')).toBe('split');
    expect(resolveStartPythonMode(undefined)).toBe('text');
    expect(resolveStartPythonMode('bogus')).toBe('text');
  });

  it('remembers a toolbar choice across loads, overriding start_view', () => {
    useEditorChromeStore.getState().setPythonMode('text');
    expect(localStorage.getItem('BLOCKPY_display.pythonMode')).toBe('text');
    expect(resolveStartPythonMode('block')).toBe('text');
  });

  it('applyPythonMode does not overwrite the remembered choice', () => {
    useEditorChromeStore.getState().setPythonMode('block');
    useEditorChromeStore.getState().applyPythonMode('split');
    expect(useEditorChromeStore.getState().pythonMode).toBe('split');
    expect(resolveStartPythonMode('text')).toBe('block');
  });
});
