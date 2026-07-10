/** Port of legacy `ast/ast_Delete.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type DeleteBlock = Blockly.Block & {
  targetCount_: number;
  updateShape_(): void;
};

defineBlock('ast_Delete', {
  init: function (this: DeleteBlock) {
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.VARIABLES);
    this.targetCount_ = 1;

    this.appendDummyInput().appendField('delete');
    this.updateShape_();
  },
  updateShape_: function (this: DeleteBlock) {
    // Add new inputs.
    let i = 0;
    for (; i < this.targetCount_; i++) {
      if (!this.getInput('TARGET' + i)) {
        const input = this.appendValueInput('TARGET' + i);
        if (i !== 0) {
          input.appendField(',').setAlign(Blockly.inputs.Align.RIGHT);
        }
      }
    }
    // Remove deleted inputs.
    while (this.getInput('TARGET' + i)) {
      this.removeInput('TARGET' + i);
      i++;
    }
  },
  /**
   * Create XML to represent list inputs.
   */
  mutationToDom: function (this: DeleteBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('targets', String(this.targetCount_));
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   */
  domToMutation: function (this: DeleteBlock, xmlElement: Element) {
    this.targetCount_ = parseInt(xmlElement.getAttribute('targets')!, 10);
    this.updateShape_();
  },
});

generator.forBlock['ast_Delete'] = function (block) {
  const typed = block as DeleteBlock;
  // Create a list with any number of elements of any type.
  const elements = new Array<string>(typed.targetCount_);
  for (let i = 0; i < typed.targetCount_; i++) {
    elements[i] =
      generator.valueToCode(block, 'TARGET' + i, generator.ORDER_NONE) ||
      generator.blank;
  }
  const code = 'del ' + elements.join(', ') + '\n';
  return code;
};

registerConverter(
  'Delete',
  function (this: TextToBlocksConverter, node: ir.Delete, _parent: unknown) {
    const targets = node.targets;

    return createBlock(
      'ast_Delete',
      node.lineno,
      {},
      this.convertElements('TARGET', targets, node),
      {
        inline: 'true',
      },
      {
        '@targets': targets.length,
      },
    );
  },
);
