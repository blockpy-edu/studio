/** Port of legacy `ast/ast_YieldFrom.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_YieldFrom',
  message0: 'yield from %1',
  args0: [{ type: 'input_value', name: 'VALUE' }],
  inputsInline: false,
  output: null,
  colour: COLOR.FUNCTIONS,
});

generator.forBlock['ast_YieldFrom'] = function (block) {
  const value = generator.valueToCode(block, 'VALUE', generator.ORDER_LAMBDA) || generator.blank;
  return ['yield from ' + value, generator.ORDER_LAMBDA];
};

registerConverter(
  'YieldFrom',
  function (this: TextToBlocksConverter, node: ir.YieldFrom, _parent: unknown) {
    const value = node.value;

    return createBlock(
      'ast_YieldFrom',
      node.lineno,
      {},
      {
        VALUE: this.convert(value, node) as Element,
      },
    );
  },
);
