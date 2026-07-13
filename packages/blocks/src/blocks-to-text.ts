/**
 * Blocks → Python text: thin wrappers around the shimmed generator plus
 * headless workspace loading (used by the round-trip suite and Split view).
 */
import * as Blockly from 'blockly/core';
import { generator, installGeneratorShims } from './generator';

/** Generate Python source from a workspace (rendered or headless). */
export function workspaceToPython(workspace: Blockly.Workspace): string {
  installGeneratorShims();
  return generator.workspaceToCode(workspace);
}

/** Load Blockly XML (string or element) into a fresh headless workspace. */
export function xmlToWorkspace(xml: string | Element): Blockly.Workspace {
  const dom = typeof xml === 'string' ? Blockly.utils.xml.textToDom(xml) : xml;
  const workspace = new Blockly.Workspace();
  Blockly.Xml.domToWorkspace(dom, workspace);
  return workspace;
}

/** Convenience: XML → Python in one step, disposing the temp workspace. */
export function xmlToPython(xml: string | Element): string {
  const workspace = xmlToWorkspace(xml);
  try {
    return workspaceToPython(workspace);
  } finally {
    workspace.dispose();
  }
}
