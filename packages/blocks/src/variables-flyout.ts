/**
 * Variables toolbox category for `custom="VARIABLE"` — the BlockMirror
 * override port (legacy `blockly_shims.js:64-119`) that Milestone 1.4 missed:
 * the flyout must serve `ast_Assign` / `ast_AugAssign` / `ast_Name` blocks
 * (the AST block set that round-trips), not Blockly's stock
 * `variables_get/set`, and it honors the `_HIDE_GETTERS_SETTERS` flag that
 * `toolboxes.ts` toggles per category.
 *
 * Blockly 11 captures `Variables.flyoutCategoryBlocks` as a module-local
 * binding when it registers the default VARIABLE callback, so the legacy
 * monkey-patch route is dead — `installVariablesFlyout` RE-registers the
 * category callback on the workspace instead (last registration wins).
 */
import * as Blockly from 'blockly/core';

function hideGettersSetters(): boolean {
  return Boolean(
    (Blockly.Variables as unknown as Record<string, unknown>)[
      '_HIDE_GETTERS_SETTERS'
    ],
  );
}

/**
 * Block list for the Variables flyout (blockly_shims.js:64-119).
 *
 * Legacy fidelity note: legacy concatenated the raw VariableModel object
 * into the Assign/AugAssign XML strings (blockly_shims.js:70-76), which
 * serialized as `[object Object]` text — the starter blocks silently LOST
 * their most-recent-variable field. We emit the field element the code
 * plainly intended; gaps, shadow, mutation, sort order, and the hidden-mode
 * label fallback are quirk-exact.
 */
export function variablesFlyoutBlocks(workspace: Blockly.Workspace): Element[] {
  const variableModelList = workspace.getVariablesOfType('');
  const xmlList: Element[] = [];
  if (variableModelList.length === 0) {
    return xmlList;
  }
  // New variables are added to the end of the variableModelList.
  const mostRecent = variableModelList[variableModelList.length - 1]!;
  const mostRecentField = Blockly.utils.xml.domToText(
    Blockly.Variables.generateVariableFieldDom(mostRecent),
  );
  const hide = hideGettersSetters();

  if (!hide && Blockly.Blocks['ast_Assign']) {
    const gap = Blockly.Blocks['ast_AugAssign'] ? 8 : 24;
    const blockText =
      '<xml>' +
      `<block type="ast_Assign" gap="${gap}">` +
      mostRecentField +
      '</block>' +
      '</xml>';
    const block = Blockly.utils.xml.textToDom(blockText).firstChild;
    xmlList.push(block as Element);
  }
  if (!hide && Blockly.Blocks['ast_AugAssign']) {
    const gap = Blockly.Blocks['ast_Name'] ? 20 : 8;
    const blockText =
      '<xml>' +
      `<block type="ast_AugAssign" gap="${gap}">` +
      mostRecentField +
      '<value name="VALUE">' +
      '<shadow type="ast_Num">' +
      '<field name="NUM">1</field>' +
      '</shadow>' +
      '</value>' +
      '<mutation options="false" simple="true"></mutation>' +
      '</block>' +
      '</xml>';
    const block = Blockly.utils.xml.textToDom(blockText).firstChild;
    xmlList.push(block as Element);
  }

  if (Blockly.Blocks['ast_Name']) {
    // Legacy compareByName override: case-SENSITIVE (`<`/`>` on raw names),
    // not Blockly's locale compare (blockly_shims.js:121-137).
    const sorted = [...variableModelList].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const variable of sorted) {
      if (!hide) {
        const block = Blockly.utils.xml.createElement('block');
        block.setAttribute('type', 'ast_Name');
        block.setAttribute('gap', '8');
        block.appendChild(Blockly.Variables.generateVariableFieldDom(variable));
        xmlList.push(block);
      } else {
        const label = Blockly.utils.xml.createElement('label');
        label.setAttribute('text', variable.name);
        label.setAttribute('web-class', 'blockmirror-toolbox-variable');
        xmlList.push(label);
      }
    }
  }
  return xmlList;
}

/**
 * Replace the workspace's default VARIABLE category callback with the
 * BlockMirror one: the standard "Create variable…" button (wired to
 * Blockly's own create-variable dialog flow) followed by the AST block list.
 */
export function installVariablesFlyout(workspace: Blockly.WorkspaceSvg): void {
  workspace.registerToolboxCategoryCallback(
    Blockly.VARIABLE_CATEGORY_NAME,
    (ws) => {
      const xmlList: Element[] = [];
      const button = document.createElement('button');
      button.setAttribute('text', '%{BKY_NEW_VARIABLE}');
      button.setAttribute('callbackKey', 'CREATE_VARIABLE');
      ws.registerButtonCallback('CREATE_VARIABLE', (flyoutButton) => {
        Blockly.Variables.createVariableButtonHandler(
          flyoutButton.getTargetWorkspace(),
        );
      });
      xmlList.push(button as unknown as Element);
      return xmlList.concat(variablesFlyoutBlocks(ws));
    },
  );
}
