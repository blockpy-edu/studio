/** Port of legacy `ast/ast_UnaryOp.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

/** `[symbol, opName, tooltip]` (legacy `BlockMirrorTextToBlocks.UNARYOPS`). */
const UNARYOPS: [string, string, string][] = [
  ['+', 'UAdd', 'Do nothing to the number'],
  ['-', 'USub', 'Make the number negative'],
  ['not', 'Not', 'Return the logical opposite of the value.'],
  ['~', 'Invert', 'Take the bit inversion of the number'],
];

UNARYOPS.forEach(function (unaryop) {
  //Blockly.Constants.Math.TOOLTIPS_BY_OP[unaryop[1]] = unaryop[2];

  const fullName = 'ast_UnaryOp' + unaryop[1];

  defineBlocks({
    type: fullName,
    message0: unaryop[0] + ' %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    inputsInline: false,
    output: null,
    colour: unaryop[1] === 'Not' ? COLOR.LOGIC : COLOR.MATH,
  });

  generator.forBlock[fullName] = function (block) {
    // Basic arithmetic operators, and power.
    const order =
      unaryop[1] === 'Not'
        ? generator.ORDER_LOGICAL_NOT
        : generator.ORDER_UNARY_SIGN;
    const argument1 =
      generator.valueToCode(block, 'VALUE', order) || generator.blank;
    const code = unaryop[0] + (unaryop[1] === 'Not' ? ' ' : '') + argument1;
    return [code, order];
  };
});

registerConverter(
  'UnaryOp',
  function (this: TextToBlocksConverter, node: ir.UnaryOp, _parent: unknown) {
    const op = node.op._astname;
    const operand = node.operand;

    return createBlock(
      'ast_UnaryOp' + op,
      node.lineno,
      {},
      {
        VALUE: this.convert(operand, node) as Element,
      },
      {
        inline: false,
      },
    );
  },
);
