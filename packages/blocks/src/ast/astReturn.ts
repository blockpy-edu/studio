/** Port of legacy `ast/ast_Return.js`. */
import type * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlock('ast_ReturnFull', {
  init: function (this: Blockly.Block) {
    this.appendValueInput('VALUE').appendField('return');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.FUNCTIONS);
  },
});
// Blockly.common.defineBlocks({ast_ReturnFull: ast_ReturnFull});

// BlockMirrorTextToBlocks.BLOCKS.push({
//     "message0": "return %1",
//     "args0": [
//         {"type": "input_value", "name": "VALUE"}
//     ],
//     "inputsInline": true,
//     "previousStatement": null,
//     "nextStatement": null,
//     "colour": BlockMirrorTextToBlocks.COLOR.FUNCTIONS
// });

defineBlocks({
  type: 'ast_Return',
  message0: 'return',
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: COLOR.FUNCTIONS,
});

generator.forBlock['ast_Return'] = function () {
  return 'return\n';
};

generator.forBlock['ast_ReturnFull'] = function (block) {
  const value = generator.valueToCode(block, 'VALUE', generator.ORDER_ATOMIC) || generator.blank;
  return 'return ' + value + '\n';
};

registerConverter(
  'Return',
  function (this: TextToBlocksConverter, node: ir.Return, _parent: unknown) {
    const value = node.value;

    if (value == null) {
      return createBlock('ast_Return', node.lineno);
    } else {
      return createBlock(
        'ast_ReturnFull',
        node.lineno,
        {},
        {
          VALUE: this.convert(value, node) as Element,
        },
      );
    }
  },
);
