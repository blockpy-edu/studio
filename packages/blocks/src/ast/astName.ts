/** Port of legacy `ast/ast_Name.js` — the variable-get block. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Name',
  message0: '%1',
  args0: [
    {
      type: 'field_variable',
      name: 'VAR',
      variable: '%{BKY_VARIABLES_DEFAULT_NAME}',
    },
  ],
  output: null,
  colour: COLOR.VARIABLES,
  extensions: ['contextMenu_variableSetterGetter_forBlockMirror'],
});

// Shape of the pre-v11 `Blockly.Constants.Variables` namespace the latent
// flyout path below still reaches for (see the preserved-verbatim comment).
type BlocklyWithVariableConstants = {
  Constants: {
    Variables: {
      RENAME_OPTION_CALLBACK_FACTORY(block: Blockly.Block): () => void;
      DELETE_OPTION_CALLBACK_FACTORY(block: Blockly.Block): () => void;
    };
  };
};

{
  /**
   * Mixin to add context menu items to create getter/setter blocks for this
   * setter/getter.
   * Used by blocks 'ast_Name' and 'ast_Assign'.
   * @mixin
   * @augments Blockly.Block
   * @package
   * @readonly
   */
  const mixin = {
    /**
     * Add menu option to create getter/setter block for this setter/getter.
     * @param {!Array} options List of menu options to add to.
     * @this Blockly.Block
     */
    customContextMenu: function (
      this: Blockly.BlockSvg,
      options: Blockly.ContextMenuRegistry.LegacyContextMenuOption[],
    ) {
      let name;
      if (!this.isInFlyout) {
        // Getter blocks have the option to create a setter block, and vice versa.
        let opposite_type, contextMenuMsg;
        if (this.type === 'ast_Name') {
          opposite_type = 'ast_Assign';
          contextMenuMsg = Blockly.Msg['VARIABLES_GET_CREATE_SET'];
        } else {
          opposite_type = 'ast_Name';
          contextMenuMsg = Blockly.Msg['VARIABLES_SET_CREATE_GET'];
        }

        // Built up field-by-field, exactly as legacy did.
        const option = {
          enabled: this.workspace.remainingCapacity() > 0,
        } as Blockly.ContextMenuRegistry.LegacyContextMenuOption;
        name = this.getField('VAR')!.getText();
        option.text = contextMenuMsg!.replace('%1', name);
        const xmlField = Blockly.utils.xml.createElement('field');
        xmlField.setAttribute('name', 'VAR');
        xmlField.appendChild(Blockly.utils.xml.createTextNode(name));
        const xmlBlock = Blockly.utils.xml.createElement('block');
        xmlBlock.setAttribute('type', opposite_type);
        xmlBlock.appendChild(xmlField);
        option.callback = Blockly.ContextMenu.callbackFactory(this, xmlBlock);
        options.push(option);
        // Getter blocks have the option to rename or delete that variable.
      } else {
        if (this.type === 'ast_Name' || this.type === 'variables_get_reporter') {
          // Preserved verbatim from legacy: `Blockly.Constants.Variables` is
          // no longer exposed by Blockly 11, so this flyout-only path was
          // already latent in the legacy build against the same version.
          const renameOption = {
            text: Blockly.Msg.RENAME_VARIABLE!,
            enabled: true,
            callback: (
              Blockly as unknown as BlocklyWithVariableConstants
            ).Constants.Variables.RENAME_OPTION_CALLBACK_FACTORY(this),
          };
          name = this.getField('VAR')!.getText();
          const deleteOption = {
            text: Blockly.Msg.DELETE_VARIABLE!.replace('%1', name),
            enabled: true,
            callback: (
              Blockly as unknown as BlocklyWithVariableConstants
            ).Constants.Variables.DELETE_OPTION_CALLBACK_FACTORY(this),
          };
          options.unshift(renameOption);
          options.unshift(deleteOption);
        }
      }
    },
  };

  Blockly.Extensions.registerMixin('contextMenu_variableSetterGetter_forBlockMirror', mixin);
}

generator.forBlock['ast_Name'] = function (block) {
  // Variable getter.
  const code = generator.getVariableName(block.getFieldValue('VAR'));
  return [code, generator.ORDER_ATOMIC];
};

registerConverter('Name', function (this: TextToBlocksConverter, node: ir.Name, _parent: unknown) {
  const id = node.id;
  // (Legacy also read `node.ctx` here, unused.)
  if (id === generator.blank) {
    return null;
  } else {
    return createBlock('ast_Name', node.lineno, {
      VAR: id,
    });
  }
});
