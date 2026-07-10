/** Port of legacy `ast/ast_BinOp.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

/**
 * `[symbol, opName, order, tooltip, augAssignVerb, augAssignPreposition]`.
 * Exported (with the derived tables below) because legacy hung these on
 * `BlockMirrorTextToBlocks` for `ast_AugAssign.js` to consume.
 */
export const BINOPS: [string, string, number, string, string, string][] = [
  ['+', 'Add', generator.ORDER_ADDITIVE, 'Return the sum of the two numbers.', 'increase', 'by'],
  ['-', 'Sub', generator.ORDER_ADDITIVE, 'Return the difference of the two numbers.', 'decrease', 'by'],
  ['*', 'Mult', generator.ORDER_MULTIPLICATIVE, 'Return the product of the two numbers.', 'multiply', 'by'],
  ['/', 'Div', generator.ORDER_MULTIPLICATIVE, 'Return the quotient of the two numbers.', 'divide', 'by'],
  ['%', 'Mod', generator.ORDER_MULTIPLICATIVE, 'Return the remainder of the first number divided by the second number.',
  'modulo', 'by'],
  ['**', 'Pow', generator.ORDER_EXPONENTIATION, 'Return the first number raised to the power of the second number.',
  'raise', 'to'],
  ['//', 'FloorDiv', generator.ORDER_MULTIPLICATIVE, 'Return the truncated quotient of the two numbers.',
  'floor divide', 'by'],
  ['<<', 'LShift', generator.ORDER_BITWISE_SHIFT, 'Return the left number left shifted by the right number.',
  'left shift', 'by'],
  ['>>', 'RShift', generator.ORDER_BITWISE_SHIFT, 'Return the left number right shifted by the right number.',
  'right shift', 'by'],
  ['|', 'BitOr', generator.ORDER_BITWISE_OR, 'Returns the bitwise OR of the two values.',
  'bitwise OR', 'using'],
  ['^', 'BitXor', generator.ORDER_BITWISE_XOR, 'Returns the bitwise XOR of the two values.',
  'bitwise XOR', 'using'],
  ['&', 'BitAnd', generator.ORDER_BITWISE_AND, 'Returns the bitwise AND of the two values.',
  'bitwise AND', 'using'],
  ['@', 'MatMult', generator.ORDER_MULTIPLICATIVE, 'Return the matrix multiplication of the two numbers.',
  'matrix multiply', 'by'],
];
export const BINOPS_SIMPLE = ['Add', 'Sub', 'Mult', 'Div', 'Mod', 'Pow'];
const BINOPS_BLOCKLY_DISPLAY_FULL: [string, string][] = BINOPS.map(
  (binop) => [binop[0], binop[1]],
);
const BINOPS_BLOCKLY_DISPLAY = BINOPS_BLOCKLY_DISPLAY_FULL.filter(
  (binop) => BINOPS_SIMPLE.indexOf(binop[1]) >= 0,
);
export const BINOPS_AUGASSIGN_DISPLAY_FULL: [string, string][] = BINOPS.map(
  (binop) => [binop[4], binop[1]],
);
export const BINOPS_AUGASSIGN_DISPLAY = BINOPS_AUGASSIGN_DISPLAY_FULL.filter(
  (binop) => BINOPS_SIMPLE.indexOf(binop[1]) >= 0,
);

export const BINOPS_BLOCKLY_GENERATE: Record<string, [string, number]> = {};
export const BINOPS_AUGASSIGN_PREPOSITION: Record<string, string> = {};
BINOPS.forEach(function (binop) {
  BINOPS_BLOCKLY_GENERATE[binop[1]] = [' ' + binop[0], binop[2]];
  BINOPS_AUGASSIGN_PREPOSITION[binop[1]] = binop[5];
  //Blockly.Constants.Math.TOOLTIPS_BY_OP[binop[1]] = binop[3];
});

defineBlocks({
  type: 'ast_BinOpFull',
  message0: '%1 %2 %3',
  args0: [
    { type: 'input_value', name: 'A' },
    { type: 'field_dropdown', name: 'OP', options: BINOPS_BLOCKLY_DISPLAY_FULL },
    { type: 'input_value', name: 'B' },
  ],
  inputsInline: true,
  output: null,
  colour: COLOR.MATH,
  //"extensions": ["math_op_tooltip"]
});

defineBlocks({
  type: 'ast_BinOp',
  message0: '%1 %2 %3',
  args0: [
    { type: 'input_value', name: 'A' },
    { type: 'field_dropdown', name: 'OP', options: BINOPS_BLOCKLY_DISPLAY },
    { type: 'input_value', name: 'B' },
  ],
  inputsInline: true,
  output: null,
  colour: COLOR.MATH,
  //"extensions": ["math_op_tooltip"]
});

generator.forBlock['ast_BinOp'] = function (block) {
  // Basic arithmetic operators, and power.
  const tuple = BINOPS_BLOCKLY_GENERATE[block.getFieldValue('OP')]!;
  const operator = tuple[0] + ' ';
  const order = tuple[1];
  const argument0 =
    generator.valueToCode(block, 'A', order) || generator.blank;
  const argument1 =
    generator.valueToCode(block, 'B', order) || generator.blank;
  const code = argument0 + operator + argument1;
  return [code, order];
};

const astBinOpConverter = function (
  this: TextToBlocksConverter,
  node: ir.BinOp,
  _parent: unknown,
) {
  const left = node.left;
  const op = node.op._astname;
  const right = node.right;

  const blockName =
    BINOPS_SIMPLE.indexOf(op) >= 0 ? 'ast_BinOp' : 'ast_BinOpFull';

  return createBlock(
    blockName,
    node.lineno,
    {
      OP: op,
    },
    {
      A: this.convert(left, node) as Element,
      B: this.convert(right, node) as Element,
    },
    {
      inline: true,
    },
  );
};
registerConverter('BinOp', astBinOpConverter);

generator.forBlock['ast_BinOpFull'] = generator.forBlock['ast_BinOp']!;
registerConverter('BinOpFull', astBinOpConverter);
