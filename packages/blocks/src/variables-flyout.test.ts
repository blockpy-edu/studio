// @vitest-environment jsdom
/**
 * M3.1 regression suite: Blockly locale population (the right-click crash —
 * empty `Blockly.Msg` made the default context menu throw on
 * `Msg.DELETE_X_BLOCKS.replace(...)`) and the BlockMirror variables-flyout
 * port (blockly_shims.js:64-119).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Blockly from 'blockly/core';
import './ast';
import { variablesFlyoutBlocks } from './variables-flyout';

function setHide(value: boolean | undefined): void {
  (Blockly.Variables as unknown as Record<string, unknown>)[
    '_HIDE_GETTERS_SETTERS'
  ] = value;
}

afterEach(() => setHide(false));

describe('Blockly locale (M3.1)', () => {
  it('populates Blockly.Msg so default context-menu templates resolve', () => {
    // The exact message the default workspace context menu .replace()s on.
    expect(Blockly.Msg['DELETE_X_BLOCKS']).toContain('%1');
    // The variables flyout button text + the astName delete entry.
    expect(Blockly.Msg['NEW_VARIABLE']).toBeTruthy();
    expect(Blockly.Msg['DELETE_VARIABLE']).toContain('%1');
  });
});

describe('variables flyout (BlockMirror port)', () => {
  it('returns no blocks for a workspace without variables', () => {
    const ws = new Blockly.Workspace();
    expect(variablesFlyoutBlocks(ws)).toEqual([]);
    ws.dispose();
  });

  it('serves ast_Assign / ast_AugAssign / ast_Name, not stock variables_*', () => {
    const ws = new Blockly.Workspace();
    ws.createVariable('banana');
    ws.createVariable('apple');
    const blocks = variablesFlyoutBlocks(ws);
    expect(blocks.map((el) => el.getAttribute('type'))).toEqual([
      'ast_Assign',
      'ast_AugAssign',
      'ast_Name',
      'ast_Name',
    ]);
    // Starter blocks carry the MOST RECENT variable's field (the intent the
    // legacy string concat silently dropped — see variables-flyout.ts).
    const assignField = blocks[0]!.querySelector('field[name="VAR"]');
    expect(assignField?.textContent).toBe('apple');
    // AugAssign keeps the legacy shadow + simple mutation.
    expect(blocks[1]!.querySelector('shadow[type="ast_Num"]')).toBeTruthy();
    expect(
      blocks[1]!.querySelector('mutation')?.getAttribute('simple'),
    ).toBe('true');
    ws.dispose();
  });

  it('sorts ast_Name getters case-SENSITIVELY like the legacy compare', () => {
    const ws = new Blockly.Workspace();
    ws.createVariable('apple');
    ws.createVariable('Zebra');
    const names = variablesFlyoutBlocks(ws)
      .filter((el) => el.getAttribute('type') === 'ast_Name')
      .map((el) => el.querySelector('field[name="VAR"]')?.textContent);
    // 'Z' < 'a' in code-unit order — Blockly's locale compare would flip it.
    expect(names).toEqual(['Zebra', 'apple']);
    ws.dispose();
  });

  it('honors _HIDE_GETTERS_SETTERS: labels only, no assign/getter blocks', () => {
    const ws = new Blockly.Workspace();
    ws.createVariable('speed');
    setHide(true);
    const entries = variablesFlyoutBlocks(ws);
    expect(entries.map((el) => el.tagName.toLowerCase())).toEqual(['label']);
    expect(entries[0]!.getAttribute('text')).toBe('speed');
    expect(entries[0]!.getAttribute('web-class')).toBe(
      'blockmirror-toolbox-variable',
    );
    ws.dispose();
  });
});
