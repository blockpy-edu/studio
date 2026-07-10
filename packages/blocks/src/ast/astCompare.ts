/** Port of legacy `ast/ast_Compare.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

/** `[symbol, opName, tooltip]` (legacy `BlockMirrorTextToBlocks.COMPARES`). */
const COMPARES: [string, string, string][] = [
  ['==', 'Eq', 'Return whether the two values are equal.'],
  ['!=', 'NotEq', 'Return whether the two values are not equal.'],
  ['<', 'Lt', 'Return whether the left value is less than the right value.'],
  ['<=', 'LtE', 'Return whether the left value is less than or equal to the right value.'],
  ['>', 'Gt', 'Return whether the left value is greater than the right value.'],
  ['>=', 'GtE', 'Return whether the left value is greater than or equal to the right value.'],
  ['is', 'Is', 'Return whether the left value is identical to the right value.'],
  ['is not', 'IsNot', 'Return whether the left value is not identical to the right value.'],
  ['in', 'In', 'Return whether the left value is in the right value.'],
  ['not in', 'NotIn', 'Return whether the left value is not in the right value.'],
];

const COMPARES_BLOCKLY_DISPLAY: [string, string][] = COMPARES.map(
  (boolop) => [boolop[0], boolop[1]],
);
const COMPARES_BLOCKLY_GENERATE: Record<string, string> = {};
COMPARES.forEach(function (boolop) {
  COMPARES_BLOCKLY_GENERATE[boolop[1]] = boolop[0];
});

defineBlocks({
  type: 'ast_Compare',
  message0: '%1 %2 %3',
  args0: [
    { type: 'input_value', name: 'A' },
    { type: 'field_dropdown', name: 'OP', options: COMPARES_BLOCKLY_DISPLAY },
    { type: 'input_value', name: 'B' },
  ],
  inputsInline: true,
  output: null,
  colour: COLOR.LOGIC,
});

generator.forBlock['ast_Compare'] = function (block) {
  // Basic arithmetic operators, and power.
  const tuple = COMPARES_BLOCKLY_GENERATE[block.getFieldValue('OP')]!;
  const operator = ' ' + tuple + ' ';
  // ORDER_RELATIONAL exists at runtime (deprecated alias) but is not in the
  // LegacyPythonGenerator typing, hence the cast.
  const order = (generator as any).ORDER_RELATIONAL as number;
  const argument0 =
    generator.valueToCode(block, 'A', order) || generator.blank;
  const argument1 =
    generator.valueToCode(block, 'B', order) || generator.blank;
  const code = argument0 + operator + argument1;
  return [code, order];
};

registerConverter(
  'Compare',
  function (this: TextToBlocksConverter, node: ir.Compare, _parent: unknown) {
    const ops = node.ops;
    const left = node.left;
    const values = node.comparators;
    let result_block = this.convert(left, node) as Element;
    for (let i = 0; i < values.length; i += 1) {
      result_block = createBlock(
        'ast_Compare',
        node.lineno,
        {
          OP: ops[i]!._astname,
        },
        {
          A: result_block,
          B: this.convert(values[i], node) as Element,
        },
        {
          inline: 'true',
        },
      );
    }
    return result_block;
  },
);
