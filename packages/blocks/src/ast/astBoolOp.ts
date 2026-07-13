/** Port of legacy `ast/ast_BoolOp.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

/** `[keyword, opName, order, tooltip]` (legacy `BlockMirrorTextToBlocks.BOOLOPS`). */
const BOOLOPS: [string, string, number, string][] = [
  [
    'and',
    'And',
    generator.ORDER_LOGICAL_AND,
    'Return whether the left and right both evaluate to True.',
  ],
  [
    'or',
    'Or',
    generator.ORDER_LOGICAL_OR,
    'Return whether either the left or right evaluate to True.',
  ],
];
const BOOLOPS_BLOCKLY_DISPLAY: [string, string][] = BOOLOPS.map((boolop) => [boolop[0], boolop[1]]);
// Built for parity with legacy; the generator below reads the field directly.
const BOOLOPS_BLOCKLY_GENERATE: Record<string, [string, number]> = {};
BOOLOPS.forEach(function (boolop) {
  BOOLOPS_BLOCKLY_GENERATE[boolop[1]] = [' ' + boolop[0] + ' ', boolop[2]];
});

defineBlocks({
  type: 'ast_BoolOp',
  message0: '%1 %2 %3',
  args0: [
    { type: 'input_value', name: 'A' },
    { type: 'field_dropdown', name: 'OP', options: BOOLOPS_BLOCKLY_DISPLAY },
    { type: 'input_value', name: 'B' },
  ],
  inputsInline: true,
  output: null,
  colour: COLOR.LOGIC,
});

generator.forBlock['ast_BoolOp'] = function (block) {
  // Operations 'and', 'or'.
  const operator = block.getFieldValue('OP') === 'And' ? 'and' : 'or';
  const order = operator === 'and' ? generator.ORDER_LOGICAL_AND : generator.ORDER_LOGICAL_OR;
  const argument0 = generator.valueToCode(block, 'A', order) || generator.blank;
  const argument1 = generator.valueToCode(block, 'B', order) || generator.blank;
  const code = argument0 + ' ' + operator + ' ' + argument1;
  return [code, order];
};

registerConverter(
  'BoolOp',
  function (this: TextToBlocksConverter, node: ir.BoolOp, _parent: unknown) {
    const op = node.op;
    const values = node.values;
    let result_block = this.convert(values[0]!, node) as Element;
    for (let i = 1; i < values.length; i += 1) {
      result_block = createBlock(
        'ast_BoolOp',
        node.lineno,
        {
          OP: op._astname,
        },
        {
          A: result_block,
          B: this.convert(values[i]!, node) as Element,
        },
        {
          inline: 'true',
        },
      );
    }
    return result_block;
  },
);
