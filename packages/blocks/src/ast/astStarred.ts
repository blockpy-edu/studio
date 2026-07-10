/** Port of legacy `ast/ast_Starred.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Starred',
  message0: '*%1',
  args0: [{ type: 'input_value', name: 'VALUE' }],
  inputsInline: false,
  output: null,
  colour: COLOR.VARIABLES,
});

generator.forBlock['ast_Starred'] = function (block) {
  // Basic arithmetic operators, and power.
  const order = generator.ORDER_NONE;
  const argument1 =
    generator.valueToCode(block, 'VALUE', order) || generator.blank;
  const code = '*' + argument1;
  return [code, order];
};

registerConverter(
  'Starred',
  function (this: TextToBlocksConverter, node: ir.Starred, _parent: unknown) {
    const value = node.value;

    return createBlock(
      'ast_Starred',
      node.lineno,
      {},
      {
        VALUE: this.convert(value, node) as Element,
      },
      {
        inline: true,
      },
    );
  },
);
