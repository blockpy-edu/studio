/** Port of legacy `ast/ast_Global.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type GlobalBlock = Blockly.Block & {
  nameCount_: number;
  updateShape_(): void;
};

defineBlock('ast_Global', {
  init: function (this: GlobalBlock) {
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.VARIABLES);
    this.nameCount_ = 1;
    this.appendDummyInput('GLOBAL').appendField('make global', 'START_GLOBALS');
    this.updateShape_();
  },
  updateShape_: function (this: GlobalBlock) {
    const input = this.getInput('GLOBAL')!;
    // Update pluralization
    if (this.getField('START_GLOBALS')) {
      this.setFieldValue(this.nameCount_ > 1 ? 'make globals' : 'make global', 'START_GLOBALS');
    }
    // Update fields
    let i = 0;
    for (; i < this.nameCount_; i++) {
      if (!this.getField('NAME' + i)) {
        if (i !== 0) {
          input.appendField(',').setAlign(Blockly.inputs.Align.RIGHT);
        }
        input.appendField(new Blockly.FieldVariable('variable'), 'NAME' + i);
      }
    }
    // Remove deleted fields.
    while (this.getField('NAME' + i)) {
      input.removeField('NAME' + i);
      i++;
    }
    // Delete and re-add ending field
    if (this.getField('END_GLOBALS')) {
      input.removeField('END_GLOBALS');
    }
    input.appendField('available', 'END_GLOBALS');
  },
  /**
   * Create XML to represent list inputs.
   */
  mutationToDom: function (this: GlobalBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('names', String(this.nameCount_));
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   */
  domToMutation: function (this: GlobalBlock, xmlElement: Element) {
    this.nameCount_ = parseInt(xmlElement.getAttribute('names')!, 10);
    this.updateShape_();
  },
});

generator.forBlock['ast_Global'] = function (block) {
  const typed = block as GlobalBlock;
  // Create a list with any number of elements of any type.
  const elements = new Array<string>(typed.nameCount_);
  for (let i = 0; i < typed.nameCount_; i++) {
    elements[i] = generator.getVariableName(block.getFieldValue('NAME' + i));
  }
  return 'global ' + elements.join(', ') + '\n';
};

registerConverter(
  'Global',
  function (this: TextToBlocksConverter, node: ir.Global, _parent: unknown) {
    const names = node.names;

    const fields: Record<string, string> = {};
    for (let i = 0; i < names.length; i++) {
      fields['NAME' + i] = names[i]!;
    }

    return createBlock(
      'ast_Global',
      node.lineno,
      fields,
      {},
      {
        inline: 'true',
      },
      {
        '@names': names.length,
      },
    );
  },
);
